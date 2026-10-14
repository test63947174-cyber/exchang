// ============================================================
// 🔥 DEPOSIT PAGE LOGIC - RND STAKING
// ============================================================
// Firebase + Real Blockchain Verification
// Amount tolerance: ±0.5% (handles rounding like 5.012 vs 5.01)
// ============================================================

import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { getDatabase, ref, get, onValue } from "firebase/database";

// Real verification from external file
import {
    completeDeposit as realCompleteDeposit,
    cleanupStaleLocks as realCleanupStaleLocks,
    checkPendingVerifications as realCheckPendingVerifications
} from './verifyTransaction.js';

// Wallet config from external file
import { WALLET_CONFIG } from './wallet.js';

// ============================================================
// 🔥 FIREBASE CONFIG
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyAz-TLmOhiy-_vHHmIjW8gyIOqTR_PT9o0",
  authDomain: "rnd2-70080.firebaseapp.com",
  databaseURL: "https://rnd2-70080-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "rnd2-70080",
  storageBucket: "rnd2-70080.firebasestorage.app",
  messagingSenderId: "468625887938",
  appId: "1:468625887938:web:5cb4ddbcf31b6fc0a4615b",
  measurementId: "G-ELVJD5NQKB"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// ============================================================
// 🔥 DEPOSIT WALLET (NEW ADDRESS)
// ============================================================
const DEPOSIT_WALLET_ADDRESS = '0xe757c330D267784F190e79e0Ec0dC5d30ad6eFA4';

// ============================================================
// 🔥 SMART NOTIFICATION SYSTEM
// ============================================================
function showToast(message, type = 'success', duration = null) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-custom ${type}`;

    const icons = {
        success: 'bi-check-circle-fill',
        error: 'bi-x-octagon-fill',
        warning: 'bi-exclamation-triangle-fill',
        info: 'bi-info-circle-fill'
    };

    const colors = {
        success: '#2ecc71',
        error: '#f87171',
        warning: '#fbbf24',
        info: '#60a5fa'
    };

    const showDuration = duration || (type === 'error' ? 8000 : type === 'warning' ? 7000 : 5000);

    toast.innerHTML = `
        <i class="bi ${icons[type] || icons.info}" style="color:${colors[type] || colors.info};"></i>
        <span class="toast-msg">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, showDuration);
}

