/* =========================================================
   Nexbit — Trade Page
   File: trade.js
   Version: 6.0 (Fixed — real order placement)

   FIXES in this version:
   - Removed stale "Trading not available yet" message
   - Real engine.placeOrder() call
   - Coin selection correct (loads from URL properly)
   - Internal order book (Firebase, not Binance)
   - Live recent trades
   - Market + Limit support
   - Balance display updates in real-time

   ⚠ SECURITY NOTE:
   Client-side for internal testing only.
   Move all order + balance logic to Cloud Functions
   before public launch.
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get, onValue }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* Import our engine */
import engine from "./engine.js";

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
   2. ENDPOINTS
   ========================================================= */
const BINANCE_TICKER = "https://api.binance.com/api/v3/ticker/24hr";
const BINANCE_KLINES = "https://api.binance.com/api/v3/klines";
const BINANCE_WS     = "wss://stream.binance.com:9443/ws";

const DEXSCREENER   = "https://api.dexscreener.com/token-pairs/v1/bsc/";
const RND_ADDRESS   = "0xcF1FbF18bE9202865bcf88E6349B9D207F75942d";
const RND_BUY_URL   = `https://pancakeswap.finance/swap?chain=bsc&outputCurrency=${RND_ADDRESS}`;
const RND_SELL_URL  = `https://pancakeswap.finance/swap?chain=bsc&inputCurrency=${RND_ADDRESS}`;

/* Only BTC is enabled for internal trading (whitelist) */
const INTERNAL_TRADING_PAIRS = {
  BTC: "BTCUSDT"
};

const PRICE_REFRESH_MS     = 30_000;
const ORDERBOOK_REFRESH_MS = 3_000;
const TRADES_REFRESH_MS    = 5_000;

/* =========================================================
   3. COIN CONFIG
   ========================================================= */
const coins = {
  BTC:  { name:"Bitcoin",   icon:"₿", cls:"btc",  type:"binance", marketSymbol:"BTCUSDT",  price:null, change:null },
  ETH:  { name:"Ethereum",  icon:"Ξ", cls:"eth",  type:"binance", marketSymbol:"ETHUSDT",  price:null, change:null },
  XRP:  { name:"XRP",       icon:"X", cls:"xrp",  type:"binance", marketSymbol:"XRPUSDT",  price:null, change:null },
  SOL:  { name:"Solana",    icon:"◎", cls:"sol",  type:"binance", marketSymbol:"SOLUSDT",  price:null, change:null },
  BNB:  { name:"BNB",       icon:"B", cls:"bnb",  type:"binance", marketSymbol:"BNBUSDT",  price:null, change:null },
  DOGE: { name:"Dogecoin",  icon:"Ð", cls:"doge", type:"binance", marketSymbol:"DOGEUSDT", price:null, change:null },
  RND:  { name:"RND Token", icon:"R", cls:"rnd",  type:"dexscreener", price:null, change:null }
};

/* =========================================================
   4. STATE
   ========================================================= */
let currentCoin    = "BTC";
let currentPrice   = null;
let currentUser    = null;
let currentTF      = "1m";

/* Order type per side */
const orderType = { buy: "limit", sell: "limit" };

/* Balances for the current pair */
let balanceBase   = { available: 0, locked: 0 };
let balanceQuote  = { available: 0, locked: 0 };

/* Chart */
let chart        = null;
let candleSeries = null;
let volumeSeries = null;
let chartReady   = false;

/* Timers / WS */
let priceTimer  = null;
let obTimer     = null;
let tradesTimer = null;
let binanceWS   = null;

let pricesFetched = false;

const FEE_RATE = 0.001;

/* Real-time listeners */
const activeListeners = [];

/* =========================================================
   5. HELPERS
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

function formatAmount(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 0.001) return n.toFixed(6);
  if (n < 1)     return n.toFixed(4);
  if (n < 100)   return n.toFixed(3);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
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
  setTimeout(() => t.classList.remove("show"), 3500);
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
   7. LOAD COIN FROM URL
   ========================================================= */
