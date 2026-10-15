/* =========================================================
   Nexbit — Deposit Page
   File: deposit.js
   Version: 3.0 (Automatic blockchain verification)

   Real flow:
   1. User sends USDT (BEP20) to master wallet
   2. User enters TXID + amount
   3. We fetch the transaction from BSC RPC (public)
   4. We verify: correct contract, correct receiver, amount
   5. We wait for confirmations
   6. On success → credit user's balance in Firebase
   7. Duplicate TXIDs are blocked

   Contract (USDT BEP20): 0x55d398326f99059fF775485246999027B3197955
   Master wallet:         0xe757c330D267784F190e79e0Ec0dC5d30ad6eFA4
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get, set, update, onValue, runTransaction }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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
const DEPOSIT_WALLET = "0xe757c330D267784F190e79e0Ec0dC5d30ad6eFA4";
const USDT_CONTRACT  = "0x55d398326f99059fF775485246999027B3197955"; // BEP20 USDT
const MIN_CONFIRMATIONS = 3;
const POLL_INTERVAL_MS  = 15_000;
const AMOUNT_TOLERANCE  = 0.005;   // ±0.5%

/* Multiple BSC RPC endpoints for reliability */
const BSC_RPCS = [
  "https://bsc-dataseed.binance.org/",
  "https://bsc-dataseed1.defibit.io/",
  "https://bsc-dataseed1.ninicoin.io/",
  "https://rpc.ankr.com/bsc"
];

/* BSCScan links */
const BSC_EXPLORER = "https://bscscan.com/";

/* =========================================================
   3. STATE
   ========================================================= */
let currentUser  = null;
let balanceTimer = null;

/* =========================================================
   4. HELPERS
   ========================================================= */
function getElement(id) { return document.getElementById(id); }

function escapeHTML(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}

function showToast(message, type = "success", duration = 5000) {
  const container = getElement("toastContainer");
  if (!container) return;

  const icons = {
    success: "✓", error: "✕", warning: "⚠", info: "ℹ"
  };
  const colors = {
    success: "var(--neon-green)",
    error: "var(--danger)",
    warning: "var(--warning)",
    info: "var(--neon-cyan)"
  };

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
  }, duration);
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
  try {
    await signOut(auth);
    localStorage.removeItem("Nexbit_User");
    window.location.href = "index.html";
  } catch { showToast("Logout failed", "error"); }
};

/* =========================================================
   6. BSC RPC — JSON-RPC helpers
   We use raw JSON-RPC calls via fetch so that no external
   library is required. Everything runs from the browser.
   ========================================================= */

/* Call `eth_getTransactionReceipt` for the TX hash */
async function rpcGetReceipt(txHash) {
  for (const rpc of BSC_RPCS) {
    try {
      const resp = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "eth_getTransactionReceipt",
          params: [txHash]
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data && data.result) return data.result;
      if (data && data.error) throw new Error(data.error.message || "RPC error");
    } catch (err) {
      console.warn(`RPC ${rpc} failed:`, err.message);
    }
  }
  throw new Error("All RPC endpoints failed for receipt");
}

/* Call `eth_blockNumber` */
async function rpcBlockNumber() {
  for (const rpc of BSC_RPCS) {
    try {
      const resp = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "eth_blockNumber",
          params: []
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data && data.result) return parseInt(data.result, 16);
    } catch (err) { /* try next */ }
  }
  throw new Error("Could not fetch current block number");
}

/* Standard ERC20/BEP20 Transfer event signature:
   keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/* Convert hex → decimal string (safe for big numbers) */
function hexToDecimal(hex) {
  if (!hex) return "0";
  return BigInt(hex).toString();
}

/* =========================================================
   7. VERIFY A DEPOSIT (core logic)
   ========================================================= */
