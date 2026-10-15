/* =========================================================
   Nexbit — Wallet Page
   File: wallet.js
   Version: 3.0 (Real balances + locked + live USD value)

   FEATURES:
   - Reads real balances from /balances/{uid}/{asset}
   - Shows available AND locked separately
   - Live USD value using Binance + DexScreener prices
   - Total portfolio value (sum of all asset USD values)
   - Real-time updates via onValue
   - Deposit / Withdraw links
   - No fake data — only verified balances

   ⚠ SECURITY NOTE:
   This is a read-only view. Balance changes must be made
   via engine.js during internal testing, and via Cloud
   Functions after public launch.
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, ref, get, onValue
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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
   2. ENDPOINTS + ASSETS
   ========================================================= */
const BINANCE_TICKER = "https://api.binance.com/api/v3/ticker/24hr";
const DEXSCREENER   = "https://api.dexscreener.com/token-pairs/v1/bsc/";
const RND_ADDRESS   = "0xcF1FbF18bE9202865bcf88E6349B9D207F75942d";

const PRICE_REFRESH_MS = 30_000;

/* Supported assets and their metadata */
const ASSETS = {
  USDT: { name: "Tether USD",  icon: "₮", cls: "usdt", type: "stable",  price: 1,    change: 0 },
  BTC:  { name: "Bitcoin",     icon: "₿", cls: "btc",  type: "binance", marketSymbol: "BTCUSDT",  price: null, change: null },
  ETH:  { name: "Ethereum",    icon: "Ξ", cls: "eth",  type: "binance", marketSymbol: "ETHUSDT",  price: null, change: null },
  XRP:  { name: "XRP",         icon: "X", cls: "xrp",  type: "binance", marketSymbol: "XRPUSDT",  price: null, change: null },
  SOL:  { name: "Solana",      icon: "◎", cls: "sol",  type: "binance", marketSymbol: "SOLUSDT",  price: null, change: null },
  BNB:  { name: "BNB",         icon: "B", cls: "bnb",  type: "binance", marketSymbol: "BNBUSDT",  price: null, change: null },
  DOGE: { name: "Dogecoin",    icon: "Ð", cls: "doge", type: "binance", marketSymbol: "DOGEUSDT", price: null, change: null },
  RND:  { name: "RND Token",   icon: "R", cls: "rnd",  type: "dexscreener", price: null, change: null }
};

/* =========================================================
   3. STATE
   ========================================================= */
let currentUser   = null;
let userBalances  = {};   // { BTC: { available, locked }, USDT: {...}, ... }
let priceTimer    = null;
let balancesReady = false;
let pricesReady   = false;
let binanceInFlight = false;
let rndInFlight     = false;

/* Real-time unsubscribers */
const activeListeners = [];

/* =========================================================
   4. HELPERS
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
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatBalance(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num === 0) return "0";
  if (num < 0.001)  return num.toFixed(8);
  if (num < 1)      return num.toFixed(6);
  if (num < 100)    return num.toFixed(4);
  return num.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatUSD(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num === 0) return "$0.00";
  if (num < 0.01) return "$" + num.toFixed(6);
  return "$" + num.toLocaleString("en-US", {
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
   5. SIDEBAR + LOGOUT
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
   6. PRICE FETCHING
   ========================================================= */
async function fetchBinancePrices() {
  if (binanceInFlight) return;
  binanceInFlight = true;

  try {
    const symbols = Object.values(ASSETS)
      .filter(a => a.type === "binance" && a.marketSymbol)
      .map(a => a.marketSymbol);

    const url = new URL(BINANCE_TICKER);
    url.searchParams.set("symbols", JSON.stringify(symbols));

    const resp = await fetch(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000)
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);

    const data = await resp.json();
    const map = {};
    data.forEach(item => { map[item.symbol] = item; });

    Object.values(ASSETS).forEach(asset => {
      if (asset.type !== "binance") return;
      const item = map[asset.marketSymbol];
      if (!item) return;
      const p = Number(item.lastPrice);
      const ch = Number(item.priceChangePercent);
      if (Number.isFinite(p) && p > 0) {
        asset.price = p;
        asset.change = Number.isFinite(ch) ? ch : null;
      }
    });
  } catch (err) {
    console.warn("Binance fetch failed:", err);
  } finally {
    binanceInFlight = false;
  }
}

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
    if (!Array.isArray(pairs)) return;

    const valid = pairs.filter(p =>
      p.chainId === "bsc" &&
      p.dexId && p.dexId.toLowerCase().includes("pancake") &&
      Number(p.priceUsd) > 0 && Number(p.liquidity?.usd) > 100
    );
    if (!valid.length) return;
    valid.sort((a, b) => Number(b.liquidity.usd) - Number(a.liquidity.usd));

    ASSETS.RND.price  = Number(valid[0].priceUsd);
    ASSETS.RND.change = Number(valid[0].priceChange?.h24);
  } catch (_) {}
  finally {
    rndInFlight = false;
  }
}

async function refreshAllPrices() {
  await Promise.all([fetchBinancePrices(), fetchRNDPrice()]);
  pricesReady = true;
  renderPortfolio();
  renderAssets();
}

function startPriceRefresh() {
  if (priceTimer) clearInterval(priceTimer);
  refreshAllPrices();
  priceTimer = setInterval(refreshAllPrices, PRICE_REFRESH_MS);
}

/* =========================================================
   7. BALANCE LOADING
   ========================================================= */

