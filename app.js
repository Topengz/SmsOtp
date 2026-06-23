// ========== SMS OTP Application ==========

// State Management
let currentOTP = null;
let expiryTimer = null;
let countdownInterval = null;
let currentPhoneNumber = null;
let currentSettings = {
    digits: 6,
    expiryMinutes: 5
};

// Constants
const STORAGE_KEYS = {
    history: 'otp_history',
    dailyLimit: 'otp_daily_limit',
    limitDate: 'otp_limit_date'
};

const TEXTBELT_API = 'https://textbelt.com/text';

// ========== Initialization ==========
document.addEventListener('DOMContentLoaded', () => {
    initOTPInputs();
    updateLimitDisplay();
    renderHistory();
    setupAutoClearLimit();
});

// ========== OTP Input Handling ==========
function initOTPInputs() {
    const inputs = document.querySelectorAll('.otp-digit');
    inputs.forEach((input, index) => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && index > 0) {
                inputs[index - 1].focus();
            }
        });

        input.addEventListener('input', (e) => {
            const val = e.target.value;
            if (val && !/^\d$/.test(val)) {
                input.value = '';
                return;
            }
            if (val && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
        });

        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasteData = e.clipboardData.getData('text').replace(/\D/g, '').split('');
            inputs.forEach((inp, i) => {
                if (pasteData[i]) inp.value = pasteData[i];
            });
            const lastFilled = Math.min(pasteData.length, inputs.length) - 1;
            if (lastFilled >= 0) inputs[lastFilled].focus();
        });
    });
}

function getEnteredOTP() {
    const inputs = document.querySelectorAll('.otp-digit');
    return Array.from(inputs).map(i => i.value).join('');
}

function clearOTPInputs() {
    const inputs = document.querySelectorAll('.otp-digit');
    inputs.forEach(i => i.value = '');
    if (inputs.length > 0) inputs[0].focus();
}

// ========== Step Navigation ==========
function goToStep(stepNum) {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById(`step${stepNum}`).classList.add('active');
}

// ========== Generate & Send OTP ==========
async function generateAndSendOTP() {
    const phoneInput = document.getElementById('phoneNumber').value.trim();
    const countryCode = document.getElementById('countryCode').value;
    const apiKey = document.getElementById('apiKey').value.trim() || 'textbelt';
    const digits = parseInt(document.getElementById('otpDigits').value);
    const expiry = parseInt(document.getElementById('otpExpiry').value);

    // Validate phone
    if (!phoneInput) {
        showToast('Masukkan nomor HP tujuan', 'error');
        return;
    }

    const cleanPhone = phoneInput.replace(/\D/g, '');
    if (cleanPhone.length < 8) {
        showToast('Nomor HP terlalu pendek', 'error');
        return;
    }

    // Check daily limit for free tier
    if (apiKey === 'textbelt' && isDailyLimitReached()) {
        showToast('Limit gratis 1 SMS/hari sudah tercapai. Gunakan API key sendiri.', 'error');
        return;
    }

    // Save settings
    currentSettings = { digits, expiryMinutes: expiry };
    currentPhoneNumber = `${countryCode} ${cleanPhone}`;

    // Generate OTP
    const otp = generateRandomOTP(digits);
    currentOTP = {
        code: otp,
        createdAt: Date.now(),
        expiresAt: Date.now() + (expiry * 60 * 1000),
        phone: currentPhoneNumber
    };

    // Build message
    const message = `Kode OTP Anda: ${otp}. Berlaku ${expiry} menit. Jangan bagikan kode ini kepada siapapun.`;

    // Show loading
    showLoading(true);

    try {
        // Send via TextBelt API
        const fullPhone = countryCode.replace('+', '') + cleanPhone;
        const response = await fetch(TEXTBELT_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                phone: fullPhone,
                message: message,
                key: apiKey
            })
        });

        const result = await response.json();

        if (result.success) {
            // Track limit for free tier
            if (apiKey === 'textbelt') {
                trackDailyUsage();
            }

            // Save to history
            addToHistory({
                phone: currentPhoneNumber,
                otp: otp,
                status: 'sent',
                timestamp: Date.now()
            });

            showToast('OTP berhasil dikirim!', 'success');

            // Go to verification step
            setupVerificationStep();
            goToStep(2);
        } else {
            const errorMsg = result.error || 'Gagal mengirim SMS';
            if (errorMsg.includes('quota') || errorMsg.includes('Out of quota')) {
                showToast('Limit SMS gratis sudah habis. Coba lagi besok atau gunakan API key.', 'error');
            } else {
                showToast(`Gagal: ${errorMsg}`, 'error');
            }
        }
    } catch (error) {
        console.error('Error:', error);
        // Fallback: Show OTP for testing even if API fails
        showToast('Gagal terhubung ke SMS API. Menampilkan OTP untuk testing.', 'warning');

        addToHistory({
            phone: currentPhoneNumber,
            otp: otp,
            status: 'failed',
            timestamp: Date.now()
        });

        setupVerificationStep();
        goToStep(2);
    } finally {
        showLoading(false);
    }
}

