export class ApiError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
export function assertOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") throw new ApiError("forbidden", 403);
  const origin = request.headers.get("origin");
  const allowed = [new URL(request.url).origin, process.env.BETTER_AUTH_URL?.replace(/\/$/, "")];
  if (origin && !allowed.includes(origin)) throw new ApiError("forbidden", 403);
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  assertOrigin(request);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ApiError("json_required", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("invalid");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 8192) { await reader.cancel(); throw new ApiError("request_too_large", 413); }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new ApiError("invalid"); }
}
export async function api(handler: () => Promise<Response>) {
  try { return await handler(); }
  catch (error) {
    if (error instanceof ApiError) return json({ error: error.code }, error.status);
    console.error("[realorna] request failed", error instanceof Error ? error.name : "Error");
    return json({ error: "server_error" }, 500);
  }
}
export function requestKey(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/i.test(value)) throw new ApiError("invalid_request_key");
  return value;
}
