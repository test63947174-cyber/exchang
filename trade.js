/* =========================================================
   Nexbit — Trade Page
   File: trade.js
   Version: 2.0 (Developer Instructions compliant)

   IMPORTANT — What this page CAN and CANNOT do:

   ✅ Live prices from Binance Spot (BTC/ETH/XRP/SOL/BNB/DOGE)
   ✅ Live RND price from DexScreener (BSC / PancakeSwap)
   ✅ Buy/Sell estimate calculation with real balance check
   ✅ RND external link → PancakeSwap (real on-chain swap)

   ❌ No fake chart (Math.random removed)
   ❌ No fake "Order placed" success message
   ❌ No client-side order creation

   A real order engine (server-side) is REQUIRED before
   this page can place actual trades.
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
   2. API ENDPOINTS + TOKEN CONFIG
   ========================================================= */
const BINANCE_TICKER = "https://api.binance.com/api/v3/ticker/24hr";
const DEXSCREENER   =
  "https://api.dexscreener.com/token-pairs/v1/bsc/";

const RND_ADDRESS   = "0xcF1FbF18bE9202865bcf88E6349B9D207F75942d";
const RND_BUY_URL   =
  `https://pancakeswap.finance/swap?chain=bsc&outputCurrency=${RND_ADDRESS}`;
const RND_SELL_URL  =
  `https://pancakeswap.finance/swap?chain=bsc&inputCurrency=${RND_ADDRESS}`;

const PRICE_REFRESH_MS = 30_000;

/* =========================================================
   3. COIN CONFIG
   No hardcoded prices. Metadata only.
   ========================================================= */
const coins = {
  BTC:  { name:"Bitcoin",   icon:"₿", cls:"btc",  type:"binance",
          marketSymbol:"BTCUSDT",  price:null, change:null, stale:false, loaded:false },
  ETH:  { name:"Ethereum",  icon:"Ξ", cls:"eth",  type:"binance",
          marketSymbol:"ETHUSDT",  price:null, change:null, stale:false, loaded:false },
  XRP:  { name:"XRP",       icon:"X", cls:"xrp",  type:"binance",
          marketSymbol:"XRPUSDT",  price:null, change:null, stale:false, loaded:false },
  SOL:  { name:"Solana",    icon:"◎", cls:"sol",  type:"binance",
          marketSymbol:"SOLUSDT",  price:null, change:null, stale:false, loaded:false },
  BNB:  { name:"BNB",       icon:"B", cls:"bnb",  type:"binance",
          marketSymbol:"BNBUSDT",  price:null, change:null, stale:false, loaded:false },
  DOGE: { name:"Dogecoin",  icon:"Ð", cls:"doge", type:"binance",
          marketSymbol:"DOGEUSDT", price:null, change:null, stale:false, loaded:false },
  RND:  { name:"RND Token", icon:"R", cls:"rnd",  type:"dexscreener",
          price:null, change:null, stale:false, loaded:false }
};

/* =========================================================
   4. STATE
   ========================================================= */
let currentCoin    = "BTC";
let currentPrice   = null;    // number or null
let currentBalance = null;    // user's USD balance, or null if unknown
let currentUser    = null;
let priceTimer     = null;
let binanceInFlight = false;
let rndInFlight     = false;

/* Fee: only shown as estimate until real fee is configured */
const FEE_ESTIMATE = 0.001;   // 0.1% — labelled as "estimated"

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
   7. AUTH GUARD + NAVBAR + LOAD BALANCE
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

  /* Load user's balance from Firebase — used for MAX button
     and for validating that user has sufficient funds. */
  try {
    const snap = await get(ref(db, `users/${user.uid}`));
    if (snap.exists()) {
      const v = snap.val();
      const bal = Number(v.balanceUSD);
      if (Number.isFinite(bal) && bal >= 0) {
        currentBalance = bal;
      }
    }
  } catch (err) {
    console.warn("Balance load failed:", err);
  }

  /* Now that we know user + balance, load coin from URL */
  loadCoinFromURL();
  startPriceRefresh();
});

/* =========================================================
   8. PRICE FETCHING
   ========================================================= */

