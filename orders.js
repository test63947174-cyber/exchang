/* =========================================================
   Nexbit — Orders Page
   File: orders.js
   Version: 2.1 (matches updated orders.html)

   IMPORTANT:
   - No demo orders. All orders are loaded from Firebase.
   - Cancel is DISABLED because there is no backend order
     engine yet. Only a clear "unavailable" message is shown.
   - Re-trade navigates to trade.html with a safe pair param.

   Database structure (expected):
     /users/{uid}/orders/{orderId}   → open & historical orders
     /users/{uid}/trades/{tradeId}   → executed trades
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* =========================================================
   1. FIREBASE CONFIG + SAFE INIT
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
   2. CONSTANTS
   ========================================================= */
const VALID_TYPES  = ["buy", "sell"];
const VALID_STATUS = ["pending", "open", "filled", "cancelled", "rejected"];

/* If false → Cancel button is disabled and shows a message.
   Set to true ONLY when a real backend order engine exists. */
const BACKEND_CANCEL_ENABLED = false;

/* =========================================================
   3. SAFE HELPERS
   ========================================================= */
function getElement(id) { return document.getElementById(id); }

function escapeHTML(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}

function formatDateTime(input) {
  if (!input) return "—";
  const d = new Date(input);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    year:   "numeric",
    month:  "short",
    day:    "2-digit",
    hour:   "2-digit",
    minute: "2-digit"
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

function showToast(msg, ok = true) {
  const t = getElement("toast");
  const m = getElement("toastMsg");
  if (!t || !m) { console[ok ? "log" : "error"](msg); return; }
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
   5. AUTH GUARD + NAVBAR
   ========================================================= */
let currentUser = null;
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUser = user;

  const name  = user.displayName || "Trader";
  const first = name.split(" ")[0];
  const un = getElement("userName");
  const ua = getElement("userAvatar");
  if (un) un.textContent = first;
  if (ua) ua.textContent = first.charAt(0).toUpperCase();

  loadAllData(user.uid);
});

/* =========================================================
   6. DATA CACHE + LOADING
   ========================================================= */
const ordersCache = {
  open:    [],
  history: [],
  trades:  []
};

let dataLoaded = false;

/* Update tab count badges */
function updateTabCounts() {
  const set = (id, n) => {
    const el = getElement(id);
    if (el) el.textContent = n;
  };
  set("countOpen",    ordersCache.open.length);
  set("countHistory", ordersCache.history.length);
  set("countTrades",  ordersCache.trades.length);
}

/* Show loading state in table */
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

/* Show error state in table */
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
   7. LOAD ORDERS + TRADES FROM FIREBASE
   ========================================================= */
async function loadAllData(uid) {
  showLoading();
  updateTabCounts();

  try {
    const [ordersSnap, tradesSnap] = await Promise.all([
      get(ref(db, `users/${uid}/orders`)),
      get(ref(db, `users/${uid}/trades`))
    ]);

    /* ----- Orders ----- */
    const rawOrders = ordersSnap.exists() ? ordersSnap.val() : {};
    const openList    = [];
    const historyList = [];

    Object.entries(rawOrders).forEach(([id, o]) => {
      if (!o || typeof o !== "object") return;

      const status = String(o.status || "").toLowerCase();
      const entry  = {
        id,
        pair:      String(o.pair || "—"),
        type:      VALID_TYPES.includes(o.type) ? o.type : "unknown",
        price:     o.price,
        amount:    o.amount,
        status:    VALID_STATUS.includes(status) ? status : "unknown",
        createdAt: o.createdAt || o.timestamp || null
      };

      if (status === "pending" || status === "open") {
        openList.push(entry);
      } else {
        historyList.push(entry);
      }
    });

    /* ----- Trades ----- */
    const rawTrades = tradesSnap.exists() ? tradesSnap.val() : {};
    const tradeList = Object.entries(rawTrades)
      .filter(([, t]) => t && typeof t === "object")
      .map(([id, t]) => ({
        id,
        pair:      String(t.pair || "—"),
        type:      VALID_TYPES.includes(t.type) ? t.type : "unknown",
        price:     t.price,
        amount:    t.amount,
        status:    "filled",
        createdAt: t.executedAt || t.createdAt || t.timestamp || null
      }));

    /* ----- Sort newest first ----- */
    const sortByDate = (a, b) =>
      new Date(b.createdAt || 0) - new Date(a.createdAt || 0);

    ordersCache.open    = openList.sort(sortByDate);
    ordersCache.history = historyList.sort(sortByDate);
    ordersCache.trades  = tradeList.sort(sortByDate);

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
   8. RENDER TABLE
   ========================================================= */
let currentTab = "open";

function renderOrders() {
  const tbody = getElement("ordersBody");
  if (!tbody) return;

  const list = ordersCache[currentTab] || [];

  /* ----- Empty states ----- */
  if (!list.length) {
    const messages = {
      open:    "You have no open orders.",
      history: "No order history yet.",
      trades:  "No executed trades yet."
    };
    const icons = {
      open:    "📋",
      history: "📜",
      trades:  "💱"
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

  /* ----- Rows ----- */
  tbody.innerHTML = list.map((o, i) => {
    /* Type badge */
    const typeBadge = o.type === "buy"
      ? `<span class="badge buy">BUY</span>`
      : o.type === "sell"
      ? `<span class="badge sell">SELL</span>`
      : `<span class="badge unknown">${escapeHTML(o.type.toUpperCase())}</span>`;

    /* Status badge */
    const statusLabel = o.status.charAt(0).toUpperCase() + o.status.slice(1);
    const statusBadge = `
      <span class="badge ${escapeHTML(o.status)}">
        ${escapeHTML(statusLabel)}
      </span>`;

    /* Action button */
    let actionBtn;

    if (currentTab === "open" && (o.status === "pending" || o.status === "open")) {
      if (BACKEND_CANCEL_ENABLED) {
        actionBtn = `
          <button class="btn-action ghost"
                  onclick="cancelOrder('${escapeHTML(o.id)}')">
            Cancel
          </button>`;
      } else {
        /* Disabled — no fake cancel */
        actionBtn = `
          <button class="btn-action disabled"
                  title="Cancellation not available yet — no order-matching backend"
                  onclick="showCancelUnavailable()">
            Cancel
          </button>`;
      }
    } else {
      /* Re-trade — safe pair URL */
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
        <td class="pair-cell">${escapeHTML(o.pair)}</td>
        <td>${typeBadge}</td>
        <td>${o.price != null ? "$" + escapeHTML(formatNumber(o.price)) : "Market"}</td>
        <td>${escapeHTML(formatNumber(o.amount))}</td>
        <td>${statusBadge}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join("");
}

/* =========================================================
   9. CANCEL (disabled until backend exists)
   ========================================================= */
window.showCancelUnavailable = function () {
  showToast(
    "Cancellation is not available yet. A real order engine is required.",
    false
  );
};

window.cancelOrder = function (orderId) {
  /* Stub for when BACKEND_CANCEL_ENABLED becomes true.
     Must call a real backend / Cloud Function and only update
     status after server confirmation. Do NOT fake success here. */
  console.warn("cancelOrder called with id:", orderId);
  showToast("Cancel is not implemented in the backend yet.", false);
};

/* =========================================================
   10. TABS + INIT
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  /* Tab buttons */
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTab = btn.dataset.tab || "open";
      renderOrders();
    });
  });

  /* Initial loading state (before auth resolves) */
  if (!dataLoaded) {
    showLoading();
  }
});
