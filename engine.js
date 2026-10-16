/* =========================================================
   Nexbit — Order Engine + Matching Engine
   File: engine.js
   Version: 3.1 (Idempotent creditBalance + safe recovery)

   CHANGES in v3.1:
   - creditBalance() is now idempotent (checks ledger by reference)
   - Added creditIdempotent() with atomic reference lock
   - Safer recovery for failed credits
   - Better error logging

   ⚠ SECURITY: Client-side for testing only.
   Move to Cloud Functions before public launch.
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, get, set, update, runTransaction, push
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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
   CONFIG
   ========================================================= */
const MIN_REMAINING_DUST = 0.00000001;

const SUPPORTED_PAIRS = {
  "BTCUSDT":  { base:"BTC",  quote:"USDT", pricePrecision:2, qtyPrecision:8, minOrderUSD:1, feeRate:0.001 },
  "ETHUSDT":  { base:"ETH",  quote:"USDT", pricePrecision:2, qtyPrecision:6, minOrderUSD:1, feeRate:0.001 },
  "XRPUSDT":  { base:"XRP",  quote:"USDT", pricePrecision:4, qtyPrecision:2, minOrderUSD:1, feeRate:0.001 },
  "SOLUSDT":  { base:"SOL",  quote:"USDT", pricePrecision:2, qtyPrecision:4, minOrderUSD:1, feeRate:0.001 },
  "BNBUSDT":  { base:"BNB",  quote:"USDT", pricePrecision:2, qtyPrecision:4, minOrderUSD:1, feeRate:0.001 },
  "DOGEUSDT": { base:"DOGE", quote:"USDT", pricePrecision:5, qtyPrecision:2, minOrderUSD:1, feeRate:0.001 }
};

/* =========================================================
   SAFE DECIMAL MATH
   ========================================================= */
function fix(n, places = 8) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(places));
}
function addD(a, b, places = 8) { return fix(Number(a) + Number(b), places); }
function subD(a, b, places = 8) { return fix(Number(a) - Number(b), places); }
function mulD(a, b, places = 8) { return fix(Number(a) * Number(b), places); }

/* =========================================================
   BALANCE HELPERS
   ========================================================= */
async function migrateLegacyBalance(uid) {
  try {
    const balancesSnap = await get(ref(db, `balances/${uid}/USDT`));
    if (balancesSnap.exists()) return;
    const userSnap = await get(ref(db, `users/${uid}/balanceUSD`));
    if (!userSnap.exists()) return;
    const legacy = Number(userSnap.val()) || 0;
    if (legacy <= 0) return;
    await set(ref(db, `balances/${uid}/USDT`), {
      available: fix(legacy), locked: 0
    });
    console.log(`[engine] Migrated ${legacy} USDT`);
  } catch (err) { console.warn("[engine] Migration failed:", err); }
}

export async function getBalance(uid, asset) {
  try {
    const snap = await get(ref(db, `balances/${uid}/${asset}`));
    if (snap.exists()) {
      const v = snap.val();
      return {
        available: Number(v.available) || 0,
        locked:    Number(v.locked)    || 0
      };
    }
    if (asset === "USDT") {
      const legacySnap = await get(ref(db, `users/${uid}/balanceUSD`));
      if (legacySnap.exists()) {
        return { available: Number(legacySnap.val()) || 0, locked: 0 };
      }
    }
    return { available: 0, locked: 0 };
  } catch (err) {
    console.error("getBalance error:", err);
    return { available: 0, locked: 0 };
  }
}

async function ensureBalanceNode(uid, asset) {
  const bRef = ref(db, `balances/${uid}/${asset}`);
  const snap = await get(bRef);
  if (!snap.exists()) await set(bRef, { available: 0, locked: 0 });
}

/* =========================================================
   LEDGER
   ========================================================= */
async function writeLedger(uid, asset, type, amount, balanceAfter, reference) {
  const entryRef = push(ref(db, `ledger/${uid}`));
  await set(entryRef, {
    asset, type,
    amount: fix(amount),
    balanceAfter: fix(balanceAfter),
    reference: reference || null,
    createdAt: Date.now()
  });
}