function loadCoinFromURL() {
  const params = new URLSearchParams(location.search);
  let sym = (params.get("coin") || "").toUpperCase();
  if (!sym && params.get("pair")) {
    sym = decodeURIComponent(params.get("pair")).split("/")[0].toUpperCase();
  }
  if (!sym || !coins[sym]) sym = "BTC";
  currentCoin = sym;
  currentPrice = coins[sym].price || null;
  console.log("[trade.js] Selected coin:", currentCoin);
}

/* =========================================================
   8. UI UPDATE
   ========================================================= */
function updateCoinUI() {
  const coin = coins[currentCoin];
  if (!coin) return;

  const price = coin.price;
  const change = coin.change;
  const priceReady = Number.isFinite(price) && price > 0;

  const iconEl = getElement("coinIcon");
  const nameEl = getElement("coinName");
  const subEl  = getElement("coinSub");

  if (iconEl) {
    iconEl.className = "coin-icon " + coin.cls;
    iconEl.textContent = coin.icon;
  }
  if (nameEl) nameEl.textContent = coin.name;
  if (subEl)  subEl.textContent  = currentCoin + " / USDT";

  const bigPrice = getElement("bigPrice");
  if (bigPrice) bigPrice.textContent = priceReady ? "$" + formatPrice(price) : "Loading…";

  const chg = getElement("bigChange");
  if (chg) {
    if (Number.isFinite(change)) {
      chg.textContent = (change >= 0 ? "▲ " : "▼ ") + Math.abs(change).toFixed(2) + "%";
      chg.className = "val " + (change >= 0 ? "up" : "down");
    } else {
      chg.textContent = "—";
      chg.className = "val";
    }
  }

  /* Prefill limit price inputs */
  const buyPriceInp  = getElement("buyPrice");
  const sellPriceInp = getElement("sellPrice");
  if (buyPriceInp && !buyPriceInp.value && priceReady) buyPriceInp.value = price.toFixed(2);
  if (sellPriceInp && !sellPriceInp.value && priceReady) sellPriceInp.value = price.toFixed(2);

  /* Update Buy/Sell button labels to reflect current coin */
  const buyBtn  = getElement("buyBtn");
  const sellBtn = getElement("sellBtn");
  if (buyBtn)  buyBtn.textContent  = "Buy " + currentCoin;
  if (sellBtn) sellBtn.textContent = "Sell " + currentCoin;

  /* Handle RND special case */
  renderRNDMode(coin);

  /* Update calc displays */
  updateCalc("buy");
  updateCalc("sell");
}

