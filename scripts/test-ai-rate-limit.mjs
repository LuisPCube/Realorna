import assert from "node:assert/strict";
if (process.env.DATABASE_URL?.trim() || process.env.VERCEL) throw new Error("Run rate-limit tests without DATABASE_URL or VERCEL.");
delete process.env.XAI_API_KEY;
delete process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEYS = "fixture-first,fixture-second";
process.env.OPENAI_MODEL = "fixture-model";
process.env.OPENAI_TRANSCRIBE_MODEL = "fixture-transcribe";
process.env.OPENAI_MIN_INTERVAL_MS = "1000";
process.env.OPENAI_MAX_ATTEMPTS = "3";
process.env.OPENAI_MAX_QUEUE_WAIT_MS = "2000";
process.env.OPENAI_RETRY_BASE_MS = "250";
const { createServer } = await import("vite");
const server = await createServer({ server: { middlewareMode: true }, logLevel: "error" });
const originalFetch = globalThis.fetch;
const checks = [];
try {
  const { getSql, dbSource } = await server.ssrLoadModule("/src/lib/db.ts");
  assert.equal(dbSource, "pglite");
  const sql = await getSql();
  const pool = await server.ssrLoadModule("/src/realorna/backend/key-pool.ts");
  const gate = await server.ssrLoadModule("/src/realorna/backend/ai-throttle.ts");
  const policy = await server.ssrLoadModule("/src/realorna/backend/ai-rate-policy.ts");
  const openai = await server.ssrLoadModule("/src/realorna/backend/openai.ts");
  const errors = await server.ssrLoadModule("/src/realorna/backend/check-errors.ts");
  const { AiServiceError } = await server.ssrLoadModule("/src/realorna/backend/ai-errors.ts");
  async function test(name, fn) {
    // This database is isolated by the guard and dbSource assertion above.
    await sql`delete from fact_ai_throttle`;
    await sql`delete from fact_ai_key_cooldowns`;
    process.env.OPENAI_API_KEYS = "fixture-first,fixture-second";
    process.env.OPENAI_MAX_QUEUE_WAIT_MS = "2000";
    globalThis.fetch = originalFetch;
    await fn(); checks.push(name); console.log("PASS " + name);
  }
  await test("Retry-After seconds, HTTP dates and OpenAI reset headers all set a minimum delay", async () => {
    const now = Date.parse("2026-10-18T00:00:00Z");
    assert.equal(policy.providerRetryInfo(new Response("", { headers: { "Retry-After": "4" } }), {}, now).delayMs, 4000);
    assert.equal(policy.providerRetryInfo(new Response("", { headers: { "Retry-After": "Sun, 18 Oct 2026 00:00:09 GMT" } }), {}, now).delayMs, 9000);
    assert.equal(policy.providerRetryInfo(new Response("", { headers: { "Retry-After": "2", "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "1m5.5s" } }), {}, now).delayMs, 65_500);
    assert.equal(policy.providerRetryInfo(new Response("", { headers: { "x-ratelimit-remaining-tokens": "10", "x-ratelimit-reset-tokens": "1h" } }), {}, now).delayMs, undefined);
    assert.equal(policy.resetDurationMs("2h1m500ms"), 7_260_500);
    assert.equal(policy.resetDurationMs("nonsense"), undefined);
  });
  await test("Exponential backoff grows, adds positive jitter, and configuration cannot disable pacing accidentally", async () => {
    assert.equal(policy.exponentialDelay(0, 2000, () => 0), 2000);
    assert.equal(policy.exponentialDelay(1, 2000, () => 0), 4000);
    assert.equal(policy.exponentialDelay(2, 2000, () => 1), 10_000);
    process.env.OPENAI_MIN_INTERVAL_MS = "0";
    assert.equal(policy.aiRateSettings().intervalMs, 12_000);
    process.env.OPENAI_MIN_INTERVAL_MS = "1000";
  });
  await test("Concurrent callers share one in-flight request and spaced start times", async () => {
    const times = []; let active = 0; let peak = 0;
    const call = async () => {
      times.push(Date.now()); peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 40)); active--;
      return new Response("{}");
    };
    await Promise.all([pool.withOpenAIKey(call, Date.now() + 5000), pool.withOpenAIKey(call, Date.now() + 5000)]);
    assert.equal(peak, 1); assert.equal(times.length, 2); assert.ok(times[1] - times[0] >= 950, JSON.stringify(times));
  });
  await test("Slow response bodies keep the lease until completion and delay the next request", async () => {
    process.env.OPENAI_MAX_QUEUE_WAIT_MS = "4000";
    let calls = 0; let firstEnded = 0; let secondStarted = 0;
    const call = async () => {
      calls++;
      if (calls === 2) { secondStarted = Date.now(); return new Response("{}"); }
      return new Response(new ReadableStream({ start(controller) {
        setTimeout(() => { controller.enqueue(new TextEncoder().encode("{}")); firstEnded = Date.now(); controller.close(); }, 1200);
      } }));
    };
    await Promise.all([pool.withOpenAIKey(call, Date.now() + 8000), pool.withOpenAIKey(call, Date.now() + 8000)]);
    assert.equal(calls, 2); assert.ok(secondStarted - firstEnded >= 950);
  });
  await test("A short 429 retries the same key after pacing and then succeeds", async () => {
    const keys = []; const times = [];
    const result = await pool.withOpenAIKey(async key => {
      keys.push(key); times.push(Date.now()); return new Response("{}", { status: keys.length === 1 ? 429 : 200 });
    }, Date.now() + 5000);
    assert.equal(result.status, 200); assert.deepEqual(keys, ["fixture-first", "fixture-first"]);
    assert.ok(times[1] - times[0] >= 950);
  });
  await test("Delayed workers cannot bunch up calls by consuming the reserved interval before sending", async () => {
    const first = await gate.acquireAiSlot(Date.now() + 5000);
    await new Promise(resolve => setTimeout(resolve, 300));
    const sentAt = Date.now();
    await gate.releaseAiSlot(first, { success: true });
    const next = await gate.acquireAiSlot(Date.now() + 5000);
    assert.ok(Date.now() - sentAt >= 950);
    await gate.releaseAiSlot(next, { success: true });
  });
  await test("A long 429 is shared across requests and keys instead of immediately key hopping", async () => {
    let calls = 0;
    const call = async () => { calls++; return new Response("{}", { status: 429, headers: { "Retry-After": "60" } }); };
    await assert.rejects(() => pool.withOpenAIKey(call, Date.now() + 5000), error => error.message === "ai_quota" && error.retryAfterSeconds >= 60);
    assert.equal(calls, 1);
    process.env.OPENAI_API_KEYS = "another-key-from-the-same-project";
    await assert.rejects(() => pool.withOpenAIKey(call, Date.now() + 5000), /ai_quota/);
    assert.equal(calls, 1);
  });
  await test("Exhausted credit and spending quota failures are not automatically retried", async () => {
    let calls = 0;
    const body = { error: { code: "insufficient_quota" } };
    await assert.rejects(() => pool.withOpenAIKey(async () => {
      calls++; return new Response(JSON.stringify(body), { status: 429 });
    }, Date.now() + 5000), error => error.code === "ai_quota" && !error.retryAfterSeconds);
    assert.equal(calls, 1);
    const [state] = await sql`select blocked_until, lease_id from fact_ai_throttle`;
    assert.ok(new Date(state.blocked_until).getTime() <= Date.now()); assert.equal(state.lease_id, null);
    // The same configured key can work after credits are restored without an hour-long app lock.
    const restored = await pool.withOpenAIKey(async () => { calls++; return new Response("{}"); }, Date.now() + 5000);
    assert.equal(restored.status, 200); assert.equal(calls, 2);
  });
  await test("A 36-second occupied lease offers a short capacity retry without releasing the active request", async () => {
    const held = await gate.acquireAiSlot(Date.now() + 5000);
    await sql`update fact_ai_throttle set next_request_at = now() - interval '1 second',
      lease_until = now() + interval '36 seconds'`;
    process.env.OPENAI_MAX_QUEUE_WAIT_MS = "0";
    let calls = 0; let failure;
    try { await pool.withOpenAIKey(async () => { calls++; return new Response("{}"); }, Date.now() + 5000); }
    catch (error) { failure = errors.asCheckError(error); }
    assert.equal(calls, 0); assert.equal(failure.code, "ai_busy");
    const response = errors.checkErrorResponse(failure); const body = await response.json();
    assert.equal(response.status, 503); assert.equal(body.retry_reason, "busy");
    assert.equal(body.error_origin, "app_queue"); assert.equal(body.retry_after_seconds, 3);
    assert.equal(Number(response.headers.get("Retry-After")), body.retry_after_seconds);
    assert.equal(body.provider_status, undefined);
    const [state] = await sql`select lease_id from fact_ai_throttle`; assert.equal(state.lease_id, held.id);
    await gate.releaseAiSlot(held);
  });
  await test("A timed-out POST releases the slot and stops without silently repeating the request", async () => {
    let calls = 0; let failure;
    try { await pool.withOpenAIKey(async () => { calls++; throw new DOMException("fixture-private-data", "TimeoutError"); }, Date.now() + 5000); }
    catch (error) { failure = errors.asCheckError(error); }
    assert.equal(calls, 1); assert.equal(failure.code, "ai_timeout");
    const response = errors.checkErrorResponse(failure); const body = await response.json();
    assert.equal(response.status, 504); assert.equal(body.error_origin, "transport");
    assert.equal(body.diagnostic_reason, "request_timeout"); assert.equal(response.headers.get("Retry-After"), null);
    assert.doesNotMatch(JSON.stringify(body), /fixture-private-data|fixture-first/);
    const [state] = await sql`select lease_id from fact_ai_throttle`; assert.equal(state.lease_id, null);
  });
  await test("An unavailable provider remains identifiable when its retry is delayed by the shared gate", async () => {
    let calls = 0; let failure;
    try { await pool.withOpenAIKey(async () => {
      calls++; return new Response(JSON.stringify({ error: { code: "server_is_overloaded", message: "fixture-private-data" } }),
        { status: 503, headers: { "Retry-After": "60", "x-request-id": "req_fixture" } });
    }, Date.now() + 5000); } catch (error) { failure = errors.asCheckError(error); }
    assert.equal(calls, 1); assert.equal(failure.code, "ai_failed");
    const response = errors.checkErrorResponse(failure); const body = await response.json();
    assert.equal(response.status, 502); assert.equal(body.provider_status, 503);
    assert.equal(body.provider_code, "server_is_overloaded"); assert.equal(body.provider_request_id, "req_fixture");
    assert.doesNotMatch(JSON.stringify(body), /fixture-private-data|fixture-first/);
  });
  await test("Billing codes and insufficient_quota types require action and do not promise a reset countdown", async () => {
    assert.equal(policy.providerRetryInfo(new Response("", { status: 429 }),
      { error: { code: "new_billing_code", type: "insufficient_quota" } }).quotaExhausted, true);
    const failure = errors.asCheckError(new AiServiceError("ai_quota", { origin: "openai", provider_status: 429, provider_code: "credit_balance_exhausted" }));
    const response = errors.checkErrorResponse(failure); const body = await response.json();
    assert.equal(response.status, 503); assert.equal(body.error, "ai_quota");
    assert.equal(body.retry_after_seconds, undefined); assert.equal(response.headers.get("Retry-After"), null);
  });
  await test("A real provider rate-limit hint remains a 429 with its request ID and minimum delay", async () => {
    let failure;
    try { await pool.withOpenAIKey(async () => new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }),
      { status: 429, headers: { "Retry-After": "60", "x-request-id": "req_rate_fixture" } }), Date.now() + 5000); }
    catch (error) { failure = errors.asCheckError(error); }
    const response = errors.checkErrorResponse(failure); const body = await response.json();
    assert.equal(response.status, 429); assert.equal(body.error, "rate"); assert.equal(body.error_origin, "openai");
    assert.equal(body.provider_request_id, "req_rate_fixture"); assert.ok(Number(response.headers.get("Retry-After")) >= 60);
  });
  await test("Repeated short 429 responses stop after the configured maximum attempts", async () => {
    let calls = 0;
    await assert.rejects(() => pool.withOpenAIKey(async () => {
      calls++; return new Response("{}", { status: 429 });
    }, Date.now() + 6000), /ai_quota/);
    assert.equal(calls, 3);
  });
  await test("Invalid credentials fail over with pacing and their cooldown is stored in the database", async () => {
    const keys = [];
    await pool.withOpenAIKey(async key => {
      keys.push(key); return new Response("{}", { status: key === "fixture-first" ? 403 : 200 });
    }, Date.now() + 5000);
    assert.deepEqual(keys, ["fixture-first", "fixture-second"]);
    assert.equal(await gate.keyIsDisabled("fixture-first"), true);
    const rows = await sql`select key_hash from fact_ai_key_cooldowns`;
    assert.equal(rows.length, 1); assert.match(rows[0].key_hash, /^[a-f0-9]{64}$/);
  });
  await test("An expired lease recovers, and a stale worker cannot release the new lease", async () => {
    const first = await gate.acquireAiSlot(Date.now() + 5000);
    process.env.OPENAI_MAX_QUEUE_WAIT_MS = "0";
    await assert.rejects(() => gate.acquireAiSlot(Date.now() + 5000), /ai_quota/);
    await sql`update fact_ai_throttle set lease_until = now() - interval '1 second', next_request_at = now() - interval '1 second'`;
    const next = await gate.acquireAiSlot(Date.now() + 5000);
    await gate.releaseAiSlot(first, { success: true });
    const [state] = await sql`select lease_id from fact_ai_throttle`;
    assert.equal(state.lease_id, next.id); await gate.releaseAiSlot(next, { success: true });
  });
  await test("An unexpected credential-store failure releases the request slot", async () => {
    const query = sql.query;
    sql.query = async (text, params) => {
      if (text.includes("insert into fact_ai_key_cooldowns")) throw new Error("fixture database failure");
      return query(text, params);
    };
    try {
      await assert.rejects(() => pool.withOpenAIKey(async () => new Response("{}", { status: 401 }), Date.now() + 5000), /fixture database failure/);
    } finally { sql.query = query; }
    const [state] = await sql`select lease_id from fact_ai_throttle`; assert.equal(state.lease_id, null);
  });
  await test("Generic 400 responses do not trigger duplicate search fallback requests", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: { message: "Malformed request." } }), { status: 400 }); };
    await assert.rejects(() => openai.askOpenAI("Synthetic fixture"), /openai_off/);
    assert.equal(calls, 1);
  });
  await test("A video transcription 429 stops further media attempts and the fact-check request", async () => {
    const { transcribeLink } = await server.ssrLoadModule("/src/realorna/backend/transcript.ts");
    let models = 0; let downloads = 0;
    globalThis.fetch = async url => {
      if (String(url).startsWith("https://api.openai.com/")) {
        models++; return new Response("{}", { status: 429, headers: { "Retry-After": "60" } });
      }
      if (String(url).startsWith("https://example.com/")) {
        downloads++; return new Response(new Uint8Array(20), { headers: { "content-type": "video/mp4" } });
      }
      return originalFetch(url);
    };
    await assert.rejects(() => transcribeLink({ url: "https://www.instagram.com/reel/fixture/", host: "instagram.com",
      html: '<meta property="og:video" content="https://example.com/one.mp4"><meta property="og:video" content="https://example.com/two.mp4">' }), /ai_quota/);
    assert.equal(models, 1); assert.equal(downloads, 1);
  });
  console.log(JSON.stringify({ ok: true, rate_limit_checks: checks.length, live_provider_called: false }));
} finally { globalThis.fetch = originalFetch; await server.close(); }
