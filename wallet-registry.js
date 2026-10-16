/* =========================================================
   Nexbit — Wallet Registry
   File: wallet-registry.js
   Version: 1.0

   PURPOSE:
   Manage BSC deposit addresses (public only) and assign
   a unique address to each user.

   ⚠⚠⚠  CRITICAL SECURITY NOTE  ⚠⚠⚠

   This file ONLY stores and assigns PUBLIC deposit addresses.
   It DOES NOT generate addresses and DOES NOT store any
   private keys or seed phrases.

   How to populate the pool (admin action, done once):
   1. Generate N addresses on a trusted wallet (MetaMask, Trust
      Wallet, Ledger, or an HD wallet you control).
   2. Export the public addresses (0x...) only.
   3. Save them securely — private keys must remain in a secure
      key-management system (HSM, hardware wallet, vault).
   4. Add the public addresses to Firebase under
      /depositAddressPool/{addressId} = { address, status, assignedTo }

   For production:
   - Move assignment logic to Cloud Functions
   - Backend must verify the incoming transfer on-chain
     before marking a deposit as credited (already handled
     in deposit.js for testing)
   - Consider dedicated wallet infrastructure
     (Blockradar, Fireblocks, Tatum, etc.)
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, get, set, update, runTransaction, push
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

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db  = getDatabase(app);

/* =========================================================
   2. ADMIN CONFIG
   =========================================================

   These are TEST addresses for internal testing ONLY.
   Replace with your own BSC addresses before any real use.

   Each address is a plain BSC wallet address — you can
   generate them from MetaMask / Trust Wallet for test.

   ⚠ DO NOT put private keys here. Only public addresses.
   ========================================================= */
const DEFAULT_POOL_ADDRESSES = [
  /* ⬇️ REPLACE THESE with your own BSC test addresses ⬇️ */
  "0xe757c330D267784F190e79e0Ec0dC5d30ad6eFA4"   // existing master wallet (as test)
  /* Add more like this: */
  // "0xabc123...",
  // "0xdef456..."
];

/* =========================================================
   3. PATHS
   ========================================================= */
const POOL_PATH     = "depositAddressPool";
const ASSIGNED_PATH = "userDepositAddresses";

/* =========================================================
   4. HELPERS
   ========================================================= */

