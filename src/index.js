import path from "node:path";
import { createIncognitoContext } from "./browser/context.js";
import { config } from "./config.js";
import { runOutlookLoginFlow } from "./flows/outlook-login.flow.js";
import { ensureDirSync } from "./utils/fs.js";
import { logInfo, logError } from "./utils/logger.js";

async function main() {
  const { browser, context } = await createIncognitoContext();
  const page = await context.newPage();

  ensureDirSync(config.screenshotDir);
  ensureDirSync(config.traceDir);

  const traceFile = path.join(config.traceDir, `trace-${Date.now()}.zip`);
  await context.tracing.start({ screenshots: true, snapshots: true });

  try {
    logInfo("Automation started", { mode: "incognito" });
    await runOutlookLoginFlow(page);
    logInfo("Automation completed");
  } catch (error) {
    const screenshotPath = path.join(config.screenshotDir, `failed-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    logError("Automation failed", error);
    logInfo("Failure screenshot saved", { path: screenshotPath });
    process.exitCode = 1;
  } finally {
    await context.tracing.stop({ path: traceFile });
    logInfo("Trace saved", { path: traceFile });
    await context.close();
    await browser.close();
  }
}

main();
