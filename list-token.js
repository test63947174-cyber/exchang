/* =========================================================
   Nexbit — List Token Page
   File: list-token.js
   Version: 2.0 (Developer Instructions compliant)

   Improvements:
   - No duplicate Firebase init (safe-guarded)
   - Strict file type & size validation (PNG/JPG/WebP only)
   - Contract address format validation per network
   - Symbol uppercase-only validation
   - Multi-location atomic update for tokenListings + myTokens
   - Duplicate-submission guard
   - Real progress based on actual steps
   - Form data preserved on failure
   - Success message only after DB write confirmed
   - Reference price clearly labelled (not verified market price)
   - XSS-safe preview & rendering
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, ref, push, set, update
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  getStorage, ref as storageRef,
  uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getAnalytics, isSupported as analyticsSupported }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

/* =========================================================
   1. FIREBASE CONFIGURATION (unchanged)
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

/* ---------- Safe-guarded Firebase init (no double init) ---------- */
const app     = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getDatabase(app);
const storage = getStorage(app);

/* Analytics is optional; ignore failures silently */
analyticsSupported()
  .then(supported => { if (supported) getAnalytics(app); })
  .catch(() => {});

/* =========================================================
   2. CONFIG CONSTANTS
   ========================================================= */
const LOGO_KEY = "Nexbit_TokenLogo";

const ALLOWED_LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp"
];
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

/* Contract address format regex per network.
   NOTE: This checks FORMAT ONLY — not contract existence. */
const NETWORK_ADDRESS_REGEX = {
  ethereum: /^0x[a-fA-F0-9]{40}$/,
  bsc:      /^0x[a-fA-F0-9]{40}$/,
  polygon:  /^0x[a-fA-F0-9]{40}$/,
  base:     /^0x[a-fA-F0-9]{40}$/,
  arbitrum: /^0x[a-fA-F0-9]{40}$/,
  tron:     /^T[a-zA-Z0-9]{33}$/,
  solana:   /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  other:    /^.{10,100}$/  // permissive for unknown
};

/* =========================================================
   3. SAFE HELPERS
   ========================================================= */
function getElement(id) { return document.getElementById(id); }

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
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
   4. SIDEBAR + LOGOUT
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
   5. AUTH GUARD + NAVBAR
   ========================================================= */
let currentUser = null;
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUser = user;
  const name  = user.displayName || "Trader";
  const first = name.split(" ")[0];
  const un = getElement("userName");
  const ua = getElement("userAvatar");
  if (un) un.textContent = first;
  if (ua) ua.textContent = first.charAt(0).toUpperCase();
});

/* =========================================================
   6. LOGO PICKER (strict type & size)
   ========================================================= */
const logoInput   = getElement("tokenLogo");
const logoPreview = getElement("logoPreview");

/* Restore saved logo (safe: data URLs only, no raw HTML) */
(function restoreLogo() {
  try {
    const saved = localStorage.getItem(LOGO_KEY);
    if (saved && saved.startsWith("data:image/") && logoPreview) {
      const img = document.createElement("img");
      img.src = saved;
      img.alt = "Token logo";
      logoPreview.replaceChildren(img);
    }
  } catch (_) {}
})();

if (logoInput) {
  logoInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      showToast("Only PNG, JPG or WebP allowed.", false);
      logoInput.value = "";
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      showToast("Logo must be under 2 MB.", false);
      logoInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      try {
        localStorage.setItem(LOGO_KEY, dataUrl);
      } catch (err) {
        console.warn("localStorage save failed:", err);
      }
      if (logoPreview) {
        const img = document.createElement("img");
        img.src = dataUrl;
        img.alt = "Token logo";
        logoPreview.replaceChildren(img);
      }
      showToast("✅ Logo ready", true);
    };
    reader.onerror = () => showToast("Could not read logo file.", false);
    reader.readAsDataURL(file);
  });
}

/* =========================================================
   7. SOCIAL NORMALIZERS
   ========================================================= */
function normalizeTwitter(input) {
  if (!input) return "";
  input = input.trim();
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) return input;
  if (input.startsWith("@")) return "https://twitter.com/" + input.slice(1);
  return "https://twitter.com/" + input;
}

function normalizeTelegram(input) {
  if (!input) return "";
  input = input.trim();
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) return input;
  if (input.startsWith("@")) return "https://t.me/" + input.slice(1);
  return "https://t.me/" + input;
}

