import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

if (process.env.DATABASE_URL?.trim() || process.env.VERCEL) throw new Error("Run fact-check tests without DATABASE_URL or VERCEL.");
process.env.OPENAI_API_KEYS = "fixture-key"; delete process.env.OPENAI_API_KEY;
process.env.OPENAI_MODEL = "fixture-model"; process.env.OPENAI_TRANSCRIBE_MODEL = "fixture-transcribe";
process.env.OPENAI_MIN_INTERVAL_MS = "1000"; process.env.OPENAI_MAX_QUEUE_WAIT_MS = "2000";
const { createServer } = await import("vite");
// In-process modules only; this is not a user preview or a live API test.
const server = await createServer({ server: { middlewareMode: true }, logLevel: "error" });
const originalFetch = globalThis.fetch;
let checks = 0;
try {
  const db = await server.ssrLoadModule("/src/lib/db.ts"); assert.equal(db.dbSource, "pglite");
  const sql = await db.getSql();
  const contract = await server.ssrLoadModule("/src/realorna/backend/contract.ts");
  const ai = await server.ssrLoadModule("/src/realorna/backend/openai.ts");
  const flow = await server.ssrLoadModule("/src/realorna/backend/factcheck.ts");
  const pages = await server.ssrLoadModule("/src/realorna/engine.server.ts");
  const { exampleReport } = await server.ssrLoadModule("/src/realorna/examples.ts");
  const { reportText, resultLabel } = await server.ssrLoadModule("/src/realorna/report-text.ts");
  const { Report, Scan, Fail } = await server.ssrLoadModule("/src/realorna/RealornaApp.tsx");
  const { translate } = await server.ssrLoadModule("/src/realorna/i18n.ts");
  const sourceUrl = "https://www.cnnindonesia.com/ekonomi/20200102/fixture";
  const evidence = "https://www.idx.co.id/id/data-pasar/fixture-20200102";
  const retrieved = [{ title: "Synthetic market record", url: evidence, publisher: "idx.co.id" }];
  const claim = (text, status, extra = {}) => ({ text, status, explanation: "Synthetic evidence for the stated session.", correction: "", importance: "utama", source_urls: [evidence], ...extra });
  const fixture = (claims, verdict = "FAKTA") => ({ verdict, summary: "Synthetic fixture only.", claims, red_flags: [], sources: [{ ...retrieved[0], published_at: "2020-01-02" }], reference_date: "2020-01-02, closing session", meta: { title: "Fixture", author: "", platform: "web", published_at: "2020-01-02" } });
  const responseData = (data, sources = retrieved) => ({ status: "completed", output: [
    { type: "web_search_call", status: "completed", action: { type: "search", sources } },
    { type: "message", content: [{ type: "output_text", text: JSON.stringify(data), annotations: [] }] },
  ] });
  const normalize = (data, sources = retrieved, contentRead = true) => contract.contractFromModel(data, sources, "id", { sourceUrl, contentRead });
  async function test(name, fn) {
    await sql`delete from fact_ai_throttle`; await sql`delete from fact_ai_key_cooldowns`;
    globalThis.fetch = async () => { throw new Error("Unexpected external fetch in fixture test"); };
    await fn(); checks++; console.log("PASS " + name);
  }
  await test("Correct event plus false core number yields Nah even if the model requests FAKTA", () => {
    const data = normalize(fixture([claim("IHSG turun", "benar"), claim("IHSG = 3500", "salah", { correction: "IHSG = 4900 pada sesi simulasi" })]));
    assert.equal(data.verdict, "MENYESATKAN"); assert.equal(resultLabel(data.verdict, "id"), "Nah (Hoax)");
    assert.match(data.claims[1].correction, /4900/); assert.match(data.summary, /terbantahkan/);
  });
  await test("Supported main claims yield Real", () => {
    assert.equal(normalize(fixture([claim("A claim", "benar")])).verdict, "FAKTA");
  });
  await test("A minor detail correction preserves Real and exposes the correction", () => {
    const data = normalize(fixture([claim("Main fact", "benar"), claim("Rounded detail", "keliru", { importance: "detail", correction: "Precise detail" })]));
    assert.equal(data.verdict, "SEBAGIAN_BENAR"); assert.equal(resultLabel(data.verdict, "en"), "Real");
  });
  await test("A material wrong date or cause cannot be hidden as a minor correction", () => {
    assert.equal(normalize(fixture([claim("Unsupported causal link", "keliru", { correction: "Different cause" })])).verdict, "HOAKS");
  });
  await test("Unresolved core claims are not labeled Real or Hoax", () => {
    const data = normalize(fixture([claim("Known event", "benar"), claim("Uncertain cause", "belum_jelas", { source_urls: [] })]));
    assert.equal(data.verdict, "BELUM_TERVERIFIKASI");
  });
  await test("No evidence, invented evidence, and a recognised publisher cannot create a positive verdict", () => {
    const data = normalize(fixture([claim("False assurance", "benar", { source_urls: ["https://fabricated.example.org/proof"] })]));
    assert.equal(data.verdict, "BELUM_TERVERIFIKASI"); assert.equal(data.claims[0].status, "belum_jelas"); assert.equal(data.sources.length, 0);
    assert.doesNotMatch(data.summary, /Synthetic fixture/);
  });
  await test("The original publisher and homepages are excluded as sole comparison evidence", () => {
    for (const url of [sourceUrl, "https://www.cnnindonesia.com/another-story", "https://www.idx.co.id/", "https://www.idx.co.id/id/"]) {
      const data = normalize(fixture([claim("A claim", "benar", { source_urls: [url] })]), [{ title: "Source", url, publisher: "source" }]);
      assert.equal(data.verdict, "BELUM_TERVERIFIKASI");
    }
  });
  await test("Only retrieved and cited public links survive; tracking parameters normalize", () => {
    const data = normalize(fixture([claim("A claim", "benar", { source_urls: [evidence + "?utm_source=fixture", "javascript:alert(1)"] })]));
    assert.deepEqual(data.claims[0].source_urls, [evidence]); assert.equal(data.sources.length, 1);
    for (const url of ["javascript:alert(1)", "http://127.0.0.1/proof", "https://user:pass@example.org/proof", "https://app.local/proof"]) assert.equal(contract.evidenceUrl(url), null);
  });
  await test("Missing content and absent main claims cannot be marked verified", () => {
    assert.equal(normalize(fixture([claim("A claim", "benar")]), retrieved, false).verdict, "BELUM_TERVERIFIKASI");
    assert.equal(normalize(fixture([claim("Tiny detail", "benar", { importance: "detail" })])).verdict, "BELUM_TERVERIFIKASI");
    assert.equal(normalize(fixture([])).verdict, "BELUM_TERVERIFIKASI");
  });
  await test("Address safety never overrides the content verdict", () => {
    const data = normalize(fixture([claim("A fact", "benar")]));
    const report = contract.reportFromContract(data, { url: sourceUrl, plan: "regular", lang: "id" }, "https://kompas-claim-login.xyz/verify", "openai");
    assert.equal(report.verdict, "FAKTA"); assert.ok(report.safety.some(s => s.st === "bad")); assert.equal("score" in report, false);
  });
  await test("Article text, JSON-LD, dates and entities are extracted without nav pollution", () => {
    const text = "Synthetic article about historical market data. ".repeat(8);
    const bits = pages.pageBits(`<html><title>Fixture &amp; data</title><nav>IGNORE THIS NAV</nav><script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "NewsArticle", articleBody: text, author: { name: "Reporter" }, datePublished: "2020-01-02T16:00:00+07:00" }] })}</script><body>Unrelated footer text</body></html>`);
    assert.equal(bits.title, "Fixture & data"); assert.equal(bits.text, text.trim()); assert.equal(bits.author, "Reporter"); assert.equal(bits.published, "2020-01-02T16:00:00+07:00");
    assert.equal(pages.pageBits("<title>Just a moment...</title><body>" + text + "</body>").text, "");
  });
  await test("Responses request forces search and strict schema, preserves historical context and server metadata", async () => {
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url) === sourceUrl) return new Response(`<meta property="article:published_time" content="2020-01-02T16:00:00+07:00"><meta name="author" content="Actual reporter"><title>Historical article</title><article>${"Synthetic historical fixture. ".repeat(15)}</article>`, { headers: { "Content-Type": "text/html" } });
      assert.equal(String(url), "https://api.openai.com/v1/responses"); calls++;
      assert.equal(options.headers.Authorization, "Bearer fixture-key"); const body = JSON.parse(options.body);
      assert.equal(body.tool_choice, "required"); assert.equal(body.tools[0].type, "web_search");
      assert.equal(body.text.format.type, "json_schema"); assert.equal(body.text.format.strict, true); assert.equal(body.store, false);
      assert.match(body.input, /2020-01-02T16:00:00\+07:00/); assert.match(body.instructions, /relative dates/); assert.match(body.input, /Asia\/Jakarta/);
      const data = fixture([claim("Historical fact", "benar")]); data.meta.author = "Hallucinated reporter";
      return new Response(JSON.stringify(responseData(data)));
    };
    const { report } = await flow.checkOrder({ url: sourceUrl, plan: "regular", lang: "id" });
    assert.equal(report.engine, "openai"); assert.equal(report.verdict, "FAKTA"); assert.equal(report.meta.author, "Actual reporter"); assert.equal(report.meta.published_at, "2020-01-02T16:00:00+07:00"); assert.equal(calls, 1);
  });
  await test("Partial long articles remain unverified even when readable claims have supporting evidence", async () => {
    globalThis.fetch = async url => String(url) === sourceUrl
      ? new Response(`<title>Long article</title><article>${"Partial article fixture. ".repeat(1000)}</article>`, { headers: { "Content-Type": "text/html" } })
      : new Response(JSON.stringify(responseData(fixture([claim("A supported part", "benar")]))));
    const { report } = await flow.checkOrder({ url: sourceUrl, plan: "regular", lang: "id" });
    assert.equal(report.verdict, "BELUM_TERVERIFIKASI"); assert.equal(report.claims[0].status, "benar"); assert.match(report.summary, /sebagian/);
  });
  await test("No search call, incomplete output, refusal and malformed JSON fail without invented evidence", () => {
    const valid = responseData(fixture([claim("A claim", "benar")]));
    assert.throws(() => ai.extractResponse({ ...valid, status: "incomplete" }), /openai_failed/);
    assert.throws(() => ai.extractResponse({ ...valid, output: valid.output.slice(1) }), /openai_failed/);
    assert.throws(() => ai.extractResponse({ ...valid, output: [valid.output[0], { type: "message", content: [{ type: "refusal" }] }] }), /openai_failed/);
    assert.throws(() => ai.extractResponse({ ...valid, output: [valid.output[0], { type: "message", content: [{ type: "output_text", text: "not JSON" }] }] }), /openai_failed/);
  });
  await test("Blocked article and video without a spoken transcript stop before fact-check API calls", async () => {
    let apiCalls = 0;
    globalThis.fetch = async url => {
      if (String(url).startsWith("https://api.openai.com")) apiCalls++;
      if (String(url).includes("oembed")) return new Response(JSON.stringify({ title: "Caption with an assertion" }));
      return new Response("Blocked", { status: 403 });
    };
    for (const input of [{ url: sourceUrl, plan: "regular", lang: "id" }, { url: "https://www.tiktok.com/@fixture/video/123", plan: "advance", lang: "id" }]) await assert.rejects(() => flow.checkOrder(input), error => error.code === "unreadable");
    assert.equal(apiCalls, 0);
  });
  await test("OpenAI transcription uploads actual MP4 bytes and never sends a page URL as media", async () => {
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), "https://api.openai.com/v1/audio/transcriptions");
      assert.ok(options.body instanceof FormData); assert.equal(options.body.get("model"), "fixture-transcribe");
      const file = options.body.get("file"); assert.equal(file.name, "speech.mp4"); assert.equal(file.size, 32);
      assert.equal(options.headers["Content-Type"], undefined);
      return new Response(JSON.stringify({ text: "This is a simulated spoken transcript for testing only." }));
    };
    assert.match(await ai.transcribeWithOpenAI({ mime: "video/mp4", bytes: new Uint8Array(32) }), /simulated/);
  });
  await test("YouTube caption IDs, text parsing and language preference remain supported", async () => {
    const { youtubeId, parseCaptionPayload, pickCaptionTrack } = await server.ssrLoadModule("/src/realorna/backend/transcript.ts");
    assert.equal(youtubeId("https://youtu.be/jNQXAC9IVRw"), "jNQXAC9IVRw");
    assert.equal(youtubeId("https://www.youtube.com/shorts/jNQXAC9IVRw"), "jNQXAC9IVRw");
    assert.equal(youtubeId("https://www.tiktok.com/@user/video/123"), null);
    assert.equal(parseCaptionPayload(JSON.stringify({ events: [{ segs: [{ utf8: "Harga " }, { utf8: "BBM" }] }] })), "Harga BBM");
    assert.equal(pickCaptionTrack([{ languageCode: "en", kind: "", baseUrl: "en" }, { languageCode: "id", kind: "asr", baseUrl: "id" }]).baseUrl, "id");
  });
  await test("Legacy Gemini credentials cannot silently activate another provider", async () => {
    delete process.env.OPENAI_API_KEYS; process.env.GEMINI_API_KEY = "unused-legacy-key";
    await assert.rejects(() => ai.askOpenAI("Fixture"), /openai_off/);
    process.env.OPENAI_API_KEYS = "fixture-key"; delete process.env.GEMINI_API_KEY;
  });
  await test("Reports render Real, Nah, corrections, sources and unknown evidence without numeric trust scores", () => {
    for (const lang of ["id", "en"]) for (const kind of ["real", "nah", "correction"]) {
      const result = exampleReport(kind, lang);
      const html = renderToStaticMarkup(React.createElement(Report, { result, lang, titleRef: { current: null }, t: (key, params) => translate(lang, key, params), onAgain() {}, onCopy() {}, onShare() {}, onPdf() {} }));
      assert.match(html, /Illustrative example|Contoh ilustratif/); assert.doesNotMatch(html, /\/100|seal-num/);
      if (kind === "nah") { assert.match(html, /Nah \(Hoax\)/); assert.match(html, /<s>/); assert.match(html, /4\.900|4,900/); }
      if (kind === "correction") assert.match(html, /class="ic warn claim-symbol"[^>]*>~<\/span>/);
      const shared = reportText(result, lang); assert.doesNotMatch(shared, /\/100/); assert.match(shared, /ILLUSTRATIVE|ILUSTRATIF/);
    }
    const data = normalize(fixture([claim("A claim", "benar")])); const result = contract.reportFromContract(data, { url: sourceUrl, plan: "regular", lang: "id" }, sourceUrl, "openai");
    const html = renderToStaticMarkup(React.createElement(Report, { result, lang: "id", titleRef: { current: null }, t: (key, params) => translate("id", key, params), onAgain() {}, onCopy() {}, onShare() {}, onPdf() {} }));
    assert.match(html, /claim-evidence/); assert.match(html, /idx\.co\.id/); assert.match(html, /Konteks waktu/);
    assert.match(reportText(result, "id"), /Bukti: https:/);
  });
  await test("Pending UI has no fabricated completed stages, and distinct failures keep saved-check guidance", () => {
    for (const lang of ["id", "en"]) {
      const t = (key, params) => translate(lang, key, params);
      const pending = renderToStaticMarkup(React.createElement(Scan, { host: "kompas.com", video: false, t }));
      assert.match(pending, /aria-busy="true"/); assert.match(pending, /Time elapsed: 0s|Waktu berjalan: 0 dtk/);
      assert.doesNotMatch(pending, /class="done"|Comparing with other reporting|Membandingkan dengan/);
      const busy = renderToStaticMarkup(React.createElement(Fail, { code: "ai_busy", t, supportId: "fixture-support" }));
      const quota = renderToStaticMarkup(React.createElement(Fail, { code: "ai_quota", t }));
      const timeout = renderToStaticMarkup(React.createElement(Fail, { code: "ai_timeout", t }));
      assert.match(busy, /AI capacity|giliran layanan AI/); assert.match(busy, /fixture-support/);
      assert.match(quota, /admin|Admin/); assert.doesNotMatch(quota, /countdown|hitungan mundur/);
      assert.match(timeout, /took too long|batas waktu/);
    }
  });
  // Export the same Report component for a self-contained reviewable HTML demo.
  if (process.env.REALORNA_EXPORT_DEMO) {
    const target = resolve(process.env.REALORNA_EXPORT_DEMO); await mkdir(resolve(target, ".."), { recursive: true });
    const sourceCss = await readFile("src/styles.css", "utf8");
    const css = sourceCss.slice(sourceCss.indexOf(".rn {"));
    const templates = []; const shares = {};
    for (const lang of ["id", "en"]) for (const kind of ["real", "nah", "correction"]) {
      const result = exampleReport(kind, lang); const key = `${lang}-${kind}`; shares[key] = reportText(result, lang);
      templates.push(`<template id="${key}">${renderToStaticMarkup(React.createElement(Report, { result, lang, titleRef: { current: null }, t: (k, p) => translate(lang, k, p), onAgain() {}, onCopy() {}, onShare() {}, onPdf() {} }))}</template>`);
    }
    const html = `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Realorna — Real / Nah</title><style>*{box-sizing:border-box}body{margin:0}button{cursor:pointer;font:inherit}h1{font-family:var(--font-display)}${css}</style><body><div class="rn" data-plan="regular"><div class="wrap"><header class="top"><span class="brand-name">Realorna</span><div class="lang"><button data-lang="id" aria-pressed="true">ID</button><button data-lang="en" aria-pressed="false">EN</button></div></header><section class="hero"><h1>Real atau Nah?</h1><p class="lead" id="intro">Lihat klaim yang benar, bagian yang keliru, dan koreksinya.</p></section><section class="checker"><div class="examples"><button class="link-btn" data-example="real">Real</button><button class="link-btn" data-example="nah">Nah · angka salah</button><button class="link-btn" data-example="correction">Real · koreksi kecil</button></div><p class="example-note" id="help">Contoh tampilan saja. Tidak melakukan pemeriksaan tautan atau panggilan API.</p></section><main id="result"></main></div></div>${templates.join("")}<script>const shares=${JSON.stringify(shares).replace(/</g,"\\u003c")};let lang='id',kind='nah';function render(){document.documentElement.lang=lang;document.getElementById('result').replaceChildren(document.getElementById(lang+'-'+kind).content.cloneNode(true));document.querySelectorAll('[data-lang]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.lang===lang)));document.querySelector('[data-example="nah"]').textContent=lang==='id'?'Nah · angka salah':'Nah · wrong number';document.querySelector('[data-example="correction"]').textContent=lang==='id'?'Real · koreksi kecil':'Real · small correction';document.getElementById('intro').textContent=lang==='id'?'Lihat klaim yang benar, bagian yang keliru, dan koreksinya.':'See the supported claims, inaccurate parts, and corrections.';document.getElementById('help').textContent=lang==='id'?'Contoh tampilan saja. Tidak melakukan pemeriksaan tautan atau panggilan API.':'Display examples only. No live link verification or API calls.';document.querySelectorAll('.actions button').forEach((b,i)=>{b.onclick=async()=>{if(i===0){document.querySelector('.checker').scrollIntoView({behavior:'smooth'});}if(i===1){try{await navigator.clipboard.writeText(shares[lang+'-'+kind]);b.textContent=lang==='id'?'Tersalin':'Copied';}catch{b.textContent=lang==='id'?'Pilih teks untuk menyalin':'Select text to copy';}}if(i===2)window.open('https://wa.me/?text='+encodeURIComponent(shares[lang+'-'+kind]),'_blank','noopener,noreferrer');if(i===3)window.print();};});}document.querySelectorAll('[data-example]').forEach(b=>b.onclick=()=>{kind=b.dataset.example;render()});document.querySelectorAll('[data-lang]').forEach(b=>b.onclick=()=>{lang=b.dataset.lang;render()});render();</script></body></html>`;
    await writeFile(target, html); console.log("EXPORTED demo HTML");
  }
  console.log(JSON.stringify({ ok: true, factcheck_checks: checks, live_provider_called: false, browser_tested: false }));
} finally { globalThis.fetch = originalFetch; await server.close(); }
