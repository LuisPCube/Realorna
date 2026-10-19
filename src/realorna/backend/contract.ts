import { inspectLink } from "../safety";
import type { Claim, FactContract, FactOk, Lang, Plan, Source, Verdict } from "../types";

function clip(value: unknown, n: number) {
  const t = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/** Only public HTTP(S) evidence links; never render arbitrary model protocols. */
export function evidenceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port && !["80", "443"].includes(u.port)) return null;
    if (!host.includes(".") || /:|^\d+(?:\.\d+){3}$/.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^utm_|^gclid$|^fbclid$/i.test(key)) u.searchParams.delete(key);
    return u.toString();
  } catch { return null; }
}

export function parseModelJson(raw: string): Record<string, unknown> | null {
  try {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const value: unknown = JSON.parse(trimmed);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

export function verdictFromClaims(claims: Claim[]): Verdict {
  if (!claims.length) return "BELUM_TERVERIFIKASI";
  const main = claims.filter(c => c.importance !== "detail");
  if (!main.length) return "BELUM_TERVERIFIKASI";
  if (main.some(c => c.status === "salah" || c.status === "keliru")) {
    return claims.some(c => c.status === "benar") ? "MENYESATKAN" : "HOAKS";
  }
  if (main.some(c => c.status === "belum_jelas")) return "BELUM_TERVERIFIKASI";
  return claims.some(c => c.status !== "benar") ? "SEBAGIAN_BENAR" : "FAKTA";
}

export function contractFromModel(
  parsed: Record<string, unknown>, retrievedSources: Source[], lang: Lang,
  input: { sourceUrl?: string; contentRead?: boolean } = {},
): FactContract {
  const available = new Map<string, Source>();
  const submitted = evidenceUrl(input.sourceUrl);
  const submittedHost = submitted ? new URL(submitted).hostname.replace(/^(?:www|m)\./, "") : "";
  for (const source of retrievedSources) {
    const url = evidenceUrl(source.url);
    if (!url || new URL(url).hostname.replace(/^(?:www|m)\./, "") === submittedHost) continue;
    // Homepages and search listings don't substantiate a specific factual claim.
    const u = new URL(url);
    if (/^\/(?:[a-z]{2}(?:-[a-z]{2})?)?\/?$/i.test(u.pathname) || /\/(?:search|pencarian)(?:\/|$)/i.test(u.pathname)) continue;
    available.set(url, { url, title: clip(source.title, 160) || u.hostname, publisher: u.hostname.replace(/^www\./, "") });
  }
  const claims: Claim[] = [];
  let downgraded = false;
  for (const item of Array.isArray(parsed.claims) ? parsed.claims : []) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = clip(o.text, 280);
    if (!text) continue;
    let status: Claim["status"] = ["benar", "salah", "keliru"].includes(String(o.status)) ? o.status as Claim["status"] : "belum_jelas";
    const source_urls = [...new Set((Array.isArray(o.source_urls) ? o.source_urls : [])
      .map(evidenceUrl).filter((url): url is string => Boolean(url && available.has(url))))].slice(0, 4);
    let explanation = clip(o.explanation, 460);
    let correction = clip(o.correction, 280);
    if (input.contentRead === false || status !== "belum_jelas" && !source_urls.length || status === "keliru" && !correction) {
      downgraded = true; status = "belum_jelas"; correction = "";
      explanation = lang === "id" ? "Bukti pembanding untuk klaim ini belum cukup. Belum dapat dipastikan benar atau salah." : "There is not enough comparison evidence for this claim. It cannot yet be confirmed or refuted.";
    }
    if (status === "belum_jelas" || status === "benar") correction = "";
    claims.push({ text, status, explanation, correction, source_urls, importance: o.importance === "detail" ? "detail" : "utama" });
    if (claims.length >= 8) break;
  }
  const verdict = input.contentRead === false ? "BELUM_TERVERIFIKASI" : verdictFromClaims(claims);
  const fallback = lang === "id" ? "Bukti yang tersedia belum cukup untuk memastikan klaim utama. Lihat bagian yang belum terverifikasi di bawah." : "The available evidence is not enough to establish the main claims. See the unverified points below.";
  let reconciled = fallback;
  const disputed = claims.find(c => c.importance !== "detail" && ["salah", "keliru"].includes(c.status));
  if (verdict === "HOAKS" || verdict === "MENYESATKAN") {
    reconciled = lang === "id" ? `Klaim utama terbantahkan: ${disputed?.text ?? ""} ${disputed?.correction ?? ""}` : `A core claim is contradicted: ${disputed?.text ?? ""} ${disputed?.correction ?? ""}`;
  } else if (verdict === "FAKTA" || verdict === "SEBAGIAN_BENAR") {
    reconciled = lang === "id" ? "Klaim utama didukung bukti pada konteks yang diperiksa." : "The main claims are supported in the context checked.";
    if (verdict === "SEBAGIAN_BENAR") reconciled += lang === "id" ? " Ada detail yang perlu koreksi atau belum terverifikasi; lihat rinciannya." : " Some details need correction or remain unverified; see the breakdown.";
  }
  const summary = downgraded || parsed.verdict !== verdict ? clip(reconciled, 500) : clip(parsed.summary, 500) || reconciled;
  const referenced = new Set(claims.flatMap(c => c.source_urls ?? []));
  const rawMeta = parsed.meta && typeof parsed.meta === "object" ? parsed.meta as Record<string, unknown> : {};
  return {
    verdict, confidence: 0, summary, claims,
    red_flags: downgraded ? [] : (Array.isArray(parsed.red_flags) ? parsed.red_flags : []).map(s => clip(s, 220)).filter(Boolean).slice(0, 5),
    sources: [...available.values()].filter(s => referenced.has(s.url)).slice(0, 32),
    meta: { title: clip(rawMeta.title, 180), platform: clip(rawMeta.platform, 80), author: clip(rawMeta.author, 120), published_at: clip(rawMeta.published_at, 60) },
    checked_at: new Date().toISOString(), reference_date: clip(parsed.reference_date, 140),
  };
}

export function reportFromContract(
  contract: FactContract, input: { url: string; plan: Plan; lang: Lang },
  finalUrl: string, engine: FactOk["engine"],
): FactOk {
  const inspected = inspectLink(new URL(finalUrl));
  return {
    ok: true, ...contract,
    meta: { ...contract.meta, platform: contract.meta.platform || inspected.platform || inspected.outlet || inspected.host },
    safety: [...inspected.items, ...inspected.source], host: inspected.host, kind: inspected.kind,
    platform: inspected.platform, outlet: inspected.outlet, url: finalUrl, plan: input.plan,
    mode: engine ? "ai" : "structure", engine,
  };
}