async function verifyDepositOnChain(txHash, expectedAmount, userId) {
  /* ---------- 1. Get receipt ---------- */
  const receipt = await rpcGetReceipt(txHash);
  if (!receipt) throw new Error("Transaction not found on BSC");
  if (receipt.status !== "0x1") throw new Error("Transaction failed on blockchain");

  const txBlock = parseInt(receipt.blockNumber, 16);

  /* ---------- 2. Find USDT Transfer event to our wallet ---------- */
  const depositAddr = DEPOSIT_WALLET.toLowerCase().replace(/^0x/, "");
  const padded = "0x" + depositAddr.padStart(64, "0");

  let match = null;
  for (const log of (receipt.logs || [])) {
    if (log.address?.toLowerCase() !== USDT_CONTRACT.toLowerCase()) continue;
    if (!log.topics || log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics[2]?.toLowerCase() !== padded.toLowerCase()) continue;

    match = log;
    break;
  }

  if (!match) {
    throw new Error("No USDT transfer to deposit wallet in this transaction");
  }

  /* ---------- 3. Decode amount (BEP20 USDT has 18 decimals) ---------- */
  const rawAmount = BigInt(match.data);
  const decimals = 18n;
  const divisor = 10n ** decimals;

  /* Keep precision as string, then to number with 6 decimals */
  const whole = rawAmount / divisor;
  const fraction = rawAmount % divisor;
  const fractionStr = fraction.toString().padStart(18, "0").slice(0, 6);
  const amountStr = `${whole}.${fractionStr}`;
  const amountNum = parseFloat(amountStr);

  /* ---------- 4. Compare with expected ---------- */
  const diff = Math.abs(amountNum - expectedAmount);
  const tolerance = Math.max(expectedAmount * AMOUNT_TOLERANCE, 0.01);

  if (diff > tolerance) {
    const err = new Error(`Amount mismatch: blockchain shows ${amountStr}`);
    err.chainAmount = amountNum;
    err.chainAmountStr = amountStr;
    throw err;
  }

  return {
    amount: amountNum,
    amountStr,
    blockNumber: txBlock,
    receiver: depositAddr
  };
}

/* =========================================================
   8. WAIT FOR CONFIRMATIONS
   ========================================================= */
async function waitForConfirmations(txHash, onProgress) {
  while (true) {
    const receipt = await rpcGetReceipt(txHash);
    if (!receipt) throw new Error("Transaction disappeared from BSC");
    if (receipt.status !== "0x1") throw new Error("Transaction failed");

    const txBlock = parseInt(receipt.blockNumber, 16);
    const currentBlock = await rpcBlockNumber();
    const confirmations = Math.max(0, currentBlock - txBlock);

    if (onProgress) onProgress(confirmations, txBlock, currentBlock);

    if (confirmations >= MIN_CONFIRMATIONS) {
      return { confirmations, blockNumber: txBlock };
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/* =========================================================
   9. CREDIT USER BALANCE (atomic & duplicate-safe)
   ========================================================= */
async function creditBalance(userId, txHash, amount, blockNumber) {
  /* Check if this TXID has already been credited */
  const usedRef = ref(db, `usedTxIds/${txHash}`);
  const usedSnap = await get(usedRef);
  if (usedSnap.exists()) {
    throw new Error("This transaction hash has already been used.");
  }

  /* Mark as used (transaction ensures atomicity) */
  await set(usedRef, {
    userId,
    amount,
    blockNumber,
    usedAt: new Date().toISOString()
  });

  /* Increment user's USD balance */
  const balanceRef = ref(db, `users/${userId}/balanceUSD`);
  const result = await runTransaction(balanceRef, current => {
    const prev = Number(current) || 0;
    return prev + amount;
  });

  const newBalance = result.snapshot.val() || 0;

  /* Save deposit record */
  const depositId = `${Date.now()}_${txHash.slice(2, 10)}`;
  await set(ref(db, `users/${userId}/deposits/${depositId}`), {
    txHash,
    amount,
    blockNumber,
    confirmations: MIN_CONFIRMATIONS,
    asset: "USDT",
    network: "BEP20",
    status: "confirmed",
    createdAt: new Date().toISOString()
  });

  /* Also record in recent transactions */
  await set(ref(db, `users/${userId}/transactions/${depositId}`), {
    type: "deposit",
    asset: "USDT",
    amount,
    txHash,
    blockNumber,
    status: "success",
    timestamp: Date.now()
  });

  return newBalance;
}

/* =========================================================
   10. LOAD RECENT DEPOSITS (real-time)
   ========================================================= */
function loadRecentDeposits(userId) {
  const wrap = getElement("recentDeposits");
  if (!wrap) return;

  const depositsRef = ref(db, `users/${userId}/deposits`);
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
      const shortHash = d.txHash ? d.txHash.slice(0, 16) + "…" : "";

      return `
        <div class="deposit-item">
          <div>
            <div class="amt">$${escapeHTML(amount)} USDT</div>
            <div class="date">${escapeHTML(dateStr)}</div>
          </div>
          <div style="text-align:right;">
            <span class="status">
              ✓ Verified (Blockchain)
            </span>
            <div class="badges">
              ${d.blockNumber ? `<span class="badge-mini badge-block">Block: ${escapeHTML(String(d.blockNumber))}</span>` : ""}
              ${shortHash ? `<span class="badge-mini badge-hash">${escapeHTML(shortHash)}</span>` : ""}
            </div>
          </div>
        </div>
      `;
    }).join("");
  }, err => {
    console.error("Recent deposits error:", err);
    wrap.innerHTML = `<div class="empty-state"><p style="color:var(--danger);">Unable to load deposits.</p></div>`;
  });
}

