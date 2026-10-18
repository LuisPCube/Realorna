import { isPublicHost } from "../engine.server";
import { transcribeWithGemini } from "./gemini";
import { GeminiRateLimitError } from "./key-pool";

export type Transcript = {
  text: string;
  source: "youtube_captions" | "gemini_media";
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const MAX_MEDIA = 6_000_000;

type CaptionTrack = { baseUrl: string; languageCode: string; kind: string };

export function youtubeId(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0] || "";
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      if (
        parts[1] &&
        (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live" || parts[0] === "v") &&
        /^[\w-]{11}$/.test(parts[1])
      ) {
        return parts[1];
      }
    }
  } catch {
    return null;
  }
  return null;
}

function decodeXml(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return c > 0 && c < 65536 ? String.fromCharCode(c) : "";
    })
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/&/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCaptionPayload(raw: string) {
  const text = raw.trim();
  if (!text) return "";
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const data = JSON.parse(text) as { events?: { segs?: { utf8?: string }[] }[] };
      const parts: string[] = [];
      for (const event of data.events || []) {
        for (const seg of event.segs || []) {
          if (seg.utf8) parts.push(seg.utf8);
        }
      }
      return parts.join("").replace(/\s+/g, " ").trim();
    } catch {
      return "";
    }
  }
  const bits: string[] = [];
  for (const match of text.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)) {
    const piece = decodeXml(match[1] || "");
    if (piece) bits.push(piece);
  }
  return bits.join(" ").replace(/\s+/g, " ").trim();
}

function trackScore(track: CaptionTrack) {
  const lang = track.languageCode.toLowerCase();
  let score = track.kind === "asr" ? 0 : 8;
  if (lang === "id" || lang.startsWith("id-")) score += 100;
  else if (lang === "en" || lang.startsWith("en-")) score += 40;
  return score;
}

export function pickCaptionTrack(tracks: CaptionTrack[]) {
  if (!tracks.length) return null;
  return [...tracks].sort((a, b) => trackScore(b) - trackScore(a))[0] || null;
}

function unescapeUrl(raw: string) {
  return raw
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u003D/gi, "=")
    .replace(/\\u003F/gi, "?")
    .replace(/\\\//g, "/")
    .replace(/&/g, "&");
}

async function youtubeCaptions(videoId: string) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip",
    },
    body: JSON.stringify({
      context: {
        client: {
          hl: "id",
          gl: "ID",
          clientName: "ANDROID",
          clientVersion: "19.44.38",
          androidSdkVersion: 30,
        },
      },
      videoId,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return "";
  const data = (await res.json()) as {
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[];
      };
    };
  };
  const tracks: CaptionTrack[] = [];
  for (const track of data.captions?.playerCaptionsTracklistRenderer?.captionTracks || []) {
    if (!track.baseUrl) continue;
    tracks.push({
      baseUrl: track.baseUrl,
      languageCode: track.languageCode || "",
      kind: track.kind || "",
    });
  }
  const chosen = pickCaptionTrack(tracks);
  if (!chosen) return "";
  const captionUrl = new URL(chosen.baseUrl);
  captionUrl.searchParams.set("fmt", "json3");
  const body = await fetch(captionUrl, {
    headers: { "User-Agent": UA, "Accept-Language": "id,en;q=0.8" },
    signal: AbortSignal.timeout(8000),
  });
  if (!body.ok) return "";
  return parseCaptionPayload(await body.text()).slice(0, 12000);
}

function mediaUrls(html: string) {
  const found: string[] = [];
  const push = (raw: string) => {
    const url = unescapeUrl(raw).trim();
    if (!/^https?:\/\//i.test(url)) return;
    if (found.includes(url) || found.length >= 4) return;
    found.push(url);
  };
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!/(?:property|name)\s*=\s*["']og:video(?::url|:secure_url)?["']/i.test(tag)) continue;
    const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) push(content);
  }
  for (const match of html.matchAll(
    /"(?:playAddr|downloadAddr|play_addr|download_addr|contentUrl|video_url)"\s*:\s*"([^"]+)"/gi,
  )) {
    push(match[1] || "");
  }
  return found;
}

async function downloadMedia(start: string) {
  let current = start;
  for (let hop = 0; hop < 3; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" || !(await isPublicHost(u.hostname))) return null;
    const res = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: "video/*,audio/*,*/*" },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok || !res.body) return null;
    const length = Number(res.headers.get("content-length") || 0);
    if (length > MAX_MEDIA) return null;
    const mime = (res.headers.get("content-type") || "video/mp4").split(";")[0].trim().toLowerCase();
    if (mime && !/^(video|audio)\//.test(mime) && mime !== "application/octet-stream") return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      total += step.value.byteLength;
      if (total > MAX_MEDIA) {
        await reader.cancel();
        return null;
      }
      chunks.push(step.value);
    }
    if (!total) return null;
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const resolved = mime === "application/octet-stream" || !mime ? "video/mp4" : mime;
    return { mime: resolved, bytes };
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

async function fromMediaPage(html: string | null) {
  if (!html) return null;
  for (const url of mediaUrls(html)) {
    try {
      const file = await downloadMedia(url);
      if (!file) continue;
      const text = await transcribeWithGemini({
        inlineData: { mimeType: file.mime, data: bytesToBase64(file.bytes) },
      });
      if (text && text.length >= 20) return { text: text.slice(0, 12000), source: "gemini_media" as const };
    } catch (err) {
      if (err instanceof GeminiRateLimitError) throw err;
      console.error("realorna media", err instanceof Error ? err.message : err);
    }
  }
  return null;
}

export async function transcribeLink(input: { url: string; host: string; html: string | null }): Promise<Transcript | null> {
  const host = input.host.toLowerCase();
  const youtube = host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com");
  if (youtube) {
    const id = youtubeId(input.url);
    if (!id) return null;
    try {
      const captions = await youtubeCaptions(id);
      if (captions.length >= 40) return { text: captions, source: "youtube_captions" };
    } catch (err) {
      console.error("realorna captions", err instanceof Error ? err.message : err);
    }
    try {
      const spoken = await transcribeWithGemini({
        fileData: { fileUri: `https://www.youtube.com/watch?v=${id}`, mimeType: "video/mp4" },
      });
      if (spoken && spoken.length >= 20) return { text: spoken.slice(0, 12000), source: "gemini_media" };
    } catch (err) {
      if (err instanceof GeminiRateLimitError) throw err;
      console.error("realorna yt-audio", err instanceof Error ? err.message : err);
    }
    return null;
  }
  try {
    return await fromMediaPage(input.html);
  } catch (err) {
    if (err instanceof GeminiRateLimitError) throw err;
    console.error("realorna transcript", err instanceof Error ? err.message : err);
    return null;
  }
}
