/* =========================================================
   Nexbit — Dashboard
   File: dashboard.js
   Version: 3.0 (Real balances + live prices + real activity)

   FEATURES:
   - Welcome user
   - Total portfolio value (real balances × live prices)
   - Available + Locked USDT + per-asset USD value
   - Coin cards with live prices (BTC/ETH/XRP/SOL/BNB/DOGE)
   - RND live price card
   - My Listed Tokens (from /users/{uid}/myTokens)
   - Recent Activity (from /users/{uid}/transactions)
   - Real-time updates

   ⚠ SECURITY NOTE:
   Read-only. Balance changes come from engine.js / deposit.js.
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
const DEXSCREENER    = "https://api.dexscreener.com/token-pairs/v1/bsc/";
const RND_ADDRESS    = "0xcF1FbF18bE9202865bcf88E6349B9D207F75942d";

const PRICE_REFRESH_MS = 30_000;

/* Coin cards data */
const coins = [
  { sym: "BTC",  name: "Bitcoin",   icon: "₿", cls: "btc",  type: "binance", marketSymbol: "BTCUSDT",  price: null, change: null },
  { sym: "ETH",  name: "Ethereum",  icon: "Ξ", cls: "eth",  type: "binance", marketSymbol: "ETHUSDT",  price: null, change: null },
  { sym: "XRP",  name: "XRP",       icon: "X", cls: "xrp",  type: "binance", marketSymbol: "XRPUSDT",  price: null, change: null },
  { sym: "SOL",  name: "Solana",    icon: "◎", cls: "sol",  type: "binance", marketSymbol: "SOLUSDT",  price: null, change: null },
  { sym: "BNB",  name: "BNB",       icon: "B", cls: "bnb",  type: "binance", marketSymbol: "BNBUSDT",  price: null, change: null },
  { sym: "DOGE", name: "Dogecoin",  icon: "Ð", cls: "doge", type: "binance", marketSymbol: "DOGEUSDT", price: null, change: null },
  { sym: "RND",  name: "RND Token", icon: "R", cls: "rnd",  type: "dexscreener", price: null, change: null }
];

/* All assets for portfolio calc */
const ASSETS = {
  USDT: { name: "Tether USD",  type: "stable",  price: 1 },
  BTC:  { name: "Bitcoin",     type: "binance", marketSymbol: "BTCUSDT",  price: null },
  ETH:  { name: "Ethereum",    type: "binance", marketSymbol: "ETHUSDT",  price: null },
  XRP:  { name: "XRP",         type: "binance", marketSymbol: "XRPUSDT",  price: null },
  SOL:  { name: "Solana",      type: "binance", marketSymbol: "SOLUSDT",  price: null },
  BNB:  { name: "BNB",         type: "binance", marketSymbol: "BNBUSDT",  price: null },
  DOGE: { name: "Dogecoin",    type: "binance", marketSymbol: "DOGEUSDT", price: null },
  RND:  { name: "RND Token",   type: "dexscreener", price: null }
};

/* =========================================================
   3. STATE
   ========================================================= */
