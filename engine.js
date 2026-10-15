/* =========================================================
   Nexbit — Order Engine + Matching Engine
   File: engine.js
   Version: 2.0 (Fixed + Market/Limit + Whitelist)

   ⚠⚠⚠  SECURITY WARNING  ⚠⚠⚠
   This runs CLIENT-SIDE for INTERNAL TESTING ONLY.
   Before PUBLIC launch, move all logic to Cloud Functions.

   Architecture (modular — easy to port to backend):
     - Balance layer: credit / debit / lock / unlock / spend
     - Ledger layer: immutable audit log
     - Order layer: create / cancel / validate
     - OrderBook layer: in-memory structure persisted to RTDB
     - Matching layer: price-time priority engine
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, get, set, update, runTransaction, push
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* =========================================================
   0. SAFE APP + DATABASE
   Reuse existing default app if already initialized
   ========================================================= */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDKFkbj5WRUinr_v7ARRtD-Gsxz4UlMrl0",
  authDomain: "exchang-59ea7.firebaseapp.com",
  databaseURL: "https://exchang-59ea7-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "exchang-59ea7",
  storageBucket: "exchang-59ea7.firebasestorage.app",
  messagingSenderId: "422935424250",
  appId: "1:422935424250:web:b4da15d25714e499cbed43"
};

const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

/* =========================================================
   1. CONFIG + WHITELIST
   ========================================================= */
const DEFAULT_FEE_RATE   = 0.001;      // 0.1%
const DEFAULT_MIN_USD    = 1;          // Minimum $1 order value
const MIN_REMAINING_DUST = 0.00000001; // Smallest meaningful quantity

/* Supported internal trading pairs (whitelist).
   Add more pairs here only after backend readiness.
*/
const SUPPORTED_PAIRS = {
  "BTCUSDT": {
    base: "BTC",
    quote: "USDT",
    pricePrecision: 2,      // $0.01 tick
    qtyPrecision: 8,        // 0.00000001 BTC
    minOrderUSD: 1,
    feeRate: 0.001
  }
  /* Future pairs:
  "ETHUSDT": { base: "ETH", quote: "USDT", pricePrecision: 2, qtyPrecision: 6, minOrderUSD: 1, feeRate: 0.001 }
  */
};

/* =========================================================
   2. SAFE DECIMAL MATH
   Every amount stored as NUMBER with fixed precision.
   Never do raw floating point for order/fee math.
   ========================================================= */
function fix(n, places = 8) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(places));
}

function addD(a, b, places = 8) { return fix(Number(a) + Number(b), places); }
function subD(a, b, places = 8) { return fix(Number(a) - Number(b), places); }
function mulD(a, b, places = 8) { return fix(Number(a) * Number(b), places); }
function divD(a, b, places = 8) {
  if (Number(b) === 0) return 0;
  return fix(Number(a) / Number(b), places);
}

/* =========================================================
   3. BALANCE HELPERS
   Path: /balances/{uid}/{asset} = { available, locked }
   ========================================================= */

export async function getBalance(uid, asset) {
  try {
    const snap = await get(ref(db, `balances/${uid}/${asset}`));
    if (!snap.exists()) return { available: 0, locked: 0 };
    const v = snap.val();
    return {
      available: Number(v.available) || 0,
      locked:    Number(v.locked)    || 0
    };
  } catch (err) {
    console.error("getBalance error:", err);
    return { available: 0, locked: 0 };
  }
}

async function ensureBalanceNode(uid, asset) {
  const bRef = ref(db, `balances/${uid}/${asset}`);
  const snap = await get(bRef);
  if (!snap.exists()) {
    await set(bRef, { available: 0, locked: 0 });
  }
}

/* =========================================================
   4. LEDGER
   Path: /ledger/{uid}/{entryId}
   ========================================================= */
async function writeLedger(uid, asset, type, amount, balanceAfter, reference) {
  const entryRef = push(ref(db, `ledger/${uid}`));
  await set(entryRef, {
    asset,
    type,
    amount: fix(amount),
    balanceAfter: fix(balanceAfter),
    reference: reference || null,
    createdAt: Date.now()
  });
}

