import { z } from "zod";
import { SYSTEM_PROMPT } from "./prompt";
import { hasOpenAIKeys, withOpenAIKey } from "./key-pool";
import { evidenceUrl, parseModelJson } from "./contract";
import type { Source } from "../types";

const ClaimSchema = z.object({
  text: z.string(), status: z.enum(["benar", "salah", "keliru", "belum_jelas"]),
  explanation: z.string(), correction: z.string(), importance: z.enum(["utama", "detail"]),
  source_urls: z.array(z.string()),
}).strict();
export const ModelSchema = z.object({
  verdict: z.enum(["FAKTA", "HOAKS", "MENYESATKAN", "SEBAGIAN_BENAR", "BELUM_TERVERIFIKASI"]),
  summary: z.string(), claims: z.array(ClaimSchema), red_flags: z.array(z.string()),
  sources: z.array(z.object({ title: z.string(), url: z.string(), publisher: z.string(), published_at: z.string() }).strict()),
  meta: z.object({ title: z.string(), platform: z.string(), author: z.string(), published_at: z.string() }).strict(),
  reference_date: z.string(),
}).strict();

// Native fetch keeps retries under one shared policy; no hidden SDK retries.
type ResponseData = {
  status?: string;
  output?: {
    type?: string; status?: string;
    action?: { type?: string; url?: string; sources?: { url?: string; title?: string }[] };
    content?: { type?: string; text?: string; annotations?: { type?: string; url?: string; title?: string }[] }[];
  }[];
};

export function extractResponse(data: ResponseData) {
  if (data.status !== "completed") throw new Error("openai_failed");
  const sources: Source[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined, title = "") => {
    const url = evidenceUrl(raw);
    if (!url || seen.has(url) || sources.length >= 80) return;
    seen.add(url);
    const host = new URL(url).hostname.replace(/^www\./, "");
    sources.push({ url, title: title.slice(0, 160) || host, publisher: host });
  };
  let searched = false;
  const text: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type === "web_search_call" && item.status === "completed") {
      searched = true;
      for (const source of item.action?.sources ?? []) add(source.url, source.title);
      if (item.action?.type === "open_page") add(item.action.url);
    }
    for (const part of item.content ?? []) {
      if (part.type === "refusal") throw new Error("openai_failed");
      if (part.type === "output_text") {
        if (part.text) text.push(part.text);
        for (const citation of part.annotations ?? []) if (citation.type === "url_citation") add(citation.url, citation.title);
      }
    }
  }
  // No search-free fallback. Do not silently turn model memory into evidence.
  if (!searched) throw new Error("openai_failed");
  const parsed = parseModelJson(text.join("\n"));
  if (!parsed || !ModelSchema.safeParse(parsed).success) throw new Error("openai_failed");
  return { parsed, sources };
}

export async function askOpenAI(user: string, deadline = Date.now() + 100_000) {
  const model = process.env.OPENAI_MODEL?.trim();
  if (!hasOpenAIKeys() || !model) throw new Error("openai_off");
  const schema = z.toJSONSchema(ModelSchema);
  delete schema.$schema;
  const response = await withOpenAIKey((key, signal) => fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, store: false, instructions: SYSTEM_PROMPT, input: user,
      tools: [{ type: "web_search", search_context_size: "medium" }], tool_choice: "required",
      max_tool_calls: 6, include: ["web_search_call.action.sources"], max_output_tokens: 7000,
      text: { format: { type: "json_schema", name: "realorna_fact_check", strict: true, schema } },
    }), signal,
  }), deadline);
  if (!response.ok) throw new Error([400, 401, 403, 404].includes(response.status) ? "openai_off" : "openai_failed");
  return extractResponse(await response.json() as ResponseData);
}

const MEDIA_EXT: Record<string, string> = {
  "video/mp4": "mp4", "audio/mp4": "m4a", "audio/mpeg": "mp3", "video/mpeg": "mpeg",
  "audio/wav": "wav", "audio/x-wav": "wav", "video/webm": "webm", "audio/webm": "webm",
};
export async function transcribeWithOpenAI(media: { mime: string; bytes: Uint8Array }, deadline = Date.now() + 50_000): Promise<string | null> {
  const model = process.env.OPENAI_TRANSCRIBE_MODEL?.trim();
  const ext = MEDIA_EXT[media.mime];
  if (!hasOpenAIKeys() || !model || !ext || media.bytes.length > 6_000_000) return null;
  const response = await withOpenAIKey((key, signal) => {
    const body = new FormData();
    body.set("model", model); body.set("response_format", "json");
    body.set("file", new Blob([new Uint8Array(media.bytes)], { type: media.mime }), `speech.${ext}`);
    return fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body, signal });
  }, deadline);
  if (!response.ok) return null;
  const data = await response.json() as { text?: unknown };
  return typeof data.text === "string" && data.text.trim().length >= 20 ? data.text.trim().slice(0, 64000) : null;
}
