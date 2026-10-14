/* =========================================================
   Nexbit — Markets Page
   File: market.js
   Version: 2.0 (Developer Instructions compliant)

   Data sources:
   - Binance Spot API  → BTC, ETH, XRP, SOL, BNB, DOGE, ADA, AVAX, DOT
   - DexScreener API   → RND (BSC / PancakeSwap)

   No hardcoded prices. No fabricated market caps.
   API failures show explicit stale/unavailable status.
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

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

/* =========================================================
   2. API ENDPOINTS
   ========================================================= */
const BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/24hr";
const DEXSCREENER_URL    =
  "https://api.dexscreener.com/token-pairs/v1/bsc/";

const RND_ADDRESS = "0xcF1FbF18bE9202865bcf88E6349B9D207F75942d";
const RND_BUY_URL =
  `https://pancakeswap.finance/swap?chain=bsc&outputCurrency=${RND_ADDRESS}`;

const PRICE_REFRESH_MS = 30_000;   // Binance refresh every 30s
const RND_REFRESH_MS   = 20_000;   // DexScreener refresh every 20s

/* =========================================================
   3. COIN REGISTRY
   No prices or market caps are hardcoded.
   Each row only holds static metadata.
   ========================================================= */
const coins = [
  { name: "Bitcoin",  sym: "BTC",  icon: "₿", cls: "btc",
    type: "binance", marketSymbol: "BTCUSDT" },

  { name: "Ethereum", sym: "ETH",  icon: "Ξ", cls: "eth",
    type: "binance", marketSymbol: "ETHUSDT" },

  { name: "XRP",      sym: "XRP",  icon: "X", cls: "xrp",
    type: "binance", marketSymbol: "XRPUSDT" },

  { name: "Solana",   sym: "SOL",  icon: "◎", cls: "sol",
    type: "binance", marketSymbol: "SOLUSDT" },

  { name: "BNB",      sym: "BNB",  icon: "B", cls: "bnb",
    type: "binance", marketSymbol: "BNBUSDT" },

  { name: "Dogecoin", sym: "DOGE", icon: "Ð", cls: "doge",
    type: "binance", marketSymbol: "DOGEUSDT" },

  { name: "Cardano",  sym: "ADA",  icon: "A", cls: "ada",
    type: "binance", marketSymbol: "ADAUSDT" },

  { name: "Avalanche",sym: "AVAX", icon: "▲", cls: "avax",
    type: "binance", marketSymbol: "AVAXUSDT" },

  { name: "Polkadot", sym: "DOT",  icon: "●", cls: "dot",
    type: "binance", marketSymbol: "DOTUSDT" },

  /* RND — price comes from DexScreener (BSC) */
  { name: "RND Token", sym: "RND", icon: "R", cls: "rnd",
    type: "dexscreener", isNew: true }
];

/* Runtime state attached to each coin */
coins.forEach(c => {
  c.price  = null;   // number or null
  c.change = null;   // number or null
  c.stale  = false;  // true if last fetch failed
  c.loaded = false;  // true after first successful fetch
});

/* =========================================================
   4. SAFE HELPERS
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
   5. SIDEBAR + LOGOUT + AUTH
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

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  const name  = user.displayName || "Trader";
  const first = name.split(" ")[0];
  const un = getElement("userName");
  const ua = getElement("userAvatar");
  if (un) un.textContent = first;
  if (ua) ua.textContent = first.charAt(0).toUpperCase();
});

/* =========================================================
   6. DATA FETCHERS
   ========================================================= */

/* ---------- Binance batch fetcher ----------
   Fetches all Binance symbols in one call (efficient, no
   duplicate requests).
*/
let binanceInFlight = false;
async function fetchBinancePrices() {
  if (binanceInFlight) return;
  binanceInFlight = true;

  try {
    const url  = new URL(BINANCE_TICKER_URL);
    const binanceCoins = coins.filter(c => c.type === "binance");
    const symbols = binanceCoins.map(c => c.marketSymbol);

    /* Binance accepts ?symbols=["BTCUSDT","ETHUSDT",...] */
    url.searchParams.set("symbols", JSON.stringify(symbols));

    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000)
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const data = await response.json();

    /* Response is an array of 24hr tickers */
    const map = {};
    data.forEach(item => { map[item.symbol] = item; });

    binanceCoins.forEach(coin => {
      const item = map[coin.marketSymbol];
      if (!item) { coin.stale = true; return; }

      const p = Number(item.lastPrice);
      const ch = Number(item.priceChangePercent);

      if (Number.isFinite(p) && p > 0 && Number.isFinite(ch)) {
        coin.price  = p;
        coin.change = ch;
        coin.stale  = false;
        coin.loaded = true;
      } else {
        coin.stale = true;
      }
    });

  } catch (err) {
    console.warn("Binance fetch failed:", err);
    /* Mark all Binance coins stale — but keep last good values */
    coins.filter(c => c.type === "binance").forEach(c => {
      c.stale = true;
    });
  } finally {
    binanceInFlight = false;
  }
}

