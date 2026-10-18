import { isPublicHost } from "../engine.server";
import { inspectLink, parseLink } from "../safety";
import type { Lang, Plan } from "../types";
import { ApiError } from "./http";
export async function checkInput(body: Record<string, unknown>): Promise<{ url: string; plan: Plan; lang: Lang }> {
  const plan = body.plan === "regular" || body.plan === "advance" ? body.plan : null;
  const raw = typeof body.url === "string" && body.url.length <= 2000 ? body.url.trim() : "";
  const url = parseLink(raw);
  if (!url || !plan || !(await isPublicHost(url.hostname))) throw new ApiError("invalid");
  if (plan === "regular" && inspectLink(url).video) throw new ApiError("video_plan", 422);
  return { url: url.toString(), plan, lang: body.lang === "en" ? "en" : "id" };
}
