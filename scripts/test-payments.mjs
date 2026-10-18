import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
// Integration tests always use an isolated in-memory Postgres. Never test
// payments or account creation against a configured real database.
if (process.env.DATABASE_URL?.trim() || process.env.VERCEL) throw new Error("Run this test without DATABASE_URL or VERCEL.");
process.env.VITE_AUTH_ENABLED = "true";
process.env.ADMIN_USERNAME = "realorna_admin";
process.env.ADMIN_PASSWORD = randomBytes(24).toString("base64url");
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
process.env.BETTER_AUTH_URL = "http://localhost:8090";
process.env.TRANSFER_BANK_NAME = "Test bank";
process.env.TRANSFER_ACCOUNT_NUMBER = "0000000000";
process.env.TRANSFER_ACCOUNT_HOLDER = "TEST ONLY";
delete process.env.GEMINI_API_KEYS; delete process.env.GEMINI_API_KEY; delete process.env.XAI_API_KEY;
const { createServer } = await import("vite");
const server = await createServer({ server: { host: "127.0.0.1", port: 8090, strictPort: true }, logLevel: "error" });
await server.listen();
const originalFetch = globalThis.fetch;
const base = "http://localhost:8090";
const checks = [];
async function request(path, body, token, extraHeaders = {}) {
  const response = await originalFetch(base + path, { method: body === undefined ? "GET" : "POST", headers: {
    "content-type": "application/json", origin: base, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}
async function test(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`); }
const input = { url: "https://example.com/article", plan: "regular", lang: "en" };
let admin, alex, other, grant, checkedOrder, invoice;
try {
  const db = await server.ssrLoadModule("/src/lib/db.ts");
  const sql = await db.getSql();
  const orders = await server.ssrLoadModule("/src/realorna/backend/orders.ts");
  await test("Admin bootstrap stores a password hash and login works", async () => {
    const response = await request("/api/auth/sign-in/username", { username: "REALORNA_ADMIN", password: process.env.ADMIN_PASSWORD });
    assert.equal(response.status, 200, JSON.stringify(response.data)); admin = response.data.token; assert.ok(admin);
    const state = await request("/api/account", undefined, admin); assert.equal(state.data.user.admin, true);
    const [account] = await sql.query(`select password from account where "providerId" = 'credential' limit 1`);
    assert.notEqual(account.password, process.env.ADMIN_PASSWORD); assert.ok(account.password.length > 100);
  });
  await test("Registration normalizes usernames and cannot set admin privileges", async () => {
    const first = await request("/api/auth/sign-up/email", { name: "Alex", username: "Alex", email: "alex@example.com", password: "ExamplePassword-2026", role: "admin" });
    assert.equal(first.status, 200, JSON.stringify(first.data)); alex = first.data.token;
    const second = await request("/api/auth/sign-up/email", { name: "Other", username: "Other", email: "other@example.com", password: "ExamplePassword-2026" });
    assert.equal(second.status, 200); other = second.data.token;
    const state = await request("/api/account", undefined, alex); assert.equal(state.data.user.username, "alex"); assert.equal(state.data.user.admin, false);
    const dup = await request("/api/auth/sign-up/email", { name: "ALex", username: "aLEX", email: "duplicate@example.com", password: "ExamplePassword-2026" });
    assert.ok(dup.status >= 400); const [{ count }] = await sql.query(`select count(*) as count from "user" where lower(username) = 'alex'`); assert.equal(count, 1);
    const reserved = await request("/api/auth/sign-up/email", { name: "Admin", username: "realorna_admin", email: "attacker@example.com", password: "ExamplePassword-2026" }); assert.equal(reserved.status, 409);
  });
  await test("Concurrent registrations cannot create duplicate usernames", async () => {
    const results = await Promise.all(["one","two"].map(tag => request("/api/auth/sign-up/email", { name: "Race", username: "Race", email: `${tag}@example.com`, password: "ExamplePassword-2026" })));
    assert.equal(results.filter(r => r.status === 200).length, 1);
    const [{ count }] = await sql.query(`select count(*) as count from "user" where lower(username) = 'race'`); assert.equal(count, 1);
  });
  await test("Anonymous and non-admin callers cannot grant attempts or bypass payment", async () => {
    assert.equal((await request("/api/admin")).status, 401);
    assert.equal((await request("/api/admin", { action: "grant", username: "alex", plan: "advance", request_key: randomUUID() }, alex)).status, 403);
    assert.equal((await request("/api/checks", { ...input, request_key: randomUUID() })).status, 401);
    assert.equal((await request("/api/checks", { ...input, request_key: randomUUID() }, alex)).status, 402);
    assert.equal((await request("/api/demo-payment", {}, alex)).status, 410);
    assert.equal((await request("/api/midtrans-webhook", {})).status, 410);
    assert.equal((await request("/api/admin", { action: "grant", username: "alex", plan: "regular", request_key: randomUUID() }, admin, { origin: "https://evil.example", "sec-fetch-site": "cross-site" })).status, 403);
  });
  await test("Admin grants are case insensitive, idempotent and account-bound", async () => {
    const body = { action: "grant", username: "ALEX", plan: "regular", request_key: randomUUID() };
    const response = await request("/api/admin", body, admin); assert.equal(response.status, 200, JSON.stringify(response.data)); grant = response.data;
    const repeat = await request("/api/admin", body, admin); assert.equal(repeat.data.attempt_id, grant.attempt_id);
    assert.equal((await request("/api/account", undefined, alex)).data.attempts.length, 1);
    assert.equal((await request("/api/checks", { ...input, attempt_id: grant.attempt_id, request_key: randomUUID() }, other)).status, 402);
    assert.equal((await request("/api/checks", { ...input, plan: "advance", attempt_id: grant.attempt_id, request_key: randomUUID() }, alex)).status, 402);
  });
  await test("One attempt creates exactly one check, including concurrent requests", async () => {
    const body = { ...input, attempt_id: grant.attempt_id, request_key: randomUUID() };
    const results = await Promise.all([request("/api/checks",body,alex),request("/api/checks",{...body,request_key:randomUUID()},alex)]);
    assert.equal(results.filter(r => r.status === 200).length,1,JSON.stringify(results)); checkedOrder = results.find(r => r.status === 200).data;
    const [{ count }] = await sql.query(`select count(*) as count from fact_orders where credit_attempt_id = $1`, [grant.attempt_id]); assert.equal(count,1);
    const repeat = await request("/api/checks",body,alex);
    if (results[0].status === 200) assert.equal(repeat.data.order_id,checkedOrder.order_id); else assert.equal(repeat.status,402);
    assert.equal((await request(`/api/orders/${checkedOrder.order_id}`,undefined,other)).status,404);
    assert.equal((await request("/api/analyze",{order_id:checkedOrder.order_id},other)).status,404);
    const [stored] = await sql.query(`select request_key from fact_orders where order_id = $1`, [checkedOrder.order_id]);
    const changed = await request("/api/checks", { ...body, url: "https://example.com/different", request_key: stored.request_key }, alex);
    assert.equal(changed.status,409);
  });
  await test("Processing claims are exclusive and stale workers cannot overwrite a retry", async () => {
    const claims = await Promise.all([orders.claimRetry(checkedOrder.order_id),orders.claimRetry(checkedOrder.order_id)]);
    const claimed = claims.find(Boolean); assert.equal(claims.filter(Boolean).length,1);
    await orders.markFailed(claimed.order_id,"ai_failed","wrong-token"); assert.equal((await orders.getOrder(claimed.order_id)).status,"processing");
    await orders.markFailed(claimed.order_id,"ai_failed",claimed.claim_token); assert.equal((await orders.getOrder(claimed.order_id)).status,"failed");
    const retry = await orders.claimRetry(claimed.order_id); assert.ok(retry); assert.notEqual(retry.claim_token,claimed.claim_token);
    await orders.markFailed(claimed.order_id,"old-error",claimed.claim_token); assert.equal((await orders.getOrder(claimed.order_id)).status,"processing");
    await orders.markFailed(claimed.order_id,"ai_failed",retry.claim_token);
    assert.equal((await request("/api/account",undefined,alex)).data.attempts.length,0);
  });
  await test("Transfers use server prices; submitting does not credit the user", async () => {
    const response = await request("/api/create-payment",{...input,amount:1,request_key:randomUUID()},alex);
    assert.equal(response.status,200,JSON.stringify(response.data)); invoice=response.data; assert.equal(invoice.status,"pending"); assert.equal(invoice.amount,3000);
    assert.equal((await request(`/api/orders/${invoice.order_id}`,{reference:"Sender Alex"},other)).status,404);
    assert.equal((await request(`/api/orders/${invoice.order_id}`,{reference:"Sender Alex"},alex)).status,200);
    assert.equal((await request("/api/account",undefined,alex)).data.attempts.length,0);
    assert.equal((await request("/api/analyze",{order_id:invoice.order_id},alex)).status,402);
    assert.equal((await request("/api/admin",{action:"approve",order_id:invoice.order_id,amount:1,bank_reference:"bank-001"},admin)).status,409);
  });
  await test("Repeated transfer approvals credit once and bank references cannot be reused", async () => {
    const body={action:"approve",order_id:invoice.order_id,amount:3000,bank_reference:"BANK-001"};
    const approved=await request("/api/admin",body,admin); assert.equal(approved.status,200,JSON.stringify(approved.data));
    await request("/api/admin",body,admin);
    const state=await request("/api/account",undefined,alex); assert.equal(state.data.attempts.length,1);
    const second=await request("/api/create-payment",{...input,request_key:randomUUID()},alex);
    const duplicate=await request("/api/admin",{...body,order_id:second.data.order_id},admin); assert.equal(duplicate.status,409); assert.equal(duplicate.data.error,"bank_reference_already_used");
    assert.equal((await orders.getOrder(second.data.order_id)).status,"pending");
    await sql.query(`update fact_orders set expires_at = now() - interval '1 minute' where order_id = $1`,[second.data.order_id]);
    assert.equal((await request("/api/admin",{...body,order_id:second.data.order_id,bank_reference:"BANK-002"},admin)).status,409);
    assert.equal((await request(`/api/orders/${second.data.order_id}`,undefined,alex)).data.status,"expired");
    assert.equal((await request("/api/account",undefined,alex)).data.attempts.length,1);
  });
  await test("Admins can check both plans without buying or consuming credits",async()=>{
    for(const plan of ["regular","advance"]){const response=await request("/api/checks",{...input,plan,request_key:randomUUID()},admin);assert.equal(response.status,200);assert.equal(response.data.amount,0);assert.equal(response.data.payment_method,"admin");}
  });
  await test("API-key failover skips exhausted keys, handles auth errors and stops when all are exhausted",async()=>{
    const pool=await server.ssrLoadModule("/src/realorna/backend/key-pool.ts");
    process.env.GEMINI_API_KEYS="test-exhausted,test-working,test-working"; assert.equal(pool.geminiKeys().length,2);
    const tried=[]; const call=async key=>{tried.push(key);return new Response("{}",{status:key==="test-exhausted"?429:200,headers:{"retry-after":"60"}});};
    assert.equal((await pool.withGeminiKey(call,Date.now()+1000)).status,200); assert.deepEqual(tried,["test-exhausted","test-working"]);
    tried.length=0;await pool.withGeminiKey(call,Date.now()+1000);assert.deepEqual(tried,["test-working"]);
    process.env.GEMINI_API_KEYS='["test-denied","test-healthy"]';const authTried=[];
    await pool.withGeminiKey(async key=>{authTried.push(key);return new Response("{}",{status:key==="test-denied"?403:200});},Date.now()+1000);assert.deepEqual(authTried,["test-denied","test-healthy"]);
    process.env.GEMINI_API_KEYS="all-exhausted-a,all-exhausted-b";
    await assert.rejects(()=>pool.withGeminiKey(async()=>new Response("{}",{status:429}),Date.now()+1000),/gemini_quota/);
    process.env.GEMINI_API_KEYS="all-invalid-a,all-invalid-b";
    await assert.rejects(()=>pool.withGeminiKey(async()=>new Response("{}",{status:403}),Date.now()+1000),/gemini_off/);
    await assert.rejects(()=>pool.withGeminiKey(async()=>{throw new Error("A cooled-down invalid key must not be retried.");},Date.now()+1000),/gemini_off/);
  });
  await test("An AI check retries with its original attempt and stores a report (mock provider)",async()=>{
    process.env.GEMINI_API_KEYS="fixture-key-1,fixture-key-2";process.env.GEMINI_MODEL="fixture-model";
    let modelCalls=0;
    const fixture={verdict:"BELUM_TERVERIFIKASI",confidence:35,summary:"Integration test fixture only.",claims:[],red_flags:[],sources:[],meta:{title:"Test fixture",platform:"web",author:"",published_at:""}};
    globalThis.fetch=async(url,options)=>{
      if(String(url).startsWith("https://generativelanguage.googleapis.com/")) {modelCalls++;return new Response(JSON.stringify(options.headers["x-goog-api-key"]==="fixture-key-1"?{}:{candidates:[{content:{parts:[{text:JSON.stringify(fixture)}]}}]}),{status:options.headers["x-goog-api-key"]==="fixture-key-1"?429:200});}
      if(String(url).startsWith("https://example.com"))return new Response(`<html><head><title>Test fixture</title></head><body><article>${"This is synthetic text for an integration test. ".repeat(40)}</article></body></html>`,{headers:{"content-type":"text/html"}});
      return originalFetch(url,options);
    };
    const response=await request("/api/analyze",{order_id:checkedOrder.order_id},alex);assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.report.ok,true);assert.equal(modelCalls,2);
    const again=await request("/api/analyze",{order_id:checkedOrder.order_id},alex);assert.equal(again.status,200);assert.equal(modelCalls,2);
    assert.equal((await request("/api/account",undefined,alex)).data.attempts.length,1);
  });
  console.log(JSON.stringify({ok:true,integration_checks:checks.length,live_bank_tested:false,live_gemini_tested:false}));
} finally { globalThis.fetch=originalFetch; await server.close(); }
