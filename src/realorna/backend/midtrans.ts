import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";

export function createOrderId() {
  return `ro_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

export function midtransConfigured() {
  return Boolean(process.env.MIDTRANS_SERVER_KEY?.trim());
}

export function midtransBaseUrl() {
  return process.env.MIDTRANS_IS_PRODUCTION === "true"
    ? "https://api.midtrans.com"
    : "https://api.sandbox.midtrans.com";
}

export function signatureHex(orderId: string, statusCode: string, grossAmount: string, serverKey: string) {
  return createHash("sha512").update(`${orderId}${statusCode}${grossAmount}${serverKey}`).digest("hex");
}

function sameHex(a: string, b: string) {
  const left = Buffer.from(a.toLowerCase());
  const right = Buffer.from(b.toLowerCase());
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function grossVariants(gross: unknown): string[] {
  if (typeof gross === "string" && gross.trim()) {
    const n = Number(gross);
    return Number.isFinite(n) ? [gross, n.toFixed(2)] : [gross];
  }
  if (typeof gross === "number" && Number.isFinite(gross)) return [String(gross), gross.toFixed(2)];
  return [];
}

export function verifyMidtransSignature(body: Record<string, unknown>, serverKey: string) {
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const statusCode = body.status_code == null ? "" : String(body.status_code);
  const given = typeof body.signature_key === "string" ? body.signature_key : "";
  if (!orderId || !statusCode || !given) return false;
  return grossVariants(body.gross_amount).some((gross) =>
    sameHex(given, signatureHex(orderId, statusCode, gross, serverKey)),
  );
}

export function amountsMatch(stored: number, gross: unknown) {
  const variants = grossVariants(gross);
  return variants.some((v) => Math.round(Number(v)) === stored);
}

export type QrisCharge = {
  qr_url: string | null;
  qr_string: string | null;
  transaction_id: string | null;
};

export async function chargeQris(orderId: string, amount: number, plan: "regular" | "advance"): Promise<QrisCharge> {
  const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim();
  if (!serverKey) throw new Error("midtrans_unconfigured");
  const auth = Buffer.from(`${serverKey}:`).toString("base64");
  const payload = {
    payment_type: "qris",
    transaction_details: { order_id: orderId, gross_amount: amount },
    item_details: [
      {
        id: plan,
        price: amount,
        quantity: 1,
        name: plan === "advance" ? "Realorna Advance" : "Realorna Regular",
      },
    ],
    custom_expiry: { expiry_duration: 10, unit: "minute" },
    qris: { acquirer: "gopay" },
  };
  const res = await fetch(`${midtransBaseUrl()}/v2/charge`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => null)) as {
    status_code?: string;
    status_message?: string;
    transaction_id?: string;
    qr_string?: string;
    actions?: { name?: string; url?: string }[];
  } | null;
  if (!res.ok || !data || (data.status_code && !["200", "201"].includes(data.status_code))) {
    const message = data?.status_message || `Midtrans ${res.status}`;
    throw new Error(message);
  }
  const qrUrl = data.actions?.find((a) => a.name === "generate-qr-code")?.url || null;
  return {
    qr_url: qrUrl && /^https:\/\//i.test(qrUrl) ? qrUrl : null,
    qr_string: data.qr_string || null,
    transaction_id: data.transaction_id || null,
  };
}

export async function qrDataUrl(qrString: string | null) {
  if (!qrString) return null;
  try {
    return await QRCode.toDataURL(qrString, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
    });
  } catch {
    return null;
  }
}