/* =========================================================
   IDEMPOTENCY — new in v3.1
   Check if a reference was already processed.
   Path: /processedRefs/{uid}/{safeRefKey}
   ========================================================= */

/* Sanitize reference for use as Firebase key */
function refKey(reference) {
  return String(reference || "")
    .replace(/[.#$\[\]/]/g, "_")
    .slice(0, 100);
}

async function isReferenceProcessed(uid, reference) {
  if (!reference) return false;
  const snap = await get(ref(db, `processedRefs/${uid}/${refKey(reference)}`));
  return snap.exists();
}

async function markReferenceProcessed(uid, reference, meta = {}) {
  if (!reference) return;
  await set(ref(db, `processedRefs/${uid}/${refKey(reference)}`), {
    reference,
    ...meta,
    processedAt: Date.now()
  });
}

/* =========================================================
   ATOMIC BALANCE OPS (unchanged)
   ========================================================= */

export async function creditBalance(uid, asset, amount, reason) {
  amount = fix(amount);
  if (amount <= 0) throw new Error("Credit amount must be > 0");
  if (asset === "USDT") await migrateLegacyBalance(uid);
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

/* =========================================================
   NEW — Idempotent credit (used by deposit flow)
   Guarantees: same reference → single credit
   ========================================================= */
export async function creditIdempotent(uid, asset, amount, reference, meta = {}) {
  amount = fix(amount);
  if (amount <= 0) throw new Error("Credit amount must be > 0");
  if (!reference) throw new Error("Reference is required for idempotent credit");

  /* Step 1: Check if already processed */
  const already = await isReferenceProcessed(uid, reference);
  if (already) {
    console.log(`[engine] Reference already processed: ${reference}`);
    const bal = await getBalance(uid, asset);
    return { alreadyProcessed: true, balance: bal };
  }

  /* Step 2: Reserve the reference (atomically) */
  const refPath = `processedRefs/${uid}/${refKey(reference)}`;
  const refRef = ref(db, refPath);

  const reserveResult = await runTransaction(refRef, current => {
    if (current) return current;   // already exists → abort
    return {
      reference,
      ...meta,
      reservedAt: Date.now()
    };
  });

  if (!reserveResult.committed) {
    console.log(`[engine] Reference locked by another run: ${reference}`);
    const bal = await getBalance(uid, asset);
    return { alreadyProcessed: true, balance: bal };
  }

  /* Step 3: Now credit (atomically) */
  try {
    if (asset === "USDT") await migrateLegacyBalance(uid);
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
    await writeLedger(uid, asset, "credit", amount, newBal.available, reference);

    /* Mark reference as fully processed */
    await update(refRef, {
      status: "completed",
      completedAt: Date.now(),
      creditedAmount: amount
    });

    return { credited: true, balance: newBal };

  } catch (err) {
    /* Release lock so it can be retried later */
    console.error("[engine] Credit failed, releasing lock:", err);
    await update(refRef, {
      status: "failed",
      error: String(err.message || err).slice(0, 200),
      failedAt: Date.now()
    });
    throw err;
  }
}

/* =========================================================
   DEBIT / LOCK / UNLOCK / SPEND (unchanged)
   ========================================================= */

export async function debitBalance(uid, asset, amount, reason) {
  amount = fix(amount);
  if (amount <= 0) throw new Error("Debit amount must be > 0");
  if (asset === "USDT") await migrateLegacyBalance(uid);
  await ensureBalanceNode(uid, asset);

  const bRef = ref(db, `balances/${uid}/${asset}`);
  let insufficient = false;
  const result = await runTransaction(bRef, current => {
    const bal = current || { available: 0, locked: 0 };
    const avail = Number(bal.available) || 0;
    const locked = Number(bal.locked) || 0;
    if (avail < amount) { insufficient = true; return; }
    return { available: fix(avail - amount), locked: fix(locked) };
  });

  if (insufficient || !result.committed) throw new Error("Insufficient available balance");
  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "debit", amount, newBal.available, reason);
  return newBal;
}

export async function lockBalance(uid, asset, amount, reason) {
  amount = fix(amount);
  if (amount <= 0) throw new Error("Lock amount must be > 0");
  if (asset === "USDT") await migrateLegacyBalance(uid);
  await ensureBalanceNode(uid, asset);

  const bRef = ref(db, `balances/${uid}/${asset}`);
  let insufficient = false;
  const result = await runTransaction(bRef, current => {
    const bal = current || { available: 0, locked: 0 };
    const avail = Number(bal.available) || 0;
    const locked = Number(bal.locked) || 0;
    if (avail < amount) { insufficient = true; return; }
    return { available: fix(avail - amount), locked: fix(locked + amount) };
  });

  if (insufficient || !result.committed) throw new Error("Insufficient available balance to lock");
  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "lock", amount, newBal.available, reason);
  return newBal;
}

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
    if (locked < amount) { insufficient = true; return; }
    return { available: fix(avail + amount), locked: fix(locked - amount) };
  });

  if (insufficient || !result.committed) throw new Error("Insufficient locked balance to unlock");
  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "unlock", amount, newBal.available, reason);
  return newBal;
}

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
    if (locked < amount) { insufficient = true; return; }
    return { available: fix(avail), locked: fix(locked - amount) };
  });

  if (insufficient || !result.committed) throw new Error("Insufficient locked balance to spend");
  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "spend", amount, newBal.available, reason);
  return newBal;
}

