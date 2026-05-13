import { chromium } from "playwright";
import { config } from "../config.js";

export async function createIncognitoContext() {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: config.headless
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai"
  });

  context.setDefaultTimeout(config.timeoutMs);
  context.setDefaultNavigationTimeout(config.timeoutMs);

  return { browser, context };
}
