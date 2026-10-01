/* =========================================================
   Nexbit — Orders Page
   File: orders.js
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

function showToast(msg, ok=true) {
  const t = document.getElementById("toast");
  document.getElementById("toastMsg").textContent = msg;
  t.style.borderColor = ok ? "var(--success)" : "var(--danger)";
  const c = t.querySelector(".check");
  c.style.background = ok ? "var(--success)" : "var(--danger)";
  c.textContent = ok ? "✓" : "✕";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}

window.logoutUser = async (e) => {
  if (e) e.preventDefault();
  try {
    await signOut(auth);
    localStorage.removeItem("Nexbit_User");
    window.location.href = "index.html";
  } catch { showToast("Logout failed", false); }
};

/* ---------- Demo data ---------- */
const orders = {
  open: [
    { date:"2026-10-01 12:34", pair:"BTC/USDT", type:"buy",  price:"$67,200", amount:"0.015 BTC", status:"Pending" },
    { date:"2026-10-01 10:12", pair:"ETH/USDT", type:"sell", price:"$3,600",  amount:"0.25 ETH",  status:"Pending" }
  ],
  history: [
    { date:"2026-09-30 15:22", pair:"BTC/USDT", type:"buy",  price:"$68,432", amount:"0.0245 BTC", status:"Filled" },
    { date:"2026-09-29 21:48", pair:"RND/USDT", type:"buy",  price:"$1.247",  amount:"1,200 RND",  status:"Filled" },
    { date:"2026-09-28 17:02", pair:"ETH/USDT", type:"sell", price:"$3,548",  amount:"0.15 ETH",   status:"Filled" },
    { date:"2026-09-27 11:33", pair:"XRP/USDT", type:"buy",  price:"$0.6234", amount:"800 XRP",    status:"Cancelled" }
  ],
  trades: [
    { date:"2026-09-30 15:22", pair:"BTC/USDT", type:"buy",  price:"$68,432", amount:"0.0245 BTC", status:"Filled" },
    { date:"2026-09-29 21:48", pair:"RND/USDT", type:"buy",  price:"$1.247",  amount:"1,200 RND",  status:"Filled" }
  ]
};

let currentTab = "open";

function renderOrders() {
  const tbody = document.getElementById("ordersBody");
  const list = orders[currentTab] || [];

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-dim);">No ${currentTab} orders yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(o => `
    <tr>
      <td>${o.date}</td>
      <td><strong>${o.pair}</strong></td>
      <td><span class="badge ${o.type}">${o.type.toUpperCase()}</span></td>
      <td>${o.price}</td>
      <td>${o.amount}</td>
      <td><span class="badge ${o.status.toLowerCase()}">${o.status}</span></td>
      <td>
        ${o.status === "Pending"
          ? `<button class="btn btn-ghost" style="padding:6px 14px; font-size:0.75rem;" onclick="cancelOrder(this)">Cancel</button>`
          : `<a href="trade.html" class="btn btn-ghost" style="padding:6px 14px; font-size:0.75rem;">Re-trade</a>`}
      </td>
    </tr>
  `).join("");
}

window.cancelOrder = function(btn) {
  btn.textContent = "Cancelled";
  btn.disabled = true;
  showToast("Order cancelled", true);
};

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    renderOrders();
  });
});

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  const name = user.displayName || "Trader";
  const first = name.split(" ")[0];
  document.getElementById("userName").textContent = first;
  document.getElementById("userAvatar").textContent = first.charAt(0).toUpperCase();
});

document.addEventListener("DOMContentLoaded", renderOrders);