/* =========================================================
   Nexbit — Order Engine + Matching Engine
   File: engine.js
   Version: 1.0

   ⚠⚠⚠  IMPORTANT SECURITY WARNING  ⚠⚠⚠

   This engine runs CLIENT-SIDE for internal testing only.
   Before PUBLIC launch, ALL of the following MUST be moved
   to Firebase Cloud Functions (server-side):

     1. placeOrder()
     2. cancelOrder()
     3. runMatchingEngine()
     4. All balance updates in Firebase transactions

   Client-side order engine is NOT secure for real money.
   Anyone can open DevTools and modify this code.

   For now: internal testing only.
   ========================================================= */

import { getDatabase, ref, get, set, update, runTransaction, serverTimestamp, push }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const db = getDatabase();

/* =========================================================
   1. CONFIG
   ========================================================= */
const FEE_RATE = 0.001;          // 0.1% fee both sides
const MIN_ORDER_USD = 1;         // Minimum $1 order
const DEFAULT_PAIR = "BTCUSDT";

/* =========================================================
   2. UTILITIES — Decimal-safe math
   We use string + Number with 8 decimal places
   ========================================================= */
function toDecimal(n, places = 8) {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(places));
}

function addDec(a, b) {
  return toDecimal(Number(a) + Number(b));
}

function subDec(a, b) {
  return toDecimal(Number(a) - Number(b));
}

function mulDec(a, b) {
  return toDecimal(Number(a) * Number(b));
}

function divDec(a, b) {
  if (Number(b) === 0) return 0;
  return toDecimal(Number(a) / Number(b));
}

/* =========================================================
   3. BALANCE HELPERS
   Structure: /balances/{uid}/{asset} = { available, locked }
   USDT and BTC both tracked separately
   ========================================================= */

/* Read balance (safe) */
export async function getBalance(uid, asset) {
  try {
    const snap = await get(ref(db, `balances/${uid}/${asset}`));
    if (!snap.exists()) {
      return { available: 0, locked: 0 };
    }
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

/* Ensure balance node exists with defaults */
async function ensureBalance(uid, asset) {
  const balanceRef = ref(db, `balances/${uid}/${asset}`);
  const snap = await get(balanceRef);
  if (!snap.exists()) {
    await set(balanceRef, { available: 0, locked: 0 });
  }
}

/* =========================================================
   4. LEDGER
   Immutable audit log of every balance change
   /ledger/{uid}/{entryId}
   ========================================================= */
async function writeLedger(uid, asset, type, amount, balanceAfter, reference) {
  const entryRef = push(ref(db, `ledger/${uid}`));
  await set(entryRef, {
    asset,
    type,
    amount: toDecimal(amount),
    balanceAfter: toDecimal(balanceAfter),
    reference: reference || null,
    createdAt: Date.now()
  });
}

/* =========================================================
   5. ATOMIC BALANCE OPERATIONS
   Uses runTransaction to prevent race conditions
   ========================================================= */

/* Credit — add to available */
export async function creditBalance(uid, asset, amount, reason) {
  if (amount <= 0) throw new Error("Credit amount must be > 0");
  await ensureBalance(uid, asset);

  const balanceRef = ref(db, `balances/${uid}/${asset}`);
  const result = await runTransaction(balanceRef, (current) => {
    const bal = current || { available: 0, locked: 0 };
    return {
      available: toDecimal(Number(bal.available || 0) + Number(amount)),
      locked:    toDecimal(Number(bal.locked    || 0))
    };
  });

  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "credit", amount, newBal.available, reason);
  return newBal;
}

/* Debit — from available only */
export async function debitBalance(uid, asset, amount, reason) {
  if (amount <= 0) throw new Error("Debit amount must be > 0");
  await ensureBalance(uid, asset);

  const balanceRef = ref(db, `balances/${uid}/${asset}`);
  const result = await runTransaction(balanceRef, (current) => {
    const bal = current || { available: 0, locked: 0 };
    const avail = Number(bal.available) || 0;
    if (avail < amount) {
      /* Abort transaction → no change */
      return;
    }
    return {
      available: toDecimal(avail - Number(amount)),
      locked:    toDecimal(Number(bal.locked || 0))
    };
  });

  if (!result.committed) {
    throw new Error("Insufficient available balance");
  }

  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "debit", amount, newBal.available, reason);
  return newBal;
}