// ============================================================
// 🔥 ANALYZE ERROR AND SHOW APPROPRIATE NOTIFICATION
// ============================================================
function analyzeError(errorMsg, userAmount) {
    const msg = String(errorMsg || '').toLowerCase();

    // 1. DUPLICATE TRANSACTION
    if (msg.includes('already been used') || msg.includes('duplicate')) {
        return {
            type: 'error',
            title: '🚫 Duplicate Transaction',
            message: 'Yeh transaction hash pehle use ho chuka hai. Ek TXID sirf ek baar use ho sakta hai.',
            statusHTML: `
                <i class="bi bi-x-octagon-fill me-2"></i>
                🚫 <strong>Duplicate Transaction</strong>
                <br><small>Yeh transaction hash pehle already deposit ho chuka hai.</small>
                <br><small>💡 Ek TXID sirf ek baar use kiya ja sakta hai. Naya deposit karo to naya hash use karo.</small>
            `
        };
    }

    // 2. AMOUNT MISMATCH
    if (msg.includes('amount mismatch') || msg.includes('shows')) {
        const match = String(errorMsg).match(/shows\s*([\d.]+)/i)
                  || String(errorMsg).match(/blockchain\s*shows\s*([\d.]+)/i);
        const chainAmount = match ? match[1] : null;

        if (chainAmount) {
            return {
                type: 'warning',
                title: '💰 Amount Mismatch',
                message: `Aapne ${userAmount} USDT enter kiya, lekin blockchain pe ${chainAmount} USDT hai. Auto-fill button se sahi amount daalein.`,
                statusHTML: `
                    <i class="bi bi-exclamation-triangle-fill me-2"></i>
                    💰 <strong>Amount Mismatch</strong>
                    <br><small>Aapne enter kiya: <strong>${userAmount} USDT</strong></small>
                    <br><small>Blockchain pe actual: <strong>${chainAmount} USDT</strong></small>
                    <br><small>💡 Neeche button click karke sahi amount auto-fill karein, phir Verify dabayein.</small>
                    <br>
                    <button type="button" class="btn-refresh mt-2" id="autoFillBtn" style="max-width:340px;padding:8px 16px;font-size:0.8rem;">
                        <i class="bi bi-magic"></i>
                        Auto-fill ${chainAmount} USDT
                    </button>
                `,
                chainAmount: chainAmount
            };
        }
        return {
            type: 'warning',
            title: '💰 Amount Mismatch',
            message: 'Aapka amount blockchain se match nahi kar raha. Exact amount with decimals enter karein.',
            statusHTML: `
                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                💰 <strong>Amount Mismatch</strong>
                <br><small>Aapne ${userAmount} USDT enter kiya but blockchain amount different hai.</small>
                <br><small>💡 Exact amount with decimals enter karein (e.g. 5.012)</small>
            `
        };
    }

    // 3. WRONG RECEIVER WALLET
    if (msg.includes('wrong receiver') || msg.includes('wrong wallet')) {
        return {
            type: 'error',
            title: '❌ Wrong Wallet',
            message: 'Yeh USDT hamare deposit address pe nahi bheja gaya. Sahi address pe bhejein.',
            statusHTML: `
                <i class="bi bi-x-octagon-fill me-2"></i>
                ❌ <strong>Wrong Receiver Wallet</strong>
                <br><small>Yeh transaction hamare deposit address pe nahi hui hai.</small>
                <br><small>💡 Ensure karein ki aapne <strong>sahi deposit address</strong> pe USDT (BEP20) bheja hai.</small>
            `
        };
    }

    // 4. INVALID TOKEN / WRONG CONTRACT
    if (msg.includes('invalid token') || msg.includes('contract')) {
        return {
            type: 'error',
            title: '❌ Wrong Token',
            message: 'Yeh USDT (BEP20) token nahi hai. Sahi contract se bhejein.',
            statusHTML: `
                <i class="bi bi-x-octagon-fill me-2"></i>
                ❌ <strong>Invalid Token Contract</strong>
                <br><small>Yeh transaction USDT (BEP20) ka nahi hai.</small>
                <br><small>💡 Sirf <strong>BSC Mainnet</strong> wala USDT hi deposit hota hai.</small>
            `
        };
    }

    // 5. NO USDT TRANSFER FOUND
    if (msg.includes('no usdt transfer')) {
        return {
            type: 'error',
            title: '❌ No USDT Transfer',
            message: 'Is transaction me USDT transfer nahi mila. Sahi TXID use karein.',
            statusHTML: `
                <i class="bi bi-x-octagon-fill me-2"></i>
                ❌ <strong>No USDT Transfer Found</strong>
                <br><small>Is transaction me koi USDT transfer event nahi hai.</small>
                <br><small>💡 Sirf <strong>USDT transfer</strong> wala TXID hi valid hai.</small>
            `
        };
    }

    // 6. TRANSACTION FAILED
    if (msg.includes('failed on blockchain') || msg.includes('transaction failed')) {
        return {
            type: 'error',
            title: '❌ Transaction Failed',
            message: 'Yeh transaction blockchain pe fail ho gaya. Doosra TXID try karein.',
            statusHTML: `
                <i class="bi bi-x-octagon-fill me-2"></i>
                ❌ <strong>Transaction Failed on Blockchain</strong>
                <br><small>Yeh transaction BSC pe fail ho chuka hai.</small>
                <br><small>💡 Failed transaction ka refund nahi hota. Sahi TXID use karein.</small>
            `
        };
    }

    // 7. TRANSACTION NOT FOUND
    if (msg.includes('not found') || msg.includes('check the hash')) {
        return {
            type: 'error',
            title: '🔍 Transaction Not Found',
            message: 'Yeh TXID blockchain pe nahi mila. Sahi hash use karein ya thodi der baad try karein.',
            statusHTML: `
                <i class="bi bi-x-octagon-fill me-2"></i>
                ❌ <strong>Transaction Not Found</strong>
                <br><small>Yeh TXID BSC blockchain pe nahi mila.</small>
                <br><small>💡 Check karein ki TXID sahi hai, ya 1-2 minute baad try karein.</small>
            `
        };
    }

    // 8. STILL PROCESSING
    if (msg.includes('already being processed') || msg.includes('already being verified')) {
        return {
            type: 'info',
            title: '⏳ Already Processing',
            message: 'Yeh transaction already verify ho raha hai. Please wait.',
            statusHTML: `
                <i class="bi bi-hourglass-split me-2"></i>
                ⏳ <strong>Already Processing</strong>
                <br><small>Yeh transaction abhi verify ho raha hai. Please wait karein.</small>
            `
        };
    }

    // 9. INSUFFICIENT CONFIRMATIONS / PENDING
    if (msg.includes('waiting for confirmations') || msg.includes('confirmations')) {
        return {
            type: 'info',
            title: '⏳ Waiting for Confirmations',
            message: 'Transaction mil gaya. Confirmations ka wait kar rahe hain...',
            statusHTML: `
                <i class="bi bi-hourglass-split me-2"></i>
                ⏳ <strong>Waiting for Confirmations</strong>
                <br><small>${errorMsg}</small>
            `
        };
    }

    // 10. RPC / NETWORK ERROR
    if (msg.includes('rpc') || msg.includes('network') || msg.includes('timeout')) {
        return {
            type: 'error',
            title: '🌐 Network Error',
            message: 'Blockchain se connect nahi ho pa rahe. Internet check karein aur try karein.',
            statusHTML: `
                <i class="bi bi-wifi-off me-2"></i>
                ❌ <strong>Network / RPC Error</strong>
                <br><small>Blockchain node se connect nahi ho pa raha.</small>
                <br><small>💡 Internet check karein, thodi der baad try karein.</small>
            `
        };
    }

    // 11. GENERIC FALLBACK
    return {
        type: 'error',
        title: '❌ Verification Failed',
        message: errorMsg || 'Kuch problem aa gayi. Please try again.',
        statusHTML: `
            <i class="bi bi-x-octagon-fill me-2"></i>
            ❌ <strong>Verification Failed</strong>
            <br><small>${errorMsg || 'Kuch problem aa gayi. Please dobara try karein.'}</small>
        `
    };
}

