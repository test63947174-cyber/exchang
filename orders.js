/* =========================================================
   Nexbit — Orders Page
   File: orders.js
   Version: 3.0 (Real orders + Cancel via engine)

   FEATURES:
   - Loads user's real orders from /users/{uid}/orders
   - Three tabs: Open, History, Trades
   - Cancel order via engine.cancelOrder() — releases locked balance
   - Real-time updates (onValue)
   - Loading / empty / error states
   - Safe rendering (escapeHTML)

   ⚠ SECURITY NOTE:
   Cancel runs client-side for internal testing only.
   Move to Cloud Functions before public launch.
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, ref, get, onValue
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* Import our engine for cancel */
import engine from "./engine.js";

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
   2. STATE
   ========================================================= */
let currentUser = null;
let currentTab  = "open";

/* Cache: loaded from Firebase */
const ordersCache = {
  open:    [],
  history: [],
  trades:  []
};

let dataLoaded = false;

/* Active real-time listeners (so we can clean up) */
const activeListeners = [];

/* =========================================================
   3. HELPERS
   ========================================================= */
function getElement(id) { return document.getElementById(id); }

function escapeHTML(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}

function formatDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });
}

function formatNumber(n, digits = 8) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits
  });
}

function formatPrice(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return "—";
  if (num < 1) return num.toFixed(6);
  if (num < 100) return num.toFixed(4);
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function showToast(msg, ok = true) {
  const t = getElement("toast");
  const m = getElement("toastMsg");
  if (!t || !m) {
    console[ok ? "log" : "error"](msg);
    return;
  }
  m.textContent = msg;
  t.style.borderColor = ok ? "var(--success)" : "var(--danger)";
  const c = t.querySelector(".check");
  if (c) {
    c.style.background = ok ? "var(--success)" : "var(--danger)";
    c.textContent = ok ? "✓" : "✕";
  }
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}

/* =========================================================
   4. SIDEBAR + LOGOUT
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
  } catch { showToast("Logout failed", false); }
};

/* =========================================================
   5. TAB COUNTS
   ========================================================= */
function updateTabCounts() {
  const set = (id, n) => {
    const el = getElement(id);
    if (el) el.textContent = n;
  };
  set("countOpen",    ordersCache.open.length);
  set("countHistory", ordersCache.history.length);
  set("countTrades",  ordersCache.trades.length);
}

/* =========================================================
   6. LOADING / ERROR STATE
   ========================================================= */
function showLoading() {
  const tbody = getElement("ordersBody");
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="loading-cell">
        <div class="spinner"></div>
        <div>Loading your orders…</div>
      </td>
    </tr>`;
}

function showError(message) {
  const tbody = getElement("ordersBody");
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="empty-cell" style="color:var(--danger);">
        <span class="emoji">⚠️</span>
        ${escapeHTML(message || "Unable to load your orders.")}
      </td>
    </tr>`;
}

/* =========================================================
   7. FETCH + FILTER
   ========================================================= */

/* Convert raw order object into a normalized entry */
function normalizeOrder(id, o) {
  const status = String(o.status || "unknown").toLowerCase();
  const remaining = Number(o.remaining) || 0;
  const filled = Number(o.filled) || 0;
  const quantity = Number(o.quantity) || 0;

  return {
    id,
    orderId: id,
    pair: String(o.pair || "—"),
    side: (o.side === "buy" || o.side === "sell") ? o.side : "unknown",
    type: (o.type === "limit" || o.type === "market") ? o.type : "unknown",
    price: Number(o.price) || 0,
    quantity,
    filled,
    remaining,
    status,
    createdAt: o.createdAt || o.timestamp || null,
    updatedAt: o.updatedAt || null
  };
}

/* Normalize a trade */
function normalizeTrade(id, t) {
  return {
    id,
    tradeId: id,
    pair: String(t.pair || "—"),
    side: (t.side === "buy" || t.side === "sell") ? t.side : "unknown",
    price: Number(t.price) || 0,
    quantity: Number(t.quantity) || 0,
    cost: Number(t.cost) || 0,
    fee: Number(t.fee) || 0,
    executedAt: t.executedAt || t.createdAt || null
  };
}

/* Split orders into open vs history, sort by date desc */
function splitOrders(rawMap) {
  const openList = [];
  const historyList = [];

  Object.entries(rawMap || {}).forEach(([id, o]) => {
    if (!o || typeof o !== "object") return;
    const entry = normalizeOrder(id, o);
    if (entry.status === "open" || entry.status === "partial") {
      openList.push(entry);
    } else {
      historyList.push(entry);
    }
  });

  const sortByDate = (a, b) =>
    new Date(b.createdAt || 0) - new Date(a.createdAt || 0);

  return {
    open:    openList.sort(sortByDate),
    history: historyList.sort(sortByDate)
  };
}

/* =========================================================
   8. LOAD ORDERS + TRADES
   ========================================================= */
async function loadOrders(uid) {
  showLoading();

  try {
    const [ordersSnap, tradesSnap] = await Promise.all([
      get(ref(db, `users/${uid}/orders`)),
      get(ref(db, `users/${uid}/trades`))
    ]);

    /* --- Orders --- */
    const rawOrders = ordersSnap.exists() ? ordersSnap.val() : {};
    const split = splitOrders(rawOrders);
    ordersCache.open    = split.open;
    ordersCache.history = split.history;

    /* --- Trades --- */
    const rawTrades = tradesSnap.exists() ? tradesSnap.val() : {};
    ordersCache.trades = Object.entries(rawTrades)
      .filter(([, t]) => t && typeof t === "object")
      .map(([id, t]) => normalizeTrade(id, t))
      .sort((a, b) => (b.executedAt || 0) - (a.executedAt || 0));

    dataLoaded = true;
    updateTabCounts();
    renderOrders();

  } catch (err) {
    console.error("Failed to load orders:", err);
    showError("Unable to load your orders. Please try again later.");
    showToast("Failed to load orders", false);
  }
}

/* =========================================================
   9. REAL-TIME LISTENERS
   ========================================================= */
function attachRealtimeListeners(uid) {
  /* Orders */
  const ordersRef = ref(db, `users/${uid}/orders`);
  const unsubOrders = onValue(ordersRef, (snap) => {
    const raw = snap.exists() ? snap.val() : {};
    const split = splitOrders(raw);
    ordersCache.open    = split.open;
    ordersCache.history = split.history;
    updateTabCounts();
    if (dataLoaded) renderOrders();
  });
  activeListeners.push(unsubOrders);

  /* Trades */
  const tradesRef = ref(db, `users/${uid}/trades`);
  const unsubTrades = onValue(tradesRef, (snap) => {
    const raw = snap.exists() ? snap.val() : {};
    ordersCache.trades = Object.entries(raw)
      .filter(([, t]) => t && typeof t === "object")
      .map(([id, t]) => normalizeTrade(id, t))
      .sort((a, b) => (b.executedAt || 0) - (a.executedAt || 0));
    updateTabCounts();
    if (dataLoaded) renderOrders();
  });
  activeListeners.push(unsubTrades);
}

/* =========================================================
   10. RENDER
   ========================================================= */
function renderOrders() {
  const tbody = getElement("ordersBody");
  if (!tbody) return;

  if (currentTab === "trades") {
    renderTrades(tbody);
    return;
  }

  const list = ordersCache[currentTab] || [];

  /* --- Empty states --- */
  if (!list.length) {
    const messages = {
      open:    "You have no open orders.",
      history: "No order history yet."
    };
    const icons = {
      open:    "📋",
      history: "📜"
    };
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-cell">
          <span class="emoji">${icons[currentTab] || "📋"}</span>
          ${escapeHTML(messages[currentTab] || "No records.")}
          <span class="sub">Orders will appear once trading is live.</span>
        </td>
      </tr>`;
    return;
  }

  /* --- Rows --- */
  tbody.innerHTML = list.map((o, i) => {
    /* Type badge */
    const typeBadge = o.side === "buy"
      ? `<span class="badge buy">BUY</span>`
      : o.side === "sell"
      ? `<span class="badge sell">SELL</span>`
      : `<span class="badge unknown">${escapeHTML(o.side.toUpperCase())}</span>`;

    /* Status badge */
    const statusLabel = o.status.charAt(0).toUpperCase() + o.status.slice(1);
    const statusClass = o.status;
    const statusBadge = `
      <span class="badge ${escapeHTML(statusClass)}">
        ${escapeHTML(statusLabel)}
      </span>`;

    /* Filled progress */
    const pct = o.quantity > 0
      ? Math.round((o.filled / o.quantity) * 100)
      : 0;
    const filledText = o.status === "open"
      ? `0 / ${formatNumber(o.quantity, 8)}`
      : `${formatNumber(o.filled, 8)} / ${formatNumber(o.quantity, 8)} (${pct}%)`;

    /* Order type label */
    const typeLabel = o.type === "market" ? "MKT" : "LMT";

    /* Action button */
    let actionBtn;
    if (currentTab === "open" && (o.status === "open" || o.status === "partial")) {
      actionBtn = `
        <button class="btn-action ghost cancel-btn"
                data-order-id="${escapeHTML(o.orderId)}">
          Cancel
        </button>`;
    } else {
      const safePair = encodeURIComponent(o.pair);
      actionBtn = `
        <a href="trade.html?pair=${safePair}"
           class="btn-action ghost">
          Re-trade
        </a>`;
    }

    return `
      <tr>
        <td class="row-num">${i + 1}</td>
        <td>${escapeHTML(formatDateTime(o.createdAt))}</td>
        <td class="pair-cell">
          ${escapeHTML(o.pair)}
          <span style="font-size:0.65rem; color:var(--text-dim); margin-left:4px;">${escapeHTML(typeLabel)}</span>
        </td>
        <td>${typeBadge}</td>
        <td>$${escapeHTML(formatPrice(o.price))}</td>
        <td>
          <div style="font-size:0.78rem;">${escapeHTML(filledText)}</div>
        </td>
        <td>${statusBadge}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join("");

  /* Attach cancel button handlers */
  tbody.querySelectorAll(".cancel-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const orderId = btn.dataset.orderId;
      if (orderId) handleCancelOrder(orderId, btn);
    });
  });
}

