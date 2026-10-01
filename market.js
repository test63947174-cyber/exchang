/* =========================================================
   Nexbit — Markets Page
   File: market.js
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
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

/* ---------- All coins ---------- */
const allCoins = [
  { icon:"₿", cls:"btc", name:"Bitcoin",  sym:"BTC",  price:68432.15, change:+2.45, cap:"$1.34T", isNew:false },
  { icon:"Ξ", cls:"eth", name:"Ethereum", sym:"ETH",  price:3548.90,  change:+1.87, cap:"$426.5B", isNew:false },
  { icon:"X", cls:"xrp", name:"XRP",      sym:"XRP",  price:0.6234,   change:+3.12, cap:"$34.7B", isNew:false },
  { icon:"◎", cls:"sol", name:"Solana",   sym:"SOL",  price:172.45,   change:-0.92, cap:"$78.9B", isNew:false },
  { icon:"B", cls:"bnb", name:"BNB",      sym:"BNB",  price:605.30,   change:+0.64, cap:"$89.2B", isNew:false },
  { icon:"Ð", cls:"doge",name:"Dogecoin", sym:"DOGE", price:0.1582,   change:-1.24, cap:"$22.9B", isNew:false },
  { icon:"R", cls:"rnd", name:"RND Token",sym:"RND",  price:1.247,    change:+18.42,cap:"$124.7M", isNew:true },
  { icon:"⬡", cls:"eth", name:"Cardano",  sym:"ADA",  price:0.4521,   change:+1.15, cap:"$16.1B", isNew:false },
  { icon:"◈", cls:"sol", name:"Avalanche",sym:"AVAX", price:36.18,    change:-2.34, cap:"$14.2B", isNew:false },
  { icon:"◆", cls:"doge",name:"Polkadot", sym:"DOT",  price:6.84,     change:+0.87, cap:"$9.8B",  isNew:false }
];

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
function showToast(msg, ok=true) {
  const t = document.getElementById("toast");
  document.getElementById("toastMsg").textContent = msg;
  t.style.borderColor = ok ? "var(--success)" : "var(--danger)";
  t.style.boxShadow = ok
    ? "0 0 30px rgba(0,255,163,0.4)"
    : "0 0 30px rgba(255,77,109,0.4)";
  const c = t.querySelector(".check");
  c.style.background = ok ? "var(--success)" : "var(--danger)";
  c.textContent = ok ? "✓" : "✕";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---------- Logout ---------- */
window.logoutUser = async (e) => {
  if (e) e.preventDefault();
  try {
    await signOut(auth);
    localStorage.removeItem("Nexbit_User");
    window.location.href = "index.html";
  } catch { showToast("Logout failed", false); }
};

/* ---------- Render ---------- */
let currentFilter = "all";
let currentSearch = "";

function renderMarket() {
  const tbody = document.getElementById("marketBody");
  let list = [...allCoins];

  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.sym.toLowerCase().includes(q)
    );
  }
  if (currentFilter === "gainers") list = list.filter(c => c.change > 0).sort((a,b) => b.change - a.change);
  if (currentFilter === "losers")  list = list.filter(c => c.change < 0).sort((a,b) => a.change - b.change);
  if (currentFilter === "new")     list = list.filter(c => c.isNew);

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text-dim);">No coins match your search.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((c, i) => `
    <tr>
      <td style="color:var(--text-dim); font-size:0.8rem;">${i + 1}</td>
      <td>
        <div class="coin-cell">
          <div class="coin-icon ${c.cls}">${c.icon}</div>
          <div>
            <div>${c.name} ${c.isNew ? '<span style="font-size:0.65rem; padding:2px 8px; border-radius:20px; background:linear-gradient(90deg,var(--neon-pink),var(--neon-purple)); color:#fff; margin-left:6px;">NEW</span>' : ''}</div>
            <div class="coin-sym">${c.sym}</div>
          </div>
        </div>
      </td>
      <td>$${c.price.toLocaleString()}</td>
      <td class="${c.change >= 0 ? 'price-up' : 'price-down'}">
        ${c.change >= 0 ? '▲' : '▼'} ${Math.abs(c.change)}%
      </td>
      <td>${c.cap}</td>
      <td><a href="trade.html?coin=${c.sym}" class="btn-trade">Trade</a></td>
    </tr>
  `).join("");
}

/* ---------- Events ---------- */
document.getElementById("searchInput").addEventListener("input", e => {
  currentSearch = e.target.value;
  renderMarket();
});
document.querySelectorAll(".filter-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    currentFilter = chip.dataset.filter;
    renderMarket();
  });
});

/* ---------- Auth guard ---------- */
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  const name = user.displayName || "Trader";
  const first = name.split(" ")[0];
  document.getElementById("userName").textContent = first;
  document.getElementById("userAvatar").textContent = first.charAt(0).toUpperCase();
});

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", renderMarket);