// ============================================================
// 🔥 CLIPBOARD
// ============================================================
function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text)
            .then(() => showToast('✅ Address copied to clipboard!', 'success'))
            .catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const input = document.createElement('input');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    try {
        document.execCommand('copy');
        showToast('✅ Address copied to clipboard!', 'success');
    } catch (err) {
        showToast('❌ Failed to copy. Please copy manually.', 'error');
    }
    document.body.removeChild(input);
}

// ============================================================
// 🔥 SIDEBAR
// ============================================================
const sidebarPanel = document.getElementById('sidebarPanel');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarClose = document.getElementById('sidebarClose');

function openSidebar() {
    if (!sidebarPanel || !sidebarOverlay) return;
    sidebarPanel.classList.add('open');
    sidebarOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    if (!sidebarPanel || !sidebarOverlay) return;
    sidebarPanel.classList.remove('open');
    sidebarOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

if (sidebarToggle) sidebarToggle.addEventListener('click', openSidebar);
if (sidebarClose) sidebarClose.addEventListener('click', closeSidebar);
if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
});

const logoutBtn = document.getElementById('logoutBtnSidebar');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try { await signOut(auth); } catch (err) { console.error('Logout error:', err); }
        window.location.href = 'login.html';
    });
}

// ============================================================
// 🔥 UI HELPERS
// ============================================================
function updateVerificationStatus(type, message) {
    const statusDiv = document.getElementById('verificationStatus');
    if (!statusDiv) return;
    statusDiv.className = `verification-status show ${type}`;
    statusDiv.innerHTML = message;
}

