/* =========================================================
   Nexbit — Wallet Registry
   File: wallet-registry.js
   Version: 1.1 (Race-safe assignment)

   CHANGES in v1.1:
   - Fixed race condition in assignAddress()
   - Uses result.committed as the only source of truth
   - Validates uniqueness before claim
   - Better error logging
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, get, set, update, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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

/* ⚠ Replace with your own BSC addresses before real use */
const DEFAULT_POOL_ADDRESSES = [
  "0xe757c330D267784F190e79e0Ec0dC5d30ad6eFA4"
  /* Add more addresses here for testing multi-user */
];

const POOL_PATH     = "depositAddressPool";
const ASSIGNED_PATH = "userDepositAddresses";

/* =========================================================
   HELPERS
   ========================================================= */
function isValidBscAddress(addr) {
  return typeof addr === "string" && /^0x[a-fA-F0-9]{40}$/.test(addr);
}
function normalize(addr) {
  return String(addr || "").trim().toLowerCase();
}

/* =========================================================
   POOL INIT
   ========================================================= */
async function ensurePoolInitialized() {
  try {
    const snap = await get(ref(db, POOL_PATH));
    if (snap.exists()) return;

    console.log("[wallet-registry] Initializing pool…");
    const updates = {};

    for (let i = 0; i < DEFAULT_POOL_ADDRESSES.length; i++) {
      const addr = DEFAULT_POOL_ADDRESSES[i];
      if (!isValidBscAddress(addr)) {
        console.warn("[wallet-registry] Invalid address skipped:", addr);
        continue;
      }
      const id = `addr_${String(i + 1).padStart(4, "0")}_${normalize(addr).slice(2, 10)}`;
      updates[`${POOL_PATH}/${id}`] = {
        address: addr,
        status: "available",
        assignedTo: null,
        createdAt: Date.now()
      };
    }

    if (Object.keys(updates).length === 0) {
      console.warn("[wallet-registry] No valid addresses to add.");
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
   GET USER ADDRESS
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
   ASSIGN ADDRESS (RACE-SAFE)
   
   Strategy:
   1. Check if user has address → return existing
   2. Ensure pool initialized
   3. Find first available
   4. Atomic claim: runTransaction on the pool entry
   5. Only trust result.committed — NOT local boolean
   6. If committed: write user mapping, return
   7. If not committed: try next address
   ========================================================= */
async function assignAddress(uid) {
  if (!uid) throw new Error("uid required");

  /* Existing assignment? */
  const existing = await getUserAddress(uid);
  if (existing) return existing;

  /* Pool ready? */
  await ensurePoolInitialized();

  const poolSnap = await get(ref(db, POOL_PATH));
  if (!poolSnap.exists()) {
    throw new Error("Address pool empty. Ask admin to populate it.");
  }

  const pool = poolSnap.val();
  const available = Object.entries(pool)
    .filter(([id, v]) => v && v.status === "available" && isValidBscAddress(v.address))
    .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));

  if (available.length === 0) {
    throw new Error("No deposit addresses available. Please contact support.");
  }

  /* Try each available address in order */
  for (const [addrId, entry] of available) {
    try {
      const addrRef = ref(db, `${POOL_PATH}/${addrId}`);

      /* Atomic claim — committed is the source of truth */
      const claim = await runTransaction(addrRef, (current) => {
        if (!current) return current;                         // missing → abort
        if (current.status !== "available") return current;   // taken → abort
        if (current.assignedTo && current.assignedTo !== uid) return current;
        return {
          ...current,
          status: "assigned",
          assignedTo: uid,
          assignedAt: Date.now()
        };
      });

      /* Only proceed if transaction actually committed */
      if (claim.committed) {
        const finalVal = claim.snapshot.val();
        /* Double-check that WE hold the claim */
        if (finalVal && finalVal.assignedTo === uid) {
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
      }

      /* Not committed or someone else won — try next */
      console.log(`[wallet-registry] Address ${addrId} not claimable, trying next…`);
    } catch (err) {
      console.warn(`[wallet-registry] Claim attempt failed for ${addrId}:`, err.message);
    }
  }

  throw new Error("Unable to assign deposit address. Try again later.");
}

/* =========================================================
   ADMIN HELPERS
   ========================================================= */
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
    return { total: available + assigned + disabled, available, assigned, disabled };
  } catch (err) {
    console.error("[wallet-registry] getPoolStats failed:", err);
    return { total: 0, available: 0, assigned: 0, disabled: 0 };
  }
}

async function addAddressToPool(address) {
  if (!isValidBscAddress(address)) throw new Error("Invalid BSC address format");
  const snap = await get(ref(db, POOL_PATH));
  if (snap.exists()) {
    const exists = Object.values(snap.val()).some(
      v => v && normalize(v.address) === normalize(address)
    );
    if (exists) throw new Error("Address already in pool");
  }
  const id = `addr_${Date.now()}_${normalize(address).slice(2, 10)}`;
  await set(ref(db, `${POOL_PATH}/${id}`), {
    address, status: "available", assignedTo: null, createdAt: Date.now()
  });
  return id;
}

export default {
  ensurePoolInitialized,
  getUserAddress,
  assignAddress,
  getPoolStats,
  addAddressToPool,
  isValidBscAddress
};