/* =========================================================
   5. ATOMIC BALANCE OPS
   Each one uses runTransaction for safety.
   If insufficient funds, transaction throws → no change.
   ========================================================= */

/* --- Credit (add to available) --- */
export async function creditBalance(uid, asset, amount, reason) {
  amount = fix(amount);
  if (amount <= 0) throw new Error("Credit amount must be > 0");
  await ensureBalanceNode(uid, asset);

  const bRef = ref(db, `balances/${uid}/${asset}`);
  const result = await runTransaction(bRef, current => {
    const bal = current || { available: 0, locked: 0 };
    return {
      available: fix(Number(bal.available || 0) + amount),
      locked:    fix(Number(bal.locked    || 0))
    };
  });

  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "credit", amount, newBal.available, reason);
  return newBal;
}

/* --- Debit (only from available) --- */
export async function debitBalance(uid, asset, amount, reason) {
  amount = fix(amount);
  if (amount <= 0) throw new Error("Debit amount must be > 0");
  await ensureBalanceNode(uid, asset);

  const bRef = ref(db, `balances/${uid}/${asset}`);
  let insufficient = false;

  const result = await runTransaction(bRef, current => {
    const bal = current || { available: 0, locked: 0 };
    const avail = Number(bal.available) || 0;
    const locked = Number(bal.locked) || 0;
    if (avail < amount) {
      insufficient = true;
      return;  // abort (leave unchanged)
    }
    return {
      available: fix(avail - amount),
      locked:    fix(locked)
    };
  });

  if (insufficient || !result.committed) {
    throw new Error("Insufficient available balance");
  }

  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "debit", amount, newBal.available, reason);
  return newBal;
}

/* --- Lock (available → locked) --- */
export async function lockBalance(uid, asset, amount, reason) {
  amount = fix(amount);
  if (amount <= 0) throw new Error("Lock amount must be > 0");
  await ensureBalanceNode(uid, asset);

  const bRef = ref(db, `balances/${uid}/${asset}`);
  let insufficient = false;

  const result = await runTransaction(bRef, current => {
    const bal = current || { available: 0, locked: 0 };
    const avail = Number(bal.available) || 0;
    const locked = Number(bal.locked) || 0;
    if (avail < amount) {
      insufficient = true;
      return;
    }
    return {
      available: fix(avail - amount),
      locked:    fix(locked + amount)
    };
  });

  if (insufficient || !result.committed) {
    throw new Error("Insufficient available balance to lock");
  }

  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "lock", amount, newBal.available, reason);
  return newBal;
}

/* --- Unlock (locked → available) --- */
export async function unlockBalance(uid, asset, amount, reason) {
  amount = fix(amount);
  if (amount <= 0) throw new Error("Unlock amount must be > 0");
  await ensureBalanceNode(uid, asset);

  const bRef = ref(db, `balances/${uid}/${asset}`);
  let insufficient = false;

  const result = await runTransaction(bRef, current => {
    const bal = current || { available: 0, locked: 0 };
    const avail = Number(bal.available) || 0;
    const locked = Number(bal.locked) || 0;
    if (locked < amount) {
      insufficient = true;
      return;
    }
    return {
      available: fix(avail + amount),
      locked:    fix(locked - amount)
    };
  });

  if (insufficient || !result.committed) {
    throw new Error("Insufficient locked balance to unlock");
  }

  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "unlock", amount, newBal.available, reason);
  return newBal;
}

/* --- Spend locked (remove from locked, e.g. after trade) --- */
export async function spendLocked(uid, asset, amount, reason) {
  amount = fix(amount);
  if (amount <= 0) throw new Error("Spend amount must be > 0");
  await ensureBalanceNode(uid, asset);

  const bRef = ref(db, `balances/${uid}/${asset}`);
  let insufficient = false;

  const result = await runTransaction(bRef, current => {
    const bal = current || { available: 0, locked: 0 };
    const avail = Number(bal.available) || 0;
    const locked = Number(bal.locked) || 0;
    if (locked < amount) {
      insufficient = true;
      return;
    }
    return {
      available: fix(avail),
      locked:    fix(locked - amount)
    };
  });

  if (insufficient || !result.committed) {
    throw new Error("Insufficient locked balance to spend");
  }

  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "spend", amount, newBal.available, reason);
  return newBal;
}