function updateBalance(newBalance) {
    const balanceDisplay = document.getElementById('depositBalance');
    if (balanceDisplay) {
        balanceDisplay.textContent = '$' + (Number(newBalance) || 0).toFixed(2);
    }
}

// ============================================================
// 🔥 RENDER DEPOSIT UI
// ============================================================
function renderDepositUI(depositWallet) {
    const container = document.getElementById('depositContent');
    if (!container) return;

    const depositAddress = DEPOSIT_WALLET_ADDRESS;
    const usdtContract = WALLET_CONFIG.USDT_CONTRACT || '';
    const minConfirmations = WALLET_CONFIG.MIN_CONFIRMATIONS || 3;

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(depositAddress)}&color=2ecc71&bgcolor=080e1a`;

    container.innerHTML = `
        <div class="page-header">
            <div>
                <h4>
                    <span class="header-icon"><i class="bi bi-arrow-down-circle"></i></span>
                    Deposit USDT
                </h4>
                <p>Send USDT (BEP20) to your deposit address & verify on blockchain</p>
            </div>
        </div>

        <div class="row g-4">
            <div class="col-12 col-lg-6">
                <div class="card-glass">
                    <div class="card-title">
                        <i class="bi bi-wallet2"></i>
                        Deposit Wallet Balance
                    </div>
                    <div class="deposit-balance" id="depositBalance">$${(Number(depositWallet) || 0).toFixed(2)}</div>
                    <div class="deposit-balance-label">USDT Balance</div>
                    <div class="balance-badge">
                        <i class="bi bi-shield-check"></i>
                        Blockchain Verified
                    </div>
                </div>
            </div>

            <div class="col-12 col-lg-6">
                <div class="card-glass">
                    <div class="card-title">
                        <i class="bi bi-qr-code"></i>
                        Send USDT (BEP20)
                    </div>

                    <div class="qr-wrapper">
                        <img src="${qrUrl}" alt="Deposit QR Code" id="qrCodeImg">
                    </div>

                    <div class="wallet-address-box">
                        <span class="address" id="depositAddress">${depositAddress}</span>
                        <button class="copy-btn" id="copyAddressBtn" type="button">
                            <i class="bi bi-copy"></i> Copy
                        </button>
                    </div>

                    <div class="address-note">
                        <i class="bi bi-info-circle"></i>
                        Only send <strong>USDT (BEP20)</strong> to this address.
                        <br>
                        Contract: <span class="contract">${usdtContract}</span>
                    </div>
                </div>
            </div>

            <div class="col-12">
                <div class="card-glass">
                    <div class="card-title">
                        <i class="bi bi-shield-check"></i>
                        🔒 Verify Deposit (Blockchain)
                    </div>

                    <div class="info-alert">
                        <i class="bi bi-info-circle"></i>
                        <strong>Real Blockchain Verification:</strong> Transaction is verified directly on BSC blockchain.
                        <br>
                        Minimum confirmations required: <strong>${minConfirmations}</strong>
                        <br>
                        ❌ <strong>Cannot fake or bypass verification!</strong>
                    </div>

                    <form id="depositForm">
                        <div class="row g-3">
                            <div class="col-12 col-md-4">
                                <label class="form-label" for="depositAmount">
                                    Amount You Sent (USDT) <span class="required">*</span>
                                </label>
                                <input type="number" id="depositAmount" class="form-control form-control-custom"
                                       placeholder="e.g. 5.012" min="0.01" step="any" required>
                                <span class="form-hint">Exact amount you sent (decimals OK)</span>
                            </div>
                            <div class="col-12 col-md-5">
                                <label class="form-label" for="txHash">
                                    Transaction Hash (TXID) <span class="required">*</span>
                                </label>
                                <input type="text" id="txHash" class="form-control form-control-custom"
                                       placeholder="0x..." required>
                                <span class="form-hint">Real BSC transaction hash from your wallet</span>
                            </div>
                            <div class="col-12 col-md-3 d-flex align-items-start">
                                <button type="submit" class="btn-primary-custom" id="verifyBtn" style="margin-top: 26px;">
                                    <i class="bi bi-check-circle"></i>
                                    <span>Verify</span>
                                </button>
                            </div>
                        </div>
                    </form>

                    <div id="verificationStatus" class="verification-status"></div>
                    <div id="pendingVerifications" class="mt-3"></div>
                </div>
            </div>

            <div class="col-12">
                <div class="card-glass">
                    <div class="card-title">
                        <i class="bi bi-clock-history"></i>
                        Recent Deposits
                    </div>
                    <div id="recentDeposits">
                        <div class="empty-state">
                            <i class="bi bi-inbox"></i>
                            <p>Loading deposits...</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const copyBtn = document.getElementById('copyAddressBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', function () {
            copyToClipboard(depositAddress);
            this.classList.add('copied');
            this.innerHTML = '<i class="bi bi-check"></i> Copied!';
            setTimeout(() => {
                this.classList.remove('copied');
                this.innerHTML = '<i class="bi bi-copy"></i> Copy';
            }, 2000);
        });
    }
}