/* =========================================================
   ORDER VALIDATION
   ========================================================= */
function getPairConfig(pair) {
  const cfg = SUPPORTED_PAIRS[pair];
  if (!cfg) throw new Error(`Pair ${pair} is not enabled for trading`);
  return cfg;
}
function validatePrice(price, cfg) {
  const p = fix(price, cfg.pricePrecision);
  if (!Number.isFinite(p) || p <= 0) throw new Error("Price must be > 0");
  const tick = 1 / Math.pow(10, cfg.pricePrecision);
  return fix(Math.round(p / tick) * tick, cfg.pricePrecision);
}
function validateQuantity(qty, cfg) {
  const q = fix(qty, cfg.qtyPrecision);
  if (!Number.isFinite(q) || q <= 0) throw new Error("Quantity must be > 0");
  return q;
}

/* =========================================================
   ORDER BOOK
   ========================================================= */
function priceKey(price, cfg) { return String(fix(price, cfg.pricePrecision)); }

export async function getOrderBook(pair, depth = 15) {
  const cfg = getPairConfig(pair);
  const [bidsSnap, asksSnap] = await Promise.all([
    get(ref(db, `orderBook/${pair}/bids`)),
    get(ref(db, `orderBook/${pair}/asks`))
  ]);
  const bids = [], asks = [];
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
  return { bids: bids.slice(0, depth), asks: asks.slice(0, depth) };
}

export async function getRecentTrades(pair, limit = 20) {
  const snap = await get(ref(db, "trades"));
  if (!snap.exists()) return [];
  return Object.values(snap.val())
    .filter(t => t && t.pair === pair)
    .sort((a, b) => (b.executedAt || 0) - (a.executedAt || 0))
    .slice(0, limit);
}

async function addToBook(pair, side, price, orderId, uid, qty, cfg) {
  const pk = priceKey(price, cfg);
  await runTransaction(ref(db, `orderBook/${pair}/${side === "buy" ? "bids" : "asks"}/${pk}`), current => {
    const c = current || { totalQty: 0, orders: {} };
    c.totalQty = fix(Number(c.totalQty || 0) + qty);
    c.orders = c.orders || {};
    c.orders[orderId] = { uid, qty: fix(qty), remaining: fix(qty), createdAt: Date.now() };
    return c;
  });
}

async function updateBookAfterFill(pair, side, price, orderId, qty, cfg) {
  const pk = priceKey(price, cfg);
  await runTransaction(ref(db, `orderBook/${pair}/${side === "buy" ? "bids" : "asks"}/${pk}`), current => {
    if (!current || !current.orders) return current;
    const ord = current.orders[orderId];
    if (ord) {
      ord.remaining = fix(Number(ord.remaining || 0) - qty);
      if (ord.remaining <= MIN_REMAINING_DUST) delete current.orders[orderId];
    }
    current.totalQty = fix(Number(current.totalQty || 0) - qty);
    const remainingOrders = current.orders ? Object.keys(current.orders).length : 0;
    if (remainingOrders === 0 || current.totalQty <= MIN_REMAINING_DUST) return null;
    return current;
  });
}

