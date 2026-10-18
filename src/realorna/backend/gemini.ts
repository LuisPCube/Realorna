import { SYSTEM_PROMPT } from "./prompt";
import { parseModelJson } from "./contract";
import type { Source } from "../types";
import { hasGeminiKeys, withGeminiKey } from "./key-pool";

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string; title?: string } }[];
    };
  }[];
  error?: { message?: string };
};

function modelChain() {
  // Select the model available to YOUR project in AI Studio. No implicit
  // model upgrades or paid model fallback.
  const model = process.env.GEMINI_MODEL?.trim();
  if (!model) throw new Error("gemini_off");
  return [model];
}

function textOf(data: GeminiResponse) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("\n").trim();
}

function groundedSources(data: GeminiResponse): Source[] {
  const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const out: Source[] = [];
  for (const chunk of chunks) {
    const url = chunk.web?.uri || "";
    if (!/^https?:\/\//i.test(url)) continue;
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    out.push({
      title: (chunk.web?.title || host).slice(0, 160),
      url,
      publisher: host.slice(0, 80),
    });
    if (out.length >= 4) break;
  }
  return out;
}

const TRANSCRIBE =
  "Transcribe every spoken word in this media, in the original language. Keep the wording. Do not summarize, translate, or comment. If there is no speech, output exactly: (tidak ada ucapan)";

type MediaPart =
  | { fileData: { fileUri: string; mimeType: string } }
  | { inlineData: { mimeType: string; data: string } };

function cleanTranscript(raw: string) {
  const text = raw
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!text || text === "(tidak ada ucapan)") return null;
  return text;
}

export async function transcribeWithGemini(media: MediaPart): Promise<string | null> {
  if (!hasGeminiKeys()) return null;
  try {
    const model = modelChain()[0];
    const res = await withGeminiKey((key, signal) => fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [media, { text: TRANSCRIBE }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 } }), signal,
      }), Date.now() + 30_000);
    if (!res.ok) return null;
    const text = cleanTranscript(textOf(await res.json() as GeminiResponse));
    return text ? text.slice(0, 12000) : null;
  } catch { return null; }
}

async function callModel(model: string, apiKey: string, user: string, withSearch: boolean, signal: AbortSignal) {
  const generationConfig: Record<string, unknown> = {
    temperature: 0.2,
    maxOutputTokens: 2048,
  };
  if (!withSearch) generationConfig.responseMimeType = "application/json";
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig,
  };
  if (withSearch) body.tools = [{ google_search: {} }];
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });
}

export async function askGemini(user: string): Promise<{ parsed: Record<string, unknown>; sources: Source[] }> {
  if (!hasGeminiKeys()) throw new Error("gemini_off");
  const model = modelChain()[0];
  const deadline = Date.now() + 55_000;
  let response = await withGeminiKey((key, signal) => callModel(model, key, user, true, signal), deadline);
  // Some free-tier models do not support search with this generation mode.
  if (response.status === 400) {
    await response.body?.cancel();
    response = await withGeminiKey((key, signal) => callModel(model, key, user, false, signal), deadline);
  }
  if (!response.ok) throw new Error(response.status === 404 ? "gemini_off" : "gemini_failed");
  const data = await response.json() as GeminiResponse;
  const parsed = parseModelJson(textOf(data));
  if (!parsed) throw new Error("gemini_failed");
  return { parsed, sources: groundedSources(data) };
}
