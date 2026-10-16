/* =========================================================
   Nexbit — Deposit Page
   File: deposit.js
   Version: 4.2 (RPC-safe chunking + RPC fallback)

   FIXES in v4.2:
   - Chunk size reduced to 50 blocks (public RPC limit-safe)
   - Added bnbchain.org / publicnode.com RPCs (no-auth)
   - Delay between chunk calls (500ms)
   - Persistent scan state
   - Pending queue for low-confirmations
   - Uses engine.creditIdempotent()

   ⚠ Client-side for testing only. Move to Cloud Functions.
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, onValue
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import engine         from "./engine.js";
import walletRegistry from "./wallet-registry.js";

const firebaseConfig = {
  apiKey: "AIzaSyDKFkbj5WRUinr_v7ARRtD-Gsxz4UlMrl0",
  authDomain: "exchang-59ea7.firebaseapp.com",
  databaseURL: "https://exchang-59ea7-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "exchang-59ea7",
  storageBucket: "exchang-59ea7.firebasestorage.app",
  messagingSenderId: "422935424250",
  appId: "1:422935424250:web:b4da15d25714e499cbed43",
  measurementId: "G-E6NV9Q2SW9"
};

const app  = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

/* =========================================================
   CONFIG
   ========================================================= */
const CHAIN_ID           = 56;
const USDT_CONTRACT      = "0x55d398326f99059fF775485246999027B3197955";
const USDT_DECIMALS      = 18;
const MIN_CONFIRMATIONS  = 3;
const MIN_DEPOSIT_USDT   = 1;
const BACKFILL_BLOCKS    = 500;
const MAX_BLOCKS_PER_SCAN = 50;      /* ✅ Public RPC limits-safe */
const DELAY_BETWEEN_CHUNKS = 500;    /* ✅ Respect rate limits */
const POLL_INTERVAL_MS   = 15_000;

/* ✅ Multiple RPCs — best free ones first */
const BSC_RPCS = [
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc.publicnode.com",
  "https://bsc-dataseed.binance.org/",
  "https://bsc-dataseed1.defibit.io/"
];

const BSC_EXPLORER = "https://bscscan.com/";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/* =========================================================
   STATE
   ========================================================= */
let currentUser      = null;
let userAddress      = null;
let pollTimer        = null;
let lastScannedBlock = null;
let isPolling        = false;
const listeners      = [];
const creditedSet    = new Set();
const pendingQueue   = new Map();

/* =========================================================
   HELPERS
   ========================================================= */
function getElement(id) { return document.getElementById(id); }

function escapeHTML(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}
function shortHash(h) { return h ? h.slice(0,12) + "…" + h.slice(-6) : "—"; }

