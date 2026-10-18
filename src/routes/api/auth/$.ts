import { createFileRoute } from "@tanstack/react-router";
async function handle(request: Request) {
  const { api, json, readJson, assertOrigin } = await import("@/realorna/backend/http");
  return api(async () => {
    assertOrigin(request);
    if (process.env.VERCEL && (!process.env.DATABASE_URL?.trim() || !process.env.BETTER_AUTH_SECRET?.trim())) return json({ error: "configuration_required" }, 503);
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path.endsWith("/sign-up/email")) {
      const body = await readJson(request.clone());
      const name = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
      const reserved = (process.env.ADMIN_USERNAME?.trim() || "realorna_admin").toLowerCase();
      if (!/^[a-z0-9_.]{3,30}$/.test(name)) return json({ code: "INVALID_USERNAME", message: "Use 3–30 letters, numbers, underscores or dots." }, 400);
      if ([reserved, "realorna_admin", "admin", "administrator"].includes(name)) return json({ code: "USERNAME_IS_ALREADY_TAKEN", message: "This username is reserved." }, 409);
    }
    if (request.method === "POST" && path.endsWith("/update-user")) {
      const body = await readJson(request.clone());
      if ("username" in body || "displayUsername" in body) return json({ message: "Usernames cannot be changed." }, 400);
    }
    const { auth } = await import("@/lib/auth/server");
    return auth.handler(request);
  });
}
export const Route = createFileRoute("/api/auth/$")({ server: { handlers: {
  GET: ({ request }) => handle(request), POST: ({ request }) => handle(request),
} } });