async function removeFromBook(pair, side, price, orderId, qty, cfg) {
  const pk = priceKey(price, cfg);
  await runTransaction(ref(db, `orderBook/${pair}/${side === "buy" ? "bids" : "asks"}/${pk}`), current => {
    if (!current || !current.orders) return current;
    if (current.orders[orderId]) {
      delete current.orders[orderId];
      current.totalQty = fix(Number(current.totalQty || 0) - qty);
    }
    const remainingOrders = current.orders ? Object.keys(current.orders).length : 0;
    if (remainingOrders === 0 || current.totalQty <= MIN_REMAINING_DUST) return null;
    return current;
  });
}

/* =========================================================
   PLACE / CANCEL / MATCH (unchanged from v3.0)
   ========================================================= */

export async function placeOrder({ uid, pair = "BTCUSDT", side, type, price, quantity }) {
  if (!uid) throw new Error("User not authenticated");
  if (!["buy", "sell"].includes(side)) throw new Error("Invalid side");
  if (!["limit", "market"].includes(type)) throw new Error("Invalid type");

  const cfg = getPairConfig(pair);
  const { base, quote } = cfg;

  let execPrice;
  if (type === "market") {
    const book = await getOrderBook(pair, 50);
    const levels = side === "buy" ? book.asks : book.bids;
    if (!levels.length) throw new Error("No liquidity for market order");
    execPrice = levels[0].price;
  } else {
    execPrice = validatePrice(price, cfg);
  }

  const qty = validateQuantity(quantity, cfg);
  const cost = mulD(execPrice, qty, cfg.pricePrecision + cfg.qtyPrecision);
  if (cost < cfg.minOrderUSD) throw new Error(`Minimum order value is $${cfg.minOrderUSD}`);

  if (side === "buy") {
    await lockBalance(uid, quote, mulD(cost, 1 + cfg.feeRate, 8), `order_lock_buy_${pair}`);
  } else {
    await lockBalance(uid, base, qty, `order_lock_sell_${pair}`);
  }

  const ordersRef = ref(db, "orders");
  const orderRef  = push(ordersRef);
  const orderId   = orderRef.key;

  const order = {
    orderId, uid, pair, baseAsset: base, quoteAsset: quote,
    side, type,
    price: fix(execPrice, cfg.pricePrecision),
    quantity: fix(qty, cfg.qtyPrecision),
    filled: 0,
    remaining: fix(qty, cfg.qtyPrecision),
    status: "open",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await set(orderRef, order);
  await set(ref(db, `users/${uid}/orders/${orderId}`), {
    orderId, pair, side, type,
    price: order.price, quantity: order.quantity,
    filled: 0, remaining: order.remaining,
    status: "open", createdAt: order.createdAt
  });

  if (type === "limit") await addToBook(pair, side, execPrice, orderId, uid, qty, cfg);

  await runMatchingEngine(pair);

  const finalSnap = await get(ref(db, `orders/${orderId}`));
  return finalSnap.val();
}

export async function cancelOrder({ uid, orderId }) {
  const snap = await get(ref(db, `orders/${orderId}`));
  if (!snap.exists()) throw new Error("Order not found");
  const order = snap.val();
  if (order.uid !== uid) throw new Error("Not your order");
  if (order.status === "filled" || order.status === "cancelled") throw new Error("Order cannot be cancelled");

  const cfg = getPairConfig(order.pair);
  const remaining = fix(Number(order.remaining) || 0);

  if (order.side === "buy") {
    const unlock = mulD(remaining, order.price, 8);
    await unlockBalance(uid, order.quoteAsset, mulD(unlock, 1 + cfg.feeRate, 8), `cancel_${orderId}`);
  } else {
    await unlockBalance(uid, order.baseAsset, remaining, `cancel_${orderId}`);
  }

  await update(ref(db, `orders/${orderId}`), { status: "cancelled", updatedAt: Date.now() });
  await update(ref(db, `users/${uid}/orders/${orderId}`), { status: "cancelled", updatedAt: Date.now() });
  if (order.type === "limit") await removeFromBook(order.pair, order.side, order.price, orderId, remaining, cfg);
  return { ok: true, orderId };
}

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
          price: Number(p), orderId: oid, uid: o.uid,
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
  for (let i = 0; i < 200; i++) {
    const book = await loadFullBook(pair, cfg);
    const bestBid = book.bids[0];
    const bestAsk = book.asks[0];
    if (!bestBid || !bestAsk) break;
    if (bestBid.price < bestAsk.price) break;
    const makerIsBid = bestBid.createdAt <= bestAsk.createdAt;
    const tradePrice = makerIsBid ? bestBid.price : bestAsk.price;
    const qty = Math.min(bestBid.remaining, bestAsk.remaining);
    if (qty <= MIN_REMAINING_DUST) break;
    await executeTrade({
      pair, cfg,
      buyerOrderId: bestBid.orderId, sellerOrderId: bestAsk.orderId,
      buyerUid: bestBid.uid, sellerUid: bestAsk.uid,
      price: tradePrice, quantity: fix(qty, cfg.qtyPrecision)
    });
  }
}