/* ---------- Binance batch fetch ---------- */
async function fetchBinancePrices() {
  if (binanceInFlight) return;
  binanceInFlight = true;

  try {
    const binanceSymbols = Object.values(coins)
      .filter(c => c.type === "binance" && c.marketSymbol)
      .map(c => c.marketSymbol);

    const url = new URL(BINANCE_TICKER);
    url.searchParams.set("symbols", JSON.stringify(binanceSymbols));

    const resp = await fetch(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000)
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);

    const data = await resp.json();
    const map  = {};
    data.forEach(item => { map[item.symbol] = item; });

    Object.values(coins).forEach(coin => {
      if (coin.type !== "binance") return;
      const item = map[coin.marketSymbol];
      if (!item) { coin.stale = true; return; }
      const p  = Number(item.lastPrice);
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
    Object.values(coins).forEach(c => {
      if (c.type === "binance") c.stale = true;
    });
  } finally {
    binanceInFlight = false;
  }
}

/* ---------- RND via DexScreener ---------- */
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

    /* Strict filtering: only verified PancakeSwap pools with the
       exact RND address and meaningful liquidity. */
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
    const rnd  = coins.RND;
    rnd.price  = Number(pair.priceUsd);
    rnd.change = Number(pair.priceChange?.h24);
    rnd.stale  = false;
    rnd.loaded = true;

  } catch (err) {
    console.warn("DexScreener fetch failed:", err);
    coins.RND.stale = true;
  } finally {
    rndInFlight = false;
  }
}

async function refreshAllPrices() {
  await Promise.all([fetchBinancePrices(), fetchRNDPrice()]);
  updatePriceUI();
}

function startPriceRefresh() {
  if (priceTimer) clearInterval(priceTimer);
  refreshAllPrices();
  priceTimer = setInterval(refreshAllPrices, PRICE_REFRESH_MS);
}

/* =========================================================
   9. LOAD COIN FROM URL
   ========================================================= */
function loadCoinFromURL() {
  const params = new URLSearchParams(location.search);
  const sym = (params.get("coin") || "BTC").toUpperCase();
  const coin = coins[sym];
  if (!coin) { showToast("Unknown coin", false); return; }

  currentCoin = sym;
  currentPrice = coin.price;   // may be null until fetched

  /* Update UI */
  updatePriceUI();

  /* Default tab (buy/sell) */
  const action = params.get("action");
  if (action === "sell") switchTradeTab("sell");

  /* Chart — no fake data */
  renderChartState(coin);
}

/* =========================================================
   10. UI UPDATES
   ========================================================= */
function updatePriceUI() {
  const coin = coins[currentCoin];
  if (!coin) return;

  const price = coin.price;
  const change = coin.change;

  /* Icon + name */
  const iconEl = getElement("coinIcon");
  const nameEl = getElement("coinName");
  const subEl  = getElement("coinSub");
  if (iconEl) {
    iconEl.className = "coin-icon " + coin.cls;
    iconEl.textContent = coin.icon;
  }
  if (nameEl) nameEl.textContent = coin.name;
  if (subEl)  subEl.textContent  = currentCoin + " / USDT";

  /* Big price */
  const bigPrice = getElement("bigPrice");
  if (bigPrice) {
    bigPrice.textContent = Number.isFinite(price)
      ? "$" + formatPrice(price)
      : (coin.loaded ? "Price unavailable" : "Loading…");
  }

  /* Big change */
  const chg = getElement("bigChange");
  if (chg) {
    if (Number.isFinite(change)) {
      chg.textContent =
        (change >= 0 ? "▲ " : "▼ ") + Math.abs(change).toFixed(2) + "%";
      chg.className = "chg " + (change >= 0 ? "up" : "down");
    } else {
      chg.textContent = "—";
      chg.className = "chg";
    }
  }

  /* Stale hint */
  if (coin.stale && coin.loaded) {
    if (bigPrice && !bigPrice.textContent.includes("⚠")) {
      bigPrice.textContent += " ⚠";
    }
  }

  /* Prices shown in buy/sell forms */
  const buyPriceEl  = getElement("buyPrice");
  const sellPriceEl = getElement("sellPrice");
  const priceText = Number.isFinite(price)
    ? "$" + formatPrice(price)
    : "—";
  if (buyPriceEl)  buyPriceEl.textContent  = priceText;
  if (sellPriceEl) sellPriceEl.textContent = priceText;

  /* Recompute order previews */
  updateCalc("buy");
  updateCalc("sell");

  /* If RND selected → replace trading forms with PancakeSwap link */
  renderRNDMode(coin);
}

/* =========================================================
   11. RND MODE — PancakeSwap instead of internal trading
   ========================================================= */