function showToast(message, type = "success", duration = null) {
  const container = getElement("toastContainer");
  if (!container) return;
  const icons  = { success:"✓", error:"✕", warning:"⚠", info:"ℹ" };
  const colors = {
    success:"var(--neon-green)", error:"var(--danger)",
    warning:"var(--warning)",    info:"var(--neon-cyan)"
  };
  const show = duration || (type === "error" ? 8000 : type === "warning" ? 7000 : 5000);
  const toast = document.createElement("div");
  toast.className = `toast-custom ${type}`;
  toast.innerHTML = `
    <span class="ico" style="color:${colors[type] || colors.info};">${icons[type] || icons.info}</span>
    <span class="toast-msg">${escapeHTML(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(120%)";
    setTimeout(() => toast.remove(), 300);
  }, show);
}

/* =========================================================
   SIDEBAR + LOGOUT
   ========================================================= */
window.toggleSidebar = () => {
  getElement("sidebar")?.classList.toggle("open");
  getElement("sidebarOverlay")?.classList.toggle("show");
};
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    getElement("sidebar")?.classList.remove("open");
    getElement("sidebarOverlay")?.classList.remove("show");
  }
});
window.logoutUser = async (e) => {
  if (e) e.preventDefault();
  stopPolling();
  try {
    await signOut(auth);
    localStorage.removeItem("Nexbit_User");
    window.location.href = "index.html";
  } catch { showToast("Logout failed", "error"); }
};

/* =========================================================
   RPC — with retry + fallback
   ========================================================= */
async function rpcCall(method, params, timeoutMs = 10000) {
  let lastError = "unknown";

  for (const rpc of BSC_RPCS) {
    try {
      const resp = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!resp.ok) { lastError = `HTTP ${resp.status}`; continue; }
      const data = await resp.json();
      if (data && data.result !== undefined) return data.result;
      if (data && data.error) {
        lastError = data.error.message || "RPC error";
        console.warn(`[deposit] RPC ${rpc} (${method}): ${lastError}`);
        continue;
      }
    } catch (err) {
      lastError = err.message;
      console.warn(`[deposit] RPC ${rpc} (${method}) failed: ${lastError}`);
    }
  }
  throw new Error(`All RPCs failed for ${method}: ${lastError}`);
}

async function rpcBlockNumber() {
  const hex = await rpcCall("eth_blockNumber", []);
  return parseInt(hex, 16);
}

async function rpcGetLogs(fromBlock, toBlock, address, topics) {
  return rpcCall("eth_getLogs", [{
    fromBlock: "0x" + fromBlock.toString(16),
    toBlock:   "0x" + toBlock.toString(16),
    address, topics
  }]);
}

async function rpcGetTransactionReceipt(txHash) {
  return rpcCall("eth_getTransactionReceipt", [txHash]);
}

/* =========================================================
   ADDRESS
   ========================================================= */
async function ensureUserAddress(uid) {
  const existing = await walletRegistry.getUserAddress(uid);
  if (existing) return existing;
  return await walletRegistry.assignAddress(uid);
}

/* =========================================================
   PERSISTENT SCAN STATE
   ========================================================= */
async function loadScanState(uid) {
  try {
    const snap = await get(ref(db, `depositScanState/${uid}/lastBlock`));
    if (snap.exists()) return Number(snap.val()) || null;
  } catch (err) {
    console.warn("[deposit] loadScanState failed:", err.message);
  }
  return null;
}

async function saveScanState(uid, blockNumber) {
  try {
    await set(ref(db, `depositScanState/${uid}/lastBlock`), blockNumber);
  } catch (err) {
    console.warn("[deposit] saveScanState failed:", err.message);
  }
}

/* =========================================================
   DUPLICATE PROTECTION
   ========================================================= */
function eventKey(txHash, logIndex) { return `56_${txHash}_${logIndex}`; }

async function isEventProcessed(key) {
  try {
    const snap = await get(ref(db, `depositEvents/${key}`));
    return snap.exists();
  } catch { return false; }
}
async function markEventProcessing(key, data) {
  await set(ref(db, `depositEvents/${key}`), {
    ...data,
    processingStatus: "processing",
    startedAt: new Date().toISOString()
  });
}
async function markEventDone(key, status) {
  await update(ref(db, `depositEvents/${key}`), {
    processingStatus: status,
    completedAt: new Date().toISOString()
  });
}

/* =========================================================
   PENDING QUEUE
   ========================================================= */
async function persistPendingDeposit(uid, key, data) {
  try {
    await set(ref(db, `users/${uid}/pendingDeposits/${key}`), {
      ...data,
      queuedAt: new Date().toISOString()
    });
  } catch (err) {
    console.warn("[deposit] persistPending failed:", err.message);
  }
}
async function removePendingDeposit(uid, key) {
  try {
    await set(ref(db, `users/${uid}/pendingDeposits/${key}`), null);
  } catch (err) {
    console.warn("[deposit] removePending failed:", err.message);
  }
}

/* =========================================================
   SCAN (chunked, delayed)
   ========================================================= */
async function scanForDeposits() {
  if (isPolling || !currentUser || !userAddress) return;
  isPolling = true;

  try {
    const latest = await rpcBlockNumber();

    if (lastScannedBlock === null) {
      const saved = await loadScanState(currentUser.uid);
      lastScannedBlock = saved !== null
        ? saved
        : Math.max(0, latest - BACKFILL_BLOCKS);
      console.log(`[deposit] Scan start: ${lastScannedBlock} (latest: ${latest})`);
    }

    const fromBlock = lastScannedBlock + 1;
    const toBlock   = Math.min(latest, fromBlock + MAX_BLOCKS_PER_SCAN);

    if (fromBlock <= toBlock) {
      await scanRange(fromBlock, toBlock);
      lastScannedBlock = toBlock;
      await saveScanState(currentUser.uid, toBlock);
    }

    await retryPendingDeposits();
    updateScanStatus(toBlock);

  } catch (err) {
    console.warn("[deposit] Scan failed:", err.message);
    updateScanStatus(null, err.message);
  } finally {
    isPolling = false;
  }
}

async function scanRange(fromBlock, toBlock) {
  const paddedTo = "0x" + userAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0");

  /* ✅ Split into 50-block chunks */
  const CHUNK = 50;
  let cursor = fromBlock;

  while (cursor <= toBlock) {
    const chunkEnd = Math.min(toBlock, cursor + CHUNK - 1);

    try {
      const logs = await rpcGetLogs(cursor, chunkEnd, USDT_CONTRACT, [
        TRANSFER_TOPIC, null, paddedTo
      ]);

      if (Array.isArray(logs) && logs.length > 0) {
        console.log(`[deposit] Found ${logs.length} transfer(s) in ${cursor}-${chunkEnd}`);
        for (const log of logs) {
          try { await handleIncomingLog(log); }
          catch (err) { console.warn("[deposit] Log handle error:", err.message); }
        }
      }
    } catch (err) {
      console.warn(`[deposit] Chunk ${cursor}-${chunkEnd} failed:`, err.message);
      /* Don't advance past failed chunk — retry next scan */
      return;
    }

    /* ✅ Delay to respect rate limits */
    await new Promise(r => setTimeout(r, DELAY_BETWEEN_CHUNKS));
    cursor = chunkEnd + 1;
  }
}

/* =========================================================
   HANDLE ONE LOG
   ========================================================= */
async function handleIncomingLog(log) {
  const txHash   = log.transactionHash;
  const logIndex = parseInt(log.logIndex, 16);
  const blockNum = parseInt(log.blockNumber, 16);
  const key      = eventKey(txHash, logIndex);

  if (creditedSet.has(key)) return;
  if (await isEventProcessed(key)) { creditedSet.add(key); return; }

  const rawAmount = BigInt(log.data);
  const divisor   = 10n ** BigInt(USDT_DECIMALS);
  const whole = rawAmount / divisor;
  const frac  = rawAmount % divisor;
  const fracStr = frac.toString().padStart(USDT_DECIMALS, "0").slice(0, 6);
  const amount = parseFloat(`${whole}.${fracStr}`);

  if (!Number.isFinite(amount) || amount < MIN_DEPOSIT_USDT) {
    console.log(`[deposit] Below minimum (${amount}) — skipping`);
    return;
  }

  const currentBlock = await rpcBlockNumber();
  const confirmations = Math.max(0, currentBlock - blockNum);

  if (confirmations < MIN_CONFIRMATIONS) {
    console.log(`[deposit] Queuing ${txHash} (${confirmations}/${MIN_CONFIRMATIONS})`);
    const pendingData = {
      txHash, logIndex, blockNumber: blockNum,
      amount, amountRaw: rawAmount.toString(),
      detectedAt: new Date().toISOString()
    };
    pendingQueue.set(key, pendingData);
    await persistPendingDeposit(currentUser.uid, key, pendingData);
    updateStatus("confirming", { amount, txHash, blockNumber: blockNum });
    return;
  }

  await finalizeDeposit(log, key, amount, blockNum, confirmations);
}

/* =========================================================
   RETRY PENDING
   ========================================================= */
async function retryPendingDeposits() {
  if (pendingQueue.size === 0) return;

  for (const [key, p] of Array.from(pendingQueue.entries())) {
    try {
      const currentBlock = await rpcBlockNumber();
      const confirmations = Math.max(0, currentBlock - p.blockNumber);

      if (confirmations >= MIN_CONFIRMATIONS) {
        const fakeLog = {
          transactionHash: p.txHash,
          logIndex: "0x" + p.logIndex.toString(16),
          blockNumber: "0x" + p.blockNumber.toString(16),
          data: "0x" + BigInt(p.amountRaw).toString(16),
          topics: [TRANSFER_TOPIC]
        };
        await finalizeDeposit(fakeLog, key, p.amount, p.blockNumber, confirmations);
        pendingQueue.delete(key);
        await removePendingDeposit(currentUser.uid, key);
      }
    } catch (err) {
      console.warn(`[deposit] Pending retry failed:`, err.message);
    }
  }
}

/* =========================================================
   FINALIZE
   ========================================================= */
async function finalizeDeposit(log, key, amount, blockNum, confirmations) {
  let receipt;
  try {
    receipt = await rpcGetTransactionReceipt(log.transactionHash);
  } catch (err) {
    console.warn(`[deposit] Receipt failed:`, err.message);
    return;
  }
  if (!receipt || receipt.status !== "0x1") {
    console.warn(`[deposit] Tx failed: ${log.transactionHash}`);
    return;
  }

  try {
    await markEventProcessing(key, {
      txHash: log.transactionHash,
      logIndex: parseInt(log.logIndex, 16),
      blockNumber: blockNum,
      chainId: CHAIN_ID,
      tokenContract: USDT_CONTRACT,
      toAddress: userAddress,
      amountRaw: log.data,
      amount, uid: currentUser.uid
    });
  } catch (err) { console.warn("[deposit] markProcessing failed:", err.message); }

  const depositId = `dep_${blockNum}_${log.transactionHash.slice(2, 10)}_${parseInt(log.logIndex, 16)}`;

  try {
    await set(ref(db, `deposits/${depositId}`), {
      uid: currentUser.uid,
      txHash: log.transactionHash,
      logIndex: parseInt(log.logIndex, 16),
      chainId: CHAIN_ID,
      tokenContract: USDT_CONTRACT,
      toAddress: userAddress,
      amountRaw: log.data,
      amount, blockNumber: blockNum, confirmations,
      status: "confirmed",
      detectedAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString()
    });
    await set(ref(db, `users/${currentUser.uid}/deposits/${depositId}`), {
      txHash: log.transactionHash,
      logIndex: parseInt(log.logIndex, 16),
      amount, blockNumber: blockNum, confirmations,
      asset: "USDT", network: "BEP20",
      status: "confirmed",
      createdAt: new Date().toISOString()
    });
    await set(ref(db, `users/${currentUser.uid}/transactions/${depositId}`), {
      type: "deposit", asset: "USDT", amount,
      txHash: log.transactionHash, blockNumber: blockNum,
      status: "success", timestamp: Date.now()
    });
  } catch (err) { console.warn("[deposit] Record save failed:", err.message); }

  const reference = `deposit_${log.transactionHash}_${parseInt(log.logIndex, 16)}`;

  try {
    const result = await engine.creditIdempotent(
      currentUser.uid, "USDT", amount, reference,
      { txHash: log.transactionHash, blockNumber: blockNum, type: "deposit" }
    );

    await markEventDone(key, "credited");
    creditedSet.add(key);

    updateStatus("credited", { amount, txHash: log.transactionHash, blockNumber: blockNum });
    showToast(`✅ Credited ${amount.toFixed(4)} USDT`, "success", 8000);

    const newBal = await engine.getBalance(currentUser.uid, "USDT");
    updateBalanceUI(newBal.available);
    refreshDepositsList();

  } catch (err) {
    console.error(`[deposit] Credit failed:`, err.message);
    await markEventDone(key, "failed");
    updateStatus("failed", { amount, txHash: log.transactionHash, error: err.message });
    showToast(`Credit failed: ${err.message}`, "error", 8000);
    pendingQueue.set(key, {
      txHash: log.transactionHash,
      logIndex: parseInt(log.logIndex, 16),
      blockNumber: blockNum, amount,
      amountRaw: log.data,
      detectedAt: new Date().toISOString(),
      lastError: err.message
    });
  }
}

/* =========================================================
   UI
   ========================================================= */
function updateScanStatus(blockNumber, error) {
  const el = getElement("scanStatus");
  const blockEl = getElement("scanBlock");
  if (!el) return;
  if (error) {
    el.textContent = "Scanner error";
    el.className = "status-value failed";
    if (blockEl) blockEl.textContent = error.slice(0, 60);
    return;
  }
  el.textContent = "Scanning";
  el.className = "status-value confirming";
  if (blockEl) blockEl.textContent = blockNumber ? `Block #${blockNumber}` : "…";
}

