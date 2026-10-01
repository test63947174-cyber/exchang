/* =========================================================
   Nexbit — List Token Page
   File: list-token.js
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, push, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

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

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getDatabase(app);

/* ---------- Sidebar ---------- */
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

/* ---------- Toast ---------- */
function showToast(msg, ok=true) {
  const t = document.getElementById("toast");
  document.getElementById("toastMsg").textContent = msg;
  t.style.borderColor = ok ? "var(--success)" : "var(--danger)";
  t.style.boxShadow = ok ? "0 0 30px rgba(0,255,163,0.4)" : "0 0 30px rgba(255,77,109,0.4)";
  const c = t.querySelector(".check");
  c.style.background = ok ? "var(--success)" : "var(--danger)";
  c.textContent = ok ? "✓" : "✕";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---------- Logout ---------- */
window.logoutUser = async (e) => {
  if (e) e.preventDefault();
  try {
    await signOut(auth);
    localStorage.removeItem("Nexbit_User");
    window.location.href = "index.html";
  } catch { showToast("Logout failed", false); }
};

/* ---------- Auth guard ---------- */
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  const name = user.displayName || "Trader";
  const first = name.split(" ")[0];
  document.getElementById("userName").textContent = first;
  document.getElementById("userAvatar").textContent = first.charAt(0).toUpperCase();
});

/* ---------- Submit form ---------- */
document.getElementById("listForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) { showToast("Please log in first.", false); return; }

  const data = {
    ownerUid:    user.uid,
    ownerEmail:  user.email,
    name:        document.getElementById("tokenName").value.trim(),
    symbol:      document.getElementById("tokenSymbol").value.trim().toUpperCase(),
    price:       parseFloat(document.getElementById("tokenPrice").value) || 0,
    supply:      parseInt(document.getElementById("tokenSupply").value) || 0,
    network:     document.getElementById("tokenNetwork").value,
    contract:    document.getElementById("tokenContract").value.trim(),
    website:     document.getElementById("tokenWebsite").value.trim(),
    description: document.getElementById("tokenDesc").value.trim(),
    status:      "pending",
    submittedAt: new Date().toISOString()
  };

  // Validation
  if (!data.name || !data.symbol || !data.price || !data.supply || !data.network || !data.contract || !data.description) {
    showToast("Please fill all required fields.", false);
    return;
  }

  const btn = document.getElementById("submitBtn");
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "Submitting…";

  try {
    const newRef = push(ref(db, "tokenListings"));
    await set(newRef, data);
    showToast("🎉 Token submitted for review!", true);
    document.getElementById("listForm").reset();
  } catch (err) {
    console.error(err);
    showToast("Submission failed. Try again.", false);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});