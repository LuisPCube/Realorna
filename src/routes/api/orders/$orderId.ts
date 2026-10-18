import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/orders/$orderId")({ server: { handlers: {
  GET: async ({ request, params }) => {
    const { api, json, ApiError } = await import("@/realorna/backend/http");
    return api(async () => {
      const { requireAccount } = await import("@/realorna/backend/accounts");
      const { getOrder, publicOrder } = await import("@/realorna/backend/orders");
      const { transferDetails } = await import("@/realorna/backend/transfers");
      const user = await requireAccount(request);
      let order = await getOrder(params.orderId, user.id);
      if (!order) throw new ApiError("not_found", 404);
      if (["pending", "submitted"].includes(order.status) && order.expires_at && new Date(order.expires_at).getTime() <= Date.now()) {
        const { getSql } = await import("@/lib/db");
        const sql = await getSql();
        await sql`update fact_orders set status = 'expired', updated_at = now() where order_id = ${order.order_id} and user_id = ${user.id} and status in ('pending', 'submitted')`;
        order = (await getOrder(params.orderId, user.id))!;
      }
      return json({ ...await publicOrder(order), ...(order.payment_method === "transfer" ? { transfer: transferDetails() } : {}) });
    });
  },
  POST: async ({ request, params }) => {
    const { api, json, readJson, ApiError } = await import("@/realorna/backend/http");
    return api(async () => {
      const { requireAccount } = await import("@/realorna/backend/accounts");
      const { getOrder, submitTransfer, publicOrder } = await import("@/realorna/backend/orders");
      const user = await requireAccount(request);
      const order = await getOrder(params.orderId, user.id);
      if (!order) throw new ApiError("not_found", 404);
      const body = await readJson(request);
      if (typeof body.reference !== "string") throw new ApiError("reference_required");
      return json(await publicOrder(await submitTransfer(order, body.reference.trim())));
    });
  },
} } });
