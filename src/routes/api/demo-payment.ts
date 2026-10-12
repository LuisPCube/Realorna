import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/demo-payment")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { json, readJson } = await import("@/realorna/backend/http");
        const { CheckError, settlePending } = await import("@/realorna/backend/factcheck");
        const { midtransConfigured } = await import("@/realorna/backend/midtrans");
        const { getOrder, publicOrder } = await import("@/realorna/backend/orders");
        if (midtransConfigured()) return json({ error: "disabled" }, 403);
        const body = (await readJson(request)) as { order_id?: unknown } | null;
        const orderId = typeof body?.order_id === "string" ? body.order_id.trim() : "";
        if (!/^ro_\d{10,}_[a-f0-9]{8}$/.test(orderId)) return json({ error: "invalid" }, 400);
        const order = await getOrder(orderId);
        if (!order || !order.demo) return json({ error: "not_found" }, 404);
        if (order.status === "processed") return json(publicOrder(order));
        try {
          const settled = await settlePending(orderId);
          const fresh = settled.order || (await getOrder(orderId));
          if (!fresh) return json({ error: "not_found" }, 404);
          if (fresh.status !== "processed") return json({ error: fresh.error || "ai_failed", order_id: orderId }, 502);
          return json(publicOrder(fresh));
        } catch (err) {
          const code = err instanceof CheckError ? err.code : "ai_failed";
          const status = code === "unreadable" || code === "video_plan" ? 422 : 502;
          return json({ error: code, order_id: orderId }, status);
        }
      },
    },
  },
});