/* Lock — move from available to locked (for pending orders) */
export async function lockBalance(uid, asset, amount, reason) {
  if (amount <= 0) throw new Error("Lock amount must be > 0");
  await ensureBalance(uid, asset);

  const balanceRef = ref(db, `balances/${uid}/${asset}`);
  const result = await runTransaction(balanceRef, (current) => {
    const bal = current || { available: 0, locked: 0 };
    const avail = Number(bal.available) || 0;
    const locked = Number(bal.locked) || 0;
    if (avail < amount) return;
    return {
      available: toDecimal(avail - Number(amount)),
      locked:    toDecimal(locked + Number(amount))
    };
  });

  if (!result.committed) {
    throw new Error("Insufficient available balance to lock");
  }

  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "lock", amount, newBal.available, reason);
  return newBal;
}

/* Unlock — move from locked back to available (for cancellation) */
export async function unlockBalance(uid, asset, amount, reason) {
  if (amount <= 0) throw new Error("Unlock amount must be > 0");
  await ensureBalance(uid, asset);

  const balanceRef = ref(db, `balances/${uid}/${asset}`);
  const result = await runTransaction(balanceRef, (current) => {
    const bal = current || { available: 0, locked: 0 };
    const avail = Number(bal.available) || 0;
    const locked = Number(bal.locked) || 0;
    if (locked < amount) return;
    return {
      available: toDecimal(avail + Number(amount)),
      locked:    toDecimal(locked - Number(amount))
    };
  });

  if (!result.committed) {
    throw new Error("Insufficient locked balance to unlock");
  }

  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "unlock", amount, newBal.available, reason);
  return newBal;
}

/* Spend — remove from locked (order filled / fee taken) */
export async function spendLocked(uid, asset, amount, reason) {
  if (amount <= 0) throw new Error("Spend amount must be > 0");
  await ensureBalance(uid, asset);

  const balanceRef = ref(db, `balances/${uid}/${asset}`);
  const result = await runTransaction(balanceRef, (current) => {
    const bal = current || { available: 0, locked: 0 };
    const locked = Number(bal.locked) || 0;
    if (locked < amount) return;
    return {
      available: toDecimal(Number(bal.available) || 0),
      locked:    toDecimal(locked - Number(amount))
    };
  });

  if (!result.committed) {
    throw new Error("Insufficient locked balance to spend");
  }

  const newBal = result.snapshot.val() || { available: 0, locked: 0 };
  await writeLedger(uid, asset, "spend", amount, newBal.available, reason);
  return newBal;
}

/* =========================================================
   6. ORDER BOOK STRUCTURE
   /orderBook/{pair}/bids/{priceStr} = { totalQty, orders: {...} }
   /orderBook/{pair}/asks/{priceStr} = { ... }
   Price is stringified to avoid float key issues
   ========================================================= */

function priceKey(price) {
  return String(toDecimal(price));
}

/* Get current order book (top N levels) */
export async function getOrderBook(pair = DEFAULT_PAIR, depth = 15) {
  const [bidsSnap, asksSnap] = await Promise.all([
    get(ref(db, `orderBook/${pair}/bids`)),
    get(ref(db, `orderBook/${pair}/asks`))
  ]);

  const bids = [];
  const asks = [];

  if (bidsSnap.exists()) {
    const v = bidsSnap.val();
    Object.keys(v).forEach(priceStr => {
      bids.push({ price: Number(priceStr), totalQty: Number(v[priceStr].totalQty) || 0 });
    });
    bids.sort((a, b) => b.price - a.price);  // highest first
  }

  if (asksSnap.exists()) {
    const v = asksSnap.val();
    Object.keys(v).forEach(priceStr => {
      asks.push({ price: Number(priceStr), totalQty: Number(v[priceStr].totalQty) || 0 });
    });
    asks.sort((a, b) => a.price - b.price);  // lowest first
  }

  return {
    bids: bids.slice(0, depth),
    asks: asks.slice(0, depth)
  };
}

/* Get recent trades for a pair */
export async function getRecentTrades(pair = DEFAULT_PAIR, limit = 20) {
  const snap = await get(ref(db, `trades`));
  if (!snap.exists()) return [];

  const all = snap.val();
  const list = Object.values(all)
    .filter(t => t && t.pair === pair)
    .sort((a, b) => (b.executedAt || 0) - (a.executedAt || 0))
    .slice(0, limit);

  return list;
}

/* =========================================================
   7. PLACE ORDER
   ========================================================= */
