/* =========================================================
   Nexbit — Deposit Page
   File: deposit.js
   Version: 4.0 (Automatic blockchain monitoring + auto-credit)

   ARCHITECTURE:
   1. User logs in → unique BSC deposit address assigned from pool
   2. User sends USDT (BEP20) to that address
   3. This script polls BSC RPC every 15s for incoming transfers
   4. On detection: verify contract + receiver + amount
   5. Wait for confirmations → credit balance atomically
   6. Real-time UI updates via Firebase listener

   ⚠ SECURITY NOTE — CRITICAL:
   This runs CLIENT-SIDE for INTERNAL TESTING ONLY.
   Before public launch, the following MUST move to Cloud Functions:
   - Blockchain scanning
   - Balance crediting
   - Duplicate protection
   
   Client-side balance credit is INSECURE. Anyone can modify
   this code to credit themselves. This is acceptable ONLY for
   testing with test funds and a closed group.

   Contract (USDT BEP20): 0x55d398326f55d3983...
   Address pool:          managed in wallet-registry.js
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, onValue, runTransaction, push
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* Import engine for balance credit */
import engine from "./engine.js";

/* Import wallet registry for address assignment */
import walletRegistry from "./wallet-registry.js";

/* =========================================================
   1. FIREBASE CONFIG
   ========================================================= */
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
   2. CONFIG — BSC + USDT
   ========================================================= */
const CHAIN_ID = 56;                                       // BSC Mainnet
const USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955"; // USDT BEP20
const USDT_DECIMALS = 18;
const MIN_CONFIRMATIONS = 3;
const MIN_DEPOSIT_USDT  = 1;

/* Multiple RPC endpoints */
const BSC_RPCS = [
  "https://bsc-dataseed.binance.org/",
  "https://bsc-dataseed1.defibit.io/",
  "https://bsc-dataseed1.ninicoin.io/",
  "https://rpc.ankr.com/bsc"
];

/* BSCScan */
const BSC_EXPLORER = "https://bscscan.com/";

/* Polling interval */
const POLL_INTERVAL_MS = 15_000;   // 15 seconds

/* Transfer(address,address,uint256) topic */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/* =========================================================
   3. STATE
   ========================================================= */
let currentUser   = null;
let userAddress   = null;    // BSC deposit address assigned to this user
let userAddressInfo = null;  // full record
let pollTimer     = null;
let lastScannedBlock = null;
let isPolling     = false;
let listeners     = [];

/* Cache of already-credited deposits to avoid re-checking */
const creditedTxSet = new Set();

/* =========================================================
   4. HELPERS
   ========================================================= */
function getElement(id) { return document.getElementById(id); }

function escapeHTML(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}

