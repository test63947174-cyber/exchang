import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
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

/* sidebar toggle + logout same as other pages */
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
function showToast(msg, ok=true) {
  const t = document.getElementById("toast");
  document.getElementById("toastMsg").textContent = msg;
  t.style.borderColor = ok ? "var(--success)" : "var(--danger)";
  const c = t.querySelector(".check");
  c.style.background = ok ? "var(--success)" : "var(--danger)";
  c.textContent = ok ? "✓" : "✕";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}
window.logoutUser = async (e) => {
  if (e) e.preventDefault();
  try {
    await signOut(auth);
    localStorage.removeItem("Nexbit_User");
    window.location.href = "index.html";
  } catch { showToast("Logout failed", false); }
};

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  const name = user.displayName || "Trader";
  const first = name.split(" ")[0];
  document.getElementById("userName").textContent = first;
  document.getElementById("userAvatar").textContent = first.charAt(0).toUpperCase();

  document.getElementById("profileName").value  = name;
  document.getElementById("profileEmail").value = user.email;
  document.getElementById("bigAvatar").textContent = first.charAt(0).toUpperCase();

  // Load extra fields from DB
  try {
    const snap = await get(ref(db, "users/" + user.uid));
    if (snap.exists()) {
      const v = snap.val();
      if (v.phone)   document.getElementById("profilePhone").value   = v.phone;
      if (v.country) document.getElementById("profileCountry").value = v.country;
    }
  } catch (_) {}
});

document.getElementById("saveProfileBtn").addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;
  const name  = document.getElementById("profileName").value.trim();
  const phone = document.getElementById("profilePhone").value.trim();
  const country = document.getElementById("profileCountry").value;

  try {
    await updateProfile(user, { displayName: name });
    await update(ref(db, "users/" + user.uid), {
      fullName: name, phone, country, updatedAt: new Date().toISOString()
    });
    showToast("✅ Profile updated successfully!", true);
    document.getElementById("userName").textContent = name.split(" ")[0];
    document.getElementById("userAvatar").textContent = name.charAt(0).toUpperCase();
  } catch (err) {
    showToast("Update failed", false);
  }
});