export async function placeOrder({
  uid,
  pair = DEFAULT_PAIR,
  side,          // "buy" | "sell"
  type,          // "limit" | "market"  (market = instant at best price)
  price,         // number (required for limit, ignored for market)
  quantity       // number — base asset quantity (e.g. BTC amount)
}) {
  if (!uid) throw new Error("User not authenticated");
  if (!["buy", "sell"].includes(side)) throw new Error("Invalid side");
  if (!["limit", "market"].includes(type)) throw new Error("Invalid type");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Quantity must be greater than 0");
  }

  const [base, quote] = pair.replace("/", "").replace("USDT", "|USDT").split("|");
  // For BTCUSDT: base = BTC, quote = USDT
  const baseAsset = base;         // BTC
  const quoteAsset = quote || "USDT";

  /* Get best price for market orders */
  let orderPrice = price;
  if (type === "market") {
    const book = await getOrderBook(pair, 1);
    if (side === "buy") {
      if (!book.asks.length) throw new Error("No sell orders available");
      orderPrice = book.asks[0].price;
    } else {
      if (!book.bids.length) throw new Error("No buy orders available");
      orderPrice = book.bids[0].price;
    }
  }

  if (!Number.isFinite(orderPrice) || orderPrice <= 0) {
    throw new Error("Price must be greater than 0");
  }

  const cost = toDecimal(orderPrice * quantity);
  if (cost < MIN_ORDER_USD) {
    throw new Error(`Minimum order value is $${MIN_ORDER_USD}`);
  }

  /* --- LOCK BALANCE --- */
  if (side === "buy") {
    /* Lock quote asset (USDT) */
    const totalLock = toDecimal(cost * (1 + FEE_RATE));  // cost + fee
    await lockBalance(uid, quoteAsset, totalLock, `order_lock_buy_${pair}`);
  } else {
    /* Lock base asset (BTC) */
    await lockBalance(uid, baseAsset, quantity, `order_lock_sell_${pair}`);
  }

  /* --- CREATE ORDER --- */
  const ordersRef = ref(db, "orders");
  const newOrderRef = push(ordersRef);
  const orderId = newOrderRef.key;

  const orderData = {
    orderId,
    uid,
    pair,
    baseAsset,
    quoteAsset,
    side,
    type,
    price: toDecimal(orderPrice),
    quantity: toDecimal(quantity),
    filled: 0,
    remaining: toDecimal(quantity),
    status: "open",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await set(newOrderRef, orderData);

  /* Save to order book */
  const bookSide = side === "buy" ? "bids" : "asks";
  const bookPath = `orderBook/${pair}/${bookSide}/${priceKey(orderPrice)}`;
  const bookRef = ref(db, bookPath);
  await runTransaction(bookRef, (current) => {
    const c = current || { totalQty: 0, orders: {} };
    c.totalQty = toDecimal(Number(c.totalQty || 0) + quantity);
    c.orders = c.orders || {};
    c.orders[orderId] = {
      uid,
      qty: toDecimal(quantity),
      remaining: toDecimal(quantity),
      createdAt: Date.now()
    };
    return c;
  });

  /* Also index order for user */
  await set(ref(db, `users/${uid}/orders/${orderId}`), {
    orderId,
    pair,
    side,
    type,
    price: toDecimal(orderPrice),
    quantity: toDecimal(quantity),
    filled: 0,
    remaining: toDecimal(quantity),
    status: "open",
    createdAt: Date.now()
  });

  /* --- RUN MATCHING ENGINE --- */
  await runMatchingEngine(pair);

  /* Fetch final order state */
  const finalSnap = await get(ref(db, `orders/${orderId}`));
  return finalSnap.val();
}

/* =========================================================
   8. CANCEL ORDER
   ========================================================= */
