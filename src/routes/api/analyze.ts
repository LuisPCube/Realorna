import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/analyze")({ server: { handlers: {
  POST: async ({ request }) => {
    const { api, json, readJson, ApiError } = await import("@/realorna/backend/http");
    return api(async () => {
      const { requireAccount } = await import("@/realorna/backend/accounts");
      const { getOrder } = await import("@/realorna/backend/orders");
      const { CheckError, retryCheck } = await import("@/realorna/backend/factcheck");
      const user = await requireAccount(request);
      const body = await readJson(request);
      const orderId = typeof body.order_id === "string" ? body.order_id : "";
      const order = await getOrder(orderId, user.id);
      if (!order) throw new ApiError("not_found", 404);
      if (!["admin", "credit"].includes(order.payment_method)) throw new ApiError("attempt_required", 402);
      try {
        const result = await retryCheck(orderId);
        if (!result?.report) return json({ error: "processing" }, 409);
        return json({ result: result.result, report: result.report });
      } catch (error) {
        if (error instanceof CheckError) return json({ error: error.code }, error.code === "rate" ? 429 : error.code === "ai_unavailable" ? 503 : 422);
        throw error;
      }
    });
  },
} } });
