import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/checks")({ server: { handlers: {
  POST: async ({ request }) => {
    const { api, json, readJson, requestKey } = await import("@/realorna/backend/http");
    return api(async () => {
      const { requireAccount } = await import("@/realorna/backend/accounts");
      const { checkInput } = await import("@/realorna/backend/validation");
      const { createCheck, publicOrder } = await import("@/realorna/backend/orders");
      const user = await requireAccount(request);
      const body = await readJson(request);
      const input = await checkInput(body);
      const order = await createCheck(user, { ...input, key: requestKey(body.request_key),
        attemptId: typeof body.attempt_id === "string" ? body.attempt_id : undefined });
      return json(await publicOrder(order));
    });
  },
} } });