/* When RND is selected, show PancakeSwap panel */
function renderRNDMode(coin) {
  const isRND = currentCoin === "RND";

  const formPanel = document.querySelector(".form-panel");
  const obPanel   = document.querySelector(".ob-panel");

  if (!formPanel) return;

  /* Remove old panels */
  const oldRND = document.getElementById("rndPanel");
  if (oldRND) oldRND.remove();
  const oldNotice = document.getElementById("pairNotice");
  if (oldNotice) oldNotice.remove();

  if (isRND) {
    formPanel.style.display = "none";
    if (obPanel) obPanel.style.display = "none";

    const panel = document.createElement("div");
    panel.id = "rndPanel";
    panel.style.cssText = "background:var(--bg-card);border:1px solid rgba(255,46,147,0.35);border-radius:14px;padding:20px;";
    panel.innerHTML = `
      <div style="font-family:'Orbitron',sans-serif;font-weight:700;font-size:1rem;color:var(--neon-pink);margin-bottom:8px;">
        ⚠ RND — External Swap Only
      </div>
      <p style="font-size:0.85rem;color:var(--text-dim);line-height:1.6;margin-bottom:16px;">
        RND is traded <strong>only on PancakeSwap (BSC)</strong>. Nexbit does not yet support internal RND trading.
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <a href="${RND_BUY_URL}" target="_blank" rel="noopener noreferrer"
           style="display:block;text-align:center;padding:13px;border-radius:10px;text-decoration:none;font-weight:700;color:#041018;background:linear-gradient(90deg,var(--neon-green),#00d484);">
          🟢 Buy RND on PancakeSwap ↗
        </a>
        <a href="${RND_SELL_URL}" target="_blank" rel="noopener noreferrer"
           style="display:block;text-align:center;padding:13px;border-radius:10px;text-decoration:none;font-weight:700;color:#fff;background:linear-gradient(90deg,var(--danger),#d63450);">
          🔴 Sell RND on PancakeSwap ↗
        </a>
      </div>
    `;
    formPanel.parentNode.insertBefore(panel, formPanel);
    return;
  }

  /* Non-RND: restore normal UI */
  formPanel.style.display = "";
  if (obPanel) obPanel.style.display = "";

  /* If non-internal pair, show notice */
  const isInternal = currentCoin in INTERNAL_TRADING_PAIRS;
  if (!isInternal) {
    const notice = document.createElement("div");
    notice.id = "pairNotice";
    notice.style.cssText = "padding:12px 16px;background:rgba(255,189,46,0.08);border:1px solid rgba(255,189,46,0.3);border-radius:12px;margin-bottom:12px;font-size:0.8rem;color:#ffbd2e;line-height:1.5;grid-column:1/-1;";
    notice.innerHTML = `⚠ <strong>${escapeHTML(coin.name)}</strong> internal trading is not yet enabled. Currently only <strong>BTC/USDT</strong> supports order placement. Live price and chart are shown.`;
    const layout = document.querySelector(".trade-layout");
    if (layout) layout.parentNode.insertBefore(notice, layout);
  }
}

/* =========================================================
   9. CHART
   ========================================================= */
function initChart() {
  const container = getElement("chartContainer");
  if (!container || typeof LightweightCharts === "undefined") {
    console.warn("Chart init failed: LightweightCharts not loaded");
    return false;
  }

  chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      background: { type: "solid", color: "transparent" },
      textColor: "#8b9bc0",
      fontSize: 11
    },
    grid: {
      vertLines: { color: "rgba(0, 240, 255, 0.05)" },
      horzLines: { color: "rgba(0, 240, 255, 0.05)" }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: "rgba(0,240,255,0.4)", width: 1, style: 3 },
      horzLine: { color: "rgba(0,240,255,0.4)", width: 1, style: 3 }
    },
    rightPriceScale: {
      borderColor: "rgba(0,240,255,0.15)",
      scaleMargins: { top: 0.1, bottom: 0.25 }
    },
    timeScale: {
      borderColor: "rgba(0,240,255,0.15)",
      timeVisible: true,
      secondsVisible: false
    }
  });

  candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: "#00ffa3",
    downColor: "#ff4d6d",
    borderUpColor: "#00ffa3",
    borderDownColor: "#ff4d6d",
    wickUpColor: "#00ffa3",
    wickDownColor: "#ff4d6d"
  });

  volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: "volume" },
    priceScaleId: "volume"
  });
  chart.priceScale("volume").applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 }
  });

  window.addEventListener("resize", () => {
    if (chart && container) {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight
      });
    }
  });

  chartReady = true;
  return true;
}

async function loadChartData(symbol, interval) {
  if (!candleSeries || !volumeSeries) return;
  try {
    const url = new URL(BINANCE_KLINES);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", "200");

    const resp = await fetch(url.toString(), { cache: "no-store" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();

    const candles = data.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4])
    }));

    const volumes = data.map(k => ({
      time: Math.floor(k[0] / 1000),
      value: Number(k[5]),
      color: Number(k[4]) >= Number(k[1])
        ? "rgba(0,255,163,0.4)"
        : "rgba(255,77,109,0.4)"
    }));

    candleSeries.setData(candles);
    volumeSeries.setData(volumes);
    chart.timeScale().fitContent();
  } catch (err) {
    console.warn("Chart data load failed:", err);
  }
}

