import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/midtrans-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { json, readJson } = await import("@/realorna/backend/http");
        const { handleMidtransNotification } = await import("@/realorna/backend/notify");
        const body = await readJson(request);
        if (!body || typeof body !== "object") return json({ error: "invalid" }, 400);
        const result = await handleMidtransNotification(body as Record<string, unknown>);
        return json(result.payload, result.http);
      },
    },
  },
});
