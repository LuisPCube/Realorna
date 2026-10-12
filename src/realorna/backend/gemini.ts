import { SYSTEM_PROMPT } from "./prompt";
import { parseModelJson } from "./contract";
import type { Source } from "../types";

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
  const preferred = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
  return [...new Set([preferred, "gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"])];
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

async function callModel(model: string, apiKey: string, user: string, withSearch: boolean) {
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
    signal: AbortSignal.timeout(45_000),
  });
}

export async function askGemini(user: string): Promise<{ parsed: Record<string, unknown>; sources: Source[] }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("gemini_off");

  let sawAuth = false;
  for (const model of modelChain()) {
    let res: Response;
    try {
      res = await callModel(model, apiKey, user, true);
      if (res.status === 400) res = await callModel(model, apiKey, user, false);
    } catch (err) {
      console.error("realorna gemini network", model, err instanceof Error ? err.message : err);
      continue;
    }
    if (res.status === 404) continue;
    if (res.status === 401 || res.status === 403) {
      sawAuth = true;
      console.error("realorna gemini auth", res.status);
      break;
    }
    if (!res.ok) {
      console.error("realorna gemini", model, res.status);
      continue;
    }
    const data = (await res.json()) as GeminiResponse;
    const text = textOf(data);
    const parsed = text ? parseModelJson(text) : null;
    if (!parsed) {
      console.error("realorna gemini json", model);
      continue;
    }
    return { parsed, sources: groundedSources(data) };
  }
  throw new Error(sawAuth ? "gemini_off" : "gemini_failed");
}
