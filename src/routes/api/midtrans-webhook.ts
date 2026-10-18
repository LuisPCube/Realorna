import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/midtrans-webhook")({ server: { handlers: {
  POST: () => Response.json({ error: "midtrans_disabled" }, { status: 410 }),
} } });