function connectChartWS(symbol, interval) {
  if (binanceWS) {
    try { binanceWS.close(); } catch (_) {}
    binanceWS = null;
  }

  const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
  binanceWS = new WebSocket(`${BINANCE_WS}/${streamName}`);

  binanceWS.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const k = data.k;
      if (!k) return;

      const candle = {
        time: Math.floor(k.t / 1000),
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c)
      };
      const vol = {
        time: Math.floor(k.t / 1000),
        value: Number(k.v),
        color: Number(k.c) >= Number(k.o)
          ? "rgba(0,255,163,0.4)"
          : "rgba(255,77,109,0.4)"
      };

      if (candleSeries) candleSeries.update(candle);
      if (volumeSeries) volumeSeries.update(vol);

      const coin = coins[currentCoin];
      if (coin && coin.type === "binance" && Number.isFinite(candle.close)) {
        coin.price = candle.close;
        currentPrice = candle.close;
        const bigPrice = getElement("bigPrice");
        if (bigPrice) bigPrice.textContent = "$" + formatPrice(candle.close);
        updateCalc("buy");
        updateCalc("sell");
      }
    } catch (_) {}
  };

  binanceWS.onerror = () => {};
  binanceWS.onclose = () => {
    setTimeout(() => {
      const c = coins[currentCoin];
      if (c && c.marketSymbol) connectChartWS(c.marketSymbol, currentTF);
    }, 3000);
  };
}

/* =========================================================
   10. INTERNAL ORDER BOOK
   ========================================================= */
async function refreshOrderBook() {
  const pair = INTERNAL_TRADING_PAIRS[currentCoin];
  if (!pair) {
    const asksEl = getElement("obAsks");
    const bidsEl = getElement("obBids");
    if (asksEl) asksEl.innerHTML = "";
    if (bidsEl) bidsEl.innerHTML = "";
    const midPriceEl = getElement("obMidPrice");
    if (midPriceEl) midPriceEl.textContent = "—";
    return;
  }

  try {
    const book = await engine.getOrderBook(pair, 10);
    renderOrderBook(book);
  } catch (err) {
    console.warn("Order book refresh failed:", err);
  }
}

function renderOrderBook(book) {
  const asksEl = getElement("obAsks");
  const bidsEl = getElement("obBids");
  const midPriceEl = getElement("obMidPrice");
  const spreadEl = getElement("obSpread");

  if (!asksEl || !bidsEl) return;

  const bids = (book.bids || []).slice(0, 8);
  const asks = (book.asks || []).slice(0, 8);

  if (!bids.length && !asks.length) {
    asksEl.innerHTML = `<div style="text-align:center;padding:20px;font-size:0.7rem;color:var(--text-dim);">No orders yet</div>`;
    bidsEl.innerHTML = "";
    if (midPriceEl) midPriceEl.textContent = "—";
    if (spreadEl)   spreadEl.textContent = "Place an order to start";
    return;
  }

  const maxAsk = Math.max(...asks.map(a => a.totalQty), 1);
  const maxBid = Math.max(...bids.map(b => b.totalQty), 1);

  const bestAsk = asks[0] ? asks[0].price : 0;
  const bestBid = bids[0] ? bids[0].price : 0;
  const midPrice = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : bestAsk || bestBid;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;

  if (midPriceEl) midPriceEl.textContent = formatPrice(midPrice);
  if (spreadEl)   spreadEl.textContent = `Spread ${formatPrice(spread)}`;

  /* Asks (reversed so highest at top) */
  asksEl.innerHTML = [...asks].reverse().map(a => {
    const pct = Math.min(100, (a.totalQty / maxAsk) * 100);
    return `
      <div class="ob-row ask">
        <div class="depth-bar" style="width:${pct}%"></div>
        <span class="price">${formatPrice(a.price)}</span>
        <span class="amount">${formatAmount(a.totalQty)}</span>
      </div>`;
  }).join("");

  /* Bids (highest at top) */
  bidsEl.innerHTML = bids.map(b => {
    const pct = Math.min(100, (b.totalQty / maxBid) * 100);
    return `
      <div class="ob-row bid">
        <div class="depth-bar" style="width:${pct}%"></div>
        <span class="price">${formatPrice(b.price)}</span>
        <span class="amount">${formatAmount(b.totalQty)}</span>
      </div>`;
  }).join("");
}

