import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/create-payment")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { json, readJson } = await import("@/realorna/backend/http");
        const { chargeQris, createOrderId, midtransConfigured, qrDataUrl } = await import(
          "@/realorna/backend/midtrans"
        );
        const { insertOrder, markFailed, saveQr } = await import("@/realorna/backend/orders");
        const { isPublicHost } = await import("@/realorna/engine.server");
        const { inspectLink, parseLink, PRICES, PROMOS } = await import("@/realorna/safety");
        const body = (await readJson(request)) as Record<string, unknown> | null;
        const rawUrl = typeof body?.url === "string" ? body.url.trim().slice(0, 2000) : "";
        const plan = body?.plan === "advance" ? "advance" : body?.plan === "regular" ? "regular" : null;
        const lang = body?.lang === "en" ? "en" : "id";
        const promo = typeof body?.promo === "string" ? body.promo.trim().toUpperCase() : "";
        const parsed = parseLink(rawUrl);
        if (!parsed || !plan) return json({ error: "invalid" }, 400);
        if (!(await isPublicHost(parsed.hostname))) return json({ error: "invalid" }, 400);
        const look = inspectLink(parsed);
        if (plan === "regular" && look.video) return json({ error: "video_plan" }, 422);

        const discount = PROMOS[promo] || 0;
        const amount = Math.round(PRICES[plan] * (1 - discount));
        const orderId = createOrderId();
        const demo = !midtransConfigured();
        await insertOrder({ orderId, url: parsed.toString(), plan, lang, amount, demo });

        if (demo) {
          return json({
            order_id: orderId,
            status: "pending",
            amount,
            currency: "IDR",
            payment_type: "qris",
            qr_url: null,
            qr_string: null,
            qr_data_url: null,
            demo: true,
          });
        }

        try {
          const charge = await chargeQris(orderId, amount, plan);
          await saveQr(orderId, charge.qr_url, charge.qr_string);
          return json({
            order_id: orderId,
            status: "pending",
            amount,
            currency: "IDR",
            payment_type: "qris",
            qr_url: charge.qr_url,
            qr_string: charge.qr_string,
            qr_data_url: await qrDataUrl(charge.qr_string),
            demo: false,
          });
        } catch (err) {
          await markFailed(orderId, "midtrans");
          console.error("realorna midtrans", err instanceof Error ? err.message : err);
          return json({ error: "payment_failed", order_id: orderId }, 502);
        }
      },
    },
  },
});
