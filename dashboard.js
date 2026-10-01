/* =========================================================
   Nexbit — Dashboard
   File: dashboard.js
   Firebase Project: exchang-59ea7
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, ref, get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

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

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getDatabase(app);

/* ---------- Coins ---------- */
const coins = [
  { icon:"₿", cls:"btc", name:"Bitcoin",  sym:"BTC",  price:68432.15, change:+2.45 },
  { icon:"Ξ", cls:"eth", name:"Ethereum", sym:"ETH",  price:3548.90,  change:+1.87 },
  { icon:"X", cls:"xrp", name:"XRP",      sym:"XRP",  price:0.6234,   change:+3.12 },
  { icon:"◎", cls:"sol", name:"Solana",   sym:"SOL",  price:172.45,   change:-0.92 },
  { icon:"B", cls:"bnb", name:"BNB",      sym:"BNB",  price:605.30,   change:+0.64 },
  { icon:"Ð", cls:"doge",name:"Dogecoin", sym:"DOGE", price:0.1582,   change:-1.24 },
  { icon:"R", cls:"rnd", name:"RND Token",sym:"RND",  price:1.247,    change:+18.42 }
];

const demoTransactions = [
  { date:"2026-10-01 14:22", type:"buy",  asset:"BTC", amount:"0.0245 BTC", value:"$1,676.58", status:"Completed" },
  { date:"2026-09-30 09:15", type:"dep",  asset:"USD", amount:"$500.00",    value:"$500.00",    status:"Completed" },
  { date:"2026-09-29 21:48", type:"buy",  asset:"RND", amount:"1,200 RND",  value:"$1,496.40",  status:"Completed" },
  { date:"2026-09-28 17:02", type:"sell", asset:"ETH", amount:"0.15 ETH",   value:"$532.34",    status:"Completed" },
  { date:"2026-09-27 11:33", type:"buy",  asset:"XRP", amount:"800 XRP",    value:"$498.72",    status:"Pending"   }
];

/* ---------- Sidebar ---------- */
window.toggleSidebar = function() {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("sidebarOverlay").classList.toggle("show");
};
// Close on Escape
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebarOverlay").classList.remove("show");
  }
});

/* ---------- Render coins ---------- */
function renderCoins() {
  const grid = document.getElementById("coinsGrid");
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
        <div class="change ${c.change>=0?'up':'down'}">
          ${c.change>=0?'▲':'▼'} ${Math.abs(c.change)}%
        </div>
      </div>
    </a>
  `).join("");
}

/* ---------- Render transactions ---------- */
function renderTransactions() {
  const tbody = document.getElementById("txBody");
  tbody.innerHTML = demoTransactions.map(t => `
    <tr>
      <td>${t.date}</td>
      <td><span class="tx-type ${t.type}">${t.type.toUpperCase()}</span></td>
      <td><strong>${t.asset}</strong></td>
      <td>${t.amount}</td>
      <td>${t.value}</td>
      <td style="color:${t.status==='Completed'?'var(--neon-green)':'var(--text-dim)'}; font-weight:500;">${t.status}</td>
    </tr>
  `).join("");
}

/* ---------- Toast ---------- */
function showToast(msg, ok=true) {
  const t = document.getElementById("toast");
  document.getElementById("toastMsg").textContent = msg;
  t.style.borderColor = ok ? "var(--success)" : "var(--danger)";
  t.style.boxShadow = ok
    ? "0 0 30px rgba(0,255,163,0.4)"
    : "0 0 30px rgba(255,77,109,0.4)";
  const check = t.querySelector(".check");
  check.style.background = ok ? "var(--success)" : "var(--danger)";
  check.textContent = ok ? "✓" : "✕";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---------- Logout ---------- */
window.logoutUser = async function(e) {
  if (e) e.preventDefault();
  try {
    await signOut(auth);
    localStorage.removeItem("Nexbit_User");
    window.location.href = "index.html";
  } catch (err) {
    showToast("Logout failed", false);
  }
};

/* ---------- Auth guard + load user ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  let displayName = user.displayName || "Trader";
  let balanceUSD  = 0;

  try {
    const snap = await get(ref(db, "users/" + user.uid));
    if (snap.exists()) {
      const v = snap.val();
      if (v.fullName) displayName = v.fullName;
      if (v.balanceUSD) balanceUSD = Number(v.balanceUSD) || 0;
    }
  } catch (_) {}

  const first = displayName.split(" ")[0];
  document.getElementById("userName").textContent    = first;
  document.getElementById("userAvatar").textContent  = first.charAt(0).toUpperCase();
  document.getElementById("welcomeName").textContent = first;

  // Animated balance
  const total = balanceUSD + 2847.35;
  animateCount(document.getElementById("balanceAmount"), 0, total, 800);

  const dailyChange = total * 0.0324;
  document.getElementById("balanceChange").textContent =
    `▲ $${dailyChange.toFixed(2)} (3.24%) today`;
});

/* ---------- Animate count ---------- */
function animateCount(el, from, to, duration) {
  const start = performance.now();
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const v = from + (to - from) * easeOut(p);
    el.textContent = "$" + v.toLocaleString(undefined, {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  renderCoins();
  renderTransactions();
});
