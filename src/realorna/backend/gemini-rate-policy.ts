export type RateReason = "rate" | "quota" | "busy";

export class GeminiRateLimitError extends Error {
  constructor(public retryAfterSeconds: number, public reason: RateReason = "rate") {
    super("gemini_quota");
    this.name = "GeminiRateLimitError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

function integerSetting(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

export function geminiRateSettings() {
  return {
    // Five starts per minute by default. Match this to YOUR project's limits.
    intervalMs: integerSetting("GEMINI_MIN_INTERVAL_MS", 12_000, 1000, 300_000),
    maxAttempts: integerSetting("GEMINI_MAX_ATTEMPTS", 3, 1, 5),
    maxQueueMs: integerSetting("GEMINI_MAX_QUEUE_WAIT_MS", 15_000, 0, 30_000),
    retryBaseMs: integerSetting("GEMINI_RETRY_BASE_MS", 2000, 250, 30_000),
  };
}

export function exponentialDelay(failures: number, baseMs: number, random = Math.random) {
  const base = Math.min(60_000, baseMs * 2 ** Math.min(8, Math.max(0, failures)));
  // Positive jitter never retries earlier than the base or Google's hint.
  return Math.ceil(base + Math.max(0, Math.min(1, random())) * base * 0.25);
}

type ProviderError = { error?: { message?: string; status?: string; details?: Record<string, unknown>[] } };

function durationMs(raw: unknown): number | undefined {
  if (typeof raw === "string" && /^\d+(?:\.\d+)?s$/.test(raw)) return Math.ceil(parseFloat(raw) * 1000);
  if (raw && typeof raw === "object") {
    const duration = raw as { seconds?: unknown; nanos?: unknown };
    const seconds = Number(duration.seconds ?? 0) + Number(duration.nanos ?? 0) / 1e9;
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  }
  return undefined;
}

export function providerRetryInfo(response: Response, data: unknown, now = Date.now()) {
  const header = response.headers.get("retry-after")?.trim();
  let delayMs: number | undefined;
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) delayMs = Math.ceil(seconds * 1000);
    else {
      const date = Date.parse(header);
      if (Number.isFinite(date)) delayMs = Math.max(0, date - now);
    }
  }
  const error = (data && typeof data === "object" ? data : {}) as ProviderError;
  let dailyQuota = false;
  let invalidKey = false;
  for (const detail of error.error?.details ?? []) {
    if (!detail || typeof detail !== "object") continue;
    if (String(detail["@type"]).endsWith("google.rpc.RetryInfo")) {
      const hint = durationMs(detail.retryDelay);
      if (hint !== undefined) delayMs = Math.max(delayMs ?? 0, hint);
    }
    if (detail.reason === "API_KEY_INVALID" || detail.reason === "API_KEY_EXPIRED") invalidKey = true;
    if (Array.isArray(detail.violations)) {
      for (const violation of detail.violations) {
        if (!violation || typeof violation !== "object") continue;
        const row = violation as Record<string, unknown>;
        const metric = `${row.quotaMetric ?? ""} ${row.quotaId ?? ""} ${row.description ?? ""}`;
        if (/per.?day|daily/i.test(metric) || String(row.quotaValue) === "0") dailyQuota = true;
      }
    }
  }
  // Some REST failures provide only a message, without ErrorInfo details.
  if (/api key (?:not valid|expired|invalid)/i.test(error.error?.message ?? "")) invalidKey = true;
  if (delayMs !== undefined && (!Number.isFinite(delayMs) || delayMs < 0)) delayMs = undefined;
  return { delayMs, dailyQuota, invalidKey };
}