/* =========================================================
   11. RECENT TRADES
   ========================================================= */
async function refreshRecentTrades() {
  const pair = INTERNAL_TRADING_PAIRS[currentCoin];
  if (!pair) return;

  try {
    const trades = await engine.getRecentTrades(pair, 15);
    renderRecentTrades(trades);
  } catch (err) {
    console.warn("Recent trades fetch failed:", err);
  }
}

function renderRecentTrades(trades) {
  const container = getElement("recentTradesList");
  if (!container) return;

  if (!trades.length) {
    container.innerHTML = `<div style="text-align:center;font-size:0.7rem;color:var(--text-dim);padding:10px;">No trades yet</div>`;
    return;
  }

  container.innerHTML = trades.slice(0, 8).map(t => {
    const cls = t.side === "sell" ? "buy" : "sell";  /* inverted for taker view */
    return `
      <div class="rt-row ${cls}">
        <span class="p">${formatPrice(t.price)}</span>
        <span class="a">${formatAmount(t.quantity)}</span>
      </div>`;
  }).join("");
}

/* =========================================================
   12. PRICE FETCHING
   ========================================================= */
let binanceInFlight = false;
async function fetchBinancePrices() {
  if (binanceInFlight) return;
  binanceInFlight = true;

  try {
    const symbols = Object.values(coins)
      .filter(c => c.type === "binance" && c.marketSymbol)
      .map(c => c.marketSymbol);

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

    Object.values(coins).forEach(coin => {
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
  } catch (err) {
    console.warn("Binance fetch failed:", err);
  } finally {
    binanceInFlight = false;
  }
}

async function fetchRNDPrice() {
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

    coins.RND.price  = Number(valid[0].priceUsd);
    coins.RND.change = Number(valid[0].priceChange?.h24);
  } catch (_) {}
}

async function refreshAllPrices() {
  await Promise.all([fetchBinancePrices(), fetchRNDPrice()]);
  const coin = coins[currentCoin];
  if (coin && Number.isFinite(coin.price)) currentPrice = coin.price;
  updateCoinUI();
  pricesFetched = true;
}

function startPriceRefresh() {
  if (priceTimer) clearInterval(priceTimer);
  refreshAllPrices();
  priceTimer = setInterval(refreshAllPrices, PRICE_REFRESH_MS);
}

/* =========================================================
   13. BALANCE LOADING
   ========================================================= */
async function loadBalances() {
  if (!currentUser) return;
  const baseAsset  = currentCoin;
  const quoteAsset = "USDT";

  try {
    balanceBase  = await engine.getBalance(currentUser.uid, baseAsset);
    balanceQuote = await engine.getBalance(currentUser.uid, quoteAsset);
  } catch (err) {
    console.warn("Balance load failed:", err);
    balanceBase  = { available: 0, locked: 0 };
    balanceQuote = { available: 0, locked: 0 };
  }

  updateBalanceDisplay();
}

function updateBalanceDisplay() {
  const buyAvail  = getElement("buyAvail");
  const buyLocked = getElement("buyLocked");
  const sellAvail = getElement("sellAvail");
  const sellLocked= getElement("sellLocked");

  if (buyAvail)  buyAvail.textContent  = "$" + Number(balanceQuote.available).toFixed(2);
  if (buyLocked) buyLocked.textContent = "$" + Number(balanceQuote.locked).toFixed(2);
  if (sellAvail) sellAvail.textContent = Number(balanceBase.available).toFixed(8) + " " + currentCoin;
  if (sellLocked)sellLocked.textContent= Number(balanceBase.locked).toFixed(8);
}

function subscribeBalances() {
  if (!currentUser) return;
  const baseAsset  = currentCoin;
  const quoteAsset = "USDT";

  const unsubBase = onValue(ref(db, `balances/${currentUser.uid}/${baseAsset}`), snap => {
    balanceBase = snap.exists() ? snap.val() : { available: 0, locked: 0 };
    updateBalanceDisplay();
  });
  activeListeners.push(unsubBase);

  const unsubQuote = onValue(ref(db, `balances/${currentUser.uid}/${quoteAsset}`), snap => {
    balanceQuote = snap.exists() ? snap.val() : { available: 0, locked: 0 };
    updateBalanceDisplay();
  });
  activeListeners.push(unsubQuote);
}

/* =========================================================
   14. TABS + ORDER TYPE + AMOUNT
   ========================================================= */
window.switchTradeTab = (mode) => {
  const tabBuy  = getElement("tabBuy");
  const tabSell = getElement("tabSell");
  const formBuy = getElement("formBuy");
  const formSell = getElement("formSell");
  if (!tabBuy || !tabSell || !formBuy || !formSell) return;

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

window.switchOrderType = (side, type) => {
  orderType[side] = type;

  const form = getElement(side === "buy" ? "formBuy" : "formSell");
  if (!form) return;

  form.querySelectorAll(".order-type-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.type === type);
  });

  const limitLabel = getElement(side === "buy" ? "buyLimitLabel" : "sellLimitLabel");
  const limitRow   = getElement(side === "buy" ? "buyLimitRow"   : "sellLimitRow");
  const showLimit  = type === "limit";
  if (limitLabel) limitLabel.style.display = showLimit ? "" : "none";
  if (limitRow)   limitRow.style.display   = showLimit ? "" : "none";

  const priceInput = getElement(side === "buy" ? "buyPrice" : "sellPrice");
  if (showLimit && priceInput && !priceInput.value && Number.isFinite(currentPrice)) {
    priceInput.value = currentPrice.toFixed(2);
  }

  updateCalc(side);
};

window.quickAmt = (mode, val) => {
  const inp = getElement(mode === "buy" ? "buyAmount" : "sellAmount");
  if (!inp) return;
  inp.value = val;
  updateCalc(mode);
};

window.setMax = (mode) => {
  const inp = getElement(mode === "buy" ? "buyAmount" : "sellAmount");
  if (!inp) return;

  if (mode === "buy") {
    if (!Number.isFinite(balanceQuote.available) || balanceQuote.available <= 0) {
      showToast("No USDT available.", false);
      return;
    }
    const max = balanceQuote.available / (1 + FEE_RATE);
    inp.value = Math.floor(max * 100) / 100;
  } else {
    if (!Number.isFinite(balanceBase.available) || balanceBase.available <= 0) {
      showToast(`No ${currentCoin} available.`, false);
      return;
    }
    let effPrice = currentPrice;
    if (orderType.sell === "limit") {
      const priceEl = getElement("sellPrice");
      const p = parseFloat(priceEl?.value || "0");
      if (Number.isFinite(p) && p > 0) effPrice = p;
    }
    const max = balanceBase.available * (effPrice || 0);
    inp.value = Math.floor(max * 100) / 100;
  }
  updateCalc(mode);
};

function getEffectivePrice(mode) {
  const type = orderType[mode];
  if (type === "limit") {
    const el = getElement(mode === "buy" ? "buyPrice" : "sellPrice");
    const p = parseFloat(el?.value || "0");
    return Number.isFinite(p) && p > 0 ? p : 0;
  }
  return Number.isFinite(currentPrice) ? currentPrice : 0;
}

function updateCalc(mode) {
  const amountEl = getElement(mode === "buy" ? "buyAmount" : "sellAmount");
  if (!amountEl) return;

  const amount = parseFloat(amountEl.value) || 0;
  const price  = getEffectivePrice(mode);

  const receiveEl = getElement(mode === "buy" ? "buyReceive"     : "sellGive");
  const priceEl2  = getElement(mode === "buy" ? "buyMarketPrice" : "sellMarketPrice");
  const feeEl     = getElement(mode === "buy" ? "buyFee"         : "sellFee");
  const totalEl   = getElement(mode === "buy" ? "buyTotal"       : "sellTotal");

  if (!price || !Number.isFinite(price)) {
    if (priceEl2)  priceEl2.textContent  = "—";
    if (receiveEl) receiveEl.textContent = "—";
    if (feeEl)     feeEl.textContent     = "—";
    if (totalEl)   totalEl.textContent   = "Price unavailable";
    return;
  }

  if (priceEl2) priceEl2.textContent = "$" + formatPrice(price);

  if (amount <= 0) {
    if (receiveEl) receiveEl.textContent = `0.00000000 ${currentCoin}`;
    if (feeEl)     feeEl.textContent     = "$0.00";
    if (totalEl)   totalEl.textContent   = "$0.00";
    return;
  }

  const fee = amount * FEE_RATE;
  if (mode === "buy") {
    if (receiveEl) receiveEl.textContent = (amount / price).toFixed(8) + " " + currentCoin;
    if (feeEl) feeEl.textContent = "$" + fee.toFixed(2);
    if (totalEl) totalEl.textContent = "$" + (amount + fee).toFixed(2);
  } else {
    if (receiveEl) receiveEl.textContent = (amount / price).toFixed(8) + " " + currentCoin;
    if (feeEl) feeEl.textContent = "$" + fee.toFixed(2);
    if (totalEl) totalEl.textContent = "$" + (amount - fee).toFixed(2);
  }
}

/* =========================================================
   15. EXECUTE TRADE — real engine call
   ========================================================= */
window.executeTrade = async (mode) => {
  const amountEl = getElement(mode === "buy" ? "buyAmount" : "sellAmount");
  if (!amountEl) return;

  if (!(currentCoin in INTERNAL_TRADING_PAIRS)) {
    showToast(`${currentCoin} internal trading is not enabled yet.`, false);
    return;
  }

  const amountUSD = parseFloat(amountEl.value) || 0;
  const type = orderType[mode];

  let orderPrice;
  if (type === "limit") {
    const priceEl = getElement(mode === "buy" ? "buyPrice" : "sellPrice");
    orderPrice = parseFloat(priceEl?.value || "0");
    if (!Number.isFinite(orderPrice) || orderPrice <= 0) {
      showToast("Enter a valid limit price.", false);
      return;
    }
  } else {
    if (!pricesFetched || !Number.isFinite(currentPrice) || currentPrice <= 0) {
      showToast("Market price not available yet.", false);
      return;
    }
    orderPrice = currentPrice;
  }

  if (amountUSD <= 0) {
    showToast("Enter a valid amount.", false);
    return;
  }
  if (amountUSD < 1) {
    showToast("Minimum order is $1.", false);
    return;
  }

  const quantity = Number((amountUSD / orderPrice).toFixed(8));
  if (quantity <= 0) {
    showToast("Quantity too small.", false);
    return;
  }

  /* Client-side pre-check (hint only — engine does the real check) */
  if (mode === "buy") {
    const needed = amountUSD * (1 + FEE_RATE);
    if (needed > balanceQuote.available) {
      showToast(`Insufficient USDT. Available: $${balanceQuote.available.toFixed(2)}`, false);
      return;
    }
  } else {
    if (quantity > balanceBase.available) {
      showToast(`Insufficient ${currentCoin}. Available: ${balanceBase.available.toFixed(8)}`, false);
      return;
    }
  }

  const btn = getElement(mode === "buy" ? "buyBtn" : "sellBtn");
  const origText = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = `Placing ${type}…`;
  }

  try {
    console.log("[trade.js] Placing order:", { mode, type, orderPrice, quantity });

    await engine.ensureWallets(currentUser.uid);

    const result = await engine.placeOrder({
      uid: currentUser.uid,
      pair: INTERNAL_TRADING_PAIRS[currentCoin],
      side: mode,
      type,
      price: orderPrice,
      quantity
    });

    console.log("[trade.js] Order result:", result);

    const filled = Number(result.filled || 0);
    const status = result.status;

    if (status === "filled") {
      showToast(`✅ Filled: ${filled.toFixed(8)} ${currentCoin} @ $${formatPrice(result.price)}`, true);
    } else if (status === "partial") {
      showToast(`⚡ Partial: ${filled.toFixed(8)} / ${Number(result.quantity).toFixed(8)} ${currentCoin}`, true);
    } else {
      showToast(`📋 ${type.toUpperCase()} order placed: ${Number(result.quantity).toFixed(8)} ${currentCoin} @ $${formatPrice(result.price)}`, true);
    }

    amountEl.value = "";
    updateCalc(mode);

    await loadBalances();
    await refreshOrderBook();
    await refreshRecentTrades();

  } catch (err) {
    console.error("[trade.js] Order failed:", err);
    showToast(err.message || "Order failed. Try again.", false);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
};

/* =========================================================
   16. TIME FRAME
   ========================================================= */
function bindTimeframeButtons() {
  const toolbar = getElement("chartToolbar");
  if (!toolbar) return;
  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".tf-btn");
    if (!btn) return;
    toolbar.querySelectorAll(".tf-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentTF = btn.dataset.tf;
    const coin = coins[currentCoin];
    if (coin && coin.type === "binance") {
      loadChartData(coin.marketSymbol, currentTF);
      connectChartWS(coin.marketSymbol, currentTF);
    }
  });
}

