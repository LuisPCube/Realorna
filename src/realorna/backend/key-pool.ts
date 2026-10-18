import { createHash } from "node:crypto";
// Ordered server-only failover. Never send keys or provider response bodies to
// browsers/logs. Cooldowns are best-effort per warm serverless process.
type Cooldown = { until: number; reason: "quota" | "auth" | "failure" };
const globalPool = globalThis as typeof globalThis & { __realornaKeyCooldownsV2?: Map<string, Cooldown> };
const cooldowns = globalPool.__realornaKeyCooldownsV2 ??= new Map<string, Cooldown>();
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
  let quota = false;
  let auth = false;
  let failed = false;
  for (const key of keys) {
    const id = createHash("sha256").update(key).digest("hex");
    const cooldown = cooldowns.get(id);
    if (cooldown && cooldown.until > Date.now()) {
      if (cooldown.reason === "quota") quota = true;
      else if (cooldown.reason === "auth") auth = true;
      else failed = true;
      continue;
    }
    const remaining = deadline - Date.now();
    if (remaining < 300) break;
    try {
      const response = await call(key, AbortSignal.timeout(Math.min(20_000, remaining)));
      if (response.status === 429) {
        quota = true;
        const retry = response.headers.get("retry-after");
        const seconds = retry ? Number(retry) || (Date.parse(retry) - Date.now()) / 1000 : 60;
        cooldowns.set(id, { until: Date.now() + Math.min(86_400, Math.max(1, seconds || 60)) * 1000, reason: "quota" });
      } else if (response.status === 401 || response.status === 403) {
        auth = true; cooldowns.set(id, { until: Date.now() + 600_000, reason: "auth" });
      } else if (response.status >= 500) {
        failed = true; cooldowns.set(id, { until: Date.now() + 10_000, reason: "failure" });
      } else return response;
      await response.body?.cancel();
    } catch { failed = true; }
  }
  throw new Error(quota ? "gemini_quota" : auth && !failed ? "gemini_off" : "gemini_failed");
}