let currentUser   = null;
let userBalances  = {};
let priceTimer    = null;
let binanceInFlight = false;
let rndInFlight     = false;

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
  if (!t || !m) return;
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
    const symbols = [
      ...coins.filter(c => c.type === "binance").map(c => c.marketSymbol),
      ...Object.values(ASSETS).filter(a => a.type === "binance").map(a => a.marketSymbol)
    ];
    const uniqueSymbols = [...new Set(symbols)];

    const url = new URL(BINANCE_TICKER);
    url.searchParams.set("symbols", JSON.stringify(uniqueSymbols));

    const resp = await fetch(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000)
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);

    const data = await resp.json();
    const map = {};
    data.forEach(item => { map[item.symbol] = item; });

    /* Update coin cards */
    coins.forEach(coin => {
      if (coin.type !== "binance") return;
      const item = map[coin.marketSymbol];
      if (!item) return;
      const p = Number(item.lastPrice);
      const ch = Number(item.priceChangePercent);
      if (Number.isFinite(p) && p > 0) {
        coin.price = p;
        coin.change = Number.isFinite(ch) ? ch : null;
      }
    });

    /* Update ASSETS prices */
    Object.entries(ASSETS).forEach(([sym, asset]) => {
      if (asset.type !== "binance") return;
      const item = map[asset.marketSymbol];
      if (!item) return;
      const p = Number(item.lastPrice);
      if (Number.isFinite(p) && p > 0) asset.price = p;
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

    const p = Number(valid[0].priceUsd);
    const ch = Number(valid[0].priceChange?.h24);

    /* Update coin */
    const rndCoin = coins.find(c => c.sym === "RND");
    if (rndCoin) {
      rndCoin.price = p;
      rndCoin.change = Number.isFinite(ch) ? ch : null;
    }
    /* Update ASSETS */
    ASSETS.RND.price = p;

    /* Update RND Featured section */
    updateRNDDisplay(p, ch, valid[0]);

  } catch (err) {
    console.warn("RND fetch failed:", err);
    const rndPrice = getElement("rndPrice");
    if (rndPrice) rndPrice.textContent = "Unavailable";
  } finally {
    rndInFlight = false;
  }
}

async function refreshAllPrices() {
  await Promise.all([fetchBinancePrices(), fetchRNDPrice()]);
  renderCoins();
  renderPortfolio();
}

function startPriceRefresh() {
  if (priceTimer) clearInterval(priceTimer);
  refreshAllPrices();
  priceTimer = setInterval(refreshAllPrices, PRICE_REFRESH_MS);
}

/* =========================================================
   7. RENDER — COIN CARDS
   ========================================================= */
function renderCoins() {
  const grid = getElement("coinsGrid");
  if (!grid) return;

  grid.innerHTML = coins.map(c => {
    const priceReady = Number.isFinite(c.price) && c.price > 0;
    const changeReady = Number.isFinite(c.change);

    const priceText = priceReady
      ? "$" + formatPrice(c.price)
      : "Loading…";

    const changeText = changeReady
      ? (c.change >= 0 ? "▲ " : "▼ ") + Math.abs(c.change).toFixed(2) + "%"
      : "—";

    const changeClass = changeReady
      ? (c.change >= 0 ? "up" : "down")
      : "";

    return `
      <a href="trade.html?coin=${encodeURIComponent(c.sym)}"
         class="coin-card"
         aria-label="${escapeHTML(c.name)} (${escapeHTML(c.sym)})">
        <div class="top">
          <div class="coin-icon ${escapeHTML(c.cls)}">${escapeHTML(c.icon)}</div>
          <div>
            <div class="coin-title">${escapeHTML(c.name)}</div>
            <div class="coin-sym">${escapeHTML(c.sym)}</div>
          </div>
        </div>
        <div class="price-row">
          <div class="price">${escapeHTML(priceText)}</div>
          <div class="change ${changeClass}">${escapeHTML(changeText)}</div>
        </div>
      </a>
    `;
  }).join("");
}

/* =========================================================
   8. RENDER — PORTFOLIO BALANCE
   ========================================================= */
function renderPortfolio() {
  const amountEl = getElement("balanceAmount");
  const changeEl = getElement("balanceChange");
  if (!amountEl) return;

  let totalAvail = 0;
  let totalLocked = 0;
  let unknownCount = 0;

  Object.keys(ASSETS).forEach(sym => {
    const bal = userBalances[sym];
    if (!bal) return;

    const avail = Number(bal.available) || 0;
    const locked = Number(bal.locked) || 0;

    if (avail === 0 && locked === 0) return;

    const price = Number.isFinite(ASSETS[sym].price) ? ASSETS[sym].price : 0;

    if (price > 0) {
      totalAvail += avail * price;
      totalLocked += locked * price;
    } else if (avail > 0 || locked > 0) {
      unknownCount++;
    }
  });

  const total = totalAvail + totalLocked;
  animateCount(amountEl, total, 700);

  if (changeEl) {
    const parts = [`Available: ${formatUSD(totalAvail)}`];
    if (totalLocked > 0) parts.push(`Locked: ${formatUSD(totalLocked)}`);
    if (unknownCount > 0) parts.push(`${unknownCount} asset price unavailable`);
    changeEl.textContent = parts.join(" · ");
  }
}

