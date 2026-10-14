/* =========================================================
   Nexbit — Wallet Page
   File: wallet.js
   Version: 2.0

   Features:
   - Live balances for BTC, ETH, XRP, SOL, BNB, DOGE, RND, USDT
   - Prices fetched from Binance + DexScreener
   - Total portfolio value in USD
   - No fake data — only verified balances shown
   - Auth guard + logout
   - Safe rendering (escapeHTML)
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
   2. API + TOKEN CONFIG
   ========================================================= */
const BINANCE_TICKER = "https://api.binance.com/api/v3/ticker/24hr";
const DEXSCREENER   = "https://api.dexscreener.com/token-pairs/v1/bsc/";
const RND_ADDRESS   = "0xcF1FbF18bE9202865bcf88E6349B9D207F75942d";

/* =========================================================
   3. SUPPORTED ASSETS
   Each asset has: sym, name, icon, cls (CSS class), type (binance/dexscreener/stable)
   ========================================================= */
const assets = {
  BTC:  { name:"Bitcoin",   icon:"₿", cls:"btc",  type:"binance", marketSymbol:"BTCUSDT"  },
  ETH:  { name:"Ethereum",  icon:"Ξ", cls:"eth",  type:"binance", marketSymbol:"ETHUSDT"  },
  XRP:  { name:"XRP",       icon:"X", cls:"xrp",  type:"binance", marketSymbol:"XRPUSDT"  },
  SOL:  { name:"Solana",    icon:"◎", cls:"sol",  type:"binance", marketSymbol:"SOLUSDT"  },
  BNB:  { name:"BNB",       icon:"B", cls:"bnb",  type:"binance", marketSymbol:"BNBUSDT"  },
  DOGE: { name:"Dogecoin",  icon:"Ð", cls:"doge", type:"binance", marketSymbol:"DOGEUSDT" },
  RND:  { name:"RND Token", icon:"R", cls:"rnd",  type:"dexscreener"                       },
  USDT: { name:"Tether",    icon:"₮", cls:"usdt", type:"stable"                            }
};

/* Runtime: attach prices + user balances */
Object.keys(assets).forEach(sym => {
  assets[sym].price  = sym === "USDT" ? 1 : null;
  assets[sym].change = sym === "USDT" ? 0 : null;
  assets[sym].balance = 0;   // user's holding, from Firebase
});

/* =========================================================
   4. STATE
   ========================================================= */
let currentUser = null;
let priceTimer  = null;

/* =========================================================
   5. SAFE HELPERS
   ========================================================= */
function getElement(id) { return document.getElementById(id); }

function escapeHTML(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}

function formatPrice(n) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 0.0001) return n.toFixed(8);
  if (n < 0.01)   return n.toFixed(6);
  if (n < 1)      return n.toFixed(4);
  if (n < 100)    return n.toFixed(2);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatBalance(n) {
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8
  });
}

