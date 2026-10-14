/* =========================================================
   Nexbit Exchange — Dashboard
   File: dashboard.js

   Features:
   - Live public market prices from Binance Spot API
   - Live RND market data from DexScreener (BSC / PancakeSwap)
   - No fabricated prices, balances or transactions
   - Firebase Authentication
   - Firebase user balance
   - User-listed tokens
   - Safe rendering of user-provided text (escapeHTML)
   - Periodic refresh (Binance 30s, RND 15s)

   IMPORTANT:
   This file does not implement real order execution.
   Live prices are informational only.
   ========================================================= */

import { initializeApp } from
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* =========================================================
   1. FIREBASE CONFIGURATION
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyDKFkbj5WRUinr_v7ARRtD-Gsxz4UlMrl0",
  authDomain: "exchang-59ea7.firebaseapp.com",
  databaseURL:
    "https://exchang-59ea7-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "exchang-59ea7",
  storageBucket: "exchang-59ea7.firebasestorage.app",
  messagingSenderId: "422935424250",
  appId: "1:422935424250:web:b4da15d25714e499cbed43",
  measurementId: "G-E6NV9Q2SW9"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

/* =========================================================
   2. MARKET CONFIGURATION
   ========================================================= */

const MARKET_API = "https://api.binance.com/api/v3/ticker/24hr";
const PRICE_REFRESH_MS = 30_000;

const coins = [
  {
    name: "Bitcoin",  sym: "BTC",  icon: "₿", cls: "btc",
    marketSymbol: "BTCUSDT", price: null, change: null
  },
  {
    name: "Ethereum", sym: "ETH",  icon: "Ξ", cls: "eth",
    marketSymbol: "ETHUSDT", price: null, change: null
  },
  {
    name: "XRP",      sym: "XRP",  icon: "X", cls: "xrp",
    marketSymbol: "XRPUSDT", price: null, change: null
  },
  {
    name: "Solana",   sym: "SOL",  icon: "◎", cls: "sol",
    marketSymbol: "SOLUSDT", price: null, change: null
  },
  {
    name: "BNB",      sym: "BNB",  icon: "B", cls: "bnb",
    marketSymbol: "BNBUSDT", price: null, change: null
  },
  {
    name: "Dogecoin", sym: "DOGE", icon: "Ð", cls: "doge",
    marketSymbol: "DOGEUSDT", price: null, change: null
  }
];

let priceRefreshTimer = null;
let priceRefreshInProgress = false;
let currentUser = null;

/* =========================================================
   3. RND TOKEN CONFIGURATION
   ========================================================= */

const RND_ADDRESS = "0xcF1FbF18bE9202865bcf88E6349B9D207F75942d";
const RND_API =
  `https://api.dexscreener.com/token-pairs/v1/bsc/${RND_ADDRESS}`;
const RND_REFRESH_MS = 15_000;
let rndRefreshTimer = null;

/* =========================================================
   4. SAFE HELPERS
   ========================================================= */

function getElement(id) {
  return document.getElementById(id);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function formatNumber(value, maxDigits = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDigits
  });
}

function showToast(message, success = true) {
  const toast = getElement("toast");
  const toastMessage = getElement("toastMsg");

  if (!toast || !toastMessage) {
    console[success ? "log" : "error"](message);
    return;
  }

  toastMessage.textContent = message;
  toast.style.borderColor = success ? "var(--success)" : "var(--danger)";

  const icon = toast.querySelector(".check");
  if (icon) {
    icon.textContent = success ? "✓" : "✕";
    icon.style.background = success ? "var(--success)" : "var(--danger)";
  }

  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3200);
}

/* =========================================================
   5. SIDEBAR
   ========================================================= */

window.toggleSidebar = () => {
  const sidebar = getElement("sidebar");
  const overlay = getElement("sidebarOverlay");
  sidebar?.classList.toggle("open");
  overlay?.classList.toggle("show");
};

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    getElement("sidebar")?.classList.remove("open");
    getElement("sidebarOverlay")?.classList.remove("show");
  }
});

/* =========================================================
   6. LOGOUT
   ========================================================= */

window.logoutUser = async event => {
  event?.preventDefault();
  try {
    await signOut(auth);
    localStorage.removeItem("Nexbit_User");
    window.location.href = "index.html";
  } catch (error) {
    console.error("Logout failed:", error);
    showToast("Logout failed. Please try again.", false);
  }
};

