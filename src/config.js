import path from "node:path";

const rootDir = process.cwd();

export const config = {
  baseUrl: "https://outlook.live.com/mail/",
  screenshotDir: path.join(rootDir, "artifacts", "screenshots"),
  traceDir: path.join(rootDir, "artifacts", "traces"),
  timeoutMs: 15000,
  headless: false,
  login: {
    email: process.env.OUTLOOK_EMAIL || "",
    password: process.env.OUTLOOK_PASSWORD || "",
    twoFactorCode: process.env.OUTLOOK_2FA_CODE || ""
  }
};
