import type { SafetyItem } from "./types";

export const NEWS: Record<string, string> = {
  "bbc.com": "BBC News",
  "bbc.co.uk": "BBC News",
  "cnn.com": "CNN",
  "kompas.com": "Kompas",
  "detik.com": "Detik",
  "cnnindonesia.com": "CNN Indonesia",
  "tempo.co": "Tempo",
  "antaranews.com": "Antara News",
  "reuters.com": "Reuters",
  "apnews.com": "Associated Press",
  "theguardian.com": "The Guardian",
  "nytimes.com": "The New York Times",
  "liputan6.com": "Liputan6",
  "cnbcindonesia.com": "CNBC Indonesia",
  "thejakartapost.com": "The Jakarta Post",
  "republika.co.id": "Republika",
  "tirto.id": "Tirto",
  "kumparan.com": "Kumparan",
  "metrotvnews.com": "Metro TV News",
  "aljazeera.com": "Al Jazeera",
  "bloomberg.com": "Bloomberg",
  "turnbackhoax.id": "TurnBackHoax",
  "kominfo.go.id": "Komdigi",
  "komdigi.go.id": "Komdigi",
};

export const VIDEO: Record<string, string> = {
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "tiktok.com": "TikTok",
  "instagram.com": "Instagram",
  "instagr.am": "Instagram",
  "facebook.com": "Facebook",
  "fb.watch": "Facebook",
};

const BRANDS: [string, string[], string][] = [
  ["bbc", ["bbc.com", "bbc.co.uk"], "BBC"],
  ["kompas", ["kompas.com"], "Kompas"],
  ["detik", ["detik.com"], "Detik"],
  ["cnn", ["cnn.com", "cnnindonesia.com"], "CNN"],
  ["reuters", ["reuters.com"], "Reuters"],
  ["antaranews", ["antaranews.com"], "Antara"],
  ["youtube", ["youtube.com", "youtu.be"], "YouTube"],
  ["tiktok", ["tiktok.com"], "TikTok"],
  ["instagram", ["instagram.com", "instagr.am"], "Instagram"],
  ["whatsapp", ["whatsapp.com", "wa.me"], "WhatsApp"],
  ["gopay", ["gopay.co.id", "gojek.com"], "GoPay"],
  ["dana", ["dana.id"], "DANA"],
  ["ovo", ["ovo.id"], "OVO"],
];

const SHORTENERS = new Set([
  "bit.ly",
  "bitly.com",
  "tinyurl.com",
  "s.id",
  "t.co",
  "cutt.ly",
  "is.gd",
  "rebrand.ly",
  "shorturl.at",
  "ow.ly",
  "goo.gl",
  "tiny.cc",
]);

const SUS_TLDS = new Set([
  "xyz",
  "top",
  "click",
  "icu",
  "tk",
  "ml",
  "ga",
  "cf",
  "gq",
  "buzz",
  "cyou",
  "sbs",
  "rest",
  "monster",
]);

const KEYWORDS = [
  "login",
  "log-in",
  "signin",
  "verify",
  "verifikasi",
  "claim",
  "klaim",
  "hadiah",
  "gratis",
  "promo",
  "undian",
  "giveaway",
  "bonus",
  "password",
  "kata-sandi",
  "airdrop",
  "wallet",
  "otp",
  "apk",
];

export const EXAMPLES = {
  news: "https://www.bbc.com/news",
  scam: "http://bbc-news-live.top/verify-account",
  video: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
} as const;

export const PRICES = { regular: 3000, advance: 10000 } as const;
export const PROMOS: Record<string, number> = { HEMAT10: 0.1 };

export function findIn(map: Record<string, string>, host: string) {
  for (const domain in map) {
    if (host === domain || host.endsWith("." + domain)) {
      return { domain, name: map[domain] };
    }
  }
  return null;
}