function normalizeWebsite(input) {
  if (!input) return "";
  input = input.trim();
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) return input;
  return "https://" + input;
}

/* =========================================================
   8. UPLOAD LOGO TO FIREBASE STORAGE
   ========================================================= */
async function uploadLogo(file, uid) {
  if (!file) return "";
  const extMap = {
    "image/png":  "png",
    "image/jpeg": "jpg",
    "image/jpg":  "jpg",
    "image/webp": "webp"
  };
  const ext  = extMap[file.type] || "bin";
  const path = `token-logos/${uid}/${Date.now()}.${ext}`;
  const sRef = storageRef(storage, path);
  await uploadBytes(sRef, file, { contentType: file.type });
  return await getDownloadURL(sRef);
}

/* =========================================================
   9. DATA URL → FILE
   ========================================================= */
function dataURLtoFile(dataUrl, filename) {
  const arr  = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

/* =========================================================
   10. PROGRESS BAR HELPERS
   ========================================================= */
const progressWrap    = getElement("progressWrap");
const progressFill    = getElement("progressFill");
const progressPercent = getElement("progressPercent");
const progressStatus  = getElement("progressStatus");
const step1 = getElement("step1");
const step2 = getElement("step2");
const step3 = getElement("step3");

function setProgress(percent, status) {
  if (!progressFill) return;
  progressFill.style.width = percent + "%";
  if (progressPercent) progressPercent.textContent = Math.round(percent) + "%";
  if (status && progressStatus) progressStatus.textContent = status;
}

function markStep(el, state) {
  if (!el) return;
  el.classList.remove("active", "done");
  if (state === "active") el.classList.add("active");
  if (state === "done")   el.classList.add("done");
}

function resetSteps() {
  [step1, step2, step3].forEach(s => s?.classList.remove("active", "done"));
}

/* =========================================================
   11. VALIDATION
   ========================================================= */
function validateInputs({ name, symbol, price, supply, network, contract, desc }) {
  if (!name || name.length < 2 || name.length > 80) {
    return "Token name must be 2–80 characters.";
  }
  if (!symbol || !/^[A-Z0-9]{2,10}$/.test(symbol)) {
    return "Symbol must be 2–10 uppercase letters or numbers.";
  }
  if (!Number.isFinite(price) || price <= 0) {
    return "Initial reference price must be a positive number.";
  }
  if (!Number.isInteger(supply) || supply <= 0) {
    return "Total supply must be a positive whole number.";
  }
  if (!network) {
    return "Please select a blockchain network.";
  }
  const regex = NETWORK_ADDRESS_REGEX[network] || NETWORK_ADDRESS_REGEX.other;
  if (!regex.test(contract)) {
    return "Contract address does not match the selected network format.";
  }
  if (!desc || desc.length < 30 || desc.length > 2000) {
    return "Description must be 30–2000 characters.";
  }
  return null;
}

/* =========================================================
   12. SUBMIT FORM
   ========================================================= */
let isSubmitting = false; // duplicate-submission guard

document.getElementById("listForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  if (isSubmitting) return;                 // prevents double-click duplicates
  if (!currentUser) {
    showToast("Please log in first.", false);
    return;
  }

  /* ---------- Collect ---------- */
  const name     = getElement("tokenName").value.trim();
  const symbol   = getElement("tokenSymbol").value.trim().toUpperCase();
  const price    = parseFloat(getElement("tokenPrice").value);
  const supply   = parseInt(getElement("tokenSupply").value, 10);
  const network  = getElement("tokenNetwork").value;
  const contract = getElement("tokenContract").value.trim();
  const website  = getElement("tokenWebsite").value.trim();
  const twitter  = getElement("tokenTwitter").value.trim();
  const telegram = getElement("tokenTelegram").value.trim();
  const desc     = getElement("tokenDesc").value.trim();
  const logoFile = getElement("tokenLogo")?.files[0] || null;

  /* ---------- Validate ---------- */
  const validationError = validateInputs({
    name, symbol, price, supply, network, contract, desc
  });
  if (validationError) { showToast(validationError, false); return; }

  /* ---------- Normalize socials ---------- */
  const websiteFinal  = normalizeWebsite(website);
  const twitterFinal  = normalizeTwitter(twitter);
  const telegramFinal = normalizeTelegram(telegram);

  /* ---------- Lock UI ---------- */
  isSubmitting = true;
  const btn     = getElement("submitBtn");
  const origTxt = btn.textContent;
  btn.disabled    = true;
  btn.textContent = "Submitting…";

  progressWrap?.classList.add("show");
  resetSteps();
  setProgress(0, "Starting…");
  progressWrap?.scrollIntoView({ behavior: "smooth", block: "center" });

  let logoURL = "";

  try {
    /* ---------- STEP 1: Logo Upload ---------- */
    markStep(step1, "active");
    setProgress(10, "Preparing logo…");

    let logoToUpload = logoFile;
    if (!logoToUpload) {
      const saved = localStorage.getItem(LOGO_KEY);
      if (saved && saved.startsWith("data:image/")) {
        try {
          logoToUpload = dataURLtoFile(saved, `logo_${Date.now()}.png`);
        } catch (err) {
          console.warn("Saved logo conversion failed:", err);
        }
      }
    }

    if (logoToUpload) {
      /* Validate saved logo again (it might have been tampered in localStorage) */
      if (!ALLOWED_LOGO_TYPES.includes(logoToUpload.type) ||
          logoToUpload.size > MAX_LOGO_BYTES) {
        throw new Error("Logo file type or size is invalid.");
      }
      try {
        setProgress(25, "Uploading logo…");
        logoURL = await uploadLogo(logoToUpload, currentUser.uid);
        setProgress(45, "Logo uploaded ✓");
      } catch (logoErr) {
        /* Per instruction: DO NOT show false success on upload failure */
        console.error("Logo upload failed:", logoErr);
        throw new Error("Logo upload failed. Please try again.");
      }
    } else {
      setProgress(45, "No logo selected");
    }
    markStep(step1, "done");

    /* ---------- STEP 2: Save to Database ---------- */
    markStep(step2, "active");
    setProgress(55, "Saving token data…");

    const submittedAt = new Date().toISOString();

    const listingPayload = {
      ownerUid:    currentUser.uid,          // rules will verify against auth.uid
      ownerEmail:  currentUser.email || "",
      ownerName:   currentUser.displayName || "",
      name,
      symbol,
      /* Reframed: this is the user-declared reference price,
         NOT a verified market price. */
      referencePrice:       price,
      referencePriceLabel:  "user-provided-reference-price",
      supply,
      network,
      contract,
      website:  websiteFinal,
      social: {
        twitter:  twitterFinal,
        telegram: telegramFinal
      },
      description: desc,
      logo: logoURL,
      status: "pending",
      submittedAt
    };

    const myTokenSummary = {
      tokenId:     "",     // filled below
      name,
      symbol,
      status:      "pending",
      logo:        logoURL,
      submittedAt
    };

    /* Push into tokenListings to obtain the ID, then write both
       records in a single atomic multi-location update. */
    const newListingRef = push(ref(db, "tokenListings"));
    const listingId     = newListingRef.key;

    myTokenSummary.tokenId = listingId;

    const updates = {};
    updates[`/tokenListings/${listingId}`]          = listingPayload;
    updates[`/users/${currentUser.uid}/myTokens/${listingId}`] = myTokenSummary;

    await update(ref(db), updates);   // ✅ atomic multi-location write

    setProgress(90, "Saved to account");
    markStep(step2, "done");

    /* ---------- STEP 3: Success ---------- */
    markStep(step3, "active");
    setProgress(100, "Success! Redirecting…");
    markStep(step3, "done");

    /* Clear logo cache */
    try { localStorage.removeItem(LOGO_KEY); } catch (_) {}

    /* Reset form */
    document.getElementById("listForm").reset();
    if (logoPreview) {
      const emoji = document.createElement("span");
      emoji.style.fontSize = "1.8rem";
      emoji.textContent = "🪙";
      logoPreview.replaceChildren(emoji);
    }

    /* Success message only AFTER DB write is confirmed */
    showToast("🎉 Token submitted successfully! Under review.", true);

    setTimeout(() => {
      window.location.href = "dashboard.html";
    }, 1600);

  } catch (err) {
    console.error("Token submission error:", err);
    showToast(err.message || "Submission failed. Please try again.", false);
    setProgress(0, "Failed ❌");
    progressWrap?.classList.remove("show");
    resetSteps();
    /* Form data is preserved — user does NOT lose what they typed */
  } finally {
    isSubmitting  = false;
    btn.disabled  = false;
    btn.textContent = origTxt;
  }
});
