/* =========================================================
   Nexbit — Dashboard Page
   File: dashboard.js  (matches dashboard.html)
   Firebase Project: exchang-59ea7
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

// ---- 🔥 Firebase Config (exchang-59ea7) ----
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

const app       = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth      = getAuth(app);
const db        = getDatabase(app);

/* =========================================================
   COIN DATA — जिसमें Bitcoin, Ethereum, XRP, Solana, BNB,
   Dogecoin और RND भी शामिल हैं
   ========================================================= */
const coins = [
  {
    icon: "₿", cls: "btc", name: "Bitcoin", sym: "BTC",
    price: 68432.15, change: +2.45, cap: "$1.34T"
  },
  {
    icon: "Ξ", cls: "eth", name: "Ethereum", sym: "ETH",
    price: 3548.90, change: +1.87, cap: "$426.5B"
  },
  {
    icon: "X", cls: "xrp", name: "XRP", sym: "XRP",
    price: 0.6234, change: +3.12, cap: "$34.7B"
  },
  {
    icon: "◎", cls: "sol", name: "Solana", sym: "SOL",
    price: 172.45, change: -0.92, cap: "$78.9B"
  },
  {
    icon: "B", cls: "bnb", name: "BNB", sym: "BNB",
    price: 605.30, change: +0.64, cap: "$89.2B"
  },
  {
    icon: "Ð", cls: "doge", name: "Dogecoin", sym: "DOGE",
    price: 0.1582, change: -1.24, cap: "$22.9B"
  },
  {
    icon: "R", cls: "rnd", name: "RND Token", sym: "RND",
    price: 1.247, change: +18.42, cap: "$124.7M"
  }
];

/* =========================================================
   DEMO TRANSACTIONS (UI showcase — later real data)
   ========================================================= */
const demoTransactions = [
  { date: "2026-10-01 14:22", type: "buy",  asset: "BTC", amount: "0.0245 BTC",  value: "$1,676.58", status: "Completed" },
  { date: "2026-09-30 09:15", type: "dep",  asset: "USD", amount: "$500.00",     value: "$500.00",   status: "Completed" },
  { date: "2026-09-29 21:48", type: "buy",  asset: "RND", amount: "1,200 RND",   value: "$1,496.40", status: "Completed" },
  { date: "2026-09-28 17:02", type: "sell", asset: "ETH", amount: "0.15 ETH",    value: "$532.34",   status: "Completed" },
  { date: "2026-09-27 11:33", type: "buy",  asset: "XRP", amount: "800 XRP",     value: "$498.72",   status: "Pending" },
  { date: "2026-09-26 20:11", type: "dep",  asset: "USD", amount: "$1,000.00",   value: "$1,000.00", status: "Completed" }
];

/* =========================================================
   RENDER COIN CARDS
   ========================================================= */
function renderCoins() {
  const grid = document.getElementById("coinsGrid");
  if (!grid) return;

  grid.innerHTML = coins.map(c => `
    <a href="trade.html?coin=${c.sym}" class="coin-card">
      <div class="top">
        <div class="coin-icon ${c.cls}">${c.icon}</div>
        <div>
          <div class="coin-title">${c.name}</div>
          <div class="coin-sym">${c.sym}</div>
        </div>
      </div>
      <div class="price-row">
        <div class="price">$${c.price.toLocaleString()}</div>
        <div class="change ${c.change >= 0 ? 'up' : 'down'}">
          ${c.change >= 0 ? '▲' : '▼'} ${Math.abs(c.change)}%
        </div>
      </div>
    </a>
  `).join("");
}

/* =========================================================
   RENDER TRANSACTIONS
   ========================================================= */
function renderTransactions() {
  const tbody = document.getElementById("txBody");
  if (!tbody) return;

  tbody.innerHTML = demoTransactions.map(t => `
    <tr>
      <td>${t.date}</td>
      <td><span class="tx-type ${t.type}">${t.type.toUpperCase()}</span></td>
      <td><strong>${t.asset}</strong></td>
      <td>${t.amount}</td>
      <td>${t.value}</td>
      <td style="color:${t.status === 'Completed' ? 'var(--neon-green)' : 'var(--text-dim)'}; font-weight:500;">
        ${t.status}
      </td>
    </tr>
  `).join("");
}

/* =========================================================
   TOAST
   ========================================================= */
function showToast(message, isSuccess = true) {
  const toast = document.getElementById("toast");
  const toastMsg = document.getElementById("toastMsg");
  toastMsg.textContent = message;
  toast.style.borderColor = isSuccess ? "var(--success)" : "var(--danger)";
  toast.style.boxShadow = isSuccess
    ? "0 0 30px rgba(0, 255, 163, 0.4)"
    : "0 0 30px rgba(255, 77, 109, 0.4)";
  const check = toast.querySelector(".check");
  check.style.background = isSuccess ? "var(--success)" : "var(--danger)";
  check.textContent = isSuccess ? "✓" : "✕";
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3200);
}

/* =========================================================
   AUTH STATE — User को check करो, न हो तो login पर भेजो
   ========================================================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // 🔒 Not logged in → redirect to login
    window.location.href = "login.html";
    return;
  }

  // ---- Welcome header + navbar ----
  let displayName = user.displayName || "Trader";
  let balanceUSD  = 0;

  // Firebase Auth profile से नाम लो
  // (या Realtime DB से full data load करो)
  try {
    const snap = await get(ref(db, "users/" + user.uid));
    if (snap.exists()) {
      const val = snap.val();
      if (val.fullName)  displayName = val.fullName;
      if (val.balanceUSD) balanceUSD = Number(val.balanceUSD) || 0;
    }
  } catch (e) {
    console.warn("DB fetch failed:", e);
  }

  // Update UI
  const firstName = displayName.split(" ")[0];
  document.getElementById("userName").textContent    = firstName;
  document.getElementById("userAvatar").textContent  = firstName.charAt(0).toUpperCase();
  document.getElementById("welcomeName").textContent = firstName;

  // Balance card
  const balEl = document.getElementById("balanceAmount");
  const chgEl = document.getElementById("balanceChange");
  const total = balanceUSD + 2847.35; // demo bonus so it looks nice

  // Smooth count-up animation
  animateCount(balEl, 0, total, 800);

  // Daily change demo
  const dailyChange = total * 0.0324; // +3.24% demo
  chgEl.textContent = `▲ $${dailyChange.toFixed(2)} (3.24%) today`;
});

/* =========================================================
   LOGOUT
   ========================================================= */
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    localStorage.removeItem("Nexbit_User");
    showToast("Logged out successfully.", true);
    setTimeout(() => { window.location.href = "index.html"; }, 900);
  } catch (err) {
    showToast("Logout failed. Try again.", false);
  }
});

/* =========================================================
   NUMBER COUNT-UP ANIMATION
   ========================================================= */
function animateCount(el, from, to, duration = 700) {
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const value = from + (to - from) * easeOut(progress);
    el.textContent = "$" + value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    if (progress < 1) requestAnimationFrame(step);
  }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  requestAnimationFrame(step);
}

/* =========================================================
   MOBILE MENU (placeholder, since dashboard is simple)
   ========================================================= */
window.toggleMobileMenu = function () {
  showToast("Use the buttons above 👆", true);
};

/* =========================================================
   INITIAL RENDER
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  renderCoins();
  renderTransactions();
});