function reloadChart() {
  const coin = coins[currentCoin];
  if (!coin) return;

  if (coin.type !== "binance") {
    if (candleSeries) candleSeries.setData([]);
    if (volumeSeries) volumeSeries.setData([]);
    if (binanceWS) { try { binanceWS.close(); } catch (_) {} binanceWS = null; }
    return;
  }

  loadChartData(coin.marketSymbol, currentTF);
  connectChartWS(coin.marketSymbol, currentTF);
  refreshOrderBook();
  refreshRecentTrades();
}

/* =========================================================
   17. AUTH STATE
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

  /* Load coin from URL first */
  loadCoinFromURL();
  updateCoinUI();

  /* Start fetching prices */
  startPriceRefresh();

  /* Ensure wallets + load balances + subscribe */
  try {
    await engine.ensureWallets(user.uid);
    await loadBalances();
    subscribeBalances();
  } catch (err) {
    console.warn("Wallet setup failed:", err);
  }

  /* Init chart after DOM is ready */
  setTimeout(() => {
    if (initChart()) {
      reloadChart();
    }
    if (obTimer) clearInterval(obTimer);
    obTimer = setInterval(refreshOrderBook, ORDERBOOK_REFRESH_MS);

    if (tradesTimer) clearInterval(tradesTimer);
    tradesTimer = setInterval(refreshRecentTrades, TRADES_REFRESH_MS);
  }, 300);
});