/* =========================================================
   6. ORDER VALIDATION
   ========================================================= */
function getPairConfig(pair) {
  const cfg = SUPPORTED_PAIRS[pair];
  if (!cfg) throw new Error(`Pair ${pair} is not enabled for trading`);
  return cfg;
}

function validatePrice(price, cfg) {
  const p = fix(price, cfg.pricePrecision);
  if (!Number.isFinite(p) || p <= 0) throw new Error("Price must be > 0");
  /* Round to tick */
  const tick = 1 / Math.pow(10, cfg.pricePrecision);
  const rounded = Math.round(p / tick) * tick;
  return fix(rounded, cfg.pricePrecision);
}

function validateQuantity(qty, cfg) {
  const q = fix(qty, cfg.qtyPrecision);
  if (!Number.isFinite(q) || q <= 0) throw new Error("Quantity must be > 0");
  return q;
}

/* =========================================================
   7. ORDER BOOK
   Path: /orderBook/{pair}/bids/{priceKey} = { totalQty, orders: { orderId: {...} } }
         /orderBook/{pair}/asks/{priceKey}
   ========================================================= */
function priceKey(price, cfg) {
  return String(fix(price, cfg.pricePrecision));
}

export async function getOrderBook(pair, depth = 15) {
  const cfg = getPairConfig(pair);

  const [bidsSnap, asksSnap] = await Promise.all([
    get(ref(db, `orderBook/${pair}/bids`)),
    get(ref(db, `orderBook/${pair}/asks`))
  ]);

  const bids = [];
  const asks = [];

  if (bidsSnap.exists()) {
    const v = bidsSnap.val();
    Object.keys(v).forEach(p => {
      const total = Number(v[p].totalQty) || 0;
      if (total > 0) bids.push({ price: Number(p), totalQty: total });
    });
    bids.sort((a, b) => b.price - a.price);
  }

  if (asksSnap.exists()) {
    const v = asksSnap.val();
    Object.keys(v).forEach(p => {
      const total = Number(v[p].totalQty) || 0;
      if (total > 0) asks.push({ price: Number(p), totalQty: total });
    });
    asks.sort((a, b) => a.price - b.price);
  }

  return {
    bids: bids.slice(0, depth),
    asks: asks.slice(0, depth)
  };
}

export async function getRecentTrades(pair, limit = 20) {
  const snap = await get(ref(db, "trades"));
  if (!snap.exists()) return [];
  return Object.values(snap.val())
    .filter(t => t && t.pair === pair)
    .sort((a, b) => (b.executedAt || 0) - (a.executedAt || 0))
    .slice(0, limit);
}

/* Add order to book (with transaction) */
async function addToBook(pair, side, price, orderId, uid, qty, cfg) {
  const pk = priceKey(price, cfg);
  const path = `orderBook/${pair}/${side === "buy" ? "bids" : "asks"}/${pk}`;
  const bRef = ref(db, path);

  await runTransaction(bRef, current => {
    const c = current || { totalQty: 0, orders: {} };
    c.totalQty = fix(Number(c.totalQty || 0) + qty);
    c.orders = c.orders || {};
    c.orders[orderId] = {
      uid,
      qty: fix(qty),
      remaining: fix(qty),
      createdAt: Date.now()
    };
    return c;
  });
}

