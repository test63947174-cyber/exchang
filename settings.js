import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

const firebaseConfig = { /* same */ 
  apiKey: "AIzaSyDKFkbj5WRUinr_v7ARRtD-Gsxz4UlMrl0",
  authDomain: "exchang-59ea7.firebaseapp.com",
  databaseURL: "https://exchang-59ea7-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "exchang-59ea7",
  storageBucket: "exchang-59ea7.firebasestorage.app",
  messagingSenderId: "422935424250",
  appId: "1:422935424250:web:b4da15d25714e499cbed43"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
getAnalytics(app); getDatabase(app);

window.toggleSidebar = () => {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("sidebarOverlay").classList.toggle("show");
};
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
window.showToast = showToast;
window.logoutUser = async (e) => {
  if (e) e.preventDefault();
  await signOut(auth);
  localStorage.removeItem("Nexbit_User");
  window.location.href = "index.html";
};
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  const first = (user.displayName || "Trader").split(" ")[0];
  document.getElementById("userName").textContent = first;
  document.getElementById("userAvatar").textContent = first.charAt(0).toUpperCase();
});