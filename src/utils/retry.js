export async function withRetry(taskName, fn, options = {}) {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 1000;

  let lastError;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt > retries) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`${taskName} failed after ${retries + 1} attempts: ${lastError?.message || "unknown error"}`);
}
