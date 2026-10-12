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
import { EXAMPLES, PRICES, PROMOS, findIn, inspectLink, parseLink, uiVerdict, VIDEO } from "./safety";
import type { ClaimStatus, FactErrCode, FactOk, Lang, Plan, SafetyItem, Verdict } from "./types";

type Recent = {
  url: string;
  host: string;
  verdict: Verdict;
  score: number;
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
const PAY_METHODS = ["QRIS", "GoPay", "OVO", "DANA", "ShopeePay", "Virtual Account"];

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
const SEAL = scallop(70, 70, 58, 3.2, 14);
const CIRC = 2 * Math.PI * 44;

function money(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

function adviceKey(v: Verdict): CopyKey {
  if (v === "FAKTA") return "advice_good";
  if (v === "HOAKS" || v === "MENYESATKAN") return "advice_bad";
  if (v === "BELUM_TERVERIFIKASI") return "advice_unknown";
  return "advice_caution";
}

function bucketLabel(v: Verdict): CopyKey {
  const b = uiVerdict(v);
  if (b === "good") return "verdict_good";
  if (b === "bad") return "verdict_bad";
  return "verdict_caution";
}

function claimPill(status: ClaimStatus): { cls: "ok" | "warn" | "bad"; key: CopyKey } {
  if (status === "benar") return { cls: "ok", key: "st_true" };
  if (status === "salah") return { cls: "bad", key: "st_false" };
  return { cls: "warn", key: "st_unclear" };
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
  const toastTimer = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const t = (key: CopyKey, params?: Record<string, string | number>) => translate(lang, key, params);

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
    setRecent(readStore<Recent[]>("rl:recent", []).slice(0, 5));
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
      score: result.score,
      ts: Date.now(),
      result,
    };
    const next = [item, ...recent.filter((r) => r.url !== result.url)].slice(0, 5);
    setRecent(next);
    localStorage.setItem("rl:recent", JSON.stringify(next));
  }

  async function runCheck() {
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
    setPayOpen(true);
  }

  function showReport(result: FactOk) {
    setPayOpen(false);
    setError(null);
    setPhase({ type: "report", result });
    remember(result);
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
    const summary = result.summaryKey ? t(result.summaryKey) : result.summary;
    const lines = [
      "Realorna",
      `${t(bucketLabel(result.verdict))} · ${t(("v_" + result.verdict) as CopyKey)} (${result.score}/100)`,
      result.host,
      summary,
      "",
      `${t("what_to_do")}: ${t(adviceKey(result.verdict))}`,
      ...result.sources.map((s) => s.url),
    ];
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      ping(t("copied"));
    } catch {
      ping(t("copy_fail"));
    }
  }

  function resetDemo() {
    localStorage.removeItem("rl:recent");
    setRecent([]);
    setUrl("");
    setError(null);
    setPhase({ type: "idle" });
    ping(t("demo_reset"));
  }

  const price = money(PRICES[plan]);

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
            <span className="proto">{t("proto")}</span>
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
          <section className="hero">
            <h1>{t("h1")}</h1>
            <p className="lead">{t("lead")}</p>
          </section>

          <section className="checker" id="checker" aria-label={t("field_label")}>
            <div className="switch" role="radiogroup" aria-label={t("plan_label")}>
              <span className="thumb" aria-hidden="true" />
              {(["regular", "advance"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className="opt"
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
                <button type="button" className="go" disabled={payOpen} onClick={() => void runCheck()}>
                  {payOpen ? t("checking") : t("check")}
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
              <button type="button" className="link-btn" onClick={() => setUrl(EXAMPLES.news)}>
                {t("ex_news")}
              </button>
              <button type="button" className="link-btn" onClick={() => setUrl(EXAMPLES.scam)}>
                {t("ex_scam")}
              </button>
              <button type="button" className="link-btn" onClick={() => setUrl(EXAMPLES.video)}>
                {t("ex_video")}
              </button>
            </div>

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
                  const text = `Realorna: ${t(bucketLabel(r.verdict))} (${r.score}/100)\n${r.host}`;
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
                    localStorage.setItem("rl:recent", JSON.stringify([]));
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
                            <span className="tabular-nums">
                              {item.score}/100
                            </span>
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

      {payOpen ? (
        <PayDialog
          plan={plan}
          url={url.trim()}
          lang={lang}
          t={t}
          onClose={() => setPayOpen(false)}
          onFail={(code) => {
            setPayOpen(false);
            setPhase({ type: "fail", code });
          }}
          onPaid={(report) => {
            ping(t("pay_ok"));
            showReport(report);
          }}
        />
      ) : null}
    </div>
  );
}

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

function Report({
  result,
  t,
  titleRef,
  onAgain,
  onCopy,
  onShare,
  onPdf,
}: {
  result: FactOk;
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
      <div className="rep-head">
        <Seal score={result.score} label={t("score_aria", { n: result.score })} />
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
            <span className="t">{t(result.engine === "grok" ? "checked_grok" : "checked_gemini")}</span>
          </span>
        ) : null}
        {result.meta.author ? (
          <span className="tag">
            <span className="t">{result.meta.author}</span>
          </span>
        ) : null}
      </div>

      <SafetyGroup title={t("g_safety")} items={result.safety.filter((i) => !["outlet", "platform", "unknown"].includes(i.code))} t={t} />
      <SafetyGroup title={t("g_source")} items={result.safety.filter((i) => ["outlet", "platform", "unknown"].includes(i.code))} t={t} />

      {result.claims.length > 0 ? (
        <section className="grp">
          <h3>{t("g_claims")}</h3>
          <ul className="sig">
            {result.claims.map((c) => {
              const pill = claimPill(c.status);
              return (
                <li key={c.text}>
                  <span className={`ic ${pill.cls}`}>
                    <StatusIcon st={pill.cls === "ok" ? "ok" : pill.cls === "bad" ? "bad" : "warn"} />
                  </span>
                  <div>
                    <div className="sig-t">{c.text}</div>
                    <div className="sig-d">
                      <span className={`pill ${pill.cls}`}>{t(pill.key)}</span>
                      {c.explanation}
                    </div>
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
            {result.sources.map((s) => (
              <li key={s.url}>
                <div>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>
                  <div className="sig-d">{s.publisher}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {result.meta.title ? (
        <p className="note">
          {result.meta.title}
          {result.meta.published_at ? ` · ${result.meta.published_at}` : ""}
        </p>
      ) : null}

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

function Seal({ score, label }: { score: number; label: string }) {
  const numRef = useRef<SVGTextElement>(null);
  const offset = CIRC * (1 - score / 100);
  useEffect(() => {
    const node = numRef.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.textContent = String(score);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start - 280) / 800));
      node.textContent = String(Math.round(score * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    node.textContent = "0";
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [score]);
  return (
    <svg className="seal" viewBox="0 0 140 140" role="img" aria-label={label}>
      <path className="seal-body" d={SEAL} />
      <circle className="seal-track" cx="70" cy="70" r="44" />
      <circle
        className="seal-arc"
        cx="70"
        cy="70"
        r="44"
        transform="rotate(-90 70 70)"
        style={{ ["--c" as string]: CIRC.toFixed(1), ["--to" as string]: offset.toFixed(1) }}
      />
      <text className="seal-num" x="70" y="76" textAnchor="middle" ref={numRef}>
        {score}
      </text>
      <text className="seal-lbl" x="70" y="94" textAnchor="middle">
        /100
      </text>
    </svg>
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

function PayDialog({
  plan,
  url,
  lang,
  t,
  onClose,
  onPaid,
  onFail,
}: {
  plan: Plan;
  url: string;
  lang: Lang;
  t: (k: CopyKey, p?: Record<string, string | number>) => string;
  onClose: () => void;
  onPaid: (report: FactOk) => void;
  onFail: (code: FactErrCode) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [promo, setPromo] = useState("");
  const [ticket, setTicket] = useState<{
    order_id: string;
    amount: number;
    demo: boolean;
    qr_url: string | null;
    qr_data_url: string | null;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [settling, setSettling] = useState(false);
  const [note, setNote] = useState("");
  const [left, setLeft] = useState(600);
  const [timing, setTiming] = useState(false);
  const onPaidRef = useRef(onPaid);
  const onFailRef = useRef(onFail);
  onPaidRef.current = onPaid;
  onFailRef.current = onFail;

  const discount = PROMOS[promo.trim().toUpperCase()] || 0;
  const previewTotal = Math.round(PRICES[plan] * (1 - discount));
  const total = ticket?.amount ?? previewTotal;

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);

  useEffect(() => {
    if (!timing) return;
    const timer = window.setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [timing]);

  useEffect(() => {
    if (timing && left === 0) {
      setTiming(false);
      setNote(t("pay_expired"));
    }
  }, [left, timing, t]);

  useEffect(() => {
    if (!ticket || ticket.demo) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(ticket.order_id)}`);
        if (!res.ok || stop) return;
        const data = (await res.json()) as { status?: string; error?: string; report?: FactOk };
        if (stop) return;
        if (data.status === "processed" && data.report?.ok) {
          stop = true;
          onPaidRef.current(data.report);
        } else if (data.status === "paid") {
          setSettling(true);
        } else if (data.status === "failed") {
          stop = true;
          onFailRef.current(failCode(data.error));
        } else if (data.status === "expired") {
          stop = true;
          setTiming(false);
          setNote(t("pay_expired"));
        }
      } catch {
        /* coba lagi pada interval berikutnya */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 3000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [ticket, t]);

  async function createPayment() {
    if (creating || ticket) return;
    setCreating(true);
    setNote("");
    try {
      const res = await fetch("/api/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, plan, lang, promo }),
      });
      const data = (await res.json()) as {
        error?: string;
        order_id?: string;
        amount?: number;
        demo?: boolean;
        qr_url?: string | null;
        qr_data_url?: string | null;
      };
      if (!res.ok || !data.order_id) {
        if (data.error === "video_plan") onFailRef.current("video_plan");
        else setNote(t("pay_fail"));
        return;
      }
      setTicket({
        order_id: data.order_id,
        amount: data.amount || previewTotal,
        demo: Boolean(data.demo),
        qr_url: data.qr_url || null,
        qr_data_url: data.qr_data_url || null,
      });
      setLeft(600);
      setTiming(true);
    } catch {
      setNote(t("pay_fail"));
    } finally {
      setCreating(false);
    }
  }

  async function simulate() {
    if (!ticket || settling) return;
    setSettling(true);
    setNote("");
    try {
      const res = await fetch("/api/demo-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: ticket.order_id }),
      });
      const data = (await res.json()) as { error?: string; report?: FactOk };
      if (!res.ok || !data.report?.ok) {
        onFailRef.current(failCode(data.error));
        return;
      }
      onPaidRef.current(data.report);
    } catch {
      onFailRef.current("ai_failed");
    } finally {
      setSettling(false);
    }
  }

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const qrSrc = ticket?.qr_data_url || ticket?.qr_url || "";

  return (
    <dialog
      ref={ref}
      aria-labelledby="payT"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h3 id="payT">{t("pay_title")}</h3>
      <p className="mid">
        {t(plan === "advance" ? "plan_advance" : "plan_regular")} · {t("per_check")}
      </p>
      <input
        className="promo"
        value={promo}
        placeholder={t("promo_ph")}
        aria-label={t("promo_ph")}
        disabled={Boolean(ticket) || creating}
        onChange={(e) => setPromo(e.target.value)}
      />
      <p className="mid">{discount ? t("promo_ok") : ""}</p>
      <div className="methods" role="group">
        {PAY_METHODS.map((m) => (
          <button key={m} type="button" aria-pressed={m === "QRIS"} disabled={m !== "QRIS"}>
            {m}
          </button>
        ))}
      </div>
      {ticket ? qrSrc ? <img className="qr" src={qrSrc} alt="QRIS" /> : <QrMark /> : null}
      {ticket && timing ? (
        <div className="cd">
          {mm}:{ss}
        </div>
      ) : null}
      <p className="mid">
        <b>
          {t("pay_total")} {money(total)}
        </b>
        {ticket ? ` · ${settling ? t("pay_checking") : ticket.demo ? t("pay_demo") : t("pay_scan")}` : null}
      </p>
      {note ? (
        <p className="error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{note}</span>
        </p>
      ) : (
        <p className="mid">{t("refund_note")}</p>
      )}
      <div className="dlg-row">
        <button type="button" className="btn" onClick={onClose}>
          {t("close")}
        </button>
        {ticket?.demo ? (
          <button type="button" className="btn primary" disabled={settling || left === 0} onClick={() => void simulate()}>
            {settling ? t("pay_checking") : t("pay_sim")}
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={creating || Boolean(ticket)} onClick={() => void createPayment()}>
            {creating ? t("pay_loading") : ticket ? t("pay_wait") : t("pay_start")}
          </button>
        )}
      </div>
    </dialog>
  );
}

function QrMark() {
  const cells: { x: number; y: number }[] = [];
  let n = 7;
  for (let y = 0; y < 21; y++) {
    for (let x = 0; x < 21; x++) {
      n = (n * 9301 + 49297) % 233280;
      const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      if (!finder && n / 233280 > 0.5) cells.push({ x, y });
    }
  }
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect className="ink" x={x} y={y} width={7} height={7} />
      <rect className="paper" x={x + 1} y={y + 1} width={5} height={5} />
      <rect className="ink" x={x + 2} y={y + 2} width={3} height={3} />
    </g>
  );
  return (
    <svg className="qr" viewBox="0 0 21 21" role="img" aria-label="QR">
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} className="ink" x={c.x} y={c.y} width={1} height={1} />
      ))}
      {finder(0, 0)}
      {finder(14, 0)}
      {finder(0, 14)}
    </svg>
  );
}
