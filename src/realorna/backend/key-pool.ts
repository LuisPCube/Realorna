import { acquireAiSlot, disableKey, keyIsDisabled, releaseAiSlot, REQUEST_TIMEOUT_MS } from "./ai-throttle";
import { exponentialDelay, aiRateSettings, AiRateLimitError, providerRetryInfo } from "./ai-rate-policy";
export { AiRateLimitError } from "./ai-rate-policy";
// Ordered failover for rejected credentials; 429 never immediately hops keys.
// All calls, including transcription, use the shared Postgres request gate.
export function openaiKeys(): string[] {
  const raw = process.env.OPENAI_API_KEYS?.trim();
  let values: unknown[] = [];
  if (raw) {
    if (raw.startsWith("[")) {
      try { const parsed = JSON.parse(raw); if (!Array.isArray(parsed)) throw new Error(); values = parsed; }
      catch { throw new Error("openai_off"); }
    } else values = raw.split(/[\n,]+/);
  }
  if (process.env.OPENAI_API_KEY?.trim()) values.push(process.env.OPENAI_API_KEY);
  return [...new Set(values.filter((v): v is string => typeof v === "string").map(v => v.trim()).filter(Boolean))].slice(0, 12);
}
export function hasOpenAIKeys() { return openaiKeys().length > 0; }
export async function withOpenAIKey(call: (key: string, signal: AbortSignal) => Promise<Response>, deadline: number): Promise<Response> {
  const keys = openaiKeys();
  if (!keys.length) throw new Error("openai_off");
  const settings = aiRateSettings();
  let keyIndex = 0;
  let lastError: Error = new Error("openai_failed");
  for (let attempt = 0; attempt < settings.maxAttempts; attempt++) {
    while (keyIndex < keys.length && await keyIsDisabled(keys[keyIndex])) keyIndex++;
    if (keyIndex >= keys.length) throw new Error("openai_off");
    const key = keys[keyIndex];
    const remaining = deadline - Date.now();
    if (remaining < 500) break;
    const lease = await acquireAiSlot(deadline);
    let response: Response;
    try {
      const signal = AbortSignal.timeout(Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now())));
      const upstream = await call(key, signal);
      const body = await upstream.arrayBuffer();
      response = new Response(body, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers });
    } catch {
      await releaseAiSlot(lease, { delayMs: exponentialDelay(lease.failures, settings.retryBaseMs), reason: "busy" });
      lastError = new Error("openai_failed");
      continue;
    }
    const details = response.ok ? {} : await response.clone().json().catch(() => ({}));
    const info = providerRetryInfo(response, details);
    if (response.status === 429) {
      const delayMs = Math.max(info.delayMs ?? (info.quotaExhausted ? 3_600_000 : 0), exponentialDelay(lease.failures, settings.retryBaseMs));
      const reason = info.quotaExhausted ? "quota" : "rate";
      const waitMs = await releaseAiSlot(lease, { delayMs, reason });
      await response.body?.cancel().catch(() => undefined);
      lastError = new AiRateLimitError(Math.max(delayMs, waitMs) / 1000, reason);
      if (info.quotaExhausted || attempt + 1 >= settings.maxAttempts || delayMs + 500 >= deadline - Date.now()) throw lastError;
      // Wait through the shared gate before retrying this SAME key.
      continue;
    }
    if (response.status === 401 || response.status === 403 || (response.status === 400 && info.invalidKey)) {
      await disableKey(key);
      await releaseAiSlot(lease);
      await response.body?.cancel().catch(() => undefined);
      keyIndex++;
      lastError = new Error("openai_off");
      continue;
    }
    if (response.status === 408 || response.status >= 500) {
      await releaseAiSlot(lease, { delayMs: Math.max(info.delayMs ?? 0, exponentialDelay(lease.failures, settings.retryBaseMs)), reason: "busy" });
      await response.body?.cancel().catch(() => undefined);
      lastError = new Error("openai_failed");
      continue;
    }
    await releaseAiSlot(lease, { success: response.ok, delayMs: response.ok ? info.delayMs : undefined });
    return response;
  }
  throw lastError;
}