function updateStatus(type, data = {}) {
  const statusEl = getElement("depositStatus");
  const amountEl = getElement("statusAmount");
  const txEl     = getElement("statusTx");
  const blockEl  = getElement("statusBlock");
  if (!statusEl) return;

  const labels = {
    waiting:    { text: "Waiting for transfer", cls: "waiting" },
    detected:   { text: "Deposit detected",     cls: "detected" },
    confirming: { text: "Confirming…",          cls: "confirming" },
    credited:   { text: "Credited ✓",           cls: "credited" },
    failed:     { text: "Failed",               cls: "failed" }
  };
  const l = labels[type] || labels.waiting;
  statusEl.className = `status-value ${l.cls}`;
  statusEl.innerHTML = `<span class="pulse-dot"></span>${l.text}`;

  if (amountEl && data.amount !== undefined) amountEl.textContent = `${Number(data.amount).toFixed(6)} USDT`;
  if (txEl && data.txHash) txEl.innerHTML = `<a href="${BSC_EXPLORER}tx/${data.txHash}" target="_blank" rel="noopener noreferrer" class="tx-link">${escapeHTML(shortHash(data.txHash))}</a>`;
  if (blockEl && data.blockNumber) blockEl.textContent = `#${data.blockNumber}`;
  if (data.error && blockEl) blockEl.textContent = data.error.slice(0, 60);
}