function animateCount(el, to, duration) {
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
   9. RENDER — RND FEATURED
   ========================================================= */
function updateRNDDisplay(price, change, pairInfo) {
  const priceEl = getElement("rndPrice");
  const changeEl = getElement("rndChange");
  const volEl = getElement("rndVolume");
  const liqEl = getElement("rndLiquidity");
  const updEl = getElement("rndUpdated");

  if (priceEl) priceEl.textContent = "$" + formatPrice(price);

  if (changeEl && Number.isFinite(change)) {
    changeEl.textContent = (change >= 0 ? "▲ +" : "▼ ") + change.toFixed(2) + "%";
    changeEl.dataset.direction = change >= 0 ? "up" : "down";
  }

  const vol = Number(pairInfo?.volume?.h24);
  if (volEl && Number.isFinite(vol)) {
    volEl.textContent = "$" + vol.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  const liq = Number(pairInfo?.liquidity?.usd);
  if (liqEl && Number.isFinite(liq)) {
    liqEl.textContent = "$" + liq.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  if (updEl) {
    updEl.textContent = "🟢 Live · Updated " + new Date().toLocaleTimeString();
  }
}

/* =========================================================
   10. RENDER — MY LISTED TOKENS
   ========================================================= */
async function loadMyTokens(uid) {
  const wrap = getElement("myTokensWrap");
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="empty-state" style="grid-column:1/-1;">
      <div class="spinner" style="margin:0 auto 10px;"></div>
      <p>Loading tokens…</p>
    </div>`;

  try {
    const snap = await get(ref(db, `users/${uid}/myTokens`));

    if (!snap.exists()) {
      wrap.innerHTML = `
        <div class="empty-state">
          <span class="emoji">🪙</span>
          <p>You haven't listed any tokens yet.</p>
          <p style="margin-top:8px;"><a href="list-token.html">+ List Your First Token</a></p>
        </div>`;
      return;
    }

    const list = Object.values(snap.val())
      .filter(t => t && typeof t === "object")
      .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));

    if (!list.length) {
      wrap.innerHTML = `<div class="empty-state"><p>No listed tokens found.</p></div>`;
      return;
    }

    wrap.innerHTML = list.map(t => {
      const status = String(t.status || "unknown");
      const statusText = {
        pending:  "⏳ Under Review",
        approved: "✅ Approved",
        rejected: "❌ Rejected"
      }[status] || "Status unavailable";

      const safeLogo = typeof t.logo === "string" && /^https:\/\//i.test(t.logo)
        ? t.logo : "";

      const logoMarkup = safeLogo
        ? `<img src="${escapeHTML(safeLogo)}" alt="${escapeHTML(t.symbol || "Token")}" loading="lazy" referrerpolicy="no-referrer" />`
        : "🪙";

      return `
        <div class="my-token-card">
          <div class="my-token-logo">${logoMarkup}</div>
          <div class="my-token-info">
            <h4>${escapeHTML(t.name || "Unnamed token")}</h4>
            <div class="sym">${escapeHTML(t.symbol || "N/A")}</div>
            <span class="my-token-status status-${escapeHTML(status)}">${escapeHTML(statusText)}</span>
          </div>
        </div>
      `;
    }).join("");

  } catch (err) {
    console.error("Failed to load tokens:", err);
    wrap.innerHTML = `<div class="empty-state"><p style="color:var(--danger);">Unable to load your tokens.</p></div>`;
  }
}

/* =========================================================
   11. RENDER — RECENT ACTIVITY
   ========================================================= */
async function loadRecentActivity(uid) {
  const tbody = getElement("txBody");
  if (!tbody) return;

  try {
    const [txSnap, tradesSnap] = await Promise.all([
      get(ref(db, `users/${uid}/transactions`)),
      get(ref(db, `users/${uid}/trades`))
    ]);

    const items = [];

    /* Transactions (deposits, withdrawals) */
    if (txSnap.exists()) {
      Object.values(txSnap.val()).forEach(t => {
        if (!t || typeof t !== "object") return;
        items.push({
          date: t.createdAt || t.timestamp || null,
          type: String(t.type || "unknown"),
          asset: String(t.asset || "—"),
          amount: t.amount,
          value: t.amount,
          status: String(t.status || "unknown")
        });
      });
    }

    /* Trades */
    if (tradesSnap.exists()) {
      Object.values(tradesSnap.val()).forEach(t => {
        if (!t || typeof t !== "object") return;
        items.push({
          date: t.executedAt || null,
          type: t.side === "buy" ? "buy" : "sell",
          asset: String(t.pair || "—").replace("USDT", ""),
          amount: t.quantity,
          value: t.cost,
          status: "Completed"
        });
      });
    }

    if (!items.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:40px; color:var(--text-dim);">
            No verified activity yet.
          </td>
        </tr>`;
      return;
    }

    /* Sort by date desc, take top 10 */
    items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const recent = items.slice(0, 10);

    tbody.innerHTML = recent.map(t => {
      const dateStr = t.date
        ? new Date(t.date).toLocaleString("en-US", {
            month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit"
          })
        : "—";

      const typeClass = t.type === "buy" ? "buy"
        : t.type === "sell" ? "sell"
        : t.type === "deposit" || t.type === "dep" ? "dep"
        : "";

      const typeLabel = t.type === "deposit" || t.type === "dep" ? "DEP"
        : t.type.toUpperCase();

      const amountDisplay = typeof t.amount === "number"
        ? t.amount.toFixed(6)
        : escapeHTML(String(t.amount || "—"));

      const valueDisplay = typeof t.value === "number"
        ? "$" + t.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : escapeHTML(String(t.value || "—"));

      const statusColor = t.status === "Completed" || t.status === "success"
        ? "var(--neon-green)"
        : t.status === "failed" || t.status === "error"
        ? "var(--danger)"
        : "var(--text-dim)";

      return `
        <tr>
          <td>${escapeHTML(dateStr)}</td>
          <td><span class="tx-type ${typeClass}">${escapeHTML(typeLabel)}</span></td>
          <td><strong>${escapeHTML(t.asset)}</strong></td>
          <td>${escapeHTML(amountDisplay)}</td>
          <td>${escapeHTML(valueDisplay)}</td>
          <td style="color:${statusColor}; font-weight:500;">${escapeHTML(t.status)}</td>
        </tr>
      `;
    }).join("");

  } catch (err) {
    console.error("Failed to load activity:", err);
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:40px; color:var(--danger);">
          Unable to load activity.
        </td>
      </tr>`;
  }
}

/* =========================================================
   12. AUTH STATE
   ========================================================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUser = user;

  const name  = user.displayName || "Trader";
  const first = name.split(" ")[0];
  const un = getElement("userName");
  const ua = getElement("userAvatar");
  const wn = getElement("welcomeName");
  if (un) un.textContent = first;
  if (ua) ua.textContent = first.charAt(0).toUpperCase();
  if (wn) wn.textContent = first;

  /* Initial loading states */
  renderCoins();  /* shows "Loading…" */

  /* Balances — subscribe for real-time */
  const balRef = ref(db, `balances/${user.uid}`);
  const unsubBal = onValue(balRef, (snap) => {
    userBalances = snap.exists() ? snap.val() : {};
    renderPortfolio();
  });
  activeListeners.push(unsubBal);

  /* Load tokens + recent activity */
  await loadMyTokens(user.uid);
  await loadRecentActivity(user.uid);

  /* Start price refresh */
  startPriceRefresh();
});

/* =========================================================
   13. INITIAL CLEANUP
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  /* Put placeholder in recent activity */
  const tbody = getElement("txBody");
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:40px; color:var(--text-dim);">
          Loading activity…
        </td>
      </tr>`;
  }
});

/* =========================================================
   14. CLEANUP
   ========================================================= */
window.addEventListener("beforeunload", () => {
  if (priceTimer) clearInterval(priceTimer);
  activeListeners.forEach(unsub => {
    try { unsub(); } catch (_) {}
  });
});
