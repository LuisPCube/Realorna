import { randomUUID, createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import { AiRateLimitError, aiRateSettings, type RateReason } from "./ai-rate-policy";

const SCOPE = "openai";
const REQUEST_TIMEOUT_MS = 45_000;
export { REQUEST_TIMEOUT_MS };
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export type AiLease = { id: string; failures: number };

export async function acquireAiSlot(deadline: number): Promise<AiLease> {
  const sql = await getSql();
  const settings = aiRateSettings();
  const queueDeadline = Math.min(deadline - 500, Date.now() + settings.maxQueueMs);
  await sql`insert into fact_ai_throttle (scope) values (${SCOPE}) on conflict (scope) do nothing`;
  while (true) {
    if (deadline - Date.now() < 500) throw new AiRateLimitError(1, "busy");
    const id = randomUUID();
    const rows = await sql.query<{ failure_count: number }>(`update fact_ai_throttle
      set lease_id = $2, lease_until = clock_timestamp() + interval '90 seconds',
          next_request_at = clock_timestamp() + ($3::int * interval '1 millisecond')
      where scope = $1 and next_request_at <= clock_timestamp() and blocked_until <= clock_timestamp()
        and (lease_until is null or lease_until <= clock_timestamp())
      returning failure_count`, [SCOPE, id, settings.intervalMs]);
    if (rows[0]) return { id, failures: Number(rows[0].failure_count) };
    const [state] = await sql.query<{ wait_ms: string | number; busy_ms: string | number; cooldown_ms: string | number; block_reason: RateReason }>(`select
      greatest(0, ceil(extract(epoch from (greatest(next_request_at, blocked_until) - clock_timestamp())) * 1000)) as wait_ms,
      greatest(0, ceil(extract(epoch from (coalesce(lease_until, clock_timestamp()) - clock_timestamp())) * 1000)) as busy_ms,
      greatest(0, ceil(extract(epoch from (blocked_until - clock_timestamp())) * 1000)) as cooldown_ms,
      block_reason from fact_ai_throttle where scope = $1`, [SCOPE]);
    const waitMs = Number(state?.wait_ms ?? 1000);
    const busyMs = Number(state?.busy_ms ?? 0);
    const reason = Number(state?.cooldown_ms ?? 0) > 0 ? state.block_reason : waitMs > 0 ? "rate" : "busy";
    const remaining = queueDeadline - Date.now();
    if (remaining <= 0 || waitMs > remaining) {
      throw new AiRateLimitError(Math.max(waitMs, busyMs, 1000) / 1000, reason);
    }
    await sleep(Math.min(1000, remaining, Math.max(100, waitMs)));
  }
}

export async function releaseAiSlot(lease: AiLease, options: { success?: boolean; delayMs?: number; reason?: RateReason } = {}) {
  const sql = await getSql();
  // The lease token prevents a timed-out worker from releasing a newer worker.
  const [state] = await sql.query<{ wait_ms: string | number }>(`update fact_ai_throttle set lease_id = null, lease_until = null,
    next_request_at = greatest(next_request_at, clock_timestamp() + ($6::int * interval '1 millisecond')),
    blocked_until = greatest(blocked_until, clock_timestamp() + ($3::bigint * interval '1 millisecond')),
    block_reason = $4,
    failure_count = case when $5 then 0 when $3 > 0 then least(failure_count + 1, 8) else failure_count end
    where scope = $1 and lease_id = $2 returning
      greatest(0, ceil(extract(epoch from (greatest(next_request_at, blocked_until) - clock_timestamp())) * 1000)) as wait_ms`,
    [SCOPE, lease.id, Math.ceil(options.delayMs ?? 0), options.reason ?? "rate", Boolean(options.success), aiRateSettings().intervalMs]);
  return Number(state?.wait_ms ?? options.delayMs ?? 0);
}

function keyHash(key: string) { return createHash("sha256").update(key).digest("hex"); }
export async function keyIsDisabled(key: string) {
  const sql = await getSql();
  const rows = await sql.query(`select key_hash from fact_ai_key_cooldowns where key_hash = $1 and disabled_until > clock_timestamp()`, [keyHash(key)]);
  return rows.length > 0;
}
export async function disableKey(key: string) {
  const sql = await getSql();
  await sql.query(`insert into fact_ai_key_cooldowns (key_hash, disabled_until) values ($1, clock_timestamp() + interval '10 minutes')
    on conflict (key_hash) do update set disabled_until = excluded.disabled_until`, [keyHash(key)]);
}