/* Load balances once (initial snapshot) */
async function loadBalances(uid) {
  try {
    const snap = await get(ref(db, `balances/${uid}`));
    userBalances = snap.exists() ? snap.val() : {};
    balancesReady = true;
    renderPortfolio();
    renderAssets();
  } catch (err) {
    console.error("Balance load failed:", err);
    showToast("Unable to load balances", false);
  }
}

/* Subscribe to all balances for real-time updates */
function subscribeBalances(uid) {
  const bRef = ref(db, `balances/${uid}`);
  const unsub = onValue(bRef, (snap) => {
    userBalances = snap.exists() ? snap.val() : {};
    balancesReady = true;
    renderPortfolio();
    renderAssets();
  });
  activeListeners.push(unsub);
}

/* Get balance for an asset (available + locked) */
function getBalanceFor(sym) {
  const b = userBalances[sym];
  if (!b) return { available: 0, locked: 0 };
  return {
    available: Number(b.available) || 0,
    locked: Number(b.locked) || 0
  };
}

/* Get USD price for an asset */
function getPriceFor(sym) {
  const asset = ASSETS[sym];
  if (!asset) return 0;
  return Number.isFinite(asset.price) ? asset.price : 0;
}

/* =========================================================
   8. RENDER — TOTAL PORTFOLIO
   ========================================================= */
function renderPortfolio() {
  const amountEl = getElement("walletBalance");
  const subEl    = getElement("walletSub");
  if (!amountEl) return;

  let totalAvailable = 0;
  let totalLocked = 0;
  let unknownCount = 0;
  let knownCount = 0;

  Object.keys(ASSETS).forEach(sym => {
    const bal = getBalanceFor(sym);
    const price = getPriceFor(sym);

    if (bal.available > 0 || bal.locked > 0) {
      if (price > 0) {
        totalAvailable += bal.available * price;
        totalLocked    += bal.locked    * price;
        knownCount++;
      } else {
        unknownCount++;
      }
    }
  });

  const total = totalAvailable + totalLocked;

  /* Animated count */
  animateNumber(amountEl, total, 700);

  if (subEl) {
    const parts = [];
    parts.push(`Available: ${formatUSD(totalAvailable)}`);
    if (totalLocked > 0) parts.push(`Locked: ${formatUSD(totalLocked)}`);
    if (unknownCount > 0) parts.push(`${unknownCount} asset price unavailable`);
    subEl.textContent = parts.join(" · ");
  }
}

function animateNumber(el, to, duration) {
  if (!el) return;
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
   9. RENDER — ASSET TABLE
   ========================================================= */
function renderAssets() {
  const tbody = getElement("assetBody");
  if (!tbody) return;

  /* Not ready yet */
  if (!balancesReady || !pricesReady) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="loading-cell">
          <div class="spinner"></div>
          <div>Loading your assets…</div>
        </td>
      </tr>`;
    return;
  }

  /* Build list with USD values */
  const list = Object.keys(ASSETS).map(sym => {
    const bal = getBalanceFor(sym);
    const price = getPriceFor(sym);
    const availUSD = bal.available * price;
    const lockedUSD = bal.locked * price;
    return {
      sym,
      ...ASSETS[sym],
      available: bal.available,
      locked: bal.locked,
      availUSD,
      lockedUSD,
      totalUSD: availUSD + lockedUSD
    };
  });

  /* Filter: only show assets with non-zero balance */
  const withBalance = list.filter(a => a.available > 0 || a.locked > 0);

  /* If nothing: empty state */
  if (!withBalance.length) {
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

  /* Sort by USD value desc */
  withBalance.sort((a, b) => b.totalUSD - a.totalUSD);

  /* Rows */
  tbody.innerHTML = withBalance.map(a => {
    const changeText = Number.isFinite(a.change)
      ? (a.change >= 0 ? "▲ " : "▼ ") + Math.abs(a.change).toFixed(2) + "%"
      : "—";
    const changeClass = Number.isFinite(a.change)
      ? (a.change >= 0 ? "price-up" : "price-down")
      : "";

    /* Locked badge if any */
    const lockedBadge = a.locked > 0
      ? `<div style="font-size:0.7rem; color:#ffbd2e; margin-top:3px;">
           🔒 Locked: ${escapeHTML(formatBalance(a.locked))} ${escapeHTML(a.sym)}
         </div>`
      : "";

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
        <td>
          <div style="font-weight:600;">${escapeHTML(formatBalance(a.available))} ${escapeHTML(a.sym)}</div>
          ${lockedBadge}
        </td>
        <td>
          <div style="font-weight:600;">${escapeHTML(formatUSD(a.totalUSD))}</div>
          ${a.locked > 0 ? `<div style="font-size:0.7rem; color:var(--text-dim);">${escapeHTML(formatUSD(a.availUSD))} available</div>` : ""}
        </td>
        <td class="${changeClass}">${escapeHTML(changeText)}</td>
        <td>
          <a href="trade.html?coin=${encodeURIComponent(a.sym)}"
             class="btn btn-ghost"
             style="padding:6px 14px; font-size:0.75rem;">
            Trade
          </a>
        </td>
      </tr>
    `;
  }).join("");
}

/* =========================================================
   10. AUTH STATE
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

  /* Show loading state */
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

  /* Load balances + start listening */
  await loadBalances(user.uid);
  subscribeBalances(user.uid);

  /* Start price refresh */
  startPriceRefresh();
});

/* =========================================================
   11. CLEANUP
   ========================================================= */
window.addEventListener("beforeunload", () => {
  if (priceTimer) clearInterval(priceTimer);
  activeListeners.forEach(unsub => {
    try { unsub(); } catch (_) {}
  });
});