// ============================================================
// 🔥 RESUME PENDING VERIFICATIONS (FIXED)
// ============================================================
async function resumePendingVerifications(userId) {
    try {
        const pendingTxs = await realCheckPendingVerifications(userId);
        const container = document.getElementById('pendingVerifications');

        if (!container || !pendingTxs || pendingTxs.length === 0) {
            if (container) container.innerHTML = '';
            return;
        }

        const minConfirmations = WALLET_CONFIG.MIN_CONFIRMATIONS || 3;
        const pollingInterval = (WALLET_CONFIG.POLLING_INTERVAL || 15000) / 1000;

        let html = `
            <div class="verification-status show polling">
                <i class="bi bi-arrow-repeat me-2"></i>
                <strong>⏳ Resuming pending verifications...</strong>
                <div class="mt-2">
        `;

        for (const pending of pendingTxs) {
            html += `
                <div class="d-flex align-items-center gap-2 mb-1">
                    <span class="polling-indicator"></span>
                    <span style="font-family:monospace;font-size:0.8rem;">${(pending.txHash || '').substring(0, 20)}...</span>
                    <span class="badge-mini badge-confirm">Pending</span>
                </div>
            `;
        }

        html += `</div></div>`;
        container.innerHTML = html;

        for (const pending of pendingTxs) {
            try {
                await realCompleteDeposit(
                    userId,
                    pending.txHash,
                    (pending.lockData && pending.lockData.amount) || 0,
                    (confirmations, currentBlock, blockNumber) => {
                        updateVerificationStatus(
                            'polling',
                            `<span class="polling-indicator"></span>
                             ⏳ Waiting for confirmations... (${confirmations}/${minConfirmations})<br>
                             <small>Block: ${blockNumber || 'pending'} | Auto-checking every ${pollingInterval} seconds...</small>`
                        );
                    },
                    (newBalance, creditedAmount, blockNumber) => {
                        const finalAmount = (creditedAmount !== undefined && creditedAmount !== null)
                            ? Number(creditedAmount) : Number(pending.lockData && pending.lockData.amount) || 0;
                        const finalBlock = blockNumber || 'confirmed';

                        updateVerificationStatus(
                            'success',
                            `<i class="bi bi-check-circle-fill me-2"></i>
                             ✅ <strong>Deposit Successfully Credited!</strong>
                             <br><small>Credited Amount: <strong>$${finalAmount.toFixed(6)} USDT</strong></small>
                             <br><small>New Balance: <strong>$${Number(newBalance).toFixed(2)} USDT</strong></small>
                             <br><small>🔒 Verified on BSC Block: <strong>${finalBlock}</strong></small>`
                        );
                        showToast(`✅ Pending deposit of $${finalAmount.toFixed(4)} USDT completed!`, 'success', 6000);
                        updateBalance(newBalance);
                    },
                    (error) => {
                        const analysis = analyzeError(error, (pending.lockData && pending.lockData.amount) || 0);
                        updateVerificationStatus(analysis.type === 'warning' ? 'error' : analysis.type, analysis.statusHTML);
                        showToast(analysis.message, analysis.type === 'warning' ? 'warning' : 'error', 8000);
                    }
                );
            } catch (error) {
                console.error('Error resuming pending verification:', error);
            }
        }
    } catch (err) {
        console.error('Error in resumePendingVerifications:', err);
    }
}

