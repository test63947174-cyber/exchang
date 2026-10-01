/* =========================================================
   Nexbit — Log In Page
   File: login.js  (matches login.html)
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
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

/* ---------- DOM ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const form         = document.getElementById("loginForm");
  const emailInput   = document.getElementById("email");
  const passwordInput= document.getElementById("password");
  const submitBtn    = document.getElementById("submitBtn");
  const emailError   = document.getElementById("emailError");
  const passError    = document.getElementById("passError");
  const toast        = document.getElementById("toast");
  const toastMsg     = document.getElementById("toastMsg");
  const forgotLink   = document.getElementById("forgotLink");

  /* ---------- Password toggle ---------- */
  const toggleBtn = document.getElementById("togglePass");
  toggleBtn.addEventListener("click", () => {
    const hidden = passwordInput.type === "password";
    passwordInput.type = hidden ? "text" : "password";
    toggleBtn.textContent = hidden ? "🙈" : "👁";
  });

  /* ---------- Helpers ---------- */
  const showError  = (el, msg) => { el.textContent = msg; el.classList.add("show"); };
  const clearError = (el) => el.classList.remove("show");

  function showToast(message, isSuccess = true) {
    toastMsg.textContent = message;
    toast.style.borderColor = isSuccess ? "var(--success)" : "var(--danger)";
    toast.style.boxShadow = isSuccess
      ? "0 0 30px rgba(0, 255, 163, 0.4)"
      : "0 0 30px rgba(255, 77, 109, 0.4)";
    const check = toast.querySelector(".check");
    check.style.background = isSuccess ? "var(--success)" : "var(--danger)";
    check.textContent = isSuccess ? "✓" : "✕";
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function fbErrorMsg(code) {
    const map = {
      "auth/invalid-email":          "Please enter a valid email address.",
      "auth/user-not-found":         "No account found with this email.",
      "auth/wrong-password":         "Incorrect password. Please try again.",
      "auth/invalid-credential":     "Invalid email or password.",
      "auth/network-request-failed": "Network error. Please check your connection.",
      "auth/too-many-requests":      "Too many attempts. Try again later."
    };
    return map[code] || "Login failed. Please try again.";
  }

  /* ---------- Validation ---------- */
  function validate() {
    let ok = true;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(emailInput.value.trim())) { showError(emailError, "Please enter a valid email."); ok = false; }
    else clearError(emailError);

    if (!passwordInput.value) { showError(passError, "Password is required."); ok = false; }
    else clearError(passError);

    return ok;
  }

  /* ---------- Submit ---------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate()) { showToast("Please fill in correct credentials.", false); return; }

    const email = emailInput.value.trim();
    const pass  = passwordInput.value;

    submitBtn.disabled = true;
    const orig = submitBtn.textContent;
    submitBtn.textContent = "Logging in…";

    try {
      await signInWithEmailAndPassword(auth, email, pass);

      localStorage.setItem("Nexbit_User", JSON.stringify({
        email, loggedInAt: new Date().toISOString()
      }));

      showToast("👋 Welcome back! Redirecting…", true);
      form.reset();

      // 👉 अगर dashboard.html बना है तो वहाँ भेजें, वरना index.html पर
      setTimeout(() => { window.location.href = "dashboard.html"; }, 1500);
      // (dashboard.html न हो तो ऊपर वाली line की जगह: window.location.href = "index.html";)
    } catch (err) {
      console.error(err);
      showToast(fbErrorMsg(err.code), false);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = orig;
    }
  });

  /* ---------- Forgot Password ---------- */
  forgotLink.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    if (!email) { showToast("Enter your email first.", false); return; }
    try {
      await sendPasswordResetEmail(auth, email);
      showToast("📧 Reset link sent to your email.", true);
    } catch (err) {
      showToast(fbErrorMsg(err.code), false);
    }
  });

  /* ---------- Clear errors ---------- */
  emailInput.addEventListener("input",    () => clearError(emailError));
  passwordInput.addEventListener("input", () => clearError(passError));
});