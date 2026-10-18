import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/account")({ server: { handlers: {
  GET: async ({ request }) => {
    const { api, json } = await import("@/realorna/backend/http");
    return api(async () => {
      const { accountState } = await import("@/realorna/backend/accounts");
      return json(await accountState(request));
    });
  },
} } });