// ============================================================
// 🔥 LOAD RECENT DEPOSITS (REAL-TIME)
// ============================================================
function loadRecentDeposits(userId) {
    const depositsRef = ref(db, `users/${userId}/transactions`);

    onValue(depositsRef, (snapshot) => {
        const container = document.getElementById('recentDeposits');
        if (!container) return;

        if (!snapshot.exists()) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-inbox"></i>
                    <p>No deposits yet. Send USDT to your deposit address.</p>
                </div>
            `;
            return;
        }

        const transactions = snapshot.val();
        const deposits = Object.values(transactions)
            .filter(tx => tx && tx.type === 'deposit' && tx.status === 'success')
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, 10);

        if (deposits.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-inbox"></i>
                    <p>No deposits yet. Send USDT to your deposit address.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = deposits.map(tx => {
            const amount = Number(tx.amount || 0).toFixed(4);
            const dateStr = tx.timestamp ? new Date(tx.timestamp).toLocaleString('en-IN') : 'N/A';
            const shortHash = tx.txHash ? tx.txHash.substring(0, 16) + '...' : '';

            return `
                <div class="deposit-item">
                    <div>
                        <div class="amount">$${amount} USDT</div>
                        <div class="date">${dateStr}</div>
                    </div>
                    <div style="text-align:right;">
                        <span class="status-active">
                            <i class="bi bi-check-circle-fill"></i>
                            Verified (Blockchain)
                        </span>
                        <div class="badges">
                            ${tx.blockNumber ? `<span class="badge-mini badge-block">Block: ${tx.blockNumber}</span>` : ''}
                            ${tx.confirmations ? `<span class="badge-mini badge-confirm">${tx.confirmations} Confirmations</span>` : ''}
                            ${shortHash ? `<span class="badge-mini badge-hash">${shortHash}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }, (error) => {
        console.error('Error loading deposits:', error);
        const container = document.getElementById('recentDeposits');
        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-exclamation-triangle" style="color:var(--red);opacity:0.6;"></i>
                    <p style="color:var(--red);">Error loading deposits. Please refresh.</p>
                </div>
            `;
        }
    });
}

// ============================================================
// 🔥 BALANCE REAL-TIME LISTENER
// ============================================================
function listenToBalance(userId) {
    const balanceRef = ref(db, `users/${userId}/depositWallet`);
    onValue(balanceRef, (snapshot) => {
        if (snapshot.exists()) {
            updateBalance(snapshot.val());
        }
    });
}

// ============================================================
// 🔥 AUTO-FILL BUTTON HANDLER
// ============================================================
document.addEventListener('click', function (e) {
    const btn = e.target.closest('#autoFillBtn');
    if (!btn) return;

    const match = btn.textContent.match(/([\d.]+)/);
    if (!match) return;

    const amountInput = document.getElementById('depositAmount');
    if (amountInput) {
        amountInput.value = match[1];
        showToast(`✅ Auto-filled ${match[1]} USDT. Ab "Verify" button dabayein.`, 'success');
        btn.remove();
    }
});