function updateBalanceUI(newBalance) {
  const el = getElement("depositBalance");
  if (el) el.textContent = "$" + (Number(newBalance) || 0).toFixed(2);
}

function refreshDepositsList() {
  if (!currentUser) return;
  const wrap = getElement("recentDeposits");
  if (!wrap) return;

  onValue(ref(db, `users/${currentUser.uid}/deposits`), snap => {
    if (!snap.exists()) {
      wrap.innerHTML = `<div class="empty-state"><span class="emoji">📥</span><p>No deposits yet.</p></div>`;
      return;
    }
    const list = Object.entries(snap.val())
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 10);

    wrap.innerHTML = list.map(d => {
      const amount = Number(d.amount || 0).toFixed(4);
      const dateStr = d.createdAt ? new Date(d.createdAt).toLocaleString("en-IN") : "—";
      const shortTx = d.txHash ? shortHash(d.txHash) : "";
      const txLink = d.txHash
        ? `<a href="${BSC_EXPLORER}tx/${d.txHash}" target="_blank" rel="noopener noreferrer" class="tx-link">${escapeHTML(shortTx)}</a>`
        : "—";
      return `
        <div class="deposit-item">
          <div>
            <div class="amt">$${escapeHTML(amount)} USDT</div>
            <div class="date">${escapeHTML(dateStr)}</div>
          </div>
          <div style="text-align:right;">
            <span class="badge-verified">✓ Verified</span>
            <div class="badges">
              ${d.blockNumber ? `<span class="badge-mini badge-block">Block: ${escapeHTML(String(d.blockNumber))}</span>` : ""}
              ${txLink}
            </div>
          </div>
        </div>`;
    }).join("");
  });
}