function showToast(message, type = "success", duration = null) {
  const container = getElement("toastContainer");
  if (!container) return;

  const icons  = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };
  const colors = {
    success: "var(--neon-green)",
    error:   "var(--danger)",
    warning: "var(--warning)",
    info:    "var(--neon-cyan)"
  };

  const show = duration || (type === "error" ? 8000 : type === "warning" ? 7000 : 5000);

  const toast = document.createElement("div");
  toast.className = `toast-custom ${type}`;
  toast.innerHTML = `
    <span class="ico" style="color:${colors[type] || colors.info};">
      ${icons[type] || icons.info}
    </span>
    <span class="toast-msg">${escapeHTML(message)}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(120%)";
    setTimeout(() => toast.remove(), 300);
  }, show);
}

function shortAddress(addr) {
  if (!addr) return "—";
  return addr.slice(0, 8) + "…" + addr.slice(-6);
}

function shortHash(h) {
  if (!h) return "—";
  return h.slice(0, 12) + "…" + h.slice(-6);
}

/* =========================================================
   5. SIDEBAR + LOGOUT
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
   6. BSC RPC CALLS
   ========================================================= */

async function rpcCall(method, params) {
  for (const rpc of BSC_RPCS) {
    try {
      const resp = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: Date.now(),
          method, params
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data && data.result !== undefined) return data.result;
      if (data && data.error) throw new Error(data.error.message || "RPC error");
    } catch (err) {
      console.warn(`RPC ${rpc} failed:`, err.message);
    }
  }
  throw new Error(`All RPCs failed for ${method}`);
}

async function rpcBlockNumber() {
  const hex = await rpcCall("eth_blockNumber", []);
  return parseInt(hex, 16);
}

async function rpcGetLogs(fromBlock, toBlock, address, topics) {
  return rpcCall("eth_getLogs", [{
    fromBlock: "0x" + fromBlock.toString(16),
    toBlock:   "0x" + toBlock.toString(16),
    address,
    topics
  }]);
}

async function rpcGetTransactionReceipt(txHash) {
  return rpcCall("eth_getTransactionReceipt", [txHash]);
}

/* =========================================================
   7. ADDRESS ASSIGNMENT (uses wallet-registry)
   ========================================================= */
async function ensureUserAddress(uid) {
  /* Check if user already has an address */
  const existing = await walletRegistry.getUserAddress(uid);
  if (existing) return existing;

  /* Assign a new one from pool */
  const assigned = await walletRegistry.assignAddress(uid);
  if (!assigned) {
    throw new Error("No deposit addresses available in the pool. Contact admin.");
  }
  return assigned;
}

/* =========================================================
   8. DUPLICATE / CREDIT PROTECTION
   ========================================================= */
function eventKey(txHash, logIndex) {
  return `56_${txHash}_${logIndex}`;
}

async function isEventProcessed(key) {
  const snap = await get(ref(db, `depositEvents/${key}`));
  return snap.exists();
}

async function markEventProcessing(key, data) {
  await set(ref(db, `depositEvents/${key}`), {
    ...data,
    processingStatus: "processing",
    startedAt: new Date().toISOString()
  });
}

async function markEventDone(key, status = "credited") {
  await update(ref(db, `depositEvents/${key}`), {
    processingStatus: status,
    completedAt: new Date().toISOString()
  });
}

/* =========================================================
   9. SCAN FOR DEPOSITS (core)
   ========================================================= */
async function scanForDeposits() {
  if (isPolling || !currentUser || !userAddress) return;
  isPolling = true;

  try {
    const latest = await rpcBlockNumber();

    /* First run: start from latest - 100 blocks */
    if (lastScannedBlock === null) {
      lastScannedBlock = latest - 100;
    }

    /* Don't scan too many blocks at once */
    const fromBlock = lastScannedBlock + 1;
    const toBlock   = Math.min(latest, fromBlock + 200);
    if (fromBlock > toBlock) {
      isPolling = false;
      return;
    }

    /* Filter: USDT Transfer to our user's address */
    const paddedTo = "0x" + userAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0");

    const logs = await rpcGetLogs(fromBlock, toBlock, USDT_CONTRACT, [
      TRANSFER_TOPIC,
      null,          // from = any
      paddedTo       // to = our user's address
    ]);

    if (Array.isArray(logs) && logs.length > 0) {
      for (const log of logs) {
        try {
          await processDepositLog(log);
        } catch (err) {
          console.warn("Deposit log processing failed:", err);
        }
      }
    }

    lastScannedBlock = toBlock;

    /* Update UI scanning status */
    updateScanStatus(toBlock);

  } catch (err) {
    console.warn("Scan failed:", err);
    updateScanStatus(null, err.message);
  } finally {
    isPolling = false;
  }
}

/* =========================================================
   10. PROCESS A SINGLE DEPOSIT LOG
   ========================================================= */
async function processDepositLog(log) {
  const txHash    = log.transactionHash;
  const logIndex  = parseInt(log.logIndex, 16);
  const blockNum  = parseInt(log.blockNumber, 16);
  const key       = eventKey(txHash, logIndex);

  /* Duplicate protection via local cache */
  if (creditedTxSet.has(key)) return;

  /* Duplicate protection via Firebase */
  if (await isEventProcessed(key)) {
    creditedTxSet.add(key);
    return;
  }

  /* Decode amount */
  const rawAmount = BigInt(log.data);
  const divisor   = 10n ** BigInt(USDT_DECIMALS);
  const whole = rawAmount / divisor;
  const frac  = rawAmount % divisor;
  const fracStr = frac.toString().padStart(USDT_DECIMALS, "0").slice(0, 6);
  const amount = parseFloat(`${whole}.${fracStr}`);

  if (!Number.isFinite(amount) || amount < MIN_DEPOSIT_USDT) {
    console.log(`Ignoring deposit below minimum (${amount})`);
    return;
  }

  /* Confirm transaction was successful */
  const receipt = await rpcGetTransactionReceipt(txHash);
  if (!receipt || receipt.status !== "0x1") {
    console.log("Transaction failed or missing:", txHash);
    return;
  }

  /* Wait for confirmations */
  const currentBlock = await rpcBlockNumber();
  const confirmations = Math.max(0, currentBlock - blockNum);
  if (confirmations < MIN_CONFIRMATIONS) {
    console.log(`Only ${confirmations} confirmations, waiting…`);
    return;
  }

  /* Mark as processing */
  await markEventProcessing(key, {
    txHash,
    logIndex,
    blockNumber: blockNum,
    chainId: CHAIN_ID,
    tokenContract: USDT_CONTRACT,
    toAddress: userAddress,
    amountRaw: rawAmount.toString(),
    amount,
    uid: currentUser.uid
  });

  /* Save deposit record */
  const depositId = `dep_${Date.now()}_${txHash.slice(2, 10)}`;
  await set(ref(db, `deposits/${depositId}`), {
    uid: currentUser.uid,
    txHash,
    logIndex,
    chainId: CHAIN_ID,
    tokenContract: USDT_CONTRACT,
    fromAddress: log.topics[1] ? "0x" + log.topics[1].slice(26) : "",
    toAddress: userAddress,
    amountRaw: rawAmount.toString(),
    amount,
    blockNumber: blockNum,
    confirmations,
    status: "confirmed",
    detectedAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString()
  });

  /* Save to user's deposits */
  await set(ref(db, `users/${currentUser.uid}/deposits/${depositId}`), {
    txHash,
    logIndex,
    amount,
    blockNumber: blockNum,
    confirmations,
    asset: "USDT",
    network: "BEP20",
    status: "confirmed",
    createdAt: new Date().toISOString()
  });

  /* Save to user's transactions */
  await set(ref(db, `users/${currentUser.uid}/transactions/${depositId}`), {
    type: "deposit",
    asset: "USDT",
    amount,
    txHash,
    blockNumber: blockNum,
    status: "success",
    timestamp: Date.now()
  });

  /* Credit balance via engine (atomic) */
  try {
    await engine.ensureWallets(currentUser.uid);
    await engine.creditBalance(
      currentUser.uid,
      "USDT",
      amount,
      `deposit_${txHash}`
    );

    /* Mark event done */
    await markEventDone(key, "credited");
    creditedTxSet.add(key);

    /* Update UI */
    updateStatus("credited", {
      amount,
      txHash,
      blockNumber: blockNum
    });
    showToast(`✅ Deposit credited: ${amount.toFixed(4)} USDT`, "success", 8000);

    /* Update balance display */
    const newBal = await engine.getBalance(currentUser.uid, "USDT");
    updateBalanceUI(newBal.available);

    /* Refresh recent deposits list */
    refreshDepositsList();

  } catch (err) {
    console.error("Credit failed:", err);
    await markEventDone(key, "failed");
    updateStatus("failed", { amount, txHash, error: err.message });
    showToast(`Credit failed: ${err.message}`, "error", 8000);
  }
}

/* =========================================================
   11. STATUS UI UPDATES
   ========================================================= */
function updateScanStatus(blockNumber, error) {
  const el = getElement("scanStatus");
  const blockEl = getElement("scanBlock");
  if (!el) return;

  if (error) {
    el.textContent = "Scanner error";
    el.className = "status-value failed";
    if (blockEl) blockEl.textContent = error;
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
  statusEl.innerHTML = `
    <span class="pulse-dot"></span>
    ${l.text}
  `;

  if (amountEl && data.amount !== undefined) {
    amountEl.textContent = `${Number(data.amount).toFixed(6)} USDT`;
  }
  if (txEl && data.txHash) {
    txEl.innerHTML = `
      <a href="${BSC_EXPLORER}tx/${data.txHash}" target="_blank" rel="noopener noreferrer" class="tx-link">
        ${escapeHTML(shortHash(data.txHash))}
      </a>
    `;
  }
  if (blockEl && data.blockNumber) {
    blockEl.textContent = `#${data.blockNumber}`;
  }
  if (data.error) {
    if (blockEl) blockEl.textContent = data.error;
  }
}