// ============================================================
// 🔥 HANDLE DEPOSIT FORM SUBMIT (FIXED)
// ============================================================
function attachFormHandler(user) {
    const form = document.getElementById('depositForm');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const amountInput = document.getElementById('depositAmount');
        const txHashInput = document.getElementById('txHash');
        const verifyBtn = document.getElementById('verifyBtn');

        const amount = parseFloat(amountInput.value);
        const txHash = txHashInput.value.trim();

        const minConfirmations = WALLET_CONFIG.MIN_CONFIRMATIONS || 3;
        const pollingInterval = (WALLET_CONFIG.POLLING_INTERVAL || 15000) / 1000;

        // ---- FRONTEND VALIDATION ----
        if (!amount || amount <= 0) {
            showToast('❌ Sahi amount enter karein (0 se zyada).', 'error');
            return;
        }

        if (!txHash || txHash.length < 10) {
            showToast('❌ Sahi transaction hash enter karein.', 'error');
            return;
        }

        if (!txHash.startsWith('0x')) {
            showToast('❌ Transaction hash "0x" se start hona chahiye.', 'error');
            return;
        }

        if (verifyBtn.disabled) {
            showToast('⏳ Please wait, verification already chal rahi hai...', 'info');
            return;
        }

        // ---- START VERIFICATION ----
        updateVerificationStatus(
            'pending',
            `<i class="bi bi-hourglass-split me-2"></i>
             🔒 <strong>Verifying on BSC blockchain...</strong>
             <span class="spinner-border spinner-border-sm ms-2" role="status"></span>
             <br><small>Please wait, yeh thoda time le sakta hai...</small>`
        );

        verifyBtn.disabled = true;
        const originalBtnHTML = verifyBtn.innerHTML;
        verifyBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Verifying...';

        let successFired = false;

        try {
            const result = await realCompleteDeposit(
                user.uid,
                txHash,
                amount,

                // ================================================
                // 🔥 ON PENDING
                // ================================================
                (confirmations, currentBlock, blockNumber) => {
                    updateVerificationStatus(
                        'polling',
                        `<span class="polling-indicator"></span>
                         ⏳ <strong>Waiting for confirmations...</strong> (${confirmations}/${minConfirmations})
                         <br><small>Block: ${blockNumber || 'pending'} | Auto-checking every ${pollingInterval} seconds</small>
                         <br><small>⚠️ Transaction ko ${minConfirmations} confirmations chahiye</small>`
                    );
                    showToast(
                        `⏳ Confirmations ka wait... (${confirmations}/${minConfirmations})`,
                        'info',
                        3500
                    );
                },

                // ================================================
                // 🔥 ON SUCCESS
                // ================================================
                (newBalance, creditedAmount, blockNumber) => {
                    successFired = true;

                    const finalAmount = (creditedAmount !== undefined && creditedAmount !== null)
                        ? Number(creditedAmount)
                        : Number(amount);
                    const finalBlock = blockNumber || 'confirmed';

                    updateVerificationStatus(
                        'success',
                        `<i class="bi bi-check-circle-fill me-2"></i>
                         ✅ <strong>Deposit Successfully Credited!</strong>
                         <br><small>Credited Amount: <strong>$${finalAmount.toFixed(6)} USDT</strong></small>
                         <br><small>New Balance: <strong>$${Number(newBalance).toFixed(2)} USDT</strong></small>
                         <br><small>🔒 Verified on BSC Block: <strong>${finalBlock}</strong></small>`
                    );

                    showToast(
                        `✅ Deposit success! $${finalAmount.toFixed(4)} USDT aapke wallet me add ho gaya.`,
                        'success',
                        6000
                    );

                    updateBalance(newBalance);

                    amountInput.value = '';
                    txHashInput.value = '';
                },

                // ================================================
                // 🔥 ON ERROR
                // ================================================
                (error) => {
                    if (successFired) {
                        console.warn('Ignoring error because success already fired:', error);
                        return;
                    }

                    const analysis = analyzeError(error, amount);
                    updateVerificationStatus(
                        analysis.type === 'warning' ? 'error' : analysis.type,
                        analysis.statusHTML
                    );
                    showToast(analysis.message, analysis.type, 8000);
                }
            );

            // 🔥 IMPORTANT: Check result AFTER all callbacks fire
            // If result has amountMismatch and callback didn't fire
            if (result && result.amountMismatch && !successFired) {
                const analysis = analyzeError(result.error, amount);
                updateVerificationStatus(
                    analysis.type === 'warning' ? 'error' : analysis.type,
                    analysis.statusHTML
                );
                showToast(analysis.message, analysis.type, 8000);
            }
            // If result has error and callback didn't fire
            else if (result && result.error && !successFired) {
                const analysis = analyzeError(result.error, amount);
                updateVerificationStatus(
                    analysis.type === 'warning' ? 'error' : analysis.type,
                    analysis.statusHTML
                );
                showToast(analysis.message, analysis.type, 8000);
            }

        } catch (error) {
            console.error('Deposit error:', error);

            if (successFired) {
                console.warn('Ignoring catch error because success already fired:', error);
            } else {
                const analysis = analyzeError(error.message || 'Unexpected error', amount);
                updateVerificationStatus(
                    analysis.type === 'warning' ? 'error' : analysis.type,
                    analysis.statusHTML
                );
                showToast(analysis.message, analysis.type, 8000);
            }
        }

        verifyBtn.disabled = false;
        verifyBtn.innerHTML = originalBtnHTML;
    });
}