/* Trades tab rendering */
function renderTrades(tbody) {
  const list = ordersCache.trades || [];

  if (!list.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-cell">
          <span class="emoji">💱</span>
          No executed trades yet.
          <span class="sub">Your filled orders will appear here.</span>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = list.map((t, i) => {
    const typeBadge = t.side === "buy"
      ? `<span class="badge buy">BUY</span>`
      : t.side === "sell"
      ? `<span class="badge sell">SELL</span>`
      : `<span class="badge unknown">${escapeHTML(t.side.toUpperCase())}</span>`;

    const sideColor = t.side === "buy" ? "var(--neon-green)" : "var(--danger)";
    const total = t.cost || (t.price * t.quantity);

    return `
      <tr>
        <td class="row-num">${i + 1}</td>
        <td>${escapeHTML(formatDateTime(t.executedAt))}</td>
        <td class="pair-cell">${escapeHTML(t.pair)}</td>
        <td>${typeBadge}</td>
        <td>$${escapeHTML(formatPrice(t.price))}</td>
        <td>${escapeHTML(formatNumber(t.quantity, 8))}</td>
        <td>$${escapeHTML(formatNumber(total, 2))}</td>
        <td style="color:${sideColor}; font-size:0.72rem; font-family:'Courier New',monospace;">
          ${escapeHTML(t.id.slice(0, 10))}…
        </td>
      </tr>
    `;
  }).join("");
}

/* =========================================================
   11. CANCEL ORDER
   ========================================================= */
async function handleCancelOrder(orderId, btn) {
  if (!currentUser) {
    showToast("Please log in first.", false);
    return;
  }

  /* Confirm dialog */
  const confirmCancel = window.confirm(
    "Cancel this order? The locked balance will be returned to your available balance."
  );
  if (!confirmCancel) return;

  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Cancelling…";

  try {
    const result = await engine.cancelOrder({
      uid: currentUser.uid,
      orderId
    });

    showToast(`✅ Order cancelled. Balance unlocked.`, true);

    /* The onValue listener will refresh the table automatically.
       But trigger a manual refresh just in case. */
    await loadOrders(currentUser.uid);

  } catch (err) {
    console.error("Cancel failed:", err);
    showToast(err.message || "Cancel failed. Try again.", false);
    btn.disabled = false;
    btn.textContent = origText;
  }
}

/* =========================================================
   12. TAB SWITCHING
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTab = btn.dataset.tab || "open";
      renderOrders();
    });
  });

  /* Show initial loading before auth resolves */
  const tbody = getElement("ordersBody");
  if (tbody && !dataLoaded) {
    showLoading();
  }
});

/* =========================================================
   13. AUTH STATE
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

  /* Initial load */
  await loadOrders(user.uid);

  /* Attach real-time listeners */
  attachRealtimeListeners(user.uid);
});

/* =========================================================
   14. CLEANUP
   ========================================================= */
window.addEventListener("beforeunload", () => {
  activeListeners.forEach(unsub => {
    try { unsub(); } catch (_) {}
  });
});
