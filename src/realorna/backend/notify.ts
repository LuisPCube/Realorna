import { amountsMatch, verifyMidtransSignature } from "./midtrans";
import { getOrder, markExpired, markFailed } from "./orders";
import { CheckError, settlePending } from "./factcheck";

export async function handleMidtransNotification(body: Record<string, unknown>) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim();
  if (!serverKey) return { http: 401, payload: { error: "midtrans_unconfigured" } };
  if (!verifyMidtransSignature(body, serverKey)) {
    return { http: 401, payload: { error: "invalid_signature" } };
  }

  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const order = orderId ? await getOrder(orderId) : null;
  if (!order) return { http: 200, payload: { ignored: true, reason: "unknown_order" } };
  if (!amountsMatch(order.amount, body.gross_amount)) {
    return { http: 400, payload: { error: "amount_mismatch" } };
  }

  if (order.status === "paid" || order.status === "processed") {
    return { http: 200, payload: { ignored: true, order_id: order.order_id, status: order.status } };
  }

  const tx = typeof body.transaction_status === "string" ? body.transaction_status : "";
  const fraud = typeof body.fraud_status === "string" ? body.fraud_status : "";
  if (fraud === "deny") {
    await markFailed(order.order_id, "fraud_deny");
    return { http: 200, payload: { ignored: true, order_id: order.order_id, status: "failed" } };
  }
  if (tx === "expire") {
    await markExpired(order.order_id);
    return { http: 200, payload: { order_id: order.order_id, status: "expired" } };
  }
  if (tx === "cancel" || tx === "deny" || tx === "failure") {
    await markFailed(order.order_id, tx);
    return { http: 200, payload: { order_id: order.order_id, status: "failed" } };
  }
  if ((tx !== "settlement" && tx !== "capture") || fraud === "challenge") {
    return { http: 200, payload: { ignored: true, order_id: order.order_id, status: order.status } };
  }
  if (order.status !== "pending") {
    return { http: 200, payload: { ignored: true, order_id: order.order_id, status: order.status } };
  }

  try {
    const settled = await settlePending(order.order_id);
    return {
      http: 200,
      payload: {
        ignored: settled.ignored,
        order_id: order.order_id,
        status: settled.order?.status || (settled.ignored ? order.status : "processed"),
      },
    };
  } catch (err) {
    const code = err instanceof CheckError ? err.code : "ai_failed";
    return { http: 200, payload: { order_id: order.order_id, status: "failed", error: code } };
  }
}