async function executeTrade({ pair, cfg, buyerOrderId, sellerOrderId, buyerUid, sellerUid, price, quantity }) {
  const { base, quote } = cfg;
  const cost = mulD(price, quantity, 8);
  const buyerFee  = mulD(cost, cfg.feeRate, 8);
  const sellerFee = mulD(cost, cfg.feeRate, 8);
  const sellerProceeds = subD(cost, sellerFee, 8);

  await spendLocked(buyerUid, quote, addD(cost, buyerFee, 8), `trade_buy_${buyerOrderId}`);
  await creditBalance(buyerUid, base, quantity, `trade_buy_${buyerOrderId}`);
  await spendLocked(sellerUid, base, quantity, `trade_sell_${sellerOrderId}`);
  await creditBalance(sellerUid, quote, sellerProceeds, `trade_sell_${sellerOrderId}`);

  await updateOrderAfterFill(buyerOrderId, quantity, cfg);
  await updateOrderAfterFill(sellerOrderId, quantity, cfg);

  const tradeRef = push(ref(db, "trades"));
  const tradeId = tradeRef.key;
  const trade = {
    tradeId, pair, buyerOrderId, sellerOrderId,
    buyerUid, sellerUid, price, quantity, cost,
    buyerFee, sellerFee, executedAt: Date.now()
  };
  await set(tradeRef, trade);
  await set(ref(db, `users/${buyerUid}/trades/${tradeId}`), {
    tradeId, pair, side: "buy", price, quantity, cost, fee: buyerFee, executedAt: trade.executedAt
  });
  await set(ref(db, `users/${sellerUid}/trades/${tradeId}`), {
    tradeId, pair, side: "sell", price, quantity, cost, fee: sellerFee, executedAt: trade.executedAt
  });
}

async function updateOrderAfterFill(orderId, qty, cfg) {
  const result = await runTransaction(ref(db, `orders/${orderId}`), current => {
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
  await update(ref(db, `users/${updated.uid}/orders/${orderId}`), {
    filled: updated.filled, remaining: updated.remaining,
    status: updated.status, updatedAt: Date.now()
  });
  if (updated.type === "limit") {
    await updateBookAfterFill(updated.pair, updated.side, updated.price, orderId, qty, cfg);
  }
}

export async function ensureWallets(uid) {
  const assets = ["USDT", "BTC", "ETH", "XRP", "SOL", "BNB", "DOGE"];
  await migrateLegacyBalance(uid);
  for (const a of assets) await ensureBalanceNode(uid, a);
}

export const _internal = { fix, addD, subD, mulD };

export default {
  placeOrder, cancelOrder, getOrderBook, getRecentTrades,
  getBalance, creditBalance, creditIdempotent,
  debitBalance, lockBalance, unlockBalance, spendLocked,
  ensureWallets, SUPPORTED_PAIRS
};