/* =========================================================
   POLLING
   ========================================================= */
function startPolling() {
  stopPolling();
  scanForDeposits();
  pollTimer = setInterval(scanForDeposits, POLL_INTERVAL_MS);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/* =========================================================
   RENDER PAGE
   ========================================================= */
function renderDepositUI(balance, address) {
  const container = getElement("depositContent");
  if (!container) return;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(address)}&color=00f0ff&bgcolor=050814`;

  container.innerHTML = `
    <div class="page-head">
      <h1>Deposit <span>USDT</span></h1>
      <p>Send USDT (BEP20) to your unique deposit address — balance credits automatically.</p>
    </div>

    <div class="balance-card">
      <div class="balance-label">Your USDT Balance</div>
      <div class="balance-amount" id="depositBalance">$${(Number(balance) || 0).toFixed(2)}</div>
      <div class="balance-badge"><span>🛡</span> Auto-Verified on BSC</div>
    </div>

    <div class="deposit-card">
      <div class="card-title"><span class="ico">📥</span> Your Unique Deposit Address</div>
      <div class="qr-address-grid">
        <div class="qr-box"><img src="${qrUrl}" alt="Deposit QR" /></div>
        <div class="address-block">
          <div class="address-label">BNB Smart Chain (BEP20) · USDT</div>
          <div class="address-value" id="depositAddress">${escapeHTML(address)}</div>
          <div class="address-actions">
            <button class="btn btn-primary" id="copyAddressBtn">📋 Copy Address</button>
            <button class="btn btn-ghost" id="shareAddressBtn">🔗 Share</button>
          </div>
          <div class="address-note">
            <strong>⚠ Only send USDT (BEP20) to this address.</strong><br>
            Sending any other token or network will result in <strong>permanent loss</strong>.<br>
            Minimum: <strong>${MIN_DEPOSIT_USDT} USDT</strong> · Confirmations: <strong>${MIN_CONFIRMATIONS}</strong>
          </div>
        </div>
      </div>

      <div class="status-panel">
        <div class="status-panel-title">🔴 Live Deposit Monitoring</div>
        <div class="status-row"><span class="status-label">Status</span>
          <span class="status-value waiting" id="depositStatus"><span class="pulse-dot"></span>Waiting for transfer</span></div>
        <div class="status-row"><span class="status-label">Detected Amount</span><span class="status-value" id="statusAmount">—</span></div>
        <div class="status-row"><span class="status-label">Transaction</span><span class="status-value" id="statusTx">—</span></div>
        <div class="status-row"><span class="status-label">Block</span><span class="status-value" id="statusBlock">—</span></div>
        <div class="status-row"><span class="status-label">Scanner</span>
          <span class="status-value confirming" id="scanStatus"><span class="pulse-dot"></span>Starting…</span></div>
        <div class="status-row"><span class="status-label">Last Block</span><span class="status-value" id="scanBlock">—</span></div>
      </div>
    </div>

    <div class="deposit-card">
      <div class="card-title"><span class="ico">⚠️</span> Important</div>
      <div class="warning-box">
        <span class="icon">⚠️</span>
        <div>
          <strong>Send only USDT (BEP20) on BNB Smart Chain</strong>
          <ul>
            <li>Network: <strong>BSC</strong></li>
            <li>Token: <strong>USDT (BEP20)</strong></li>
            <li>Contract: <span class="contract">${USDT_CONTRACT}</span></li>
            <li>Minimum: <strong>${MIN_DEPOSIT_USDT} USDT</strong></li>
            <li>Confirmations: <strong>${MIN_CONFIRMATIONS}</strong></li>
          </ul>
        </div>
      </div>
    </div>

    <div class="deposit-card">
      <div class="card-title"><span class="ico">📜</span> Recent Deposits</div>
      <div id="recentDeposits">
        <div class="loading-box"><div class="spinner"></div><div>Loading deposits…</div></div>
      </div>
    </div>
  `;

  getElement("copyAddressBtn")?.addEventListener("click", () => copyToClipboard(address));
  getElement("shareAddressBtn")?.addEventListener("click", async () => {
    const text = `Deposit USDT (BEP20) to:\n${address}\nNetwork: BNB Smart Chain`;
    if (navigator.share) {
      try { await navigator.share({ title: "Nexbit Deposit", text }); } catch (_) {}
    } else { copyToClipboard(text); }
  });
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Address copied", "success", 2500);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); showToast("Copied", "success", 2500); }
    catch { showToast("Copy failed", "error"); }
    ta.remove();
  }
}

/* =========================================================
   AUTH STATE
   ========================================================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUser = user;

  const name  = user.displayName || "Trader";
  const first = name.split(" ")[0];
  const un = getElement("userName");
  const ua = getElement("userAvatar");
  if (un) un.textContent = first;
  if (ua) ua.textContent = first.charAt(0).toUpperCase();

  const container = getElement("depositContent");
  if (container) {
    container.innerHTML = `<div class="loading-box"><div class="spinner"></div><div>Assigning your deposit address…</div></div>`;
  }

  try {
    await engine.ensureWallets(user.uid);
    const address = await ensureUserAddress(user.uid);
    userAddress = address;
    console.log("[deposit] Address:", userAddress);

    let balance = 0;
    try {
      const bal = await engine.getBalance(user.uid, "USDT");
      balance = bal.available || 0;
    } catch (_) {}

    renderDepositUI(balance, userAddress);
    refreshDepositsList();

    const balRef = ref(db, `balances/${user.uid}/USDT`);
    const unsub = onValue(balRef, snap => {
      if (snap.exists()) updateBalanceUI(snap.val().available);
    });
    listeners.push(unsub);

    try {
      const pendingSnap = await get(ref(db, `users/${user.uid}/pendingDeposits`));
      if (pendingSnap.exists()) {
        Object.entries(pendingSnap.val()).forEach(([k, v]) => {
          pendingQueue.set(k, v);
        });
        console.log(`[deposit] Loaded ${pendingQueue.size} pending deposits`);
      }
    } catch (_) {}

    startPolling();

  } catch (err) {
    console.error("[deposit] Init failed:", err);
    if (container) {
      container.innerHTML = `
        <div class="empty-state" style="padding:60px 20px;">
          <span class="emoji">⚠️</span>
          <h4 style="color:#fff;margin-bottom:8px;">Deposit Unavailable</h4>
          <p style="color:var(--text-dim);">${escapeHTML(err.message || "Setup failed")}</p>
        </div>`;
    }
  }
});

window.addEventListener("beforeunload", () => {
  stopPolling();
  listeners.forEach(unsub => { try { unsub(); } catch (_) {} });
});