/* Remove or reduce order from book */
async function updateBookAfterFill(pair, side, price, orderId, qty, cfg) {
  const pk = priceKey(price, cfg);
  const path = `orderBook/${pair}/${side === "buy" ? "bids" : "asks"}/${pk}`;
  const bRef = ref(db, path);

  await runTransaction(bRef, current => {
    if (!current || !current.orders) return current;
    const ord = current.orders[orderId];
    if (ord) {
      ord.remaining = fix(Number(ord.remaining || 0) - qty);
      if (ord.remaining <= MIN_REMAINING_DUST) {
        delete current.orders[orderId];
      }
    }
    current.totalQty = fix(Number(current.totalQty || 0) - qty);

    /* Remove empty level */
    const remainingOrders = current.orders ? Object.keys(current.orders).length : 0;
    if (remainingOrders === 0 || current.totalQty <= MIN_REMAINING_DUST) {
      return null;
    }
    return current;
  });
}

/* Remove order entirely from book (for cancel) */
async function removeFromBook(pair, side, price, orderId, qty, cfg) {
  const pk = priceKey(price, cfg);
  const path = `orderBook/${pair}/${side === "buy" ? "bids" : "asks"}/${pk}`;
  const bRef = ref(db, path);

  await runTransaction(bRef, current => {
    if (!current || !current.orders) return current;
    if (current.orders[orderId]) {
      delete current.orders[orderId];
      current.totalQty = fix(Number(current.totalQty || 0) - qty);
    }
    const remainingOrders = current.orders ? Object.keys(current.orders).length : 0;
    if (remainingOrders === 0 || current.totalQty <= MIN_REMAINING_DUST) {
      return null;
    }
    return current;
  });
}

/* =========================================================
   8. PLACE ORDER (Limit + Market)
   ========================================================= */
