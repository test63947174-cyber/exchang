/* =========================================================
   Nexbit — Sign Up Page
   File: signup.js  (matches signup.html)
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
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

/* ---------- DOM ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const form          = document.getElementById("signupForm");
  const fullnameInput = document.getElementById("fullname");
  const emailInput    = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const confirmInput  = document.getElementById("confirmPassword");
  const submitBtn     = document.getElementById("submitBtn");

  const nameError     = document.getElementById("nameError");
  const emailError    = document.getElementById("emailError");
  const passError     = document.getElementById("passError");
  const confirmError  = document.getElementById("confirmError");

  const toast         = document.getElementById("toast");
  const toastMsg      = document.getElementById("toastMsg");

  /* ---------- Password toggle ---------- */
  function setupToggle(btnId, input) {
    const btn = document.getElementById(btnId);
    btn.addEventListener("click", () => {
      const hidden = input.type === "password";
      input.type = hidden ? "text" : "password";
      btn.textContent = hidden ? "🙈" : "👁";
    });
  }
  setupToggle("togglePass1", passwordInput);
  setupToggle("togglePass2", confirmInput);

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
      "auth/email-already-in-use": "This email is already registered. Please log in.",
      "auth/invalid-email": "Please enter a valid email address.",
      "auth/weak-password": "Password is too weak. Use at least 6 characters.",
      "auth/network-request-failed": "Network error. Please check your connection.",
      "auth/operation-not-allowed": "Email/Password sign-in is not enabled in Firebase Console."
    };
    return map[code] || "Sign-up failed. Please try again.";
  }

  /* ---------- Validation ---------- */
  function validate() {
    let ok = true;
    if (fullnameInput.value.trim().length < 2) { showError(nameError, "Please enter your full name."); ok = false; }
    else clearError(nameError);

    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(emailInput.value.trim())) { showError(emailError, "Please enter a valid email address."); ok = false; }
    else clearError(emailError);

    if (passwordInput.value.length < 6) { showError(passError, "Password must be at least 6 characters."); ok = false; }
    else clearError(passError);

    if (confirmInput.value !== passwordInput.value || !confirmInput.value) { showError(confirmError, "Passwords do not match."); ok = false; }
    else clearError(confirmError);

    return ok;
  }

  /* ---------- Submit ---------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate()) { showToast("Please fix the errors above.", false); return; }

    const fullName = fullnameInput.value.trim();
    const email    = emailInput.value.trim();
    const password = passwordInput.value;

    submitBtn.disabled = true;
    const orig = submitBtn.textContent;
    submitBtn.textContent = "Creating…";

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const user = cred.user;

      await updateProfile(user, { displayName: fullName });

      await set(ref(db, "users/" + user.uid), {
        uid: user.uid,
        fullName: fullName,
        email: email,
        createdAt: new Date().toISOString(),
        provider: "password",
        balanceUSD: 0,
        status: "active"
      });

      localStorage.setItem("Nexbit_User", JSON.stringify({
        uid: user.uid, fullName, email, createdAt: new Date().toISOString()
      }));

      showToast("🎉 Account created! Redirecting…", true);
      form.reset();
      setTimeout(() => { window.location.href = "login.html"; }, 1600);
    } catch (err) {
      console.error(err);
      showToast(fbErrorMsg(err.code), false);
      if (err.code === "auth/email-already-in-use") {
        showError(emailError, "This email is already registered.");
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = orig;
    }
  });

  /* ---------- Clear errors on typing ---------- */
  fullnameInput.addEventListener("input", () => clearError(nameError));
  emailInput.addEventListener("input",    () => clearError(emailError));
  passwordInput.addEventListener("input", () => clearError(passError));
  confirmInput.addEventListener("input",  () => clearError(confirmError));
});