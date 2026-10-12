import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { json, readJson } = await import("@/realorna/backend/http");
        const { CheckError, retryCheck } = await import("@/realorna/backend/factcheck");
        const { getOrder } = await import("@/realorna/backend/orders");
        const body = (await readJson(request)) as { order_id?: unknown } | null;
        const orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";
        if (!/^ro_\d{10,}_[a-f0-9]{8}$/.test(orderId)) return json({ error: "invalid" }, 400);
        const existing = await getOrder(orderId);
        if (!existing) return json({ error: "not_found" }, 404);
        if (existing.status === "pending" || existing.status === "expired") {
          return json({ error: "payment_required", order_id: orderId, status: existing.status }, 402);
        }
        try {
          const done = await retryCheck(orderId);
          if (!done?.result) return json({ error: "ai_failed", order_id: orderId }, 502);
          return json(done.result);
        } catch (err) {
          const code = err instanceof CheckError ? err.code : "ai_failed";
          const status =
            code === "unreadable" || code === "video_plan" ? 422 : code === "invalid" ? 402 : code === "ai_unavailable" ? 503 : 502;
          return json({ error: code, order_id: orderId }, status);
        }
      },
    },
  },
});
