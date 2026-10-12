import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/orders/$orderId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { json } = await import("@/realorna/backend/http");
        const { getOrder, publicOrder } = await import("@/realorna/backend/orders");
        const orderId = params.orderId || "";
        if (!/^ro_\d{10,}_[a-f0-9]{8}$/.test(orderId)) return json({ error: "invalid" }, 400);
        const order = await getOrder(orderId);
        if (!order) return json({ error: "not_found" }, 404);
        return json(publicOrder(order));
      },
    },
  },
});
