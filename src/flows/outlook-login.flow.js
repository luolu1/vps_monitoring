import { config } from "../config.js";
import { withRetry } from "../utils/retry.js";
import { logInfo } from "../utils/logger.js";

async function clickIfVisible(page, selector) {
  const locator = page.locator(selector);
  if ((await locator.count()) > 0 && (await locator.first().isVisible())) {
    await locator.first().click();
    return true;
  }
  return false;
}

async function fill2faIfPresent(page, twoFactorCode) {
  const codeInputSelectors = [
    'input[name="otc"]',
    'input[name="code"]',
    'input[id*="otc"]',
    'input[autocomplete="one-time-code"]'
  ];

  for (const selector of codeInputSelectors) {
    const locator = page.locator(selector);
    if ((await locator.count()) > 0 && (await locator.first().isVisible())) {
      if (!twoFactorCode) {
        throw new Error("2FA page detected but OUTLOOK_2FA_CODE is empty");
      }
      await locator.first().fill(twoFactorCode);
      await page.keyboard.press("Enter");
      return;
    }
  }
}

export async function runOutlookLoginFlow(page) {
  const { email, password, twoFactorCode } = config.login;

  if (!email || !password) {
    throw new Error("OUTLOOK_EMAIL and OUTLOOK_PASSWORD are required");
  }

  logInfo("Open Outlook Mail");
  await withRetry("open outlook", async () => {
    await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
  });

  await clickIfVisible(page, 'a:has-text("Sign in")');
  await clickIfVisible(page, 'a:has-text("登录")');

  const emailInput = page.locator('input[type="email"], input[name="loginfmt"]');
  await emailInput.first().waitFor({ state: "visible" });
  await emailInput.first().fill(email);
  await page.keyboard.press("Enter");

  const passwordInput = page.locator('input[type="password"], input[name="passwd"]');
  await passwordInput.first().waitFor({ state: "visible" });
  await passwordInput.first().fill(password);
  await page.keyboard.press("Enter");

  await fill2faIfPresent(page, twoFactorCode);

  await clickIfVisible(page, 'input[type="submit"][value="Yes"]');
  await clickIfVisible(page, 'input[type="submit"][value="是"]');
  await clickIfVisible(page, 'input#idBtn_Back');

  await page.waitForURL(/outlook\.live\.com\/mail/i, { timeout: 45000 });
  logInfo("Outlook login completed");
}
