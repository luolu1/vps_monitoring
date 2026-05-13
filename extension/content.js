function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
}

function queryFirst(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && isVisible(element)) {
      return element;
    }
  }
  return null;
}

async function waitForElement(selectors, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = queryFirst(selectors);
    if (el) return el;
    await delay(250);
  }
  return null;
}

function setInputValue(input, value) {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickElement(el) {
  el.focus();
  el.click();
}

async function handleLoginPage(credentials) {
  const emailInput = await waitForElement([
    'input[type="email"]',
    'input[name="loginfmt"]'
  ], 20000);

  if (emailInput) {
    setInputValue(emailInput, credentials.email);
    const nextBtn = queryFirst(['input[type="submit"]', 'button[type="submit"]']);
    if (nextBtn) {
      clickElement(nextBtn);
      await delay(1200);
    }
  }

  const passwordInput = await waitForElement([
    'input[type="password"]',
    'input[name="passwd"]'
  ], 20000);

  if (passwordInput) {
    setInputValue(passwordInput, credentials.password);
    const loginBtn = queryFirst(['input[type="submit"]', 'button[type="submit"]']);
    if (loginBtn) {
      clickElement(loginBtn);
      await delay(1200);
    }
  }

  const codeInput = await waitForElement([
    'input[name="otc"]',
    'input[name="code"]',
    'input[autocomplete="one-time-code"]'
  ], 8000);

  if (codeInput && credentials.twoFactorCode) {
    setInputValue(codeInput, credentials.twoFactorCode);
    const codeSubmit = queryFirst(['input[type="submit"]', 'button[type="submit"]']);
    if (codeSubmit) {
      clickElement(codeSubmit);
      await delay(1200);
    }
  }

  const staySignedInNo = queryFirst([
    'input#idBtn_Back',
    'input[type="submit"][value="No"]',
    'input[type="submit"][value="否"]'
  ]);

  if (staySignedInNo) {
    clickElement(staySignedInNo);
  }
}

function run() {
  chrome.storage.local.get(["outlookCredentials"], async (result) => {
    const credentials = result.outlookCredentials || {};
    if (!credentials.email || !credentials.password) {
      return;
    }

    if (location.hostname === "login.live.com" || location.hostname === "outlook.live.com") {
      try {
        await handleLoginPage(credentials);
      } catch (_) {
      }
    }
  });
}

run();