function updateBalanceUI(newBalance) {
  const el = getElement("depositBalance");
  if (el) el.textContent = "$" + (Number(newBalance) || 0).toFixed(2);
}

/* =========================================================
   12. DEPOSITS LIST
   ========================================================= */
function refreshDepositsList() {
  if (!currentUser) return;
  const wrap = getElement("recentDeposits");
  if (!wrap) return;

  const depositsRef = ref(db, `users/${currentUser.uid}/deposits`);
  onValue(depositsRef, snap => {
    if (!snap.exists()) {
      wrap.innerHTML = `
        <div class="empty-state">
          <span class="emoji">📥</span>
          <p>No deposits yet.</p>
        </div>`;
      return;
    }

    const list = Object.entries(snap.val())
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 10);

    wrap.innerHTML = list.map(d => {
      const amount = Number(d.amount || 0).toFixed(4);
      const dateStr = d.createdAt
        ? new Date(d.createdAt).toLocaleString("en-IN")
        : "—";
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
        </div>
      `;
    }).join("");
  });
}

/* =========================================================
   13. RENDER PAGE
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

    <!-- Balance Card -->
    <div class="balance-card">
      <div class="balance-label">Your USDT Balance</div>
      <div class="balance-amount" id="depositBalance">$${(Number(balance) || 0).toFixed(2)}</div>
      <div class="balance-badge">
        <span>🛡</span> Auto-Verified on BSC
      </div>
    </div>

    <!-- Deposit Card -->
    <div class="deposit-card">
      <div class="card-title"><span class="ico">📥</span> Your Unique Deposit Address</div>

      <div class="qr-address-grid">
        <div class="qr-box">
          <img src="${qrUrl}" alt="Deposit QR" />
        </div>

        <div class="address-block">
          <div class="address-label">BNB Smart Chain (BEP20) · USDT</div>
          <div class="address-value" id="depositAddress">${escapeHTML(address)}</div>

          <div class="address-actions">
            <button class="btn btn-primary" id="copyAddressBtn">📋 Copy Address</button>
            <button class="btn btn-ghost" id="shareAddressBtn">🔗 Share</button>
          </div>

          <div class="address-note">
            <strong>⚠ Only send USDT (BEP20) to this address.</strong><br>
            Sending any other token or on any other network will result in
            <strong>permanent loss of funds</strong>.<br>
            Minimum deposit: <strong>${MIN_DEPOSIT_USDT} USDT</strong>.
          </div>
        </div>
      </div>

      <!-- Auto-monitoring status -->
      <div class="status-panel">
        <div class="status-panel-title">🔴 Live Deposit Monitoring</div>

        <div class="status-row">
          <span class="status-label">Status</span>
          <span class="status-value waiting" id="depositStatus">
            <span class="pulse-dot"></span>
            Waiting for transfer
          </span>
        </div>

        <div class="status-row">
          <span class="status-label">Detected Amount</span>
          <span class="status-value" id="statusAmount">—</span>
        </div>

        <div class="status-row">
          <span class="status-label">Transaction</span>
          <span class="status-value" id="statusTx">—</span>
        </div>

        <div class="status-row">
          <span class="status-label">Block</span>
          <span class="status-value" id="statusBlock">—</span>
        </div>

        <div class="status-row">
          <span class="status-label">Scanner</span>
          <span class="status-value confirming" id="scanStatus">
            <span class="pulse-dot"></span>
            Starting…
          </span>
        </div>

        <div class="status-row">
          <span class="status-label">Last Block</span>
          <span class="status-value" id="scanBlock">—</span>
        </div>
      </div>
    </div>

    <!-- Warning Box -->
    <div class="deposit-card">
      <div class="card-title"><span class="ico">⚠️</span> Important Safety Information</div>

      <div class="warning-box">
        <span class="icon">⚠️</span>
        <div>
          <strong>Send only USDT on BNB Smart Chain (BEP20)</strong>
          <ul>
            <li>Network: <strong>BNB Smart Chain (BSC)</strong></li>
            <li>Token: <strong>USDT (BEP20)</strong></li>
            <li>Contract: <span class="contract">${USDT_CONTRACT}</span></li>
            <li>Minimum: <strong>${MIN_DEPOSIT_USDT} USDT</strong></li>
            <li>Confirmations required: <strong>${MIN_CONFIRMATIONS}</strong></li>
            <li><strong>Do NOT</strong> send ERC20, TRC20 or any other token/network</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Recent Deposits -->
    <div class="deposit-card">
      <div class="card-title"><span class="ico">📜</span> Recent Deposits</div>
      <div id="recentDeposits">
        <div class="loading-box">
          <div class="spinner"></div>
          <div>Loading deposits…</div>
        </div>
      </div>
    </div>
  `;

  /* Bind buttons */
  getElement("copyAddressBtn")?.addEventListener("click", () => copyToClipboard(address));
  getElement("shareAddressBtn")?.addEventListener("click", async () => {
    const text = `Deposit USDT (BEP20) to:\n${address}\nNetwork: BNB Smart Chain`;
    if (navigator.share) {
      try { await navigator.share({ title: "Nexbit Deposit", text }); } catch (_) {}
    } else {
      copyToClipboard(text);
    }
  });
}

/* =========================================================
   14. COPY HELPER
   ========================================================= */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Address copied to clipboard", "success", 2500);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast("Address copied", "success", 2500);
    } catch {
      showToast("Copy failed — please copy manually", "error");
    }
    ta.remove();
  }
}

