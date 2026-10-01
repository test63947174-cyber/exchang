/* =========================================================
   Nexbit — Sign Up Page Logic with Firebase
   Firebase Project: exchang-59ea7
   ========================================================= */

// ---- Firebase SDK Imports (CDN modules) ----
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

// ---- 🔥 NEW Firebase Configuration ----
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

// ---- Initialize Firebase ----
const app       = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth      = getAuth(app);
const db        = getDatabase(app);

/* =========================================================
   DOM Elements & Logic
   ========================================================= */
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

  const togglePass1   = document.getElementById("togglePass1");
  const togglePass2   = document.getElementById("togglePass2");

  const toast         = document.getElementById("toast");
  const toastMsg      = document.getElementById("toastMsg");

  /* =========================================================
     1. Show / Hide Password Toggle
     ========================================================= */
  function setupToggle(button, input) {
    button.addEventListener("click", () => {
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      button.textContent = isHidden ? "🙈" : "👁";
    });
  }
  setupToggle(togglePass1, passwordInput);
  setupToggle(togglePass2, confirmInput);

  /* =========================================================
     2. Error Helpers
     ========================================================= */
  const showError  = (el, msg) => { el.textContent = msg; el.classList.add("show"); };
  const clearError = (el) => el.classList.remove("show");

  /* =========================================================
     3. Toast Notification
     ========================================================= */
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

  /* =========================================================
     4. Client-side Validation
     ========================================================= */
  function validateForm() {
    let isValid = true;

    if (fullnameInput.value.trim().length < 2) {
      showError(nameError, "Please enter your full name.");
      isValid = false;
    } else clearError(nameError);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailInput.value.trim())) {
      showError(emailError, "Please enter a valid email address.");
      isValid = false;
    } else clearError(emailError);

    if (passwordInput.value.length < 6) {
      showError(passError, "Password must be at least 6 characters.");
      isValid = false;
    } else clearError(passError);

    if (confirmInput.value !== passwordInput.value || confirmInput.value === "") {
      showError(confirmError, "Passwords do not match.");
      isValid = false;
    } else clearError(confirmError);

    return isValid;
  }

  /* =========================================================
     5. Firebase Error Message Map
     ========================================================= */
  function getFirebaseErrorMessage(code) {
    const map = {
      "auth/email-already-in-use":    "This email is already registered. Please log in.",
      "auth/invalid-email":           "The email address is not valid.",
      "auth/weak-password":           "Password is too weak. Use at least 6 characters.",
      "auth/network-request-failed":  "Network error. Please check your connection.",
      "auth/operation-not-allowed":   "Email/Password sign-in is not enabled in Firebase Console.",
      "auth/too-many-requests":       "Too many attempts. Please try again later."
    };
    return map[code] || "Sign-up failed. Please try again.";
  }

  /* =========================================================
     6. Form Submit → Firebase Auth + Realtime DB
     ========================================================= */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      showToast("Please fix the errors above.", false);
      return;
    }

    const fullName = fullnameInput.value.trim();
    const email    = emailInput.value.trim();
    const password = passwordInput.value;

    // Loading state
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = "Creating…";

    try {
      // 1) Create user in Firebase Authentication
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 2) Set displayName on auth profile
      await updateProfile(user, { displayName: fullName });

      // 3) Save extra profile to Realtime Database → /users/{uid}
      await set(ref(db, "users/" + user.uid), {
        uid:        user.uid,
        fullName:   fullName,
        email:      email,
        createdAt:  new Date().toISOString(),
        provider:   "password",
        balanceUSD: 0,
        status:     "active"
      });

      // 4) Cache minimal info in localStorage (for quick login.html checks)
      try {
        localStorage.setItem("Nexbit_User", JSON.stringify({
          uid:       user.uid,
          fullName:  fullName,
          email:     email,
          createdAt: new Date().toISOString()
        }));
      } catch (lsErr) {
        console.warn("localStorage save failed:", lsErr);
      }

      // 5) Success feedback + redirect
      showToast("Account created successfully! Redirecting…", true);
      form.reset();

      setTimeout(() => {
        window.location.href = "login.html";
      }, 1800);

    } catch (error) {
      console.error("Nexbit Sign-Up Error:", error);
      const msg = getFirebaseErrorMessage(error.code);
      showToast(msg, false);

      if (error.code === "auth/email-already-in-use") {
        showError(emailError, "This email is already registered.");
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  /* =========================================================
     7. Clear Errors on Typing
     ========================================================= */
  fullnameInput.addEventListener("input", () => clearError(nameError));
  emailInput.addEventListener("input",    () => clearError(emailError));
  passwordInput.addEventListener("input", () => clearError(passError));
  confirmInput.addEventListener("input",  () => clearError(confirmError));
});