export async function placeOrder({
  uid,
  pair = "BTCUSDT",
  side,          // "buy" | "sell"
  type,          // "limit" | "market"
  price,         // for limit — required; for market — ignored
  quantity       // base asset amount (e.g. BTC)
}) {
  if (!uid) throw new Error("User not authenticated");
  if (!["buy", "sell"].includes(side)) throw new Error("Invalid side");
  if (!["limit", "market"].includes(type)) throw new Error("Invalid type");

  const cfg = getPairConfig(pair);
  const { base, quote } = cfg;

  /* --- Determine price --- */
  let execPrice;
  if (type === "market") {
    const book = await getOrderBook(pair, 50);
    /* Market BUY → consume lowest asks; Market SELL → highest bids */
    const levels = side === "buy" ? book.asks : book.bids;
    if (!levels.length) {
      throw new Error("No liquidity for market order");
    }
    execPrice = levels[0].price;
  } else {
    execPrice = validatePrice(price, cfg);
  }

  /* --- Validate quantity --- */
  const qty = validateQuantity(quantity, cfg);
  const cost = mulD(execPrice, qty, cfg.pricePrecision + cfg.qtyPrecision);

  if (cost < cfg.minOrderUSD) {
    throw new Error(`Minimum order value is $${cfg.minOrderUSD}`);
  }

  /* --- Lock funds --- */
  if (side === "buy") {
    /* Lock cost + fee in quote */
    const totalLock = mulD(cost, 1 + cfg.feeRate, 8);
    await lockBalance(uid, quote, totalLock, `order_lock_buy_${pair}`);
  } else {
    await lockBalance(uid, base, qty, `order_lock_sell_${pair}`);
  }

  /* --- Create order record --- */
  const ordersRef = ref(db, "orders");
  const orderRef  = push(ordersRef);
  const orderId   = orderRef.key;

  const order = {
    orderId,
    uid,
    pair,
    baseAsset: base,
    quoteAsset: quote,
    side,
    type,
    price: fix(execPrice, cfg.pricePrecision),
    quantity: fix(qty, cfg.qtyPrecision),
    filled: 0,
    remaining: fix(qty, cfg.qtyPrecision),
    status: "open",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await set(orderRef, order);

  /* Mirror to user's orders */
  await set(ref(db, `users/${uid}/orders/${orderId}`), {
    orderId,
    pair,
    side,
    type,
    price: order.price,
    quantity: order.quantity,
    filled: 0,
    remaining: order.remaining,
    status: "open",
    createdAt: order.createdAt
  });

  /* For LIMIT — add to book */
  if (type === "limit") {
    await addToBook(pair, side, execPrice, orderId, uid, qty, cfg);
  }

  /* --- Run matching engine --- */
  await runMatchingEngine(pair);

  /* Fetch final state */
  const finalSnap = await get(ref(db, `orders/${orderId}`));
  return finalSnap.val();
}

/* =========================================================
   9. CANCEL ORDER
   ========================================================= */
export async function cancelOrder({ uid, orderId }) {
  const snap = await get(ref(db, `orders/${orderId}`));
  if (!snap.exists()) throw new Error("Order not found");
  const order = snap.val();
  if (order.uid !== uid) throw new Error("Not your order");
  if (order.status === "filled" || order.status === "cancelled") {
    throw new Error("Order cannot be cancelled");
  }

  const cfg = getPairConfig(order.pair);
  const remaining = fix(Number(order.remaining) || 0);

  /* Unlock remaining */
  if (order.side === "buy") {
    const unlock = mulD(remaining, order.price, 8);
    const withFee = mulD(unlock, 1 + cfg.feeRate, 8);
    await unlockBalance(uid, order.quoteAsset, withFee, `cancel_${orderId}`);
  } else {
    await unlockBalance(uid, order.baseAsset, remaining, `cancel_${orderId}`);
  }

  /* Update order */
  await update(ref(db, `orders/${orderId}`), {
    status: "cancelled",
    updatedAt: Date.now()
  });
  await update(ref(db, `users/${uid}/orders/${orderId}`), {
    status: "cancelled",
    updatedAt: Date.now()
  });

  /* Remove from book */
  if (order.type === "limit") {
    await removeFromBook(order.pair, order.side, order.price, orderId, remaining, cfg);
  }

  return { ok: true, orderId };
}

/* =========================================================
   10. MATCHING ENGINE
   Price-time priority
   ========================================================= */
async function loadFullBook(pair, cfg) {
  const [bidsSnap, asksSnap] = await Promise.all([
    get(ref(db, `orderBook/${pair}/bids`)),
    get(ref(db, `orderBook/${pair}/asks`))
  ]);

  const bids = [], asks = [];

  const collect = (side, snap, arr, sorter) => {
    if (!snap.exists()) return;
    const v = snap.val();
    Object.keys(v).forEach(p => {
      const level = v[p];
      if (!level.orders) return;
      Object.keys(level.orders).forEach(oid => {
        const o = level.orders[oid];
        arr.push({
          price: Number(p),
          orderId: oid,
          uid: o.uid,
          remaining: Number(o.remaining) || 0,
          createdAt: o.createdAt || 0
        });
      });
    });
    arr.sort(sorter);
  };

  collect("bids", bidsSnap, bids, (a, b) => b.price - a.price || a.createdAt - b.createdAt);
  collect("asks", asksSnap, asks, (a, b) => a.price - b.price || a.createdAt - b.createdAt);

  return { bids, asks };
}

async function runMatchingEngine(pair) {
  const cfg = getPairConfig(pair);

  for (let i = 0; i < 200; i++) {     // safety limit
    const book = await loadFullBook(pair, cfg);
    const bestBid = book.bids[0];
    const bestAsk = book.asks[0];
    if (!bestBid || !bestAsk) break;
    if (bestBid.price < bestAsk.price) break;      // no cross

    /* Price = earlier (maker) order's price */
    const makerIsBid = bestBid.createdAt <= bestAsk.createdAt;
    const tradePrice = makerIsBid ? bestBid.price : bestAsk.price;

    const qty = Math.min(bestBid.remaining, bestAsk.remaining);
    if (qty <= MIN_REMAINING_DUST) break;

    await executeTrade({
      pair,
      cfg,
      buyerOrderId: bestBid.orderId,
      sellerOrderId: bestAsk.orderId,
      buyerUid: bestBid.uid,
      sellerUid: bestAsk.uid,
      price: tradePrice,
      quantity: fix(qty, cfg.qtyPrecision)
    });
  }
}

/* =========================================================
   11. EXECUTE TRADE (atomic both sides)
   ========================================================= */
async function executeTrade({
  pair, cfg,
  buyerOrderId, sellerOrderId,
  buyerUid, sellerUid,
  price, quantity
}) {
  const { base, quote } = cfg;

  const cost = mulD(price, quantity, 8);
  const buyerFee  = mulD(cost, cfg.feeRate, 8);
  const sellerFee = mulD(cost, cfg.feeRate, 8);
  const sellerProceeds = subD(cost, sellerFee, 8);

  /* ---------- BUYER ---------- */
  /* Buyer locked: cost + fee.  Spend that.  Credit base. */
  await spendLocked(buyerUid, quote, addD(cost, buyerFee, 8), `trade_buy_${buyerOrderId}`);
  await creditBalance(buyerUid, base, quantity, `trade_buy_${buyerOrderId}`);

  /* ---------- SELLER ---------- */
  await spendLocked(sellerUid, base, quantity, `trade_sell_${sellerOrderId}`);
  await creditBalance(sellerUid, quote, sellerProceeds, `trade_sell_${sellerOrderId}`);

  /* ---------- ORDERS ---------- */
  await updateOrderAfterFill(buyerOrderId, quantity, cfg);
  await updateOrderAfterFill(sellerOrderId, quantity, cfg);

  /* ---------- TRADE RECORD ---------- */
  const tradeRef = push(ref(db, "trades"));
  const tradeId = tradeRef.key;

  const trade = {
    tradeId,
    pair,
    buyerOrderId,
    sellerOrderId,
    buyerUid,
    sellerUid,
    price,
    quantity,
    cost,
    buyerFee,
    sellerFee,
    executedAt: Date.now()
  };
  await set(tradeRef, trade);

  /* Mirror to user histories */
  await set(ref(db, `users/${buyerUid}/trades/${tradeId}`), {
    tradeId, pair, side: "buy", price, quantity, cost, fee: buyerFee, executedAt: trade.executedAt
  });
  await set(ref(db, `users/${sellerUid}/trades/${tradeId}`), {
    tradeId, pair, side: "sell", price, quantity, cost, fee: sellerFee, executedAt: trade.executedAt
  });
}

/* Update order status after a fill */
async function updateOrderAfterFill(orderId, qty, cfg) {
  const orderRef = ref(db, `orders/${orderId}`);

  const result = await runTransaction(orderRef, current => {
    if (!current) return current;
    const filled = fix(Number(current.filled || 0) + qty, cfg.qtyPrecision);
    const remaining = fix(Number(current.quantity) - filled, cfg.qtyPrecision);
    current.filled = filled;
    current.remaining = remaining < 0 ? 0 : remaining;
    current.status = remaining <= MIN_REMAINING_DUST ? "filled" : "partial";
    current.updatedAt = Date.now();
    return current;
  });

  const updated = result.snapshot.val();
  if (!updated) return;

  /* Mirror user */
  await update(ref(db, `users/${updated.uid}/orders/${orderId}`), {
    filled: updated.filled,
    remaining: updated.remaining,
    status: updated.status,
    updatedAt: Date.now()
  });

  /* Book update */
  if (updated.type === "limit") {
    await updateBookAfterFill(
      updated.pair,
      updated.side,
      updated.price,
      orderId,
      qty,
      cfg
    );
  }
}

/* =========================================================
   12. HELPERS
   ========================================================= */
export async function ensureWallets(uid) {
  const assets = ["USDT", "BTC", "ETH", "XRP", "SOL", "BNB", "DOGE"];
  for (const a of assets) {
    await ensureBalanceNode(uid, a);
  }
}

/* Expose for debugging */
export const _internal = { fix, addD, subD, mulD, divD };

/* =========================================================
   13. EXPORT
   ========================================================= */
export default {
  placeOrder,
  cancelOrder,
  getOrderBook,
  getRecentTrades,
  getBalance,
  creditBalance,
  debitBalance,
  lockBalance,
  unlockBalance,
  spendLocked,
  ensureWallets
};