/* =========================================================
   15. POLLING
   ========================================================= */
function startPolling() {
  stopPolling();
  scanForDeposits();                          // run now
  pollTimer = setInterval(scanForDeposits, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/* =========================================================
   16. AUTH STATE
   ========================================================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUser = user;

  /* Navbar info */
  const name  = user.displayName || "Trader";
  const first = name.split(" ")[0];
  const un = getElement("userName");
  const ua = getElement("userAvatar");
  if (un) un.textContent = first;
  if (ua) ua.textContent = first.charAt(0).toUpperCase();

  /* Show loading */
  const container = getElement("depositContent");
  if (container) {
    container.innerHTML = `
      <div class="loading-box">
        <div class="spinner"></div>
        <div>Assigning your deposit address…</div>
      </div>`;
  }

  try {
    /* Ensure engine wallets for USDT */
    await engine.ensureWallets(user.uid);

    /* Get or assign deposit address */
    const address = await ensureUserAddress(user.uid);
    userAddress = address;

    console.log("[deposit] User address:", userAddress);

    /* Fetch balance */
    let balance = 0;
    try {
      const bal = await engine.getBalance(user.uid, "USDT");
      balance = bal.available || 0;
    } catch (_) {}

    /* Render UI */
    renderDepositUI(balance, userAddress);

    /* Load deposits */
    refreshDepositsList();

    /* Live balance listener */
    const balRef = ref(db, `balances/${user.uid}/USDT`);
    const unsubBal = onValue(balRef, snap => {
      if (snap.exists()) {
        const v = snap.val();
        updateBalanceUI(v.available);
      }
    });
    listeners.push(unsubBal);

    /* Start blockchain scanner */
    startPolling();

  } catch (err) {
    console.error("Deposit init failed:", err);
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

/* =========================================================
   17. CLEANUP
   ========================================================= */
window.addEventListener("beforeunload", () => {
  stopPolling();
  listeners.forEach(unsub => { try { unsub(); } catch (_) {} });
});