function formatUSD(n) {
  if (!Number.isFinite(n)) return "$0.00";
  return "$" + n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function showToast(msg, ok = true) {
  const t = getElement("toast");
  const m = getElement("toastMsg");
  if (!t || !m) { console[ok ? "log" : "error"](msg); return; }
  m.textContent = msg;
  t.style.borderColor = ok ? "var(--success)" : "var(--danger)";
  t.style.boxShadow = ok
    ? "0 0 30px rgba(0,255,163,0.4)"
    : "0 0 30px rgba(255,77,109,0.4)";
  const c = t.querySelector(".check");
  if (c) {
    c.style.background = ok ? "var(--success)" : "var(--danger)";
    c.textContent = ok ? "✓" : "✕";
  }
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}

/* =========================================================
   6. SIDEBAR + LOGOUT
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
   7. AUTH GUARD + NAVBAR
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

  await loadUserBalances(user.uid);
  startPriceRefresh();
});

/* =========================================================
   8. LOAD USER BALANCES FROM FIREBASE
   Expected structure (any of these will work):
     /users/{uid}/balances/{SYM} = number
     /users/{uid}/balanceUSD = number  → treated as USDT
   ========================================================= */
async function loadUserBalances(uid) {
  try {
    const snap = await get(ref(db, `users/${uid}`));
    if (!snap.exists()) { renderAssets(); return; }

    const v = snap.val() || {};

    /* Direct balanceUSD (treated as USDT) */
    const balanceUSD = Number(v.balanceUSD);
    if (Number.isFinite(balanceUSD) && balanceUSD >= 0) {
      assets.USDT.balance = balanceUSD;
    }

    /* Per-asset balances */
    if (v.balances && typeof v.balances === "object") {
      Object.keys(v.balances).forEach(sym => {
        const s = sym.toUpperCase();
        if (assets[s]) {
          const b = Number(v.balances[sym]);
          if (Number.isFinite(b) && b >= 0) {
            assets[s].balance = b;
          }
        }
      });
    }

    renderAssets();

  } catch (err) {
    console.error("Balance load failed:", err);
    showToast("Unable to load balances", false);
    renderAssets();
  }
}

/* =========================================================
   9. LIVE PRICE FETCHING
   ========================================================= */

/* Binance batch fetch */
let binanceInFlight = false;
async function fetchBinancePrices() {
  if (binanceInFlight) return;
  binanceInFlight = true;

  try {
    const binanceAssets = Object.entries(assets)
      .filter(([, a]) => a.type === "binance")
      .map(([, a]) => a.marketSymbol);

    const url = new URL(BINANCE_TICKER);
    url.searchParams.set("symbols", JSON.stringify(binanceAssets));

    const resp = await fetch(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000)
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);

    const data = await resp.json();
    const map  = {};
    data.forEach(item => { map[item.symbol] = item; });

    Object.entries(assets).forEach(([sym, a]) => {
      if (a.type !== "binance") return;
      const item = map[a.marketSymbol];
      if (!item) return;
      const p  = Number(item.lastPrice);
      const ch = Number(item.priceChangePercent);
      if (Number.isFinite(p) && p > 0 && Number.isFinite(ch)) {
        a.price  = p;
        a.change = ch;
      }
    });

  } catch (err) {
    console.warn("Binance price fetch failed:", err);
  } finally {
    binanceInFlight = false;
  }
}

/* RND fetch from DexScreener */
let rndInFlight = false;
async function fetchRNDPrice() {
  if (rndInFlight) return;
  rndInFlight = true;

  try {
    const resp = await fetch(DEXSCREENER + RND_ADDRESS, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000)
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);

    const pairs = await resp.json();
    if (!Array.isArray(pairs)) throw new Error("Bad response");

    const valid = pairs.filter(p =>
      p.chainId === "bsc" &&
      p.dexId && p.dexId.toLowerCase().includes("pancake") &&
      (
        p.baseToken?.address?.toLowerCase() === RND_ADDRESS.toLowerCase() ||
        p.quoteToken?.address?.toLowerCase() === RND_ADDRESS.toLowerCase()
      ) &&
      Number(p.priceUsd) > 0 &&
      Number(p.liquidity?.usd) > 100
    );

    if (!valid.length) throw new Error("No verified RND pool");

    valid.sort((a, b) =>
      Number(b.liquidity.usd) - Number(a.liquidity.usd)
    );

    const pair = valid[0];
    assets.RND.price  = Number(pair.priceUsd);
    assets.RND.change = Number(pair.priceChange?.h24);

  } catch (err) {
    console.warn("RND price fetch failed:", err);
  } finally {
    rndInFlight = false;
  }
}

/* Refresh orchestration */
async function refreshAllPrices() {
  await Promise.all([fetchBinancePrices(), fetchRNDPrice()]);
  renderAssets();
  renderTotal();
}

function startPriceRefresh() {
  if (priceTimer) clearInterval(priceTimer);
  refreshAllPrices();
  priceTimer = setInterval(refreshAllPrices, 30_000);
}

/* =========================================================
   10. RENDER ASSETS
   ========================================================= */
