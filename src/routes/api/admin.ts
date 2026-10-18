import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/admin")({ server: { handlers: {
  GET: async ({ request }) => {
    const { api, json } = await import("@/realorna/backend/http");
    return api(async () => {
      const { requireAccount } = await import("@/realorna/backend/accounts");
      const { adminOrders } = await import("@/realorna/backend/orders");
      const { getSql } = await import("@/lib/db");
      await requireAccount(request, true);
      const sql = await getSql();
      const audit = await sql.query(`select a.action, a.created_at, u.username, t.plan from fact_admin_audit a
        join "user" u on u.id = a.target_user_id left join fact_attempts t on t.attempt_id = a.attempt_id
        order by a.created_at desc limit 15`);
      return json({ orders: await adminOrders(), audit });
    });
  },
  POST: async ({ request }) => {
    const { api, json, readJson, ApiError, requestKey } = await import("@/realorna/backend/http");
    return api(async () => {
      const { requireAccount } = await import("@/realorna/backend/accounts");
      const { grantAttempt, approveTransfer, rejectTransfer, publicOrder } = await import("@/realorna/backend/orders");
      const admin = await requireAccount(request, true);
      const body = await readJson(request);
      if (body.action === "grant") {
        if (typeof body.username !== "string" || !["regular", "advance"].includes(String(body.plan))) throw new ApiError("invalid");
        return json(await grantAttempt(admin, body.username, body.plan as "regular" | "advance", requestKey(body.request_key)));
      }
      if (typeof body.order_id !== "string") throw new ApiError("invalid");
      if (body.action === "approve") {
        if (typeof body.bank_reference !== "string" || typeof body.amount !== "number") throw new ApiError("invalid");
        return json(await publicOrder(await approveTransfer(admin, body.order_id, body.bank_reference.trim(), body.amount)));
      }
      if (body.action === "reject") { await rejectTransfer(admin, body.order_id); return json({ ok: true }); }
      throw new ApiError("invalid");
    });
  },
} } });
