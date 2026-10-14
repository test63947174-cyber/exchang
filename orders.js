/* =========================================================
   Nexbit — Orders Page
   File: orders.js
   Version: 2.0 (Developer Instructions compliant)

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
const VALID_TYPES   = ["buy", "sell"];
const VALID_STATUS  = ["pending", "open", "filled", "cancelled", "rejected"];

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

  /* Load orders once we know the user */
  loadAllData(user.uid);
});

/* =========================================================
   6. DATA LOADING
   ========================================================= */
const ordersCache = {
  open:    [],   // pending / open
  history: [],   // filled / cancelled / rejected
  trades:  []    // executed trades only
};

let dataLoaded = false;

async function loadAllData(uid) {
  const tbody = getElement("ordersBody");
  if (tbody) {
    tbody.innerHTML = `
      <tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-dim);">
        Loading your orders…
      </td></tr>`;
  }

  try {
    const [ordersSnap, tradesSnap] = await Promise.all([
      get(ref(db, `users/${uid}/orders`)),
      get(ref(db, `users/${uid}/trades`))
    ]);

    /* --- Orders --- */
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

    /* --- Trades --- */
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

    /* Sort newest first */
    const sortByDate = (a, b) =>
      new Date(b.createdAt || 0) - new Date(a.createdAt || 0);

    ordersCache.open    = openList.sort(sortByDate);
    ordersCache.history = historyList.sort(sortByDate);
    ordersCache.trades  = tradeList.sort(sortByDate);

    dataLoaded = true;
    renderOrders();

  } catch (err) {
    console.error("Failed to load orders:", err);
    if (tbody) {
      tbody.innerHTML = `
        <tr><td colspan="7" style="text-align:center; padding:40px; color:var(--danger);">
          Unable to load your orders. Please try again later.
        </td></tr>`;
    }
    showToast("Failed to load orders", false);
  }
}

/* =========================================================
   7. RENDER
   ========================================================= */
let currentTab = "open";

function renderOrders() {
  const tbody = getElement("ordersBody");
  if (!tbody) return;

  const list = ordersCache[currentTab] || [];

  /* Empty states */
  if (!list.length) {
    const messages = {
      open:    "You have no open orders.",
      history: "No order history yet.",
      trades:  "No executed trades yet."
    };
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:40px; color:var(--text-dim);">
          ${messages[currentTab] || "No records."}
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = list.map(o => {
    /* Type badge */
    const typeBadge = o.type === "buy"
      ? `<span class="badge buy">BUY</span>`
      : o.type === "sell"
      ? `<span class="badge sell">SELL</span>`
      : `<span class="badge">${escapeHTML(o.type.toUpperCase())}</span>`;

    /* Status badge */
    const statusBadge = `
      <span class="badge ${escapeHTML(o.status)}">
        ${escapeHTML(o.status.charAt(0).toUpperCase() + o.status.slice(1))}
      </span>`;

    /* Action button */
    let actionBtn;

    if (currentTab === "open" && (o.status === "pending" || o.status === "open")) {
      if (BACKEND_CANCEL_ENABLED) {
        actionBtn = `<button class="btn btn-ghost"
                       style="padding:6px 14px; font-size:0.75rem;"
                       onclick="cancelOrder('${escapeHTML(o.id)}')">
                       Cancel
                     </button>`;
      } else {
        /* Realistic UX: no fake cancel. Show it as disabled + tooltip */
        actionBtn = `<button class="btn btn-ghost"
                       style="padding:6px 14px; font-size:0.75rem; opacity:0.5; cursor:not-allowed;"
                       title="Cancellation not available yet — no order-matching backend"
                       onclick="showCancelUnavailable()">
                       Cancel
                     </button>`;
      }
    } else {
      /* Re-trade — safe pair URL */
      const safePair = encodeURIComponent(o.pair);
      actionBtn = `<a href="trade.html?pair=${safePair}"
                     class="btn btn-ghost"
                     style="padding:6px 14px; font-size:0.75rem;">
                     Re-trade
                   </a>`;
    }

    return `
      <tr>
        <td>${escapeHTML(formatDateTime(o.createdAt))}</td>
        <td><strong>${escapeHTML(o.pair)}</strong></td>
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
   8. CANCEL (disabled until backend exists)
   ========================================================= */
window.showCancelUnavailable = function () {
  showToast(
    "Cancellation is not available yet. A real order engine is required.",
    false
  );
};

window.cancelOrder = function (orderId) {
  /* Kept as a stub for when BACKEND_CANCEL_ENABLED becomes true.
     It must call a real backend / Cloud Function and only update
     status after server confirmation. Do NOT fake success here. */
  console.warn("cancelOrder called with id:", orderId);
  showToast("Cancel is not implemented in the backend yet.", false);
};

/* =========================================================
   9. TABS
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

  /* If data hasn't loaded yet (auth pending), show a hint */
  const tbody = getElement("ordersBody");
  if (tbody && !dataLoaded) {
    tbody.innerHTML = `
      <tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-dim);">
        Loading your orders…
      </td></tr>`;
  }
});
