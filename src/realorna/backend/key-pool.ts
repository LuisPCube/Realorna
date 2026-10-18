import { acquireGeminiSlot, disableKey, keyIsDisabled, releaseGeminiSlot, REQUEST_TIMEOUT_MS } from "./gemini-throttle";
import { exponentialDelay, geminiRateSettings, GeminiRateLimitError, providerRetryInfo } from "./gemini-rate-policy";
export { GeminiRateLimitError } from "./gemini-rate-policy";
// Ordered failover for rejected credentials; 429 never immediately hops keys.
// All calls, including transcription, use the shared Postgres request gate.
export function geminiKeys(): string[] {
  const raw = process.env.GEMINI_API_KEYS?.trim();
  let values: unknown[] = [];
  if (raw) {
    if (raw.startsWith("[")) {
      try { const parsed = JSON.parse(raw); if (!Array.isArray(parsed)) throw new Error(); values = parsed; }
      catch { throw new Error("gemini_off"); }
    } else values = raw.split(/[\n,]+/);
  }
  if (process.env.GEMINI_API_KEY?.trim()) values.push(process.env.GEMINI_API_KEY);
  return [...new Set(values.filter((v): v is string => typeof v === "string").map(v => v.trim()).filter(Boolean))].slice(0, 12);
}
export function hasGeminiKeys() { return geminiKeys().length > 0; }
export async function withGeminiKey(call: (key: string, signal: AbortSignal) => Promise<Response>, deadline: number): Promise<Response> {
  const keys = geminiKeys();
  if (!keys.length) throw new Error("gemini_off");
  const settings = geminiRateSettings();
  let keyIndex = 0;
  let lastError: Error = new Error("gemini_failed");
  for (let attempt = 0; attempt < settings.maxAttempts; attempt++) {
    while (keyIndex < keys.length && await keyIsDisabled(keys[keyIndex])) keyIndex++;
    if (keyIndex >= keys.length) throw new Error("gemini_off");
    const key = keys[keyIndex];
    const remaining = deadline - Date.now();
    if (remaining < 500) break;
    const lease = await acquireGeminiSlot(deadline);
    let response: Response;
    try {
      response = await call(key, AbortSignal.timeout(Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()))));
    } catch {
      await releaseGeminiSlot(lease, { delayMs: exponentialDelay(lease.failures, settings.retryBaseMs), reason: "busy" });
      lastError = new Error("gemini_failed");
      continue;
    }
    const details = response.ok ? {} : await response.clone().json().catch(() => ({}));
    const info = providerRetryInfo(response, details);
    if (response.status === 429) {
      const delayMs = Math.max(info.delayMs ?? (info.dailyQuota ? 3_600_000 : 0), exponentialDelay(lease.failures, settings.retryBaseMs));
      const reason = info.dailyQuota ? "quota" : "rate";
      const waitMs = await releaseGeminiSlot(lease, { delayMs, reason });
      await response.body?.cancel().catch(() => undefined);
      lastError = new GeminiRateLimitError(Math.max(delayMs, waitMs) / 1000, reason);
      if (info.dailyQuota || attempt + 1 >= settings.maxAttempts || delayMs + 500 >= deadline - Date.now()) throw lastError;
      // Wait through the shared gate before retrying this SAME key.
      continue;
    }
    if (response.status === 401 || response.status === 403 || (response.status === 400 && info.invalidKey)) {
      await disableKey(key);
      await releaseGeminiSlot(lease);
      await response.body?.cancel().catch(() => undefined);
      keyIndex++;
      lastError = new Error("gemini_off");
      continue;
    }
    if (response.status === 408 || response.status >= 500) {
      await releaseGeminiSlot(lease, { delayMs: Math.max(info.delayMs ?? 0, exponentialDelay(lease.failures, settings.retryBaseMs)), reason: "busy" });
      await response.body?.cancel().catch(() => undefined);
      lastError = new Error("gemini_failed");
      continue;
    }
    await releaseGeminiSlot(lease, { success: response.ok });
    return response;
  }
  throw lastError;
}
