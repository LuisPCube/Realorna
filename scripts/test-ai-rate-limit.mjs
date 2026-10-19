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
const server = await createServer({ server: { host: "127.0.0.1", port: 8092, strictPort: true }, logLevel: "error" });
await server.listen();
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
    }, Date.now() + 5000), error => error.reason === "quota" && error.retryAfterSeconds >= 3600);
    assert.equal(calls, 1);
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
