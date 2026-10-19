import { randomUUID } from "node:crypto";
import { acquireAiSlot, disableKey, keyIsDisabled, releaseAiSlot, REQUEST_TIMEOUT_MS } from "./ai-throttle";
import { exponentialDelay, aiRateSettings, AiRateLimitError, providerRetryInfo } from "./ai-rate-policy";
import { AiServiceError, providerDiagnostic } from "./ai-errors";
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
export async function withOpenAIKey(call: (key: string, signal: AbortSignal, clientRequestId: string) => Promise<Response>, deadline: number): Promise<Response> {
  const keys = openaiKeys();
  if (!keys.length) throw new Error("openai_off");
  const settings = aiRateSettings();
  let keyIndex = 0;
  let lastError: Error = new AiServiceError("ai_failed", { origin: "transport" });
  for (let attempt = 0; attempt < settings.maxAttempts; attempt++) {
    while (keyIndex < keys.length && await keyIsDisabled(keys[keyIndex])) keyIndex++;
    if (keyIndex >= keys.length) throw lastError instanceof AiServiceError && lastError.code === "ai_unavailable"
      ? lastError : new AiServiceError("ai_unavailable", { origin: "app_cooldown", reason: "credentials_disabled" });
    const key = keys[keyIndex];
    const remaining = deadline - Date.now();
    if (remaining < 500) throw attempt ? lastError : new AiServiceError("ai_timeout", { origin: "deadline" });
    let lease;
    try { lease = await acquireAiSlot(deadline); }
    catch (error) {
      // A retry waiting for capacity must not disguise the failure that caused it.
      if (attempt > 0 && error instanceof AiRateLimitError && error.reason === "busy") throw lastError;
      throw error;
    }
    let released = false;
    const release = async (options: Parameters<typeof releaseAiSlot>[1] = {}) => {
      released = true;
      return releaseAiSlot(lease, options);
    };
    try {
      const clientRequestId = randomUUID();
      const signal = AbortSignal.timeout(Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now() - 500)));
      let upstream: Response | undefined;
      let response: Response;
      try {
        upstream = await call(key, signal, clientRequestId);
        const body = await upstream.arrayBuffer();
        response = new Response(body, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers });
      } catch (error) {
        const timedOut = signal.aborted || error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
        await release(timedOut ? {} : { delayMs: exponentialDelay(lease.failures, settings.retryBaseMs), reason: "busy" });
        const diagnostic = { ...providerDiagnostic(upstream, undefined, clientRequestId), origin: "transport" as const,
          reason: timedOut ? "request_timeout" : "connection_failed" };
        // A timed-out POST may already have been processed. Do not silently duplicate it.
        if (timedOut) throw new AiServiceError("ai_timeout", diagnostic);
        lastError = new AiServiceError("ai_failed", diagnostic);
        continue;
      }
      const details = response.ok ? {} : await response.clone().json().catch(() => ({}));
      const info = providerRetryInfo(response, details);
      const diagnostic = providerDiagnostic(response, details, clientRequestId);
      if (response.status === 429 && info.quotaExhausted) {
        // Preserve real provider hints, but never invent a billing reset time.
        await release({ delayMs: info.delayMs, reason: "quota" });
        throw new AiServiceError("ai_quota", diagnostic);
      }
      if (response.status === 429) {
        const delayMs = Math.max(info.delayMs ?? 0, exponentialDelay(lease.failures, settings.retryBaseMs));
        const waitMs = await release({ delayMs, reason: "rate" });
        lastError = new AiRateLimitError(Math.max(delayMs, waitMs) / 1000, "rate", diagnostic);
        if (attempt + 1 >= settings.maxAttempts || delayMs + 500 >= deadline - Date.now()) throw lastError;
        continue;
      }
      if (response.status === 401 || response.status === 403 || (response.status === 400 && info.invalidKey)) {
        await disableKey(key);
        await release();
        keyIndex++;
        lastError = new AiServiceError("ai_unavailable", diagnostic);
        continue;
      }
      if (response.status === 408 || response.status >= 500) {
        await release({ delayMs: Math.max(info.delayMs ?? 0, exponentialDelay(lease.failures, settings.retryBaseMs)), reason: "busy" });
        lastError = new AiServiceError(response.status === 408 ? "ai_timeout" : "ai_failed", diagnostic);
        if (response.status === 408) throw lastError;
        continue;
      }
      await release({ success: response.ok, delayMs: response.ok ? info.delayMs : undefined });
      return response;
    } finally {
      // Unexpected parsing/configuration failures must also release our own lease.
      if (!released) await release();
    }
  }
  throw lastError;
}
