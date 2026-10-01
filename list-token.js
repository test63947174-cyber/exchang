/* =========================================================
   Nexbit — List Token Page
   File: list-token.js
   Features:
   - Flexible Twitter/Telegram input (@username OR URL)
   - Logo saved to localStorage before upload
   - Live progress bar during submission
   - Auto-redirect to dashboard
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
   LOGO PICKER — Save to localStorage
   ========================================================= */
const logoInput   = document.getElementById("tokenLogo");
const logoPreview = document.getElementById("logoPreview");
const LOGO_KEY    = "Nexbit_TokenLogo";

// Restore saved logo on page load
(function restoreLogo() {
  const saved = localStorage.getItem(LOGO_KEY);
  if (saved && logoPreview) {
    logoPreview.innerHTML = `<img src="${saved}" alt="logo" />`;
  }
})();

if (logoInput) {
  logoInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      showToast("Logo must be under 2MB", false);
      logoInput.value = "";
      return;
    }
    if (!file.type.startsWith("image/")) {
      showToast("Please select an image file", false);
      logoInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;

      // ✅ Save to localStorage (so it persists if page reloads)
      try {
        localStorage.setItem(LOGO_KEY, dataUrl);
        console.log("✅ Logo saved to localStorage");
      } catch (err) {
        console.warn("localStorage full or unavailable:", err);
      }

      // Show preview
      logoPreview.innerHTML = `<img src="${dataUrl}" alt="logo" />`;
      showToast("✅ Logo ready", true);
    };
    reader.readAsDataURL(file);
  });
}

/* =========================================================
   SOCIAL HANDLE NORMALIZERS
   अगर user @username दे या link दे — दोनों accept करें
   ========================================================= */