function generateRandomOTP(digits) {
    let otp = '';
    for (let i = 0; i < digits; i++) {
        otp += Math.floor(Math.random() * 10);
    }
    return otp;
}

// ========== Verification Step ==========
function setupVerificationStep() {
    // Update display
    document.getElementById('sentPhoneNumber').textContent = currentPhoneNumber;
    document.getElementById('sentOtpCode').textContent = currentOTP.code;

    // Setup countdown
    startCountdown();

    // Clear inputs
    clearOTPInputs();

    // Update OTP input boxes based on digit count
    const container = document.getElementById('otpInputs');
    container.innerHTML = '';
    for (let i = 0; i < currentSettings.digits; i++) {
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 1;
        input.className = 'otp-digit';
        input.dataset.index = i;
        container.appendChild(input);
    }
    initOTPInputs();
}

function startCountdown() {
    // Clear existing timer
    if (countdownInterval) clearInterval(countdownInterval);

    const expiryMs = currentSettings.expiryMinutes * 60 * 1000;
    let remaining = expiryMs;

    updateCountdownDisplay(remaining);

    countdownInterval = setInterval(() => {
        remaining -= 1000;
        if (remaining <= 0) {
            clearInterval(countdownInterval);
            currentOTP = null;
            updateCountdownDisplay(0);
            document.getElementById('countdown').textContent = 'EXPIRED';
            document.getElementById('countdown').classList.add('expired');
            showToast('Kode OTP sudah expired. Silakan kirim ulang.', 'error');
            updateHistoryStatus(currentPhoneNumber, 'expired');
        } else {
            updateCountdownDisplay(remaining);
        }
    }, 1000);
}

