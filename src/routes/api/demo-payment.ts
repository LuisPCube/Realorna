import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/demo-payment")({ server: { handlers: {
  POST: () => Response.json({ error: "removed_use_admin_grants" }, { status: 410 }),
} } });