export async function cancelOrder({ uid, orderId }) {
  const orderRef = ref(db, `orders/${orderId}`);
  const snap = await get(orderRef);
  if (!snap.exists()) throw new Error("Order not found");

  const order = snap.val();
  if (order.uid !== uid) throw new Error("Not your order");
  if (order.status === "filled" || order.status === "cancelled") {
    throw new Error("Order cannot be cancelled");
  }

  const remaining = Number(order.remaining) || 0;

  /* Unlock remaining balance */
  if (order.side === "buy") {
    /* Unlock USDT: remaining * price * (1+fee) */
    const unlockAmt = toDecimal(remaining * order.price * (1 + FEE_RATE));
    await unlockBalance(uid, order.quoteAsset, unlockAmt, `cancel_${orderId}`);
  } else {
    /* Unlock BTC */
    await unlockBalance(uid, order.baseAsset, remaining, `cancel_${orderId}`);
  }

  /* Update order status */
  await update(orderRef, {
    status: "cancelled",
    updatedAt: Date.now()
  });

  /* Remove from order book */
  const bookSide = order.side === "buy" ? "bids" : "asks";
  const bookPath = `orderBook/${order.pair}/${bookSide}/${priceKey(order.price)}`;
  const bookRef = ref(db, bookPath);
  await runTransaction(bookRef, (current) => {
    if (!current) return current;
    if (current.orders && current.orders[orderId]) {
      current.totalQty = toDecimal(Number(current.totalQty || 0) - remaining);
      delete current.orders[orderId];
    }
    if (current.totalQty <= 0.00000001) {
      /* Empty level — remove */
      return null;
    }
    return current;
  });

  /* Update user order index */
  await update(ref(db, `users/${uid}/orders/${orderId}`), {
    status: "cancelled",
    updatedAt: Date.now()
  });

  return { ok: true, orderId };
}

/* =========================================================
   9. MATCHING ENGINE
   Called after every new order.
   Matches highest bid vs lowest ask.
   ========================================================= */
async function runMatchingEngine(pair = DEFAULT_PAIR) {
  /* Load full order book sorted */
  const book = await loadFullBook(pair);

  let bestBid = book.bids[0] || null;   // highest price
  let bestAsk = book.asks[0] || null;   // lowest price

  let safety = 0;
  while (bestBid && bestAsk && bestBid.price >= bestAsk.price && safety < 100) {
    safety++;

    /* Find oldest order at this price level for both sides */
    const bidOrder = pickOldestOrder(bestBid.orders);
    const askOrder = pickOldestOrder(bestAsk.orders);

    if (!bidOrder || !askOrder) break;

    const tradePrice = toDecimal(bestAsk.price);  // Price = the resting (older) order's price
    /* Convention: price of the earlier order (maker) is used */

    /* Determine trade quantity = min of both remainings */
    const qty = Math.min(Number(bidOrder.remaining), Number(askOrder.remaining));
    if (qty <= 0) break;

    /* Execute trade */
    await executeTrade({
      pair,
      buyerOrderId: bidOrder.orderId,
      sellerOrderId: askOrder.orderId,
      buyerUid: bidOrder.uid,
      sellerUid: askOrder.uid,
      price: tradePrice,
      quantity: toDecimal(qty),
      baseAsset: pair.startsWith("BTC") ? "BTC" : pair.replace("USDT", ""),
      quoteAsset: "USDT"
    });

    /* Reload book for next iteration */
    const newBook = await loadFullBook(pair);
    bestBid = newBook.bids[0] || null;
    bestAsk = newBook.asks[0] || null;
  }
}

/* Load full book into memory */
async function loadFullBook(pair) {
  const [bidsSnap, asksSnap] = await Promise.all([
    get(ref(db, `orderBook/${pair}/bids`)),
    get(ref(db, `orderBook/${pair}/asks`))
  ]);

  const bids = [];
  const asks = [];

  if (bidsSnap.exists()) {
    const v = bidsSnap.val();
    Object.keys(v).forEach(p => {
      const level = v[p];
      if (!level.orders) return;
      Object.keys(level.orders).forEach(oid => {
        bids.push({
          price: Number(p),
          orderId: oid,
          uid: level.orders[oid].uid,
          remaining: Number(level.orders[oid].remaining) || 0,
          createdAt: level.orders[oid].createdAt || 0
        });
      });
    });
    bids.sort((a, b) => b.price - a.price || a.createdAt - b.createdAt);
  }

  if (asksSnap.exists()) {
    const v = asksSnap.val();
    Object.keys(v).forEach(p => {
      const level = v[p];
      if (!level.orders) return;
      Object.keys(level.orders).forEach(oid => {
        asks.push({
          price: Number(p),
          orderId: oid,
          uid: level.orders[oid].uid,
          remaining: Number(level.orders[oid].remaining) || 0,
          createdAt: level.orders[oid].createdAt || 0
        });
      });
    });
    asks.sort((a, b) => a.price - b.price || a.createdAt - b.createdAt);
  }

  return { bids, asks };
}

function pickOldestOrder(ordersObj) {
  let oldest = null;
  Object.keys(ordersObj).forEach(oid => {
    const o = ordersObj[oid];
    o.orderId = oid;
    if (!oldest || (o.createdAt || 0) < (oldest.createdAt || 0)) {
      oldest = o;
    }
  });
  return oldest;
}

