/**
 * =======================================================================================
 * POPUP.JS — Trợ lý Học tập HG
 * Phiên bản: 3.3
 * Mục đích: Quản lý domain được phép & hiển thị trạng thái license
 * =======================================================================================
 */

// ===============================
// ELEMENTS
// ===============================
const domainInput = document.getElementById('domain-input');
const addBtn = document.getElementById('add-domain-btn');
const domainList = document.getElementById('domain-list');
const licenseStatus = document.getElementById('license-status');

// ===============================
// HÀM CHUẨN HÓA DOMAIN
// ===============================
function normalizeDomain(input) {
    return input
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')  // Bỏ http:// hoặc https://
        .replace(/^www\./, '')        // Bỏ www.
        .replace(/\/+$/, '');         // Bỏ dấu / cuối
}

// ===============================
// HIỂN THỊ DANH SÁCH DOMAIN
// ===============================
function renderDomains(domains) {
    domainList.innerHTML = '';
    if (!domains || domains.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'Chưa có domain nào.';
        li.style.color = '#888';
        li.style.fontStyle = 'italic';
        domainList.appendChild(li);
        return;
    }

    domains.forEach(d => {
        const li = document.createElement('li');
        li.textContent = d;

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Xóa';
        delBtn.style.marginLeft = '8px';
        delBtn.style.backgroundColor = '#dc3545';
        delBtn.style.color = 'white';
        delBtn.style.border = 'none';
        delBtn.style.borderRadius = '3px';
        delBtn.style.cursor = 'pointer';
        delBtn.style.padding = '2px 6px';
        delBtn.style.fontSize = '12px';

        delBtn.addEventListener('click', () => removeDomain(d));
        li.appendChild(delBtn);
        domainList.appendChild(li);
    });
}

// ===============================
// THÊM DOMAIN
// ===============================
function addDomain() {
    const domain = normalizeDomain(domainInput.value);
    if (!domain) return;

    chrome.runtime.sendMessage({ type: 'ADD_DOMAIN', domain }, (res) => {
        if (chrome.runtime.lastError) {
            console.error('Lỗi gửi message:', chrome.runtime.lastError);
            return;
        }
        renderDomains(res.domains);
        domainInput.value = '';
    });
}

// ===============================
// XÓA DOMAIN
// ===============================
function removeDomain(domain) {
    chrome.runtime.sendMessage({ type: 'REMOVE_DOMAIN', domain }, (res) => {
        if (chrome.runtime.lastError) {
            console.error('Lỗi gửi message:', chrome.runtime.lastError);
            return;
        }
        renderDomains(res.domains);
    });
}

// ===============================
// KHI POPUP MỞ RA
// ===============================
chrome.runtime.sendMessage({ type: 'GET_DOMAINS' }, (res) => {
    if (res && res.domains) renderDomains(res.domains);
});

// ===============================
// TRẠNG THÁI LICENSE / TRIAL
// ===============================
chrome.storage.local.get(['encryptedLicenseKey', 'installDate'], (data) => {
    let msg = '';
    if (data.encryptedLicenseKey) {
        msg = '✅ Đã kích hoạt bản quyền';
    } else if (data.installDate) {
        const installDate = new Date(data.installDate);
        const now = new Date();
        const daysUsed = Math.floor((now - installDate) / (1000 * 60 * 60 * 24));
        const remaining = 90 - daysUsed;
        msg = `⏳ Dùng thử: ${daysUsed}/90 ngày (${remaining > 0 ? remaining + ' ngày còn lại' : 'Hết hạn'})`;
    } else {
        msg = '⚠️ Chưa kích hoạt hoặc chưa bắt đầu dùng thử';
    }
    licenseStatus.textContent = msg;
});

// ===============================
// GẮN SỰ KIỆN
// ===============================
addBtn.addEventListener('click', addDomain);
domainInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addDomain();
});
