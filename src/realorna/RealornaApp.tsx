import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  AlertTriangle,
  Check,
  Globe,
  Info,
  Link2,
  Lock,
  Minus,
  Moon,
  Newspaper,
  Play,
  Sun,
  X,
} from "lucide-react";
import { translate, type CopyKey } from "./i18n";
import { PRICES, findIn, inspectLink, parseLink, uiVerdict, VIDEO } from "./safety";
import { exampleReport, type ExampleKind } from "./examples";
import { reportText } from "./report-text";
import { signOut } from "@/lib/auth/client";
import { apiRequest, errorMessage, RequestError, say, useAccount } from "./account";
import { AccountPanel, AdminPanel, TransferDialog } from "./AccountPanels";
import type { AccountOrder, Attempt } from "./account-types";
import type { ClaimStatus, FactErrCode, FactOk, Lang, Plan, SafetyItem, Verdict } from "./types";

type Recent = {
  url: string;
  host: string;
  verdict: Verdict;
  ts: number;
  result: FactOk;
};

type Phase =
  | { type: "idle" }
  | { type: "scan"; host: string; video: boolean; step: number }
  | { type: "report"; result: FactOk }
  | { type: "fail"; code: FactErrCode };

const NEWS_CHIPS = ["BBC", "Kompas", "Detik", "CNN Indonesia", "Reuters"];
const VIDEO_CHIPS = ["YouTube", "TikTok", "Instagram"];

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function scallop(cx: number, cy: number, R: number, a: number, N: number) {
  const pts: string[] = [];
  for (let d = 0; d < 360; d += 2) {
    const th = (d * Math.PI) / 180;
    const r = R + a * Math.cos(N * th);
    pts.push(`${(cx + r * Math.cos(th)).toFixed(1)},${(cy + r * Math.sin(th)).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}

const MARK = scallop(20, 20, 17, 1.7, 12);

function money(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

function adviceKey(v: Verdict): CopyKey {
  if (v === "FAKTA" || v === "SEBAGIAN_BENAR") return "advice_good";
  if (v === "HOAKS" || v === "MENYESATKAN") return "advice_bad";
  if (v === "BELUM_TERVERIFIKASI") return "advice_unknown";
  return "advice_caution";
}

function bucketLabel(v: Verdict): CopyKey {
  if (v === "FAKTA" || v === "SEBAGIAN_BENAR") return "verdict_good";
  if (v === "HOAKS" || v === "MENYESATKAN") return "verdict_bad";
  return "verdict_caution";
}

function claimPill(status: ClaimStatus): { cls: "ok" | "warn" | "bad"; key: CopyKey; symbol: string } {
  if (status === "benar") return { cls: "ok", key: "st_true", symbol: "✓" };
  if (status === "salah") return { cls: "bad", key: "st_false", symbol: "✕" };
  if (status === "keliru") return { cls: "warn", key: "st_correction", symbol: "~" };
  return { cls: "warn", key: "st_unclear", symbol: "?" };
}

function StatusIcon({ st }: { st: SafetyItem["st"] | "off" }) {
  if (st === "ok") return <Check size={14} strokeWidth={3} aria-hidden="true" />;
  if (st === "warn") return <AlertTriangle size={14} strokeWidth={2.6} aria-hidden="true" />;
  if (st === "bad") return <X size={14} strokeWidth={3} aria-hidden="true" />;
  if (st === "off") return <Minus size={14} strokeWidth={3} aria-hidden="true" />;
  return <Info size={14} strokeWidth={2.6} aria-hidden="true" />;
}

function failCode(error: unknown): FactErrCode {
  if (
    error === "unreadable" ||
    error === "video_plan" ||
    error === "invalid" ||
    error === "rate" ||
    error === "ai_unavailable" ||
    error === "ai_failed"
  ) {
    return error;
  }
  return "ai_failed";
}

export function RealornaApp() {
  const [lang, setLang] = useState<Lang>("id");
  const [exampleKind, setExampleKind] = useState<ExampleKind>("nah");
  const [plan, setPlan] = useState<Plan>("regular");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<CopyKey | null>(null);
  const [phase, setPhase] = useState<Phase>({ type: "idle" });
  const [recent, setRecent] = useState<Recent[]>([]);
  const [toast, setToast] = useState("");
  const [toastOn, setToastOn] = useState(false);
  const [dark, setDark] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [working, setWorking] = useState(false);
  const [retryUntil, setRetryUntil] = useState(0);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [adminOpen, setAdminOpen] = useState(false);
  const [selectedAttempt, setSelectedAttempt] = useState<Attempt | null>(null);
  const [resumeOrderId, setResumeOrderId] = useState<string | undefined>();
  const account = useAccount();
  const handledAttempt = useRef("");
  const checkRequest = useRef<{ identity: string; key: string; orderId?: string; url: string; plan: Plan; lang: Lang; attemptId?: string } | null>(null);
  const toastTimer = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const t = (key: CopyKey, params?: Record<string, string | number>) => translate(lang, key, params);

  useEffect(() => {
    const pending = account.orders.reduce((latest, order) => Math.max(latest,
      order.retry_after_at ? new Date(order.retry_after_at).getTime() || 0 : 0), 0);
    if (pending > Date.now()) setRetryUntil(current => Math.max(current, pending));
  }, [account.orders]);

  useEffect(() => {
    const update = () => setRetrySeconds(Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000)));
    update();
    if (retryUntil <= Date.now()) return;
    const timer = window.setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [retryUntil]);

  function rememberCooldown(error: unknown) {
    if (error instanceof RequestError && error.code === "rate" && error.retryAfterSeconds > 0) {
      setRetryUntil(current => Math.max(current, Date.now() + error.retryAfterSeconds * 1000));
    }
  }

  useEffect(() => {
    const storedLang = readStore<string>("rl:lang", "");
    const nextLang: Lang =
      storedLang === "en" || storedLang === "id"
        ? storedLang
        : (navigator.language || "id").toLowerCase().startsWith("id")
          ? "id"
          : "en";
    const storedPlan = readStore<string>("rl:plan", "regular");
    setLang(nextLang);
    setPlan(storedPlan === "advance" ? "advance" : "regular");
    const storedTheme = readStore<string>("rl:theme", "");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = storedTheme === "dark" || (storedTheme !== "light" && prefersDark);
    setDark(isDark);
    document.documentElement.dataset.theme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : isDark ? "dark" : "light";
    setMounted(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    setRecent(account.user ? readStore<Recent[]>(`rl:recent:${account.user.id}`, []).slice(0, 5) : []);
    setPhase({ type: "idle" });
  }, [account.user?.id]);

  useEffect(() => {
    if (!account.user || account.loading) return;
    const id = new URLSearchParams(window.location.search).get("attempt");
    if (!id || handledAttempt.current === id) return;
    handledAttempt.current = id;
    const found = account.attempts.find(a => a.attempt_id === id);
    if (found) { setSelectedAttempt(found); setPlan(found.plan); inputRef.current?.focus(); }
    else ping(say(lang, "This attempt is unavailable or belongs to another account.", "Kesempatan ini tidak tersedia atau milik akun lain."));
  }, [account.user?.id, account.loading, account.attempts, lang]);

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setPhase(p => p.type === "scan" ? { ...p, step: Math.min(p.video ? 3 : 2, p.step + 1) } : p), 1800);
    return () => clearInterval(timer);
  }, [working]);

  useEffect(() => {
    if (!toastOn) return;
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastOn(false), 2600);
    return () => window.clearTimeout(toastTimer.current);
  }, [toast, toastOn]);

  function ping(msg: string) {
    setToast(msg);
    setToastOn(true);
  }

  function chooseLang(next: Lang) {
    setLang(next);
    if (phase.type === "report" && phase.result.demo) setPhase({ type: "report", result: exampleReport(exampleKind, next) });
    localStorage.setItem("rl:lang", JSON.stringify(next));
  }

  function choosePlan(next: Plan, announce = false) {
    setPlan(next);
    localStorage.setItem("rl:plan", JSON.stringify(next));
    if (announce) ping(t("toast_plan", { plan: translate(lang, next === "advance" ? "plan_advance" : "plan_regular") }));
  }

  function toggleTheme() {
    const next = dark ? "light" : "dark";
    setDark(!dark);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("rl:theme", JSON.stringify(next));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "dark" ? "#0B1220" : "#EBF0F6");
  }

  const parsed = useMemo(() => parseLink(url), [url]);
  const videoHint = useMemo(() => {
    if (!parsed || plan !== "regular") return null;
    return findIn(VIDEO, parsed.hostname.toLowerCase().replace(/^www\./, ""));
  }, [parsed, plan]);

  function remember(result: FactOk) {
    const item: Recent = {
      url: result.url,
      host: result.host,
      verdict: result.verdict,
      ts: Date.now(),
      result,
    };
    const next = [item, ...recent.filter((r) => r.url !== result.url)].slice(0, 5);
    setRecent(next);
    if (account.user) localStorage.setItem(`rl:recent:${account.user.id}`, JSON.stringify(next));
  }

  async function runCheck() {
    if (working || payOpen) return;
    if (retryUntil > Date.now()) { ping(say(lang, "Please wait for the retry countdown.", "Tunggu hitungan mundur sebelum mencoba lagi.")); return; }
    const raw = url.trim();
    if (!raw) {
      setError("err_empty");
      inputRef.current?.focus();
      return;
    }
    const u = parseLink(raw);
    if (!u) {
      setError("err_invalid");
      inputRef.current?.focus();
      return;
    }
    const look = inspectLink(u);
    if (plan === "regular" && look.video) {
      ping(t("hint_video", { platform: look.platform || "video" }));
      return;
    }
    setError(null);
    if (account.loading) { ping(say(lang,"Loading your account…","Memuat akunmu…")); return; }
    if (account.error) { ping(errorMessage(new RequestError(account.error, 503), lang)); return; }
    if (!account.user) {
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    const previous = checkRequest.current;
    if (previous?.orderId && previous.url === raw && previous.plan === plan && previous.lang === lang) {
      await executeCheck(previous.attemptId);
      return;
    }
    if (account.user.admin || account.attempts.some(a => a.plan === plan)) {
      await executeCheck(selectedAttempt?.plan === plan ? selectedAttempt.attempt_id : undefined);
    } else { setResumeOrderId(undefined); setPayOpen(true); }
  }

  async function analyzeOrder(orderId: string) {
    const data = await apiRequest<{ report: FactOk }>("/api/analyze", { order_id: orderId });
    if (!data.report?.ok) throw new RequestError("ai_failed", 502);
    showReport(data.report);
  }

  async function executeCheck(attemptId?: string) {
    if (working) return;
    if (retryUntil > Date.now()) return;
    setWorking(true); setPayOpen(false);
    const link = parseLink(url);
    const looked = link ? inspectLink(link) : null;
    setPhase({ type: "scan", host: looked?.host || "", video: looked?.video || false, step: 0 });
    const identity = JSON.stringify({ url: url.trim(), plan, lang, attemptId });
    if (!checkRequest.current || checkRequest.current.identity !== identity) checkRequest.current = { identity, key: crypto.randomUUID(), url: url.trim(), plan, lang, attemptId };
    try {
      if (!checkRequest.current.orderId) {
        const order = await apiRequest<{ order_id: string }>("/api/checks", { url: url.trim(), plan, lang, attempt_id: attemptId, request_key: checkRequest.current.key });
        checkRequest.current.orderId = order.order_id;
      }
      await analyzeOrder(checkRequest.current.orderId);
      checkRequest.current = null; setSelectedAttempt(null);
    } catch (e) {
      rememberCooldown(e);
      if (e instanceof RequestError && e.code === "attempt_required") {
        checkRequest.current = null; setSelectedAttempt(null); setPhase({ type: "idle" }); setResumeOrderId(undefined); setPayOpen(true);
      } else {
        setPhase({ type: "fail", code: failCode(e instanceof RequestError ? e.code : "ai_failed") });
        ping(errorMessage(e,lang));
      }
    } finally { setWorking(false); await account.refresh(); }
  }

  async function openOrder(order: AccountOrder) {
    if (working) return;
    if (order.retry_after_at && new Date(order.retry_after_at).getTime() > Date.now()) return;
    setPlan(order.plan); setUrl(order.url);
    if (order.payment_method === "transfer") { setResumeOrderId(order.order_id); setPayOpen(true); return; }
    setWorking(true); setPhase({ type: "scan", host: parseLink(order.url)?.hostname || "", video: order.plan === "advance", step: 0 });
    try {
      if (order.status === "processed") {
        const stored = await apiRequest<{ report: FactOk }>(`/api/orders/${encodeURIComponent(order.order_id)}`);
        showReport(stored.report);
      } else await analyzeOrder(order.order_id);
    } catch (e) { rememberCooldown(e); setPhase({ type: "fail", code: failCode(e instanceof RequestError ? e.code : "ai_failed") }); ping(errorMessage(e,lang)); }
    finally { setWorking(false); await account.refresh(); }
  }

  function showReport(result: FactOk) {
    setPayOpen(false);
    setError(null);
    setPhase({ type: "report", result });
    if (!result.demo) remember(result);
    requestAnimationFrame(() => {
      titleRef.current?.focus();
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function showRecent(item: Recent) {
    setUrl(item.url);
    setError(null);
    setPhase({ type: "report", result: item.result });
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function copyReport(result: FactOk) {
    const text = reportText(result, lang);
    try {
      await navigator.clipboard.writeText(text);
      ping(t("copied"));
    } catch {
      ping(t("copy_fail"));
    }
  }

  function resetDemo() {
    if (account.user) localStorage.removeItem(`rl:recent:${account.user.id}`);
    setRecent([]);
    setUrl("");
    setError(null);
    setPhase({ type: "idle" });
    ping(t("demo_reset"));
  }

  const price = account.user?.admin ? say(lang,"Free for admin","Gratis untuk admin") : money(PRICES[plan]);

  return (
    <div className="rn" data-plan={plan}>
      <div className="wrap">
        <header className="top">
          <a className="brand" href="#top" aria-label="Realorna">
            <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
              <path className="m-body" d={MARK} />
              <path className="m-tick" d="M13 20.5l5 5 9-10.5" />
            </svg>
            <span className="brand-name">Realorna</span>
          </a>
          <div className="top-right">
            <button
              type="button"
              className="theme"
              onClick={toggleTheme}
              aria-label={dark ? t("theme_light") : t("theme_dark")}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {account.loading ? <span className="proto">…</span> : account.user ? <>
              {account.user.admin && <button className="account-link" type="button" aria-expanded={adminOpen} onClick={() => setAdminOpen(!adminOpen)}>Admin</button>}
              <span className="username-tag">@{account.user.username}</span>
              <button className="account-link" type="button" onClick={() => void signOut("/").catch(e => ping(errorMessage(e,lang)))}>{say(lang,"Sign out","Keluar")}</button>
            </> : <a className="account-link" href="/login">{say(lang,"Sign in / Register","Masuk / Daftar")}</a>}
            <div className="lang" role="group" aria-label={t("lang_label")}>
              <button type="button" aria-pressed={lang === "en"} onClick={() => chooseLang("en")}>
                EN
              </button>
              <button type="button" aria-pressed={lang === "id"} onClick={() => chooseLang("id")}>
                ID
              </button>
            </div>
          </div>
        </header>

        <main id="top">
          {account.user?.admin && adminOpen && <AdminPanel lang={lang}/>}
          {account.error && <p className="form-error" role="alert">{errorMessage(new RequestError(account.error,503),lang)}</p>}
          <section className="hero">
            <h1>{t("h1")}</h1>
            <p className="lead">{t("lead")}</p>
          </section>

          <AccountPanel lang={lang} onAttempt={attempt => {setSelectedAttempt(attempt);choosePlan(attempt.plan);inputRef.current?.focus();}} onOrder={order => void openOrder(order)}/>
          <section className="checker" id="checker" aria-label={t("field_label")}>
            <div className="switch" role="radiogroup" aria-label={t("plan_label")}>
              <span className="thumb" aria-hidden="true" />
              {(["regular", "advance"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className="opt"
                  disabled={working || payOpen}
                  role="radio"
                  aria-checked={plan === p}
                  tabIndex={plan === p ? 0 : -1}
                  onClick={() => choosePlan(p)}
                  onKeyDown={(e) => {
                    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
                    e.preventDefault();
                    choosePlan(p === "regular" ? "advance" : "regular");
                  }}
                >
                  <span className="opt-name">{t(p === "regular" ? "plan_regular" : "plan_advance")}</span>
                  <span className="opt-sub">{t(p === "regular" ? "plan_regular_sub" : "plan_advance_sub")}</span>
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runCheck();
              }}
              noValidate
              autoComplete="off"
            >
              <div className="row">
                <div className={`field${error ? " invalid" : ""}`}>
                  <Link2 className="field-ic" size={20} aria-hidden="true" />
                  <label className="sr" htmlFor="url">
                    {t("field_label")}
                  </label>
                  <input
                    id="url"
                    disabled={working || account.loading}
                    ref={inputRef}
                    name="url"
                    type="text"
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={t(plan === "advance" ? "ph_advance" : "ph_regular")}
                    value={url}
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setError(null);
                    }}
                  />
                  <button
                    type="button"
                    className="mini"
                    onClick={() => {
                      if (url) {
                        setUrl("");
                        setError(null);
                        inputRef.current?.focus();
                        return;
                      }
                      void navigator.clipboard
                        .readText()
                        .then((txt) => {
                          const next = (txt || "").trim();
                          if (next) setUrl(next);
                          else inputRef.current?.focus();
                        })
                        .catch(() => {
                          ping(t("paste_fail"));
                          inputRef.current?.focus();
                        });
                    }}
                  >
                    {url ? t("clear") : t("paste")}
                  </button>
                </div>
                <button type="button" className="go" disabled={payOpen || working || account.loading || retrySeconds > 0} onClick={() => void runCheck()}>
                  {payOpen || working ? t("checking") : retrySeconds > 0 ? say(lang, `Retry in ${retrySeconds}s`, `Coba lagi ${retrySeconds}d`) : t("check")}
                </button>
              </div>
              {error ? (
                <p className="error" role="alert">
                  <AlertTriangle size={18} aria-hidden="true" />
                  <span>{t(error)}</span>
                </p>
              ) : null}
            </form>

            {videoHint ? (
              <div className="hint" role="status">
                <Lock size={18} aria-hidden="true" />
                <span>{t("hint_video", { platform: videoHint.name })}</span>
                <button type="button" className="link-btn" onClick={() => choosePlan("advance", true)}>
                  {t("hint_switch")}
                </button>
              </div>
            ) : null}

            {selectedAttempt && <p className="success-line"><GiftNotice/>{say(lang,`Using your ${selectedAttempt.plan === "advance" ? "Advance" : "Regular"} attempt. Paste a link to start.`,`Menggunakan kesempatan ${selectedAttempt.plan === "advance" ? "Advance" : "Regular"}. Tempel tautan untuk mulai.`)}</p>}
            {retrySeconds > 0 && <p className="note" role="status">{say(lang,
              `Please wait ${retrySeconds} seconds. Your saved check can be retried without another payment.`,
              `Tunggu ${retrySeconds} detik. Pemeriksaan tersimpan bisa diulang tanpa membayar lagi.`)}</p>}
            <div className="sources">
              <div className="src-row">
                <span className="src-label">{t("src_news")}</span>
                {NEWS_CHIPS.map((n) => (
                  <span className="chip" key={n}>
                    {n}
                  </span>
                ))}
                <span className="more">{t("more_outlets")}</span>
              </div>
              <div className="src-row">
                <span className="src-label">{t("src_video")}</span>
                {VIDEO_CHIPS.map((n) =>
                  plan === "regular" ? (
                    <span className="chip locked" key={n}>
                      <Lock size={12} aria-hidden="true" />
                      {n}
                      <span className="sr">, {t("adv_only")}</span>
                    </span>
                  ) : (
                    <span className="chip on" key={n}>
                      {n}
                    </span>
                  ),
                )}
                {plan === "regular" ? <span className="more">{t("adv_only")}</span> : null}
              </div>
            </div>

            <div className="examples">
              <span>{t("try_example")}</span>
              {(["real", "nah", "correction"] as ExampleKind[]).map(kind => <button key={kind} type="button" className="link-btn" disabled={working || payOpen}
                onClick={() => { setExampleKind(kind); showReport(exampleReport(kind, lang)); }}>
                {t(kind === "real" ? "ex_real" : kind === "nah" ? "ex_nah" : "ex_correction")}
              </button>)}
            </div>
            <p className="example-note">{t("example_hint")}</p>

            <div className="card-foot">
              <span className="quota">
                <strong>{price}</strong>
                <span>{t("per_check")}</span>
              </span>
              <a href="#plans">{t("compare_plans")}</a>
            </div>
          </section>

          <div id="result" ref={resultRef} aria-live="polite">
            {phase.type === "scan" ? <Scan host={phase.host} video={phase.video} step={phase.step} t={t} /> : null}
            {phase.type === "fail" ? <Fail code={phase.code} t={t} /> : null}
            {phase.type === "report" ? (
              <Report
                result={phase.result}
                lang={lang}
                t={t}
                titleRef={titleRef}
                onAgain={() => {
                  setUrl("");
                  setPhase({ type: "idle" });
                  inputRef.current?.focus();
                }}
                onCopy={() => void copyReport(phase.result)}
                onShare={() => {
                  const r = phase.result;
                  const text = reportText(r, lang);
                  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
                }}
                onPdf={() => {
                  ping(t("pdf_hint"));
                  window.setTimeout(() => window.print(), 400);
                }}
              />
            ) : null}
          </div>

          <section className="sec">
            <div className="sec-head">
              <h2>{t("recent_title")}</h2>
              {mounted && recent.length > 0 ? (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setRecent([]);
                    if (account.user) localStorage.setItem(`rl:recent:${account.user.id}`, JSON.stringify([]));
                  }}
                >
                  {t("recent_clear")}
                </button>
              ) : null}
            </div>
            {!mounted || recent.length === 0 ? (
              <p className="empty">{t("recent_empty")}</p>
            ) : (
              <ul className="recent">
                {recent.map((item) => {
                  const b = uiVerdict(item.verdict);
                  return (
                    <li key={item.url + item.ts}>
                      <button type="button" className="rec" onClick={() => showRecent(item)}>
                        <span className={`ic ${b === "good" ? "ok" : b === "bad" ? "bad" : "warn"}`}>
                          <StatusIcon st={b === "good" ? "ok" : b === "bad" ? "bad" : "warn"} />
                        </span>
                        <span className="rec-main">
                          <span className="rec-host">{item.host}</span>
                          <span className="rec-sub">
                            <span className={`rv ${b}`}>{t(bucketLabel(item.verdict))}</span>

                          </span>
                        </span>
                        <span className="rec-time">{ago(item.ts, lang, t)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="sec" id="plans">
            <div className="sec-head">
              <h2>{t("plans_title")}</h2>
            </div>
            <div className="plans">
              <PlanCard
                kind="regular"
                plan={plan}
                t={t}
                onChoose={() => {
                  choosePlan("regular", true);
                  document.getElementById("checker")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
              <PlanCard
                kind="advance"
                plan={plan}
                t={t}
                onChoose={() => {
                  choosePlan("advance", true);
                  document.getElementById("checker")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            </div>
            <p className="pay">{t("pay_note")}</p>
          </section>

          <section className="sec">
            <div className="sec-head">
              <h2>{t("how_title")}</h2>
            </div>
            <ol className="how">
              {[1, 2, 3].map((n) => (
                <li key={n}>
                  <span className="n">{n}</span>
                  <h3>{t(`how${n}_t` as CopyKey)}</h3>
                  <p>{t(`how${n}_d` as CopyKey)}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="sec faq">
            <div className="sec-head">
              <h2>{t("faq_title")}</h2>
            </div>
            {[1, 2, 3, 4].map((n) => (
              <details key={n}>
                <summary>{t(`faq${n}_q` as CopyKey)}</summary>
                <p>{t(`faq${n}_a` as CopyKey)}</p>
              </details>
            ))}
          </section>
        </main>

        <footer>
          <span>{t("footer_note")}</span>
          <button type="button" onClick={resetDemo}>
            {t("reset_demo")}
          </button>
        </footer>
      </div>

      <div className={`toast${toastOn ? " show" : ""}`} role="status">
        {toast}
      </div>

      {payOpen && <TransferDialog plan={plan} url={url.trim()} lang={lang} resumeOrderId={resumeOrderId}
        onClose={() => setPayOpen(false)} onApproved={attemptId => void executeCheck(attemptId)}/>}
    </div>
  );
}

function GiftNotice() { return <Check size={17} aria-hidden="true"/>; }

function ago(ts: number, lang: Lang, t: (k: CopyKey, p?: Record<string, string | number>) => string) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return t("just_now");
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86400), "day");
}

function Scan({
  host,
  video,
  step,
  t,
}: {
  host: string;
  video: boolean;
  step: number;
  t: (k: CopyKey, p?: Record<string, string | number>) => string;
}) {
  const steps: CopyKey[] = video
    ? ["step_read", "step_scan", "step_transcribe", "step_claims", "step_write"]
    : ["step_read", "step_scan", "step_match", "step_write"];
  return (
    <div className="panel" role="status">
      <p className="scan-head">{t("scan_title", { host })}</p>
      <p className="note">{t("scan_note")}</p>
      <ol className="steps">
        {steps.map((key, i) => (
          <li key={key} className={i < step ? "done" : i === step ? "active" : ""}>
            <span className="dot">{i < step ? <Check size={12} strokeWidth={3} /> : null}</span>
            {t(key)}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Fail({
  code,
  t,
}: {
  code: FactErrCode;
  t: (k: CopyKey) => string;
}) {
  const title: CopyKey =
    code === "rate" ? "fail_rate_title" : code === "ai_unavailable" ? "fail_off_title" : code === "unreadable" ? "fail_title" : "fail_ai_title";
  const body: CopyKey =
    code === "rate" ? "fail_rate_body" : code === "ai_unavailable" ? "fail_off_body" : code === "unreadable" ? "fail_body" : "fail_ai_body";
  return (
    <div className="panel alert" role="alert">
      <h3>{t(title)}</h3>
      <p>{t(body)}</p>
    </div>
  );
}

export function Report({
  result,
  lang,
  t,
  titleRef,
  onAgain,
  onCopy,
  onShare,
  onPdf,
}: {
  result: FactOk;
  lang: Lang;
  t: (k: CopyKey, p?: Record<string, string | number>) => string;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onAgain: () => void;
  onCopy: () => void;
  onShare: () => void;
  onPdf: () => void;
}) {
  const bucket = uiVerdict(result.verdict);
  const summary = result.summaryKey ? t(result.summaryKey) : result.summary;
  const kind =
    result.kind === "news"
      ? t("kind_news")
      : result.kind === "video"
        ? t("kind_video", { platform: result.platform || result.meta.platform || "" })
        : t("kind_link");
  return (
    <article className="report" data-v={bucket} aria-labelledby="repTitle">
      {result.demo && <div className="demo-notice" role="note"><strong>{t("example_title")}</strong><p>{t("example_disclaimer")}</p></div>}
      <p className="report-kicker">{t("content_result")}</p>
      {result.meta.title && <p className="report-article-title">{result.meta.title}</p>}
      <div className="rep-head">
        <span className="verdict-mark" aria-hidden="true">{bucket === "good" ? <Check size={38} strokeWidth={3}/> : bucket === "bad" ? <X size={38} strokeWidth={3}/> : <span>?</span>}</span>
        <div>
          <h2 className="rep-title" id="repTitle" tabIndex={-1} ref={titleRef}>
            {t(bucketLabel(result.verdict))}
          </h2>
          <p className="precise">{t(("v_" + result.verdict) as CopyKey)}</p>
          <p className="rep-sum">{summary}</p>
        </div>
      </div>
      <div className="meta">
        <span className="tag">
          <Link2 size={14} aria-hidden="true" />
          <span className="t">{result.host}</span>
        </span>
        <span className="tag">
          {result.kind === "news" ? (
            <Newspaper size={14} aria-hidden="true" />
          ) : result.kind === "video" ? (
            <Play size={14} aria-hidden="true" />
          ) : (
            <Globe size={14} aria-hidden="true" />
          )}
          <span className="t">{kind}</span>
        </span>
        <span className="tag">
          <span className="t">{t(result.plan === "advance" ? "plan_tag_advance" : "plan_tag_regular")}</span>
        </span>
        {result.mode === "ai" ? (
          <span className="tag">
            <span className="t">{t(result.engine === "openai" ? "checked_openai" : "checked_legacy")}</span>
          </span>
        ) : null}
        {result.meta.author ? (
          <span className="tag">
            <span className="t">{result.meta.author}</span>
          </span>
        ) : null}
      </div>

      {result.reference_date && <p className="time-context"><strong>{t("time_context")}:</strong> {result.reference_date}</p>}
      {!result.demo && result.checked_at && <p className="note">{t("checked_at")}: {new Date(result.checked_at).toLocaleString(lang === "id" ? "id-ID" : "en-GB", { timeZone: "Asia/Jakarta" })} WIB</p>}

      {result.claims.length > 0 ? (
        <section className="grp">
          <h3>{t("g_claims")}</h3>
          <ul className="sig">
            {result.claims.map((c, index) => {
              const pill = claimPill(c.status);
              return (
                <li key={index} className={`claim-row claim-${c.status}`}>
                  <span className={`ic ${pill.cls} claim-symbol`} aria-hidden="true">{pill.symbol}</span>
                  <div className="claim-main">
                    <div className="claim-heading"><span className="sig-t">{c.status === "salah" ? <s>{c.text}</s> : c.text}</span><span className={`pill ${pill.cls}`}>{t(pill.key)}</span></div>
                    {c.correction && <p className="claim-correction"><Check size={16} aria-hidden="true"/><span><strong>{t("correction")}:</strong> {c.correction}</span></p>}
                    <p className="sig-d">{c.explanation}</p>
                    {Boolean(c.source_urls?.length) && <div className="claim-evidence">{c.source_urls?.map(url => {
                      const source = result.sources.find(s => s.url === url);
                      return source ? <a key={url} href={url} target="_blank" rel="noopener noreferrer" aria-label={`${t("evidence")}: ${source.title}`}>[{result.sources.indexOf(source) + 1}] {source.publisher}</a> : null;
                    })}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {result.red_flags.length > 0 ? (
        <section className="grp">
          <h3>{t("g_flags")}</h3>
          <ul className="sig">
            {result.red_flags.map((flag) => (
              <li key={flag}>
                <span className="ic bad">
                  <X size={14} strokeWidth={3} aria-hidden="true" />
                </span>
                <div className="sig-t">{flag}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.sources.length > 0 ? (
        <section className="grp">
          <h3>{t("g_sources")}</h3>
          <ul className="sig">
            {result.sources.map((s, index) => (
              <li key={s.url}>
                <div>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    [{index + 1}] {s.title}
                  </a>
                  <div className="sig-d">{s.publisher}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!result.demo && result.safety.length > 0 && <details className="safety-details">
        <summary>{t("g_safety")}</summary>
        <p className="note">{t("safety_separate")}</p>
        <SafetyGroup title={t("g_safety")} items={result.safety.filter(i => !["outlet", "platform", "unknown"].includes(i.code))} t={t}/>
        <SafetyGroup title={t("g_source")} items={result.safety.filter(i => ["outlet", "platform", "unknown"].includes(i.code))} t={t}/>
      </details>}

      {result.meta.published_at && <p className="note">{t("published_at")}: {result.meta.published_at}</p>}

      <div className="advice">
        <h3>{t("what_to_do")}</h3>
        <p>{t(adviceKey(result.verdict))}</p>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={onAgain}>
          {t("another")}
        </button>
        <button type="button" className="btn" onClick={onCopy}>
          {t("copy")}
        </button>
        <button type="button" className="btn" onClick={onShare}>
          {t("share_wa")}
        </button>
        <button type="button" className="btn" onClick={onPdf}>
          {t("save_pdf")}
        </button>
      </div>
      <p className="note">{t("disclaimer")}</p>
      <p className="note">{t("report_note")}</p>
    </article>
  );
}

function SafetyGroup({
  title,
  items,
  t,
}: {
  title: string;
  items: SafetyItem[];
  t: (k: CopyKey, p?: Record<string, string | number>) => string;
}) {
  if (!items.length) return null;
  return (
    <section className="grp">
      <h3>{title}</h3>
      <ul className="sig">
        {items.map((item, i) => (
          <li key={item.code + i}>
            <span className={`ic ${item.st}`}>
              <StatusIcon st={item.st} />
            </span>
            <div>
              <div className="sig-t">{t(`s_${item.code}_t` as CopyKey, item.params)}</div>
              <div className="sig-d">{t(`s_${item.code}_d` as CopyKey, item.params)}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}


function PlanCard({
  kind,
  plan,
  t,
  onChoose,
}: {
  kind: Plan;
  plan: Plan;
  t: (k: CopyKey, p?: Record<string, string | number>) => string;
  onChoose: () => void;
}) {
  const selected = plan === kind;
  const features: { yes: boolean; key: CopyKey }[] =
    kind === "regular"
      ? [
          { yes: true, key: "feat_news" },
          { yes: true, key: "feat_scan" },
          { yes: false, key: "feat_video" },
          { yes: false, key: "feat_ai" },
          { yes: true, key: "feat_pay" },
        ]
      : [
          { yes: true, key: "feat_news" },
          { yes: true, key: "feat_scan" },
          { yes: true, key: "feat_video" },
          { yes: true, key: "feat_ai" },
          { yes: true, key: "feat_pay" },
        ];
  return (
    <article className={`plan ${kind === "regular" ? "reg" : "adv"}`}>
      <div className="plan-name">
        {t(kind === "regular" ? "plan_regular" : "plan_advance")}
        {kind === "advance" ? <span className="badge">{t("badge_video")}</span> : null}
      </div>
      <p className="blurb">{t(kind === "regular" ? "plan_regular_blurb" : "plan_advance_blurb")}</p>
      <div className="price">
        {money(PRICES[kind])} <small>{t("per_check")}</small>
      </div>
      <ul className="feat">
        {features.map((f) => (
          <li key={f.key} className={f.yes ? "" : "no"}>
            <span className={`ic ${f.yes ? "ok" : "off"}`}>
              <StatusIcon st={f.yes ? "ok" : "off"} />
            </span>
            <span>
              {t(f.key)}
              {f.yes ? null : <span className="sr"> ({t("not_included")})</span>}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={`btn cta ${kind === "regular" ? "reg" : "adv"}`}
        aria-pressed={selected}
        onClick={onChoose}
      >
        {selected ? (
          <>
            <Check size={16} aria-hidden="true" /> {t("selected")}
          </>
        ) : (
          t(kind === "regular" ? "choose_regular" : "choose_advance")
        )}
      </button>
    </article>
  );
}