/* ---------- RND fetcher (DexScreener) ---------- */
let rndInFlight = false;
async function fetchRNDPrice() {
  if (rndInFlight) return;
  rndInFlight = true;

  try {
    const url  = DEXSCREENER_URL + RND_ADDRESS;
    const resp = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000)
    });

    if (!resp.ok) throw new Error("HTTP " + resp.status);

    const pairs = await resp.json();
    if (!Array.isArray(pairs)) throw new Error("Bad response");

    /* STRICT filtering to avoid picking a wrong token/pair */
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

    /* Highest liquidity = safest single pool */
    valid.sort((a, b) =>
      Number(b.liquidity.usd) - Number(a.liquidity.usd)
    );

    const pair = valid[0];
    const rnd  = coins.find(c => c.sym === "RND");
    if (!rnd) return;

    rnd.price  = Number(pair.priceUsd);
    rnd.change = Number(pair.priceChange?.h24);
    rnd.volume = Number(pair.volume?.h24);
    rnd.liquidity = Number(pair.liquidity?.usd);
    rnd.stale  = false;
    rnd.loaded = true;

  } catch (err) {
    console.warn("DexScreener fetch failed:", err);
    const rnd = coins.find(c => c.sym === "RND");
    if (rnd) rnd.stale = true;
  } finally {
    rndInFlight = false;
  }
}

/* =========================================================
   7. RENDER
   ========================================================= */
let currentFilter = "all";
let currentSearch = "";

function getFilteredList() {
  let list = [...coins];

  /* Search filter */
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.sym.toLowerCase().includes(q)
    );
  }

  /* Filter chips */
  if (currentFilter === "gainers") {
    list = list
      .filter(c => Number.isFinite(c.change) && c.change > 0)
      .sort((a, b) => b.change - a.change);
  } else if (currentFilter === "losers") {
    list = list
      .filter(c => Number.isFinite(c.change) && c.change < 0)
      .sort((a, b) => a.change - b.change);
  } else if (currentFilter === "new") {
    list = list.filter(c => c.isNew);
  }

  return list;
}

function renderMarket() {
  const tbody = getElement("marketBody");
  if (!tbody) return;

  const list = getFilteredList();

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:40px; color:var(--text-dim);">
          No coins match your search.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = list.map((c, i) => {
    const hasPrice = Number.isFinite(c.price) && c.price > 0;
    const hasChange = Number.isFinite(c.change);

    const priceText = hasPrice
      ? "$" + formatPrice(c.price)
      : (c.loaded ? "Price unavailable" : "Loading…");

    const changeText = hasChange
      ? (c.change >= 0 ? "▲ " : "▼ ") + Math.abs(c.change).toFixed(2) + "%"
      : "—";

    const changeClass = hasChange
      ? (c.change >= 0 ? "price-up" : "price-down")
      : "";

    /* Stale warning badge */
    const staleBadge = c.stale && c.loaded
      ? `<span style="font-size:0.65rem; color:#ffbd2e; margin-left:6px;">⚠ stale</span>`
      : "";

    /* Trade button — special handling for RND */
    let actionBtn;
    if (c.sym === "RND") {
      /* RND is only on PancakeSwap — no internal trade page yet */
      actionBtn = `<a href="${RND_BUY_URL}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="btn-trade"
                      title="Buy RND on PancakeSwap">Buy on PancakeSwap ↗</a>`;
    } else {
      actionBtn = `<a href="trade.html?coin=${encodeURIComponent(c.sym)}"
                      class="btn-trade">Trade</a>`;
    }

    return `
      <tr>
        <td style="color:var(--text-dim); font-size:0.8rem;">${i + 1}</td>
        <td>
          <div class="coin-cell">
            <div class="coin-icon ${escapeHTML(c.cls)}">${escapeHTML(c.icon)}</div>
            <div>
              <div>
                ${escapeHTML(c.name)}
                ${c.isNew ? '<span class="tag-new">NEW</span>' : ''}
                ${staleBadge}
              </div>
              <div class="coin-sym">${escapeHTML(c.sym)}</div>
            </div>
          </div>
        </td>
        <td style="font-family:'Orbitron',sans-serif;">${escapeHTML(priceText)}</td>
        <td class="${changeClass}">${escapeHTML(changeText)}</td>
        <td style="color:var(--text-dim); font-size:0.8rem;">Live API</td>
        <td>${actionBtn}</td>
      </tr>
    `;
  }).join("");
}

/* =========================================================
   8. REFRESH ORCHESTRATION
   ========================================================= */
async function refreshAll() {
  await Promise.all([fetchBinancePrices(), fetchRNDPrice()]);
  renderMarket();
}

let refreshTimer = null;
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshAll();
  refreshTimer = setInterval(refreshAll, PRICE_REFRESH_MS);
}

/* =========================================================
   9. EVENT BINDINGS
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  /* Search input */
  const si = getElement("searchInput");
  if (si) {
    si.addEventListener("input", e => {
      currentSearch = e.target.value || "";
      renderMarket();
    });
  }

  /* Filter chips */
  const chips = document.querySelectorAll(".filter-chip");
  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      chips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      currentFilter = chip.dataset.filter || "all";
      renderMarket();
    });
  });

  renderMarket();       // initial empty table
  startAutoRefresh();   // begins fetching
});

/* Cleanup on unload */
window.addEventListener("beforeunload", () => {
  if (refreshTimer) clearInterval(refreshTimer);
});