function renderAssets() {
  const tbody = getElement("assetBody");
  if (!tbody) return;

  /* Build list of assets with non-zero balance OR show all */
  const list = Object.entries(assets).map(([sym, a]) => {
    const price  = Number.isFinite(a.price) ? a.price : 0;
    const bal    = Number.isFinite(a.balance) ? a.balance : 0;
    const usdVal = price * bal;
    return { sym, ...a, usdVal };
  });

  /* Sort by USD value descending */
  list.sort((x, y) => y.usdVal - x.usdVal);

  /* Empty state — no assets with any balance */
  const hasAny = list.some(a => a.balance > 0);
  if (!hasAny) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-cell">
          <span class="emoji">💰</span>
          Your wallet is empty.
          <span class="sub">Deposit funds to see them here.</span>
        </td>
      </tr>`;
    return;
  }

  /* Rows */
  tbody.innerHTML = list.map(a => {
    const priceText = Number.isFinite(a.price) && a.price > 0
      ? "$" + formatPrice(a.price)
      : "—";

    const changeText = Number.isFinite(a.change)
      ? (a.change >= 0 ? "▲ " : "▼ ") + Math.abs(a.change).toFixed(2) + "%"
      : "—";

    const changeClass = Number.isFinite(a.change)
      ? (a.change >= 0 ? "price-up" : "price-down")
      : "";

    const balanceText = formatBalance(a.balance);

    const valueText = a.usdVal > 0 ? formatUSD(a.usdVal) : "—";

    const action = `
      <a href="trade.html?coin=${encodeURIComponent(a.sym)}"
         class="btn btn-ghost"
         style="padding:6px 14px; font-size:0.75rem;">
        Trade
      </a>`;

    return `
      <tr>
        <td>
          <div class="coin-cell">
            <div class="coin-icon ${escapeHTML(a.cls)}">${escapeHTML(a.icon)}</div>
            <div>
              <div>${escapeHTML(a.name)}</div>
              <div class="coin-sym">${escapeHTML(a.sym)}</div>
            </div>
          </div>
        </td>
        <td>${escapeHTML(balanceText)} ${escapeHTML(a.sym)}</td>
        <td>${escapeHTML(valueText)}</td>
        <td class="${changeClass}">${escapeHTML(changeText)}</td>
        <td>${action}</td>
      </tr>
    `;
  }).join("");
}

/* =========================================================
   11. RENDER TOTAL PORTFOLIO VALUE
   ========================================================= */
function renderTotal() {
  const totalEl = getElement("walletBalance");
  const subEl   = getElement("walletSub");
  if (!totalEl) return;

  let total = 0;
  let known = 0;
  let unknown = 0;

  Object.values(assets).forEach(a => {
    const price = Number.isFinite(a.price) ? a.price : null;
    const bal   = Number.isFinite(a.balance) ? a.balance : 0;
    if (bal === 0) return;
    if (price === null) { unknown++; return; }
    total += price * bal;
    known++;
  });

  /* Animated count-up */
  animateCount(totalEl, total, 700);

  if (subEl) {
    if (unknown > 0) {
      subEl.textContent = `Includes ${known} assets. ${unknown} asset price(s) unavailable.`;
    } else {
      subEl.textContent = "Live value based on current market prices.";
    }
  }
}

function animateCount(el, to, duration = 700) {
  const from = 0;
  const start = performance.now();
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const v = from + (to - from) * easeOut(p);
    el.textContent = "$" + v.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* =========================================================
   12. INIT
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  /* Show loading placeholder in table */
  const tbody = getElement("assetBody");
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="loading-cell">
          <div class="spinner"></div>
          <div>Loading your wallet…</div>
        </td>
      </tr>`;
  }

  /* Show loading in total */
  const totalEl = getElement("walletBalance");
  if (totalEl) totalEl.textContent = "$0.00";
});

/* Cleanup */
window.addEventListener("beforeunload", () => {
  if (priceTimer) clearInterval(priceTimer);
});
