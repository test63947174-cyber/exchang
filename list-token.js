/* =========================================================
   Nexbit — List Token Page
   File: list-token.js
   Features: Token submission with social links, logo,
             website, and tracking on dashboard
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, push, set }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getAnalytics }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

/* ---------- Firebase Config ---------- */
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

const app       = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth      = getAuth(app);
const db        = getDatabase(app);
const storage   = getStorage(app);

/* =========================================================
   SIDEBAR TOGGLE
   ========================================================= */
window.toggleSidebar = () => {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("sidebarOverlay").classList.toggle("show");
};
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebarOverlay").classList.remove("show");
  }
});

/* =========================================================
   TOAST
   ========================================================= */
function showToast(msg, ok = true) {
  const t = document.getElementById("toast");
  document.getElementById("toastMsg").textContent = msg;
  t.style.borderColor = ok ? "var(--success)" : "var(--danger)";
  t.style.boxShadow = ok
    ? "0 0 30px rgba(0,255,163,0.4)"
    : "0 0 30px rgba(255,77,109,0.4)";
  const c = t.querySelector(".check");
  c.style.background = ok ? "var(--success)" : "var(--danger)";
  c.textContent = ok ? "✓" : "✕";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}

/* =========================================================
   LOGOUT
   ========================================================= */
window.logoutUser = async (e) => {
  if (e) e.preventDefault();
  try {
    await signOut(auth);
    localStorage.removeItem("Nexbit_User");
    window.location.href = "index.html";
  } catch { showToast("Logout failed", false); }
};

/* =========================================================
   AUTH GUARD + NAVBAR
   ========================================================= */
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  const name = user.displayName || "Trader";
  const first = name.split(" ")[0];
  document.getElementById("userName").textContent = first;
  document.getElementById("userAvatar").textContent = first.charAt(0).toUpperCase();
});

/* =========================================================
   LOGO PREVIEW
   ========================================================= */
const logoInput = document.getElementById("tokenLogo");
const logoPreview = document.getElementById("logoPreview");

if (logoInput) {
  logoInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast("Logo must be under 2MB", false);
      logoInput.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      logoPreview.innerHTML = `<img src="${ev.target.result}" alt="logo" />`;
    };
    reader.readAsDataURL(file);
  });
}

/* =========================================================
   URL VALIDATION HELPERS
   ========================================================= */
function isValidURL(str) {
  if (!str) return true;
  try { new URL(str); return true; } catch { return false; }
}
function isValidTwitter(str) {
  if (!str) return true;
  return /^https?:\/\/(www\.)?(twitter|x)\.com\/[A-Za-z0-9_]{1,15}/.test(str);
}
function isValidTelegram(str) {
  if (!str) return true;
  return /^https?:\/\/(www\.)?t\.me\/[A-Za-z0-9_]{4,32}/.test(str);
}
function isValidDiscord(str) {
  if (!str) return true;
  return /^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9]+/.test(str);
}

/* =========================================================
   UPLOAD LOGO TO FIREBASE STORAGE
   ========================================================= */
async function uploadLogo(file, uid) {
  if (!file) return "";
  const ext = file.name.split(".").pop().toLowerCase();
  const path = `token-logos/${uid}/${Date.now()}.${ext}`;
  const sRef = storageRef(storage, path);
  await uploadBytes(sRef, file);
  return await getDownloadURL(sRef);
}

/* =========================================================
   SUBMIT FORM
   ========================================================= */
document.getElementById("listForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = auth.currentUser;
  if (!user) { showToast("Please log in first.", false); return; }

  // --- Collect form data ---
  const name     = document.getElementById("tokenName").value.trim();
  const symbol   = document.getElementById("tokenSymbol").value.trim().toUpperCase();
  const price    = parseFloat(document.getElementById("tokenPrice").value) || 0;
  const supply   = parseInt(document.getElementById("tokenSupply").value) || 0;
  const network  = document.getElementById("tokenNetwork").value;
  const contract = document.getElementById("tokenContract").value.trim();
  const website  = document.getElementById("tokenWebsite").value.trim();
  const twitter  = document.getElementById("tokenTwitter").value.trim();
  const telegram = document.getElementById("tokenTelegram").value.trim();
  const discord  = document.getElementById("tokenDiscord").value.trim();
  const desc     = document.getElementById("tokenDesc").value.trim();
  const logoFile = document.getElementById("tokenLogo")?.files[0] || null;

  // --- Validation ---
  if (!name || name.length < 2) {
    showToast("Token name must be at least 2 characters.", false); return;
  }
  if (!symbol || symbol.length < 2 || symbol.length > 10) {
    showToast("Symbol must be 2-10 characters.", false); return;
  }
  if (price <= 0) {
    showToast("Initial price must be greater than 0.", false); return;
  }
  if (supply <= 0) {
    showToast("Total supply must be greater than 0.", false); return;
  }
  if (!network) {
    showToast("Please select a blockchain network.", false); return;
  }
  if (!contract || contract.length < 10) {
    showToast("Please enter a valid contract address.", false); return;
  }
  if (!desc || desc.length < 30) {
    showToast("Description must be at least 30 characters.", false); return;
  }
  if (website && !isValidURL(website)) {
    showToast("Website URL is not valid.", false); return;
  }
  if (twitter && !isValidTwitter(twitter)) {
    showToast("Twitter URL should be like https://twitter.com/username", false); return;
  }
  if (telegram && !isValidTelegram(telegram)) {
    showToast("Telegram URL should be like https://t.me/yourchannel", false); return;
  }
  if (discord && !isValidDiscord(discord)) {
    showToast("Discord invite URL is not valid.", false); return;
  }

  const btn = document.getElementById("submitBtn");
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "Submitting…";

  try {
    // --- Upload logo (optional) ---
    let logoURL = "";
    if (logoFile) {
      btn.textContent = "Uploading logo…";
      try {
        logoURL = await uploadLogo(logoFile, user.uid);
      } catch (logoErr) {
        console.warn("Logo upload failed, continuing without logo:", logoErr);
        logoURL = "";
      }
    }

    // --- Build data object ---
    btn.textContent = "Saving…";
    const data = {
      ownerUid:    user.uid,
      ownerEmail:  user.email,
      ownerName:   user.displayName || "",
      name,
      symbol,
      price,
      supply,
      network,
      contract,
      website,
      social: {
        twitter:  twitter  || "",
        telegram: telegram || "",
        discord:  discord  || ""
      },
      description: desc,
      logo: logoURL,
      status:      "pending",
      submittedAt: new Date().toISOString()
    };

    // --- Save under /tokenListings (public list) ---
    const newRef = push(ref(db, "tokenListings"));
    await set(newRef, data);

    // --- Also save under /users/{uid}/myTokens for quick lookup ---
    await set(ref(db, `users/${user.uid}/myTokens/${newRef.key}`), {
      tokenId:     newRef.key,
      name,
      symbol,
      status:      "pending",
      logo:        logoURL,
      submittedAt: data.submittedAt
    });

    showToast("🎉 Token submitted successfully! Under review.", true);

    // Reset form
    document.getElementById("listForm").reset();
    if (logoPreview) {
      logoPreview.innerHTML = `<span style="font-size:1.8rem;">🪙</span>`;
    }

    // Redirect to dashboard after 2.2 seconds
    setTimeout(() => {
      window.location.href = "dashboard.html";
    }, 2200);

  } catch (err) {
    console.error("Token submission error:", err);
    showToast(err.message || "Submission failed. Try again.", false);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});
