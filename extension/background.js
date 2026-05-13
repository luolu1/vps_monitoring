const OUTLOOK_URL = "https://outlook.live.com/mail/";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "startLogin") {
    return;
  }

  const payload = {
    email: message.email || "",
    password: message.password || "",
    twoFactorCode: message.twoFactorCode || ""
  };

  chrome.storage.local.set({ outlookCredentials: payload }, () => {
    chrome.windows.create({
      url: OUTLOOK_URL,
      incognito: true,
      focused: true
    }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true });
    });
  });

  return true;
});