function renderRNDMode(coin) {
  const isRND = currentCoin === "RND";

  const orderCard  = document.querySelector(".order-card");
  const buyForm    = getElement("formBuy");
  const sellForm   = getElement("formSell");
  const tradeTabs  = document.querySelector(".trade-tabs");

  if (!orderCard) return;

  /* Remove any previously-injected RND panel */
  const oldPanel = document.getElementById("rndPanel");
  if (oldPanel) oldPanel.remove();

  if (!isRND) {
    /* Restore normal forms */
    if (tradeTabs) tradeTabs.style.display = "";
    if (buyForm)   buyForm.style.display = "";
    if (sellForm && !sellForm.classList.contains("active")) {
      sellForm.style.display = "";
    }
    return;
  }

  /* Hide internal trading UI (RND not supported internally yet) */
  if (tradeTabs) tradeTabs.style.display = "none";
  if (buyForm)   buyForm.style.display = "none";
  if (sellForm)  sellForm.style.display = "none";

  /* Show clear external-swap panel */
  const panel = document.createElement("div");
  panel.id = "rndPanel";
  panel.style.padding = "4px 0";
  panel.innerHTML = `
    <div style="
      padding: 18px;
      background: rgba(255,46,147,0.08);
      border: 1px solid rgba(255,46,147,0.35);
      border-radius: 14px;
      margin-bottom: 16px;
    ">
      <div style="font-family:'Orbitron',sans-serif; font-weight:700; font-size:1rem; color:var(--neon-pink); margin-bottom:6px;">
        ⚠ RND — External Swap Only
      </div>
      <p style="font-size:0.85rem; color:var(--text-dim); line-height:1.6; margin-bottom:14px;">
        RND is currently traded <strong>only on PancakeSwap (BSC)</strong>.
        Nexbit does not yet support internal RND trading.
        Real swaps happen on-chain through PancakeSwap.
      </p>

      <div style="display:flex; flex-direction:column; gap:10px;">
        <a href="${RND_BUY_URL}"
           target="_blank" rel="noopener noreferrer"
           style="display:block; text-align:center; padding:13px;
                  border-radius:10px; text-decoration:none; font-weight:700;
                  letter-spacing:0.5px; color:#041018;
                  background:linear-gradient(90deg, var(--neon-green), #00d484);
                  box-shadow: 0 0 22px rgba(0,255,163,0.4);">
          🟢 Buy RND on PancakeSwap ↗
        </a>
        <a href="${RND_SELL_URL}"
           target="_blank" rel="noopener noreferrer"
           style="display:block; text-align:center; padding:13px;
                  border-radius:10px; text-decoration:none; font-weight:700;
                  letter-spacing:0.5px; color:#fff;
                  background:linear-gradient(90deg, var(--danger), #d63450);
                  box-shadow: 0 0 22px rgba(255,77,109,0.4);">
          🔴 Sell RND on PancakeSwap ↗
        </a>
      </div>

      <p style="font-size:0.72rem; color:var(--text-dim); margin-top:12px; line-height:1.5;">
        Contract (BSC): <br>
        <code style="font-size:0.7rem; color:var(--neon-cyan); word-break:break-all;">
          ${RND_ADDRESS}
        </code>
      </p>
    </div>
  `;
  orderCard.insertBefore(panel, orderCard.firstChild);
}

/* =========================================================
   12. CHART — honest fallback
   ========================================================= */
function renderChartState(coin) {
  const chartArea = document.querySelector(".chart-area");
  if (!chartArea) return;

  /* Remove old SVG/placeholder */
  chartArea.innerHTML = "";

  /* We do NOT fake chart data. Until real OHLC is wired,
     we show an explicit "Chart unavailable" state. */
  const wrap = document.createElement("div");
  wrap.style.cssText = `
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    width:100%; height:100%; text-align:center; padding:20px;
    color:var(--text-dim);
  `;
  wrap.innerHTML = `
    <div style="font-size:2.4rem; margin-bottom:8px;">📈</div>
    <div style="font-family:'Orbitron',sans-serif; font-size:0.95rem; font-weight:700; margin-bottom:6px;">
      Chart unavailable
    </div>
    <p style="font-size:0.78rem; max-width:340px; line-height:1.6;">
      Real historical OHLC data is not yet connected for ${escapeHTML(coin.name)}.
      Live prices are shown above; a real chart will appear once a
      trustworthy data feed is integrated.
    </p>
  `;
  chartArea.appendChild(wrap);
}

/* =========================================================
   13. TRADE TABS
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

/* =========================================================
   14. AMOUNT HELPERS
   ========================================================= */
window.quickAmt = (mode, val) => {
  const inp = getElement(mode === "buy" ? "buyAmount" : "sellAmount");
  if (!inp) return;
  inp.value = val;
  updateCalc(mode);
};

window.setMax = (mode) => {
  const inp = getElement(mode === "buy" ? "buyAmount" : "sellAmount");
  if (!inp) return;

  if (!Number.isFinite(currentBalance) || currentBalance <= 0) {
    showToast("Balance unavailable. Cannot set MAX.", false);
    inp.value = "";
    updateCalc(mode);
    return;
  }

  /* Reserve some balance for fee */
  const usable = currentBalance * (1 - FEE_ESTIMATE);
  inp.value = Math.floor(usable * 100) / 100;
  updateCalc(mode);
};