/* =========================================================
   7. RENDER COIN CARDS
   Unavailable prices remain unavailable.
   No hardcoded fallback prices are used.
   ========================================================= */

function renderCoins() {
  const grid = getElement("coinsGrid");
  if (!grid) return;

  grid.innerHTML = coins.map(coin => {
    const priceAvailable =
      Number.isFinite(coin.price) && coin.price > 0;
    const changeAvailable = Number.isFinite(coin.change);

    const priceText = priceAvailable
      ? `$${formatNumber(coin.price, coin.price < 1 ? 6 : 2)}`
      : "Price unavailable";

    const changeText = changeAvailable
      ? `${coin.change >= 0 ? "▲" : "▼"} ${Math.abs(coin.change).toFixed(2)}%`
      : "24h change unavailable";

    const changeClass = changeAvailable
      ? (coin.change >= 0 ? "up" : "down")
      : "";

    return `
      <a
        href="trade.html?coin=${encodeURIComponent(coin.sym)}"
        class="coin-card"
        aria-label="${escapeHTML(coin.name)} (${escapeHTML(coin.sym)})"
      >
        <div class="top">
          <div class="coin-icon ${escapeHTML(coin.cls)}">
            ${escapeHTML(coin.icon)}
          </div>
          <div>
            <div class="coin-title">${escapeHTML(coin.name)}</div>
            <div class="coin-sym">${escapeHTML(coin.sym)}</div>
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
   8. FETCH LIVE BINANCE PRICES
   ========================================================= */

async function fetchMarketPrice(coin) {
  if (!coin.marketSymbol) {
    return { price: null, change: null, available: false };
  }

  const url = new URL(MARKET_API);
  url.searchParams.set("symbol", coin.marketSymbol);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`Market API returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const price = Number(data.lastPrice);
  const change = Number(data.priceChangePercent);

  if (
    !Number.isFinite(price) || price <= 0 ||
    !Number.isFinite(change)
  ) {
    throw new Error(`Invalid ticker data for ${coin.sym}`);
  }

  return { price, change, available: true };
}

async function refreshMarketPrices() {
  if (priceRefreshInProgress) return;
  priceRefreshInProgress = true;

  try {
    await Promise.all(coins.map(async coin => {
      try {
        const result = await fetchMarketPrice(coin);
        coin.price = result.price;
        coin.change = result.change;
      } catch (error) {
        console.error(
          `Unable to update ${coin.sym} market data:`, error
        );
        coin.price = null;
        coin.change = null;
      }
    }));
    renderCoins();
  } finally {
    priceRefreshInProgress = false;
  }
}

function startMarketPriceUpdates() {
  if (priceRefreshTimer !== null) clearInterval(priceRefreshTimer);
  refreshMarketPrices();
  priceRefreshTimer = setInterval(refreshMarketPrices, PRICE_REFRESH_MS);
}

/* =========================================================
   9. RND LIVE MARKET (DexScreener / PancakeSwap BSC)
   ========================================================= */

async function loadRNDMarket() {
  const response = await fetch(RND_API, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("RND market data unavailable");
  }

  const pairs = await response.json();

  const validPairs = pairs.filter(pair =>
    pair.chainId === "bsc" &&
    (
      pair.baseToken?.address?.toLowerCase() === RND_ADDRESS.toLowerCase() ||
      pair.quoteToken?.address?.toLowerCase() === RND_ADDRESS.toLowerCase()
    ) &&
    Number(pair.priceUsd) > 0 &&
    Number(pair.liquidity?.usd) > 0
  );

  validPairs.sort(
    (a, b) => Number(b.liquidity.usd) - Number(a.liquidity.usd)
  );

  if (!validPairs.length) {
    throw new Error("No verified RND market pool found");
  }

  const pair = validPairs[0];

  return {
    priceUsd: Number(pair.priceUsd),
    change24h: Number(pair.priceChange?.h24),
    volume24h: Number(pair.volume?.h24),
    liquidityUsd: Number(pair.liquidity?.usd),
    pairAddress: pair.pairAddress,
    dexId: pair.dexId,
    updatedAt: new Date().toISOString()
  };
}

async function updateRNDDisplay() {
  try {
    const market = await loadRNDMarket();

    const price = getElement("rndPrice");
    const change = getElement("rndChange");
    const volume = getElement("rndVolume");
    const liquidity = getElement("rndLiquidity");
    const updated = getElement("rndUpdated");

    if (price) {
      const p = market.priceUsd;
      let priceText;
      if (p < 0.0001)      priceText = p.toFixed(8);
      else if (p < 0.01)   priceText = p.toFixed(6);
      else if (p < 1)      priceText = p.toFixed(4);
      else                 priceText = p.toFixed(2);
      price.textContent = "$" + priceText;
      price.classList.remove("muted");
    }

    if (change && Number.isFinite(market.change24h)) {
      change.textContent =
        (market.change24h >= 0 ? "▲ +" : "▼ ") +
        market.change24h.toFixed(2) + "%";
      change.dataset.direction =
        market.change24h >= 0 ? "up" : "down";
    }

    if (volume && Number.isFinite(market.volume24h)) {
      volume.textContent =
        "$" + market.volume24h.toLocaleString("en-US", {
          maximumFractionDigits: 0
        });
    }

    if (liquidity && Number.isFinite(market.liquidityUsd)) {
      liquidity.textContent =
        "$" + market.liquidityUsd.toLocaleString("en-US", {
          maximumFractionDigits: 0
        });
    }

    if (updated) {
      updated.textContent =
        "🟢 Live · Updated " +
        new Date(market.updatedAt).toLocaleTimeString("en-US");
    }

  } catch (error) {
    console.error("RND market update failed:", error);

    const price = getElement("rndPrice");
    const change = getElement("rndChange");
    const volume = getElement("rndVolume");
    const liquidity = getElement("rndLiquidity");
    const updated = getElement("rndUpdated");

    if (price) {
      price.textContent = "Unavailable";
      price.classList.add("muted");
    }
    if (change)    change.textContent = "—";
    if (volume)    volume.textContent = "—";
    if (liquidity) liquidity.textContent = "—";
    if (updated)   updated.textContent =
      "⚠️ Live market data unavailable — DexScreener may be temporarily down";
  }
}

function startRNDUpdates() {
  if (rndRefreshTimer !== null) clearInterval(rndRefreshTimer);
  updateRNDDisplay();
  rndRefreshTimer = setInterval(updateRNDDisplay, RND_REFRESH_MS);
}

/* =========================================================
   10. BALANCE DISPLAY
   Display the balance actually stored in Firebase.
   ========================================================= */

function animateCount(element, from, to, duration = 600) {
  if (!element) return;

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    element.textContent = "Balance unavailable";
    return;
  }

  const start = performance.now();

  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = from + (to - from) * eased;

    element.textContent = "$" + value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

function renderBalance(balance) {
  const balanceElement = getElement("balanceAmount");
  const changeElement = getElement("balanceChange");

  if (!Number.isFinite(balance) || balance < 0) {
    if (balanceElement) balanceElement.textContent = "Balance unavailable";
    if (changeElement) changeElement.textContent = "Unable to verify balance";
    return;
  }

  animateCount(balanceElement, 0, balance, 600);

  if (changeElement) {
    changeElement.textContent =
      "Daily change unavailable — verified ledger required";
  }
}

/* =========================================================
   11. RECENT TRANSACTIONS
   No demo data is shown as real activity.
   ========================================================= */

function renderTransactions(transactions = []) {
  const tbody = getElement("txBody");
  if (!tbody) return;

  if (!Array.isArray(transactions) || transactions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          No verified transactions available.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = transactions.map(transaction => `
    <tr>
      <td>${escapeHTML(transaction.date)}</td>
      <td>
        <span class="tx-type ${escapeHTML(transaction.type)}">
          ${escapeHTML(transaction.type).toUpperCase()}
        </span>
      </td>
      <td><strong>${escapeHTML(transaction.asset)}</strong></td>
      <td>${escapeHTML(transaction.amount)}</td>
      <td>${escapeHTML(transaction.value)}</td>
      <td>${escapeHTML(transaction.status)}</td>
    </tr>
  `).join("");
}

/* =========================================================
   12. MY LISTED TOKENS
   ========================================================= */

async function loadMyTokens(uid) {
  const wrapper = getElement("myTokensWrap");
  if (!wrapper) return;

  wrapper.textContent = "Loading your listed tokens...";

  try {
    const snapshot = await get(ref(db, `users/${uid}/myTokens`));

    if (!snapshot.exists()) {
      wrapper.innerHTML = `
        <div class="empty-state">
          <span class="emoji">🪙</span>
          <p>You haven't listed any tokens yet.</p>
          <p style="margin-top:8px;">
            <a href="list-token.html">+ List Your First Token</a>
          </p>
        </div>
      `;
      return;
    }

    const value = snapshot.val();

    const tokenList = Object.values(value)
      .filter(token => token && typeof token === "object")
      .sort((a, b) => {
        const dateA = Date.parse(a.submittedAt) || 0;
        const dateB = Date.parse(b.submittedAt) || 0;
        return dateB - dateA;
      });

    if (tokenList.length === 0) {
      wrapper.textContent = "No listed tokens found.";
      return;
    }

    wrapper.innerHTML = tokenList.map(token => {
      const status = String(token.status || "unknown");

      const statusText = {
        pending:  "⏳ Under Review",
        approved: "✅ Approved",
        rejected: "❌ Rejected"
      }[status] || "Status unavailable";

      const safeLogo =
        typeof token.logo === "string" &&
        /^https:\/\//i.test(token.logo)
          ? token.logo
          : "";

      const logoMarkup = safeLogo
        ? `<img src="${escapeHTML(safeLogo)}"
                alt="${escapeHTML(token.symbol || "Token")}"
                loading="lazy"
                referrerpolicy="no-referrer">`
        : "🪙";

      return `
        <div class="my-token-card">
          <div class="my-token-logo">${logoMarkup}</div>
          <div class="my-token-info">
            <h4>${escapeHTML(token.name || "Unnamed token")}</h4>
            <div class="sym">${escapeHTML(token.symbol || "N/A")}</div>
            <span class="my-token-status status-${escapeHTML(status)}">
              ${escapeHTML(statusText)}
            </span>
          </div>
        </div>
      `;
    }).join("");

  } catch (error) {
    console.error("Failed to load listed tokens:", error);
    wrapper.textContent =
      "Unable to load your listed tokens. Please try again.";
  }
}

/* =========================================================
   13. AUTH STATE + LOAD USER DATA
   ========================================================= */

onAuthStateChanged(auth, async user => {
  if (!user) {
    currentUser = null;
    window.location.href = "login.html";
    return;
  }

  currentUser = user;

  const nameElement    = getElement("userName");
  const avatarElement  = getElement("userAvatar");
  const welcomeElement = getElement("welcomeName");

  let displayName = user.displayName || "Trader";
  let balanceUSD  = null;

  try {
    const snapshot = await get(ref(db, `users/${user.uid}`));

    if (snapshot.exists()) {
      const data = snapshot.val();

      if (typeof data.fullName === "string" && data.fullName.trim()) {
        displayName = data.fullName.trim();
      }

      const storedBalance = Number(data.balanceUSD);

      if (
        data.balanceUSD !== undefined &&
        Number.isFinite(storedBalance) &&
        storedBalance >= 0
      ) {
        balanceUSD = storedBalance;
      }
    }
  } catch (error) {
    console.error("Unable to load user account:", error);
  }

  const firstName = displayName.split(/\s+/)[0] || "Trader";

  if (nameElement)    nameElement.textContent = firstName;
  if (avatarElement)  avatarElement.textContent = firstName.charAt(0).toUpperCase();
  if (welcomeElement) welcomeElement.textContent = firstName;

  if (balanceUSD === null) {
    const balanceElement = getElement("balanceAmount");
    const changeElement  = getElement("balanceChange");

    if (balanceElement) balanceElement.textContent = "Balance unavailable";
    if (changeElement)  changeElement.textContent  = "Account balance could not be verified";
  } else {
    renderBalance(balanceUSD);
  }

  renderTransactions([]);
  await loadMyTokens(user.uid);
});

/* =========================================================
   14. INITIALIZATION
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  renderCoins();
  renderTransactions([]);
  startMarketPriceUpdates();
  startRNDUpdates();
});

window.addEventListener("beforeunload", () => {
  if (priceRefreshTimer !== null) clearInterval(priceRefreshTimer);
  if (rndRefreshTimer !== null)   clearInterval(rndRefreshTimer);
});
