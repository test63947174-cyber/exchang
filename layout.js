/* =========================================================
   Nexbit — Shared Layout Logic
   File: layout.js
   ----------------------------------------
   Handles: Sidebar toggle, Toast, Logout, Auth Guard,
            Navbar user info
   ----------------------------------------
   Usage (in any page):
     import { initAuthGuard, showToast } from "./layout.js";
     initAuthGuard();
   ========================================================= */

import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

/* =========================================================
   1. SIDEBAR TOGGLE
   ========================================================= */
export function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (sidebar)  sidebar.classList.toggle("open");
  if (overlay)  overlay.classList.toggle("show");
}

/* ESC key to close */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.getElementById("sidebar")?.classList.remove("open");
    document.getElementById("sidebarOverlay")?.classList.remove("show");
  }
});

/* =========================================================
   2. TOAST NOTIFICATION
   ========================================================= */
export function showToast(message, isSuccess = true) {
  const toast = document.getElementById("toast");
  const toastMsg = document.getElementById("toastMsg");
  if (!toast || !toastMsg) {
    // अगर toast element नहीं है तो alert fallback
    console.log(isSuccess ? "✓" : "✕", message);
    return;
  }

  toastMsg.textContent = message;
  toast.style.borderColor = isSuccess ? "var(--success)" : "var(--danger)";
  toast.style.boxShadow = isSuccess
    ? "0 0 30px rgba(0, 255, 163, 0.4)"
    : "0 0 30px rgba(255, 77, 109, 0.4)";

  const check = toast.querySelector(".check");
  if (check) {
    check.style.background = isSuccess ? "var(--success)" : "var(--danger)";
    check.textContent = isSuccess ? "✓" : "✕";
  }

  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3200);
}

/* =========================================================
   3. LOGOUT
   ========================================================= */
export async function logoutUser(e) {
  if (e) e.preventDefault();
  try {
    await signOut(auth);
    localStorage.removeItem("Nexbit_User");
    window.location.href = "index.html";
  } catch (err) {
    console.error("Logout error:", err);
    showToast("Logout failed. Try again.", false);
  }
}

/* =========================================================
   4. AUTH GUARD + NAVBAR USER INFO
   ========================================================= */
export function initAuthGuard() {
  onAuthStateChanged(auth, (user) => {
    // Login नहीं है → login.html पर भेजो
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    // Navbar में user की info भरो
    const name = user.displayName || "Trader";
    const first = name.split(" ")[0];

    const nameEl    = document.getElementById("userName");
    const avatarEl  = document.getElementById("userAvatar");

    if (nameEl)    nameEl.textContent = first;
    if (avatarEl)  avatarEl.textContent = first.charAt(0).toUpperCase();
  });
}

/* =========================================================
   5. GLOBAL BINDING
   ताकि HTML में onclick="toggleSidebar()" सीधे काम करे
   ========================================================= */
window.toggleSidebar = toggleSidebar;
window.logoutUser    = logoutUser;
window.showToast     = showToast;