function isIpLiteral(host: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "0.0.0.0" || v === "::") return true;
  if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (!m) return false;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((n) => n > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export async function isPublicHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }
  if (isIpLiteral(host)) return !isPrivateIp(host);
  try {
    const dns = await import("node:dns/promises");
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length) return false;
    return records.every((r) => !isPrivateIp(r.address));
  } catch {
    return true;
  }
}

type Fetched =
  | { ok: true; finalUrl: string; status: number; body: string; truncated: boolean }
  | { ok: false; reason: "blocked" | "http" | "network" | "not_text"; status?: number; finalUrl?: string };

export async function safeFetch(start: string): Promise<Fetched> {
  let current = start;
  for (let hop = 0; hop < 4; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return { ok: false, reason: "network" };
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "blocked" };
    if (!(await isPublicHost(u.hostname))) return { ok: false, reason: "blocked" };
    let res: Response;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "id,en;q=0.8",
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      return { ok: false, reason: "network", finalUrl: current };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, reason: "http", status: res.status, finalUrl: current };
      current = new URL(loc, current).toString();
      continue;
    }
    if (res.status === 404 || res.status === 410) {
      return { ok: false, reason: "http", status: res.status, finalUrl: current };
    }
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) return { ok: false, reason: "http", status: res.status, finalUrl: current };
    if (ct && !/html|text|json|xml/i.test(ct)) {
      return { ok: false, reason: "not_text", status: res.status, finalUrl: current };
    }
    if (!res.body) return { ok: false, reason: "not_text", status: res.status, finalUrl: current };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    while (size < 1_000_000) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, 1_000_000 - size);
      chunks.push(chunk); size += chunk.length;
      if (chunk.length < value.length || size >= 1_000_000) { await reader.cancel(); break; }
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return { ok: true, finalUrl: current, status: res.status, body, truncated: size >= 1_000_000 };
  }
  return { ok: false, reason: "network" };
}

function decode(s: string) {
  const named: Record<string, string> = { amp: "&", nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "–", mdash: "—" };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const point = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "";
  }).replace(/\s+/g, " ").trim();
}

function readableText(html: string) {
  return decode(html
    .replace(/<(script|style|noscript|nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function metaContent(html: string, key: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attr = tag.match(new RegExp(`(?:name|property)\\s*=\\s*["']${key}["']`, "i"));
    if (!attr) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decode(content).slice(0, 400);
  }
  return "";
}

export function pageBits(html: string) {
  let article: Record<string, unknown> = {};
  const visit = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== "object" || depth > 8) return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 50)) visit(item, depth + 1); return; }
    const row = value as Record<string, unknown>;
    if (/Article|Reportage|BlogPosting/.test(String(row["@type"] ?? ""))) {
      if (String(row.articleBody ?? "").length > String(article.articleBody ?? "").length || !Object.keys(article).length) article = row;
    }
    for (const key of ["@graph", "mainEntity", "itemListElement"]) visit(row[key], depth + 1);
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* Some publishers have invalid JSON-LD. */ }
  }
  const title = metaContent(html, "og:title") || (typeof article.headline === "string" ? decode(article.headline) : "") || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 400);
  const description = metaContent(html, "og:description") || metaContent(html, "description");
  const authorObject = Array.isArray(article.author) ? article.author[0] : article.author;
  const articleAuthor = typeof authorObject === "string" ? authorObject : authorObject && typeof authorObject === "object" ? String((authorObject as { name?: string }).name ?? "") : "";
  const author = metaContent(html, "author") || metaContent(html, "article:author") || articleAuthor.slice(0, 160);
  const published = metaContent(html, "article:published_time") || metaContent(html, "date") || (typeof article.datePublished === "string" ? article.datePublished.slice(0, 60) : "");
  const region = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  let text = typeof article.articleBody === "string" && article.articleBody.length >= 120 ? readableText(article.articleBody) : readableText(region || html);
  if (/^(?:just a moment|access denied|attention required|robot check|verify you are human|sign in|log in|404|403)/i.test(title.trim())) text = "";
  return { title, description, author, published, text: text.slice(0, 16000), truncated: text.length > 16000 };
}

export async function oembed(url: string, host: string) {
  let endpoint = "";
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") {
    endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  } else if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  } else if (host.includes("instagram.com") || host === "instagr.am") {
    endpoint = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;
  } else {
    return null;
  }
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      provider_name?: string;
    };
    return {
      title: String(data.title || "").slice(0, 300),
      author: String(data.author_name || "").slice(0, 160),
      provider: String(data.provider_name || "").slice(0, 80),
    };
  } catch {
    return null;
  }
}
