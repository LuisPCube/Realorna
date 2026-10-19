export type RateReason = "rate" | "quota" | "busy";

export class AiRateLimitError extends Error {
  constructor(public retryAfterSeconds: number, public reason: RateReason = "rate", public diagnostic: AiDiagnostic = { origin: "app_cooldown" }) {
    super("ai_quota");
    this.name = "AiRateLimitError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

function integerSetting(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

export function aiRateSettings() {
  return {
    intervalMs: integerSetting("OPENAI_MIN_INTERVAL_MS", 12_000, 1000, 300_000),
    maxAttempts: integerSetting("OPENAI_MAX_ATTEMPTS", 3, 1, 5),
    maxQueueMs: integerSetting("OPENAI_MAX_QUEUE_WAIT_MS", 30_000, 0, 60_000),
    retryBaseMs: integerSetting("OPENAI_RETRY_BASE_MS", 2000, 250, 30_000),
  };
}

export function exponentialDelay(failures: number, baseMs: number, random = Math.random) {
  const base = Math.min(60_000, baseMs * 2 ** Math.min(8, Math.max(0, failures)));
  return Math.ceil(base + Math.max(0, Math.min(1, random())) * base * 0.25);
}

// OpenAI reset headers contain durations such as "6m0s" or "1.5s".
export function resetDurationMs(raw: string | null) {
  if (!raw || !/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(raw)) return undefined;
  let ms = 0;
  for (const match of raw.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    ms += Number(match[1]) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2]] ?? 0);
  }
  return Number.isFinite(ms) ? Math.ceil(ms) : undefined;
}

export function providerRetryInfo(response: Response, data: unknown, now = Date.now()) {
  const delays: number[] = [];
  const header = response.headers.get("retry-after")?.trim();
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) delays.push(Math.ceil(seconds * 1000));
    else if (Number.isFinite(Date.parse(header))) delays.push(Math.max(0, Date.parse(header) - now));
  }
  const retryMs = Number(response.headers.get("retry-after-ms"));
  if (retryMs > 0 && Number.isFinite(retryMs)) delays.push(Math.ceil(retryMs));
  for (const dimension of ["requests", "tokens", "project-tokens"]) {
    const remaining = response.headers.get(`x-ratelimit-remaining-${dimension}`);
    if (remaining !== null && Number(remaining) <= 0) {
      const reset = resetDurationMs(response.headers.get(`x-ratelimit-reset-${dimension}`));
      if (reset !== undefined) delays.push(reset);
    }
  }
  const error = (data as { error?: { code?: string; type?: string } } | null)?.error;
  const code = String(error?.code ?? error?.type ?? "");
  const quotaExhausted = error?.type === "insufficient_quota" || /^(insufficient_quota|credit_balance_exhausted|billing_hard_limit_reached|organization_spend_limit_exceeded|project_spend_limit_exceeded|organization_usage_limit_exceeded|usage_limit_exceeded)$/.test(code);
  const invalidKey = code === "invalid_api_key";
  return { delayMs: delays.length ? Math.max(...delays) : undefined, quotaExhausted, invalidKey };
}
import type { AiDiagnostic } from "./ai-errors";