function updateCountdownDisplay(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    document.getElementById('countdown').textContent =
        `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ========== Verify OTP ==========
function verifyOTP() {
    const entered = getEnteredOTP();

    if (!currentOTP) {
        showToast('Kode OTP sudah expired. Silakan kirim ulang.', 'error');
        return;
    }

    if (entered.length !== currentSettings.digits) {
        showToast(`Masukkan ${currentSettings.digits} digit OTP`, 'error');
        return;
    }

    if (entered === currentOTP.code) {
        // Success
        clearInterval(countdownInterval);
        showToast('Verifikasi berhasil!', 'success');
        document.getElementById('verifiedPhone').textContent = currentPhoneNumber;
        updateHistoryStatus(currentPhoneNumber, 'verified');
        goToStep(3);
    } else {
        showToast('Kode OTP salah. Silakan coba lagi.', 'error');
        // Shake animation on inputs
        const inputs = document.querySelectorAll('.otp-digit');
        inputs.forEach(i => {
            i.style.animation = 'none';
            setTimeout(() => {
                i.style.animation = 'shake 0.4s ease';
            }, 10);
        });
    }
}

// ========== Resend OTP ==========
function resendOTP() {
    clearInterval(countdownInterval);
    goToStep(1);
    showToast('Silakan generate OTP baru', 'warning');
}

// ========== Reset App ==========
function resetApp() {
    currentOTP = null;
    currentPhoneNumber = null;
    clearInterval(countdownInterval);
    document.getElementById('phoneNumber').value = '';
    document.getElementById('countdown').classList.remove('expired');
    updateLimitDisplay();
    goToStep(1);
}

// ========== Daily Limit Management ==========
function isDailyLimitReached() {
    const today = new Date().toDateString();
    const savedDate = localStorage.getItem(STORAGE_KEYS.limitDate);
    const usedCount = parseInt(localStorage.getItem(STORAGE_KEYS.dailyLimit) || '0');

    if (savedDate !== today) {
        // Reset for new day
        localStorage.setItem(STORAGE_KEYS.limitDate, today);
        localStorage.setItem(STORAGE_KEYS.dailyLimit, '0');
        return false;
    }

    return usedCount >= 1; // 1 SMS per day for free
}

function trackDailyUsage() {
    const today = new Date().toDateString();
    const savedDate = localStorage.getItem(STORAGE_KEYS.limitDate);

    if (savedDate !== today) {
        localStorage.setItem(STORAGE_KEYS.limitDate, today);
        localStorage.setItem(STORAGE_KEYS.dailyLimit, '1');
    } else {
        const current = parseInt(localStorage.getItem(STORAGE_KEYS.dailyLimit) || '0');
        localStorage.setItem(STORAGE_KEYS.dailyLimit, String(current + 1));
    }

    updateLimitDisplay();
}

function updateLimitDisplay() {
    const today = new Date().toDateString();
    const savedDate = localStorage.getItem(STORAGE_KEYS.limitDate);
    const usedCount = savedDate === today ? parseInt(localStorage.getItem(STORAGE_KEYS.dailyLimit) || '0') : 0;

    const progressBar = document.getElementById('limitProgress');
    const limitText = document.getElementById('limitText');
    const resetTime = document.getElementById('resetTime');

    if (usedCount >= 1) {
        progressBar.classList.add('used');
        progressBar.style.width = '0%';
        limitText.textContent = '❌ Limit 1 SMS gratis/hari sudah tercapai';
        document.querySelector('.badge').textContent = 'LIMIT';
        document.querySelector('.badge').className = 'badge badge-used';
        document.getElementById('btnGenerate').disabled = true;
        document.getElementById('btnGenerateText').textContent = '⛔ Limit Tercapai - Gunakan API Key';
    } else {
        progressBar.classList.remove('used');
        progressBar.style.width = '100%';
        limitText.textContent = `✅ ${1 - usedCount} dari 1 SMS gratis tersedia hari ini`;
        document.querySelector('.badge').textContent = 'GRATIS';
        document.querySelector('.badge').className = 'badge badge-free';
        document.getElementById('btnGenerate').disabled = false;
        document.getElementById('btnGenerateText').textContent = '🚀 Generate & Kirim OTP';
    }

    // Calculate reset time (midnight)
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const diff = tomorrow - now;
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    resetTime.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function setupAutoClearLimit() {
    // Check and clear limit every minute
    setInterval(() => {
        const today = new Date().toDateString();
        const savedDate = localStorage.getItem(STORAGE_KEYS.limitDate);
        if (savedDate !== today) {
            updateLimitDisplay();
        }
    }, 60000);
}

// ========== History Management ==========
function addToHistory(entry) {
    const history = getHistory();
    history.unshift(entry);
    // Keep only last 20 entries
    if (history.length > 20) history.pop();
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
    renderHistory();
}

function getHistory() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.history) || '[]');
    } catch {
        return [];
    }
}

function updateHistoryStatus(phone, status) {
    const history = getHistory();
    const entry = history.find(h => h.phone === phone && h.status === 'sent');
    if (entry) {
        entry.status = status;
        localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history));
        renderHistory();
    }
}

function renderHistory() {
    const container = document.getElementById('historyList');
    const history = getHistory();

    if (history.length === 0) {
        container.innerHTML = '<p class="empty-state">Belum ada riwayat pengiriman</p>';
        return;
    }

    container.innerHTML = history.map(item => {
        const date = new Date(item.timestamp);
        const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        const statusClass = {
            'sent': 'status-pending',
            'verified': 'status-success',
            'failed': 'status-failed',
            'expired': 'status-expired'
        }[item.status] || 'status-pending';

        const statusLabel = {
            'sent': 'Terkirim',
            'verified': 'Terverifikasi',
            'failed': 'Gagal',
            'expired': 'Expired'
        }[item.status] || item.status;

        return `
            <div class="history-item">
                <div>
                    <div class="phone">${item.phone}</div>
                    <div class="time">${timeStr} - OTP: ${item.otp}</div>
                </div>
                <span class="status ${statusClass}">${statusLabel}</span>
            </div>
        `;
    }).join('');
}

// ========== UI Utilities ==========
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3500);
}

function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (show) {
        overlay.classList.add('show');
    } else {
        overlay.classList.remove('show');
    }
}

// ========== CSS Animation for Shake ==========
const style = document.createElement('style');
style.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-8px); }
        40% { transform: translateX(8px); }
        60% { transform: translateX(-4px); }
        80% { transform: translateX(4px); }
    }
`;
document.head.appendChild(style);