// ============================================================
// 🔥 MAIN AUTH FLOW
// ============================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    try {
        try {
            await realCleanupStaleLocks();
        } catch (err) {
            console.warn('cleanupStaleLocks warning:', err);
        }

        const userSnap = await get(ref(db, 'users/' + user.uid));
        if (!userSnap.exists()) {
            window.location.href = 'dashboard.html';
            return;
        }

        const userData = userSnap.val();

        const name = userData.name || 'User';
        const username = userData.username || userData.referralCode || 'USER';
        const sidebarName = document.getElementById('sidebarName');
        const sidebarUserId = document.getElementById('sidebarUserId');
        const sidebarAvatar = document.getElementById('sidebarAvatar');
        const referralBadge = document.getElementById('referralBadge');

        if (sidebarName) sidebarName.textContent = name;
        if (sidebarUserId) sidebarUserId.textContent = 'ID: ' + username.substring(0, 20) + (username.length > 20 ? '...' : '');
        if (sidebarAvatar) sidebarAvatar.textContent = name.charAt(0).toUpperCase();
        if (referralBadge) referralBadge.textContent = userData.totalReferrals || 0;

        const depositWallet = userData.depositWallet || 0;

        renderDepositUI(depositWallet);
        await resumePendingVerifications(user.uid);
        loadRecentDeposits(user.uid);
        listenToBalance(user.uid);
        attachFormHandler(user);

    } catch (error) {
        console.error('Error loading deposit page:', error);
        const container = document.getElementById('depositContent');
        if (container) {
            container.innerHTML = `
                <div class="empty-state" style="padding: 60px 20px;">
                    <i class="bi bi-exclamation-triangle" style="color:var(--red);opacity:0.8;"></i>
                    <h4 style="color:#fff;margin-bottom:8px;">Error Loading Page</h4>
                    <p style="color:var(--text-muted);margin-bottom:20px;">
                        ${error.message || 'Please check your internet connection.'}
                    </p>
                    <button class="btn-refresh" onclick="location.reload()" style="max-width:200px;margin:0 auto;">
                        <i class="bi bi-arrow-clockwise"></i>
                        Refresh Page
                    </button>
                </div>
            `;
        }
    }
});