function normalizeTwitter(input) {
  if (!input) return "";
  input = input.trim();
  if (!input) return "";

  // अगर पहले से URL है
  if (/^https?:\/\//i.test(input)) return input;

  // अगर @ से शुरू होता है
  if (input.startsWith("@")) {
    return "https://twitter.com/" + input.slice(1);
  }

  // अगर सिर्फ़ username है
  return "https://twitter.com/" + input;
}

function normalizeTelegram(input) {
  if (!input) return "";
  input = input.trim();
  if (!input) return "";

  // अगर पहले से URL है
  if (/^https?:\/\//i.test(input)) return input;

  // अगर @ से शुरू होता है
  if (input.startsWith("@")) {
    return "https://t.me/" + input.slice(1);
  }

  // अगर सिर्फ़ username है
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
   DATA URL → FILE (localStorage से Firebase Storage भेजने के लिए)
   ========================================================= */
function dataURLtoFile(dataUrl, filename) {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

/* =========================================================
   PROGRESS BAR HELPERS
   ========================================================= */
const progressWrap    = document.getElementById("progressWrap");
const progressFill    = document.getElementById("progressFill");
const progressPercent = document.getElementById("progressPercent");
const progressStatus  = document.getElementById("progressStatus");
const step1 = document.getElementById("step1");
const step2 = document.getElementById("step2");
const step3 = document.getElementById("step3");

function setProgress(percent, status) {
  progressFill.style.width = percent + "%";
  progressPercent.textContent = Math.round(percent) + "%";
  if (status) progressStatus.textContent = status;
}

function markStep(stepEl, state) {
  stepEl.classList.remove("active", "done");
  if (state === "active") stepEl.classList.add("active");
  if (state === "done")   stepEl.classList.add("done");
}

function resetSteps() {
  [step1, step2, step3].forEach(s => s.classList.remove("active", "done"));
}

/* =========================================================
   SUBMIT FORM
   ========================================================= */
document.getElementById("listForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const user = auth.currentUser;
  if (!user) { showToast("Please log in first.", false); return; }

  // --- Collect ---
  const name     = document.getElementById("tokenName").value.trim();
  const symbol   = document.getElementById("tokenSymbol").value.trim().toUpperCase();
  const price    = parseFloat(document.getElementById("tokenPrice").value) || 0;
  const supply   = parseInt(document.getElementById("tokenSupply").value) || 0;
  const network  = document.getElementById("tokenNetwork").value;
  const contract = document.getElementById("tokenContract").value.trim();
  const website  = document.getElementById("tokenWebsite").value.trim();
  const twitter  = document.getElementById("tokenTwitter").value.trim();
  const telegram = document.getElementById("tokenTelegram").value.trim();
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

  // --- Normalize socials (flexible: @username or URL) ---
  const websiteFinal  = normalizeWebsite(website);
  const twitterFinal  = normalizeTwitter(twitter);
  const telegramFinal = normalizeTelegram(telegram);

  const btn = document.getElementById("submitBtn");
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "Submitting…";

  // Show progress bar
  progressWrap.classList.add("show");
  resetSteps();
  setProgress(0, "Starting…");
  progressWrap.scrollIntoView({ behavior: "smooth", block: "center" });

  try {
    // ---------- STEP 1: Logo Upload ----------
    markStep(step1, "active");
    setProgress(10, "Preparing logo…");

    let logoURL = "";

    // Priority: file input → localStorage saved logo
    let logoToUpload = logoFile;
    if (!logoToUpload) {
      const savedLogo = localStorage.getItem(LOGO_KEY);
      if (savedLogo && savedLogo.startsWith("data:image")) {
        try {
          logoToUpload = dataURLtoFile(savedLogo, `logo_${Date.now()}.png`);
        } catch (err) {
          console.warn("Could not convert saved logo:", err);
        }
      }
    }

    if (logoToUpload) {
      try {
        setProgress(25, "Uploading logo…");
        logoURL = await uploadLogo(logoToUpload, user.uid);
        setProgress(45, "Logo uploaded ✓");
        markStep(step1, "done");
      } catch (logoErr) {
        console.warn("Logo upload failed, continuing:", logoErr);
        markStep(step1, "done");
        setProgress(45, "Logo skipped");
      }
    } else {
      markStep(step1, "done");
      setProgress(45, "No logo");
    }

    // ---------- STEP 2: Save token data ----------
    markStep(step2, "active");
    setProgress(55, "Saving token data…");

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
      website: websiteFinal,
      social: {
        twitter:  twitterFinal,
        telegram: telegramFinal
      },
      description: desc,
      logo: logoURL,
      status:      "pending",
      submittedAt: new Date().toISOString()
    };

    // Save under /tokenListings
    const newRef = push(ref(db, "tokenListings"));
    await set(newRef, data);

    setProgress(75, "Saved to main list");

    // Save under /users/{uid}/myTokens
    await set(ref(db, `users/${user.uid}/myTokens/${newRef.key}`), {
      tokenId:     newRef.key,
      name,
      symbol,
      status:      "pending",
      logo:        logoURL,
      submittedAt: data.submittedAt
    });

    setProgress(90, "Added to dashboard");
    markStep(step2, "done");

    // ---------- STEP 3: Redirect ----------
    markStep(step3, "active");
    setProgress(100, "Success! Redirecting…");

    // Clear localStorage logo
    try { localStorage.removeItem(LOGO_KEY); } catch (_) {}

    // Reset form
    document.getElementById("listForm").reset();
    if (logoPreview) {
      logoPreview.innerHTML = `<span style="font-size:1.8rem;">🪙</span>`;
    }

    showToast("🎉 Token submitted successfully! Under review.", true);
    markStep(step3, "done");

    setTimeout(() => {
      window.location.href = "dashboard.html";
    }, 1600);

  } catch (err) {
    console.error("Token submission error:", err);
    showToast(err.message || "Submission failed. Try again.", false);
    setProgress(0, "Failed ❌");

    // Reset UI
    progressWrap.classList.remove("show");
    resetSteps();
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});