/* =========================================================
   18. INIT
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  const buyInp   = getElement("buyAmount");
  const sellInp  = getElement("sellAmount");
  const buyPrice = getElement("buyPrice");
  const sellPrice= getElement("sellPrice");

  if (buyInp)    buyInp.addEventListener("input",   () => updateCalc("buy"));
  if (sellInp)   sellInp.addEventListener("input",  () => updateCalc("sell"));
  if (buyPrice)  buyPrice.addEventListener("input", () => updateCalc("buy"));
  if (sellPrice) sellPrice.addEventListener("input",() => updateCalc("sell"));

  switchOrderType("buy", "limit");
  switchOrderType("sell", "limit");

  bindTimeframeButtons();

  /* Auto-fill limit price inputs once prices load */
  const fillInterval = setInterval(() => {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return;
    const bp = getElement("buyPrice");
    const sp = getElement("sellPrice");
    if (bp && !bp.value) bp.value = currentPrice.toFixed(2);
    if (sp && !sp.value) sp.value = currentPrice.toFixed(2);
    updateCalc("buy");
    updateCalc("sell");
  }, 1500);
  setTimeout(() => clearInterval(fillInterval), 20000);
});

window.addEventListener("beforeunload", () => {
  if (priceTimer)  clearInterval(priceTimer);
  if (obTimer)     clearInterval(obTimer);
  if (tradesTimer) clearInterval(tradesTimer);
  if (binanceWS)   { try { binanceWS.close(); } catch (_) {} }
  activeListeners.forEach(unsub => { try { unsub(); } catch (_) {} });
});