/* =========================================================
   10. EXECUTE TRADE (atomic — both sides)
   ========================================================= */
async function executeTrade({
  pair, buyerOrderId, sellerOrderId,
  buyerUid, sellerUid,
  price, quantity, baseAsset, quoteAsset
}) {
  /* Calculate amounts */
  const cost = toDecimal(price * quantity);       // total quote (USDT)
  const buyerFee = toDecimal(cost * FEE_RATE);
  const sellerFee = toDecimal(cost * FEE_RATE);
  const sellerProceeds = toDecimal(cost - sellerFee);

  /* ---------- BUYER SIDE ---------- */
  /* Buyer already locked: cost + fee in USDT.
     Now spend (cost + fee) from locked. */
  await spendLocked(buyerUid, quoteAsset, toDecimal(cost + buyerFee), `trade_${buyerOrderId}`);

  /* Credit BTC to buyer's available */
  await creditBalance(buyerUid, baseAsset, quantity, `trade_${buyerOrderId}`);

  /* ---------- SELLER SIDE ---------- */
  /* Seller already locked: quantity in BTC.
     Spend quantity from locked. */
  await spendLocked(sellerUid, baseAsset, quantity, `trade_${sellerOrderId}`);

  /* Credit USDT (minus fee) to seller's available */
  await creditBalance(sellerUid, quoteAsset, sellerProceeds, `trade_${sellerOrderId}`);

  /* ---------- UPDATE ORDERS ---------- */
  await updateOrderAfterFill(buyerOrderId, quantity, pair, "buy", price);
  await updateOrderAfterFill(sellerOrderId, quantity, pair, "sell", price);

  /* ---------- SAVE TRADE ---------- */
  const tradeRef = push(ref(db, "trades"));
  const tradeId = tradeRef.key;
  await set(tradeRef, {
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
  });

  /* Save to both users' trade histories */
  await set(ref(db, `users/${buyerUid}/trades/${tradeId}`), {
    tradeId, pair, side: "buy", price, quantity, cost, fee: buyerFee, executedAt: Date.now()
  });
  await set(ref(db, `users/${sellerUid}/trades/${tradeId}`), {
    tradeId, pair, side: "sell", price, quantity, cost, fee: sellerFee, executedAt: Date.now()
  });
}

/* Update order status after a fill */
async function updateOrderAfterFill(orderId, qty, pair, side, price) {
  const orderRef = ref(db, `orders/${orderId}`);
  const result = await runTransaction(orderRef, (current) => {
    if (!current) return current;
    const filled = toDecimal(Number(current.filled || 0) + Number(qty));
    const remaining = toDecimal(Number(current.quantity) - filled);
    current.filled = filled;
    current.remaining = remaining < 0 ? 0 : remaining;
    current.status = remaining <= 0.00000001 ? "filled" : "partial";
    current.updatedAt = Date.now();
    return current;
  });

  const updated = result.snapshot.val();
  if (!updated) return;

  /* Sync user order index */
  await update(ref(db, `users/${updated.uid}/orders/${orderId}`), {
    filled: updated.filled,
    remaining: updated.remaining,
    status: updated.status,
    updatedAt: Date.now()
  });

  /* Update order book */
  const bookSide = side === "buy" ? "bids" : "asks";
  const bookRef = ref(db, `orderBook/${pair}/${bookSide}/${priceKey(price)}`);
  await runTransaction(bookRef, (current) => {
    if (!current || !current.orders) return current;
    if (current.orders[orderId]) {
      current.orders[orderId].remaining =
        toDecimal(Number(current.orders[orderId].remaining || 0) - Number(qty));
      current.totalQty =
        toDecimal(Number(current.totalQty || 0) - Number(qty));

      if (current.orders[orderId].remaining <= 0.00000001) {
        delete current.orders[orderId];
      }
    }

    /* Remove level if empty */
    const hasOrders = current.orders && Object.keys(current.orders).length > 0;
    if (!hasOrders || current.totalQty <= 0.00000001) {
      return null;
    }
    return current;
  });
}

/* =========================================================
   11. INITIALIZE — Create wallets on first order
   ========================================================= */
export async function ensureWallets(uid) {
  const assets = ["USDT", "BTC", "ETH", "XRP", "SOL", "BNB", "DOGE"];
  for (const asset of assets) {
    await ensureBalance(uid, asset);
  }
}

/* =========================================================
   12. EXPORT
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
  ensureWallets
};