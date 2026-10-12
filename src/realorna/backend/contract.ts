import { inspectLink, isSeverePhish, trustScore } from "../safety";
import type {
  Claim,
  ClaimStatus,
  ContentMeta,
  FactContract,
  FactOk,
  Plan,
  Source,
  Verdict,
} from "../types";

const VERDICTS = new Set<Verdict>([
  "FAKTA",
  "HOAKS",
  "MENYESATKAN",
  "SEBAGIAN_BENAR",
  "BELUM_TERVERIFIKASI",
]);

function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function asVerdict(v: unknown): Verdict {
  return typeof v === "string" && VERDICTS.has(v as Verdict) ? (v as Verdict) : "BELUM_TERVERIFIKASI";
}

function asStatus(v: unknown): ClaimStatus {
  if (v === "benar" || v === "salah" || v === "belum_jelas") return v;
  return "belum_jelas";
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function parseModelJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function cleanSources(raw: unknown, extra: Source[]): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  const push = (title: string, url: string, publisher: string) => {
    if (!/^https?:\/\//i.test(url)) return;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    if (u.hostname === "localhost" || u.hostname.endsWith(".local")) return;
    const key = u.toString();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      title: clip(title || u.hostname, 160),
      url: key,
      publisher: clip(publisher || hostnameOf(key), 80),
    });
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      push(String(o.title || ""), String(o.url || ""), String(o.publisher || ""));
      if (out.length >= 5) break;
    }
  }
  for (const c of extra) {
    if (out.length >= 5) break;
    push(c.title, c.url, c.publisher);
  }
  return out;
}

export function contractFromModel(
  parsed: Record<string, unknown>,
  extraSources: Source[],
  lang: "id" | "en",
): FactContract {
  const claims: Claim[] = [];
  if (Array.isArray(parsed.claims)) {
    for (const item of parsed.claims) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const text = clip(String(o.text || ""), 280);
      if (!text) continue;
      claims.push({
        text,
        status: asStatus(o.status),
        explanation: clip(String(o.explanation || ""), 480),
      });
      if (claims.length >= 6) break;
    }
  }
  const red_flags: string[] = [];
  if (Array.isArray(parsed.red_flags)) {
    for (const flag of parsed.red_flags) {
      if (typeof flag !== "string") continue;
      const text = clip(flag, 220);
      if (text) red_flags.push(text);
      if (red_flags.length >= 8) break;
    }
  }
  const metaRaw = (parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {}) as Record<
    string,
    unknown
  >;
  const meta: ContentMeta = {
    title: clip(String(metaRaw.title || ""), 180),
    platform: clip(String(metaRaw.platform || ""), 80),
    author: clip(String(metaRaw.author || ""), 120),
    published_at: clip(String(metaRaw.published_at || ""), 40),
  };
  const summary = clip(String(parsed.summary || ""), 800);
  return {
    verdict: asVerdict(parsed.verdict),
    confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0))),
    summary:
      summary ||
      (lang === "id"
        ? "Bukti yang tersedia belum cukup untuk vonis yang lebih tegas."
        : "The available evidence is not enough for a firmer verdict."),
    claims,
    red_flags,
    sources: cleanSources(parsed.sources, extraSources),
    meta,
  };
}

export function reportFromContract(
  contract: FactContract,
  input: { url: string; plan: Plan; lang: "id" | "en" },
  finalUrl: string,
  engine: FactOk["engine"],
): FactOk {
  const u = new URL(finalUrl);
  const inspected = inspectLink(u);
  let verdict = contract.verdict;
  let confidence = contract.confidence;
  if (isSeverePhish(inspected.items)) {
    verdict = "HOAKS";
    confidence = Math.max(confidence, 80);
  }
  const meta = {
    ...contract.meta,
    title: contract.meta.title || inspected.outlet || "",
    platform: contract.meta.platform || inspected.platform || inspected.outlet || inspected.host,
  };
  return {
    ok: true,
    verdict,
    confidence,
    score: trustScore(verdict, confidence || 50),
    summary: contract.summary,
    claims: contract.claims,
    red_flags: contract.red_flags,
    sources: contract.sources,
    meta,
    safety: [...inspected.items, ...inspected.source],
    host: inspected.host,
    kind: inspected.kind,
    platform: inspected.platform,
    outlet: inspected.outlet,
    url: finalUrl,
    plan: input.plan,
    mode: engine ? "ai" : "structure",
    engine,
  };
}

export function contractFromReport(report: FactOk): FactContract {
  return {
    verdict: report.verdict,
    confidence: report.confidence,
    summary: report.summaryKey ? report.summary : report.summary,
    claims: report.claims,
    red_flags: report.red_flags,
    sources: report.sources,
    meta: report.meta,
  };
}
