/* =========================================================
   Nexbit — Wallet Page
   File: wallet.js
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
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

/* ---------- Sidebar ---------- */
window.toggleSidebar = () => {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("sidebarOverlay").classList.toggle("show");
};
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebarOverlay").classList.remove("show");
  }
});

/* ---------- Toast ---------- */
window.showToast = function(msg, ok=true) {
  const t = document.getElementById("toast");
  document.getElementById("toastMsg").textContent = msg;
  t.style.borderColor = ok ? "var(--success)" : "var(--danger)";
  t.style.boxShadow = ok ? "0 0 30px rgba(0,255,163,0.4)" : "0 0 30px rgba(255,77,109,0.4)";
  const c = t.querySelector(".check");
  c.style.background = ok ? "var(--success)" : "var(--danger)";
  c.textContent = ok ? "✓" : "✕";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
};

/* ---------- Logout ---------- */
window.logoutUser = async (e) => {
  if (e) e.preventDefault();
  try {
    await signOut(auth);
    localStorage.removeItem("Nexbit_User");
    window.location.href = "index.html";
  } catch { showToast("Logout failed", false); }
};

/* ---------- Demo assets ---------- */
const demoAssets = [
  { icon:"₿", cls:"btc", name:"Bitcoin",  sym:"BTC",  bal:0.0421,  value:2880.99, change:+2.45 },
  { icon:"Ξ", cls:"eth", name:"Ethereum", sym:"ETH",  bal:0.3520,  value:1249.21, change:+1.87 },
  { icon:"X", cls:"xrp", name:"XRP",      sym:"XRP",  bal:850.00,  value:529.89,  change:+3.12 },
  { icon:"R", cls:"rnd", name:"RND Token",sym:"RND",  bal:1200.00, value:1496.40, change:+18.42 }
];

function renderAssets() {
  const tbody = document.getElementById("assetBody");
  tbody.innerHTML = demoAssets.map(a => `
    <tr>
      <td>
        <div class="coin-cell">
          <div class="coin-icon ${a.cls}">${a.icon}</div>
          <div>
            <div>${a.name}</div>
            <div class="coin-sym">${a.sym}</div>
          </div>
        </div>
      </td>
      <td>${a.bal} ${a.sym}</td>
      <td>$${a.value.toLocaleString()}</td>
      <td style="color:${a.change >= 0 ? 'var(--neon-green)' : 'var(--danger)'}; font-weight:600;">
        ${a.change >= 0 ? '▲' : '▼'} ${Math.abs(a.change)}%
      </td>
      <td><a href="trade.html?coin=${a.sym}" class="btn btn-ghost" style="padding:6px 14px; font-size:0.75rem;">Trade</a></td>
    </tr>
  `).join("");
}

/* ---------- Auth guard ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  const name = user.displayName || "Trader";
  const first = name.split(" ")[0];
  document.getElementById("userName").textContent = first;
  document.getElementById("userAvatar").textContent = first.charAt(0).toUpperCase();

  let balanceUSD = 0;
  try {
    const snap = await get(ref(db, "users/" + user.uid));
    if (snap.exists() && snap.val().balanceUSD) balanceUSD = Number(snap.val().balanceUSD) || 0;
  } catch (_) {}

  document.getElementById("walletBalance").textContent =
    "$" + (balanceUSD + 2847.35).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
});

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", renderAssets);