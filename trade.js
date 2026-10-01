/* =========================================================
   Nexbit — Trade Page
   File: trade.js
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
const db = getDatabase(app);

/* ---------- Coin prices ---------- */
const prices = {
  BTC:  { name:"Bitcoin",  icon:"₿", cls:"btc",  price:68432.15, change:+2.45 },
  ETH:  { name:"Ethereum", icon:"Ξ", cls:"eth",  price:3548.90,  change:+1.87 },
  XRP:  { name:"XRP",      icon:"X", cls:"xrp",  price:0.6234,   change:+3.12 },
  SOL:  { name:"Solana",   icon:"◎", cls:"sol",  price:172.45,   change:-0.92 },
  BNB:  { name:"BNB",      icon:"B", cls:"bnb",  price:605.30,   change:+0.64 },
  DOGE: { name:"Dogecoin", icon:"Ð", cls:"doge", price:0.1582,   change:-1.24 },
  RND:  { name:"RND Token",icon:"R", cls:"rnd",  price:1.247,    change:+18.42 }
};

let currentCoin = "BTC";
let currentPrice = prices.BTC.price;

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
  t.style.boxShadow = ok ? "0 0 30px rgba(0,255,163,0.4)" : "0 0 30px rgba(255,77,109,0.4)";
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

/* ---------- Load coin from URL ---------- */
function loadCoin() {
  const params = new URLSearchParams(location.search);
  const sym = (params.get("coin") || "BTC").toUpperCase();
  const coin = prices[sym];
  if (!coin) { showToast("Unknown coin", false); return; }

  currentCoin = sym;
  currentPrice = coin.price;

  document.getElementById("coinIcon").className = "coin-icon " + coin.cls;
  document.getElementById("coinIcon").textContent = coin.icon;
  document.getElementById("coinName").textContent = coin.name;
  document.getElementById("coinSub").textContent = sym + " / USDT";
  document.getElementById("bigPrice").textContent = "$" + coin.price.toLocaleString();
  const chg = document.getElementById("bigChange");
  chg.textContent = (coin.change >= 0 ? "▲ " : "▼ ") + Math.abs(coin.change) + "%";
  chg.className = "chg " + (coin.change >= 0 ? "up" : "down");

  document.getElementById("buyPrice").textContent = "$" + coin.price.toLocaleString();
  document.getElementById("sellPrice").textContent = "$" + coin.price.toLocaleString();

  // Default action
  const action = params.get("action");
  if (action === "sell") switchTradeTab("sell");

  // Draw chart
  drawChart(coin.change);
}

/* ---------- Fake chart ---------- */
function drawChart(change) {
  const points = 40;
  const base = 150;
  const trend = change >= 0 ? 1 : -1;
  const data = [];
  let val = base;
  for (let i = 0; i < points; i++) {
    val += trend * 1.5 + (Math.random() - 0.5) * 20;
    data.push(Math.max(40, Math.min(260, val)));
  }

  const width = 800, height = 300;
  const stepX = width / (points - 1);
  let lineD = `M 0 ${height - data[0]}`;
  data.forEach((v, i) => {
    if (i > 0) lineD += ` L ${i * stepX} ${height - v}`;
  });
  const areaD = lineD + ` L ${width} ${height} L 0 ${height} Z`;

  document.getElementById("chartLine").setAttribute("d", lineD);
  document.getElementById("chartArea").setAttribute("d", areaD);
}

/* ---------- Trade tabs ---------- */
window.switchTradeTab = (mode) => {
  const tabBuy = document.getElementById("tabBuy");
  const tabSell = document.getElementById("tabSell");
  const formBuy = document.getElementById("formBuy");
  const formSell = document.getElementById("formSell");

  if (mode === "buy") {
    tabBuy.classList.add("active");
    tabSell.classList.remove("active");
    formBuy.classList.add("active");
    formSell.classList.remove("active");
  } else {
    tabSell.classList.add("active");
    tabBuy.classList.remove("active");
    formSell.classList.add("active");
    formBuy.classList.remove("active");
  }
};

/* ---------- Amount helpers ---------- */
window.quickAmt = (mode, val) => {
  const inp = document.getElementById(mode === "buy" ? "buyAmount" : "sellAmount");
  inp.value = val;
  updateCalc(mode);
};

window.setMax = (mode) => {
  const inp = document.getElementById(mode === "buy" ? "buyAmount" : "sellAmount");
  inp.value = 10000;
  updateCalc(mode);
};

function updateCalc(mode) {
  const amount = parseFloat(document.getElementById(mode === "buy" ? "buyAmount" : "sellAmount").value) || 0;
  const fee = amount * 0.001;

  if (mode === "buy") {
    document.getElementById("buyReceive").textContent =
      (amount / currentPrice).toFixed(8) + " " + currentCoin;
    document.getElementById("buyFee").textContent = "$" + fee.toFixed(2);
    document.getElementById("buyTotal").textContent = "$" + (amount + fee).toFixed(2);
  } else {
    document.getElementById("sellGive").textContent =
      (amount / currentPrice).toFixed(8) + " " + currentCoin;
    document.getElementById("sellFee").textContent = "$" + fee.toFixed(2);
    document.getElementById("sellTotal").textContent = "$" + (amount - fee).toFixed(2);
  }
}

/* ---------- Execute trade ---------- */
window.executeTrade = async (mode) => {
  const inp = document.getElementById(mode === "buy" ? "buyAmount" : "sellAmount");
  const amount = parseFloat(inp.value) || 0;

  if (amount <= 0) { showToast("Please enter an amount.", false); return; }
  if (amount < 10) { showToast("Minimum trade is $10.", false); return; }

  showToast(`✅ ${mode === "buy" ? "Buy" : "Sell"} order placed! ${amount} USD of ${currentCoin}`, true);
  inp.value = "";
  updateCalc(mode);
};

/* ---------- Auth guard ---------- */
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  const name = user.displayName || "Trader";
  const first = name.split(" ")[0];
  document.getElementById("userName").textContent = first;
  document.getElementById("userAvatar").textContent = first.charAt(0).toUpperCase();
});

/* ---------- Bind inputs ---------- */
document.getElementById("buyAmount").addEventListener("input",  () => updateCalc("buy"));
document.getElementById("sellAmount").addEventListener("input", () => updateCalc("sell"));

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", loadCoin);