export function parseLink(raw: string): URL | null {
  const s = (raw || "").trim();
  if (!s || /\s/.test(s) || s.length > 2000) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  if (!hasScheme && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return null;
  let u: URL;
  try {
    u = new URL(hasScheme ? s : "https://" + s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
  if (!isIp && !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]{2,}$/.test(host)) return null;
  return u;
}

export function bareHost(u: URL) {
  return u.hostname.toLowerCase().replace(/^www\./, "");
}

export function inspectLink(u: URL) {
  const host = bareHost(u);
  const tld = host.split(".").pop() || "";
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const outlet = findIn(NEWS, host);
  const vid = findIn(VIDEO, host);
  const known = Boolean(outlet || vid);
  const isHttp = u.protocol === "http:";
  const susTld = SUS_TLDS.has(tld);
  const short = SHORTENERS.has(host);
  const items: SafetyItem[] = [];
  const add = (st: SafetyItem["st"], code: SafetyItem["code"], params?: Record<string, string>) => {
    items.push(params ? { st, code, params } : { st, code });
  };

  if (isIp) add("bad", "ip");
  if (host.includes("xn--")) add("warn", "puny");
  if (u.username || u.password) add("bad", "cred");

  let look: string | null = null;
  if (!known) {
    const brand = BRANDS.find(
      ([tok, legit]) =>
        host.includes(tok) && !legit.some((d) => host === d || host.endsWith("." + d)),
    );
    if (brand) {
      look = brand[2];
      add("bad", "look", { brand: brand[2] });
    }
    const hay = (host + u.pathname + u.search).toLowerCase();
    const kw = KEYWORDS.find((k) => hay.includes(k));
    if (kw) {
      const harsh = susTld || isHttp || short || Boolean(look);
      add(harsh ? "bad" : "warn", "kw", { kw });
    }
    if (susTld) add(kw || look ? "bad" : "warn", "tld", { tld });
    if (short) add("warn", "short");
  }

  if (isHttp) add("warn", "https_bad");
  else add("ok", "https_ok");

  const risky = items.some((i) => i.st === "bad" || i.st === "warn");
  if (!risky) add("ok", "clean");

  const source: SafetyItem[] = [];
  if (outlet) source.push({ st: "ok", code: "outlet", params: { name: outlet.name } });
  else if (vid) source.push({ st: "info", code: "platform", params: { platform: vid.name } });
  else source.push({ st: "warn", code: "unknown", params: { host } });

  return {
    host,
    outlet: outlet?.name ?? null,
    platform: vid?.name ?? null,
    video: Boolean(vid),
    short,
    isHttp,
    items,
    source,
    kind: (outlet ? "news" : vid ? "video" : "link") as "news" | "video" | "link",
  };
}

export function isSeverePhish(items: SafetyItem[]) {
  const codes = new Set(items.map((i) => i.code));
  if (codes.has("ip") || codes.has("cred")) return true;
  if (codes.has("puny") && codes.has("look")) return true;
  if (codes.has("look") && (codes.has("tld") || codes.has("kw") || codes.has("https_bad"))) return true;
  if (codes.has("tld") && codes.has("kw")) return true;
  if (codes.has("kw") && (codes.has("https_bad") || codes.has("short"))) return true;
  return false;
}

export function hash01(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/** Trust seal: high means safer. Model confidence is certainty, not trust. */
export function trustScore(verdict: string, confidence: number) {
  const c = Math.max(0, Math.min(100, confidence));
  if (verdict === "FAKTA") return Math.round(72 + (c / 100) * 26);
  if (verdict === "HOAKS") return Math.round(8 + ((100 - c) / 100) * 18);
  if (verdict === "MENYESATKAN") return Math.round(24 + ((100 - c) / 100) * 16);
  if (verdict === "SEBAGIAN_BENAR") return Math.round(50 + (c / 100) * 16);
  return Math.round(38 + (c / 100) * 14);
}

export function uiVerdict(verdict: string): "good" | "caution" | "bad" {
  if (verdict === "FAKTA") return "good";
  if (verdict === "HOAKS") return "bad";
  return "caution";
}
