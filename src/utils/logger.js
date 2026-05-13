function nowIso() {
  return new Date().toISOString();
}

export function logInfo(message, extra = {}) {
  const payload = Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[INFO] ${nowIso()} ${message}${payload}`);
}

export function logError(message, error) {
  const detail = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { error };
  console.error(`[ERROR] ${nowIso()} ${message} ${JSON.stringify(detail)}`);
}
