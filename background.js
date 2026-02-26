// Danh sách domain được phép
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ allowedDomains: [] });
});

// Lắng nghe message từ popup để update domain
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'ADD_DOMAIN') {
        chrome.storage.local.get('allowedDomains', (data) => {
            const domains = data.allowedDomains || [];
            if (!domains.includes(msg.domain)) domains.push(msg.domain);
            chrome.storage.local.set({ allowedDomains: domains }, () => {
                sendResponse({ success: true, domains });
            });
        });
        return true;
    } else if (msg.type === 'REMOVE_DOMAIN') {
        chrome.storage.local.get('allowedDomains', (data) => {
            let domains = data.allowedDomains || [];
            domains = domains.filter(d => d !== msg.domain);
            chrome.storage.local.set({ allowedDomains: domains }, () => {
                sendResponse({ success: true, domains });
            });
        });
        return true;
    } else if (msg.type === 'GET_DOMAINS') {
        chrome.storage.local.get('allowedDomains', (data) => {
            sendResponse({ domains: data.allowedDomains || [] });
        });
        return true;
    }
});