/* Validate a BSC address (basic format check) */
function isValidBscAddress(addr) {
  if (typeof addr !== "string") return false;
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

/* Normalize address to lowercase for uniqueness checks */
function normalize(addr) {
  return String(addr || "").trim().toLowerCase();
}

/* =========================================================
   5. POOL INITIALIZATION (admin, run once)
   ========================================================= */
async function ensurePoolInitialized() {
  try {
    const snap = await get(ref(db, POOL_PATH));
    if (snap.exists()) return;   // already initialized

    console.log("[wallet-registry] Initializing pool…");

    const updates = {};
    DEFAULT_POOL_ADDRESSES.forEach((addr, i) => {
      if (!isValidBscAddress(addr)) {
        console.warn("[wallet-registry] Invalid address skipped:", addr);
        return;
      }
      const id = `addr_${String(i + 1).padStart(4, "0")}_${normalize(addr).slice(2, 10)}`;
      updates[`${POOL_PATH}/${id}`] = {
        address: addr,
        status: "available",      // available | assigned | disabled
        assignedTo: null,
        createdAt: Date.now()
      };
    });

    if (Object.keys(updates).length === 0) {
      console.warn("[wallet-registry] No valid addresses to add to pool.");
      return;
    }

    await update(ref(db), updates);
    console.log(`[wallet-registry] Pool initialized with ${Object.keys(updates).length} addresses.`);

  } catch (err) {
    console.error("[wallet-registry] Pool init failed:", err);
    throw err;
  }
}

/* =========================================================
   6. GET USER'S ASSIGNED ADDRESS
   ========================================================= */
async function getUserAddress(uid) {
  if (!uid) return null;

  try {
    const snap = await get(ref(db, `${ASSIGNED_PATH}/${uid}/BSC_USDT`));
    if (!snap.exists()) return null;

    const v = snap.val();
    if (!isValidBscAddress(v.address)) return null;

    return v.address;

  } catch (err) {
    console.warn("[wallet-registry] getUserAddress failed:", err);
    return null;
  }
}

/* =========================================================
   7. ASSIGN A NEW ADDRESS (atomic + unique)
   ========================================================= */
async function assignAddress(uid) {
  if (!uid) throw new Error("uid required");

  /* If already assigned, return existing */
  const existing = await getUserAddress(uid);
  if (existing) return existing;

  /* Ensure pool is initialized */
  await ensurePoolInitialized();

  /* Find first available address */
  const poolSnap = await get(ref(db, POOL_PATH));
  if (!poolSnap.exists()) {
    throw new Error("Address pool empty. Ask admin to populate it.");
  }

  const pool = poolSnap.val();
  const availableEntries = Object.entries(pool)
    .filter(([id, v]) => v && v.status === "available" && isValidBscAddress(v.address))
    .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));

  if (availableEntries.length === 0) {
    throw new Error("No deposit addresses available. Please contact support.");
  }

  /* Atomic claim of the first available address */
  for (const [addrId, entry] of availableEntries) {
    try {
      const addrRef = ref(db, `${POOL_PATH}/${addrId}`);
      let claimed = false;

      const result = await runTransaction(addrRef, (current) => {
        if (!current) return current;
        if (current.status !== "available") return current;   // abort
        claimed = true;
        return {
          ...current,
          status: "assigned",
          assignedTo: uid,
          assignedAt: Date.now()
        };
      });

      if (claimed && result.committed) {
        /* Save user's mapping */
        const record = {
          address: entry.address,
          network: "BSC",
          asset: "USDT",
          addressId: addrId,
          createdAt: Date.now(),
          status: "active"
        };

        await set(ref(db, `${ASSIGNED_PATH}/${uid}/BSC_USDT`), record);

        console.log(`[wallet-registry] Assigned ${entry.address} to ${uid}`);
        return entry.address;
      }
    } catch (err) {
      /* This address was claimed by someone else — try next */
      console.warn(`[wallet-registry] Claim attempt failed for ${addrId}:`, err.message);
    }
  }

  throw new Error("Unable to assign deposit address. Try again later.");
}

/* =========================================================
   8. ADMIN HELPERS
   ========================================================= */

/* Get pool stats (admin) */
async function getPoolStats() {
  try {
    const snap = await get(ref(db, POOL_PATH));
    if (!snap.exists()) return { total: 0, available: 0, assigned: 0, disabled: 0 };

    const pool = snap.val();
    let available = 0, assigned = 0, disabled = 0;

    Object.values(pool).forEach(v => {
      if (!v) return;
      if (v.status === "available") available++;
      else if (v.status === "assigned") assigned++;
      else if (v.status === "disabled") disabled++;
    });

    return {
      total: available + assigned + disabled,
      available, assigned, disabled
    };
  } catch (err) {
    console.error("[wallet-registry] getPoolStats failed:", err);
    return { total: 0, available: 0, assigned: 0, disabled: 0 };
  }
}

/* Add a single address to the pool (admin) */
async function addAddressToPool(address) {
  if (!isValidBscAddress(address)) {
    throw new Error("Invalid BSC address format");
  }

  /* Check if already in pool */
  const snap = await get(ref(db, POOL_PATH));
  if (snap.exists()) {
    const exists = Object.values(snap.val()).some(
      v => v && normalize(v.address) === normalize(address)
    );
    if (exists) {
      throw new Error("Address already in pool");
    }
  }

  const id = `addr_${Date.now()}_${normalize(address).slice(2, 10)}`;
  await set(ref(db, `${POOL_PATH}/${id}`), {
    address,
    status: "available",
    assignedTo: null,
    createdAt: Date.now()
  });

  return id;
}

/* =========================================================
   9. EXPORT
   ========================================================= */
export default {
  ensurePoolInitialized,
  getUserAddress,
  assignAddress,
  getPoolStats,
  addAddressToPool,
  isValidBscAddress
};