/* Estimate-only calculator. It does not create an order. */
function updateCalc(mode) {
  const amountEl = getElement(mode === "buy" ? "buyAmount" : "sellAmount");
  if (!amountEl) return;

  const amount = parseFloat(amountEl.value) || 0;
  const price  = Number.isFinite(currentPrice) ? currentPrice : 0;

  const receiveEl = getElement(mode === "buy" ? "buyReceive" : "sellGive");
  const feeEl     = getElement(mode === "buy" ? "buyFee"     : "sellFee");
  const totalEl   = getElement(mode === "buy" ? "buyTotal"   : "sellTotal");

  /* Invalid or missing price */
  if (!price) {
    if (receiveEl) receiveEl.textContent = "—";
    if (feeEl)     feeEl.textContent     = "—";
    if (totalEl)   totalEl.textContent   = "Price unavailable";
    return;
  }

  if (amount <= 0 || !Number.isFinite(amount)) {
    if (receiveEl) receiveEl.textContent = `0.00000000 ${currentCoin}`;
    if (feeEl)     feeEl.textContent     = "$0.00";
    if (totalEl)   totalEl.textContent   = "$0.00";
    return;
  }

  const fee = amount * FEE_ESTIMATE;

  if (mode === "buy") {
    if (receiveEl) receiveEl.textContent =
      (amount / price).toFixed(8) + " " + currentCoin;
    if (feeEl) feeEl.textContent = "$" + fee.toFixed(2);
    if (totalEl) totalEl.textContent = "$" + (amount + fee).toFixed(2);
  } else {
    if (receiveEl) receiveEl.textContent =
      (amount / price).toFixed(8) + " " + currentCoin;
    if (feeEl) feeEl.textContent = "$" + fee.toFixed(2);
    if (totalEl) totalEl.textContent = "$" + (amount - fee).toFixed(2);
  }
}

/* =========================================================
   15. EXECUTE TRADE — honest stub, no fake success
   ========================================================= */
window.executeTrade = async (mode) => {
  const inp = getElement(mode === "buy" ? "buyAmount" : "sellAmount");
  if (!inp) return;

  const amount = parseFloat(inp.value) || 0;

  /* Basic validation first */
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    showToast("Price unavailable — cannot place trade.", false);
    return;
  }
  if (amount <= 0) {
    showToast("Please enter a valid amount.", false);
    return;
  }
  if (amount < 10) {
    showToast("Minimum trade is $10.", false);
    return;
  }

  /* RND has no internal trading */
  if (currentCoin === "RND") {
    showToast(
      "RND is traded only on PancakeSwap. Use the external link.",
      false
    );
    return;
  }

  /* Balance check — only when we actually know it */
  if (Number.isFinite(currentBalance)) {
    if (mode === "buy" && amount > currentBalance) {
      showToast("Insufficient balance for this buy.", false);
      return;
    }
  } else {
    showToast("Balance could not be verified.", false);
    return;
  }

  /* ⚠ REALITY CHECK: No order engine is connected.
     We do NOT show fake success. */
  showToast(
    "Trading not available yet. A real order engine is required before orders can be placed.",
    false
  );

  /* IMPORTANT — the code below is intentionally NOT executed.
     When a real backend is ready, replace the toast above with:

        const orderId = await backend.placeOrder({
           pair:   currentCoin + "/USDT",
           type:   mode,
           amount: amount,
           price:  currentPrice,
           fee:    amount * FEE_ESTIMATE
        });
        if (orderId) {
           showToast("Order submitted.", true);
           // Then redirect to orders.html or show inline confirmation
        } else {
           showToast("Order submission failed.", false);
        }
  */
};

/* =========================================================
   16. INIT
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  const buyInp  = getElement("buyAmount");
  const sellInp = getElement("sellAmount");
  if (buyInp)  buyInp.addEventListener("input",  () => updateCalc("buy"));
  if (sellInp) sellInp.addEventListener("input", () => updateCalc("sell"));

  /* Prepare the chart area to show the honest placeholder
     BEFORE any coin is loaded. */
  const chartArea = document.querySelector(".chart-area");
  if (chartArea) {
    chartArea.innerHTML = `
      <div style="
        display:flex; align-items:center; justify-content:center;
        width:100%; height:100%; color:var(--text-dim);
        font-size:0.9rem; text-align:center; padding:20px;">
        Loading live market data…
      </div>`;
  }
});

/* Clean up on unload */
window.addEventListener("beforeunload", () => {
  if (priceTimer) clearInterval(priceTimer);
});
