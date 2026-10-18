import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/create-payment")({ server: { handlers: {
  POST: async ({ request }) => {
    const { api, json, readJson, requestKey } = await import("@/realorna/backend/http");
    return api(async () => {
      const { requireAccount } = await import("@/realorna/backend/accounts");
      const { checkInput } = await import("@/realorna/backend/validation");
      const { createTransfer, publicOrder } = await import("@/realorna/backend/orders");
      const { transferDetails } = await import("@/realorna/backend/transfers");
      const { PRICES, PROMOS } = await import("@/realorna/safety");
      const user = await requireAccount(request);
      if (user.admin) return json({ error: "admin_checks_are_free" }, 409);
      const transfer = transferDetails();
      const body = await readJson(request);
      const input = await checkInput(body);
      const promo = typeof body.promo === "string" ? body.promo.trim().toUpperCase() : "";
      const amount = Math.round(PRICES[input.plan] * (1 - (PROMOS[promo] || 0)));
      const order = await createTransfer({ ...input, userId: user.id, amount, key: requestKey(body.request_key) });
      return json({ ...await publicOrder(order), transfer, currency: "IDR" });
    });
  },
} } });