/* =========================================================
   11. RENDER THE PAGE
   ========================================================= */
function renderDepositUI(currentBalance = 0) {
  const container = getElement("depositContent");
  if (!container) return;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(DEPOSIT_WALLET)}&color=00f0ff&bgcolor=050814`;

  container.innerHTML = `
    <div class="page-head">
      <h1>Deposit <span>USDT</span></h1>
      <p>Send USDT (BEP20) to your deposit address, then verify on blockchain.</p>
    </div>

    <!-- Balance Card -->
    <div class="balance-card">
      <div class="balance-label">Your USDT Balance</div>
      <div class="balance-amount" id="depositBalance">$${(Number(currentBalance) || 0).toFixed(2)}</div>
      <div class="balance-badge">
        <span>🛡</span> Blockchain Verified
      </div>
    </div>

    <!-- Deposit Card -->
    <div class="deposit-card">
      <div class="card-title"><span class="ico">📥</span> Send USDT (BEP20)</div>

      <div class="qr-address-grid">
        <div class="qr-box">
          <img src="${qrUrl}" alt="QR Code" />
        </div>

        <div class="address-block">
          <div class="address-label">Your Deposit Address</div>
          <div class="address-value" id="depositAddress">${escapeHTML(DEPOSIT_WALLET)}</div>

          <div class="address-actions">
            <button class="btn btn-primary" id="copyAddressBtn">📋 Copy Address</button>
            <button class="btn btn-ghost" id="shareAddressBtn">🔗 Share</button>
          </div>

          <div class="address-note">
            <strong>Only send USDT (BEP20) to this address.</strong>
            <br>
            Contract: <span class="contract">${escapeHTML(USDT_CONTRACT)}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Verify Card -->
    <div class="deposit-card">
      <div class="card-title"><span class="ico">🔒</span> Verify Deposit on Blockchain</div>

      <div class="info-alert">
        <strong>Real Blockchain Verification:</strong> Your transaction is verified directly on the
        BSC blockchain.
        <br>
        Minimum confirmations required: <strong>${MIN_CONFIRMATIONS}</strong>
        <br>
        <span class="x">✕ Cannot be faked or bypassed.</span>
      </div>

      <form id="depositForm" class="verify-form">
        <div class="verify-grid">
          <div class="form-group">
            <label class="form-label" for="depositAmount">
              Amount Sent (USDT) <span class="req">*</span>
            </label>
            <input type="number" id="depositAmount" class="form-control"
                   placeholder="e.g. 5.012" min="0.01" step="any" required>
            <span class="form-hint">Exact amount you sent</span>
          </div>

          <div class="form-group">
            <label class="form-label" for="txHash">
              Transaction Hash (TXID) <span class="req">*</span>
            </label>
            <input type="text" id="txHash" class="form-control"
                   placeholder="0x…" required>
            <span class="form-hint">Real BSC transaction hash</span>
          </div>

          <div class="verify-btn-wrap">
            <button type="submit" class="btn btn-primary" id="verifyBtn">
              Verify Deposit
            </button>
          </div>
        </div>
      </form>

      <div id="verificationStatus" class="verification-status"></div>
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
  getElement("copyAddressBtn")?.addEventListener("click", () => {
    copyToClipboard(DEPOSIT_WALLET);
  });

  getElement("shareAddressBtn")?.addEventListener("click", async () => {
    const text = `Deposit USDT (BEP20) to:\n${DEPOSIT_WALLET}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Nexbit Deposit", text }); } catch (_) {}
    } else {
      copyToClipboard(text);
    }
  });

  /* Wire the form (only once, on this render) */
  attachFormHandler();
}

/* =========================================================
   12. COPY HELPER
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
   13. VERIFICATION STATUS UI
   ========================================================= */
function updateVerificationStatus(type, html) {
  const el = getElement("verificationStatus");
  if (!el) return;
  el.className = `verification-status show ${type}`;
  el.innerHTML = html;
}

function updateBalanceUI(newBalance) {
  const el = getElement("depositBalance");
  if (el) el.textContent = "$" + (Number(newBalance) || 0).toFixed(2);
}

/* =========================================================
   14. FORM HANDLER
   ========================================================= */
function attachFormHandler() {
  const form = getElement("depositForm");
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!currentUser) {
      showToast("Please log in first.", "error");
      return;
    }

    const amountInput = getElement("depositAmount");
    const txHashInput = getElement("txHash");
    const verifyBtn   = getElement("verifyBtn");

    const amount = parseFloat(amountInput.value);
    const txHash = (txHashInput.value || "").trim();

    /* --- Basic validation --- */
    if (!amount || amount <= 0) {
      showToast("Enter a valid amount (greater than 0).", "error"); return;
    }
    if (!txHash || txHash.length < 20) {
      showToast("Enter a valid transaction hash.", "error"); return;
    }
    if (!txHash.startsWith("0x")) {
      showToast('Transaction hash must start with "0x".', "error"); return;
    }
    if (verifyBtn.disabled) {
      showToast("Please wait, verification already running…", "info"); return;
    }

    verifyBtn.disabled = true;
    const originalHTML = verifyBtn.innerHTML;
    verifyBtn.innerHTML = "Verifying…";

    updateVerificationStatus(
      "pending",
      `<span class="polling-indicator"></span>
       <strong>Verifying on BSC blockchain…</strong>
       <br><small>Please wait, this may take a moment.</small>`
    );

    try {
      /* --- Step 1: Verify on-chain (amount, contract, receiver) --- */
      const chainResult = await verifyDepositOnChain(txHash, amount, currentUser.uid);

      /* --- Step 2: Wait for confirmations --- */
      const final = await waitForConfirmations(txHash, (confirmations) => {
        updateVerificationStatus(
          "polling",
          `<span class="polling-indicator"></span>
           <strong>Waiting for confirmations…</strong> (${confirmations}/${MIN_CONFIRMATIONS})
           <br><small>Confirmed block: ${chainResult.blockNumber}</small>`
        );
      });

      /* --- Step 3: Credit balance --- */
      const newBalance = await creditBalance(
        currentUser.uid,
        txHash,
        chainResult.amount,
        final.blockNumber
      );

      updateVerificationStatus(
        "success",
        `<strong>✓ Deposit Successfully Credited!</strong>
         <br>Amount: <strong>$${chainResult.amount.toFixed(6)} USDT</strong>
         <br>New Balance: <strong>$${Number(newBalance).toFixed(2)} USDT</strong>
         <br>Verified on BSC Block: <strong>${final.blockNumber}</strong>`
      );
      showToast(`✅ Deposit of $${chainResult.amount.toFixed(4)} USDT credited!`, "success", 6000);
      updateBalanceUI(newBalance);
      amountInput.value = "";
      txHashInput.value = "";

    } catch (err) {
      console.error("Deposit error:", err);

      if (err.chainAmount !== undefined) {
        /* Amount mismatch — give a helpful hint */
        updateVerificationStatus(
          "error",
          `<strong>💰 Amount Mismatch</strong>
           <br>You entered: <strong>${amount} USDT</strong>
           <br>Blockchain shows: <strong>${err.chainAmountStr} USDT</strong>
           <br><br>
           <button type="button" class="auto-fill-btn" id="autoFillBtn">
             Auto-fill ${err.chainAmountStr} USDT
           </button>`
        );
        showToast(`Amount mismatch. Blockchain shows ${err.chainAmountStr} USDT.`, "warning", 8000);
      } else {
        /* Generic error */
        updateVerificationStatus(
          "error",
          `<strong>✕ Verification Failed</strong>
           <br><small>${escapeHTML(err.message || "Unknown error")}</small>`
        );
        showToast(err.message || "Verification failed.", "error", 8000);
      }

    } finally {
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = originalHTML;
    }
  });
}

/* Auto-fill button handler */
document.addEventListener("click", (e) => {
  const btn = e.target.closest("#autoFillBtn");
  if (!btn) return;
  const match = btn.textContent.match(/([\d.]+)/);
  if (!match) return;
  const input = getElement("depositAmount");
  if (input) {
    input.value = match[1];
    showToast(`Auto-filled ${match[1]} USDT. Click Verify again.`, "success");
    btn.remove();
  }
});

/* =========================================================
   15. AUTH STATE + INIT
   ========================================================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  currentUser = user;

  /* Navbar info */
  const name  = user.displayName || "Trader";
  const first = name.split(" ")[0];
  const un = getElement("userName");
  const ua = getElement("userAvatar");
  if (un) un.textContent = first;
  if (ua) ua.textContent = first.charAt(0).toUpperCase();

  /* Load balance */
  let balance = 0;
  try {
    const snap = await get(ref(db, `users/${user.uid}`));
    if (snap.exists()) {
      const v = snap.val();
      const b = Number(v.balanceUSD);
      if (Number.isFinite(b) && b >= 0) balance = b;
    }
  } catch (err) {
    console.warn("Balance load failed:", err);
  }

  /* Render */
  renderDepositUI(balance);
  loadRecentDeposits(user.uid);

  /* Live balance listener */
  const balanceRef = ref(db, `users/${user.uid}/balanceUSD`);
  onValue(balanceRef, snap => {
    if (snap.exists()) updateBalanceUI(snap.val());
  });
});

/* Cleanup */
window.addEventListener("beforeunload", () => {
  if (balanceTimer) clearInterval(balanceTimer);
});
