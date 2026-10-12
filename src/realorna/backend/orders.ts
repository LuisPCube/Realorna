import { getSql } from "@/lib/db";
import type { FactContract, FactOk, Lang, Plan } from "../types";

export type OrderStatus = "pending" | "paid" | "processed" | "failed" | "expired";

export type OrderRow = {
  order_id: string;
  url: string;
  plan: Plan;
  lang: Lang;
  amount: number;
  status: OrderStatus;
  qr_url: string | null;
  qr_string: string | null;
  demo: boolean;
  result_json: string | null;
  report_json: string | null;
  error: string | null;
};

type DbOrder = {
  order_id: string;
  url: string;
  plan: string;
  lang: string;
  amount: number | string;
  status: string;
  qr_url: string | null;
  qr_string: string | null;
  demo: boolean | number | string | null;
  result_json: string | null;
  report_json: string | null;
  error: string | null;
};

const COLS = `order_id, url, plan, lang, amount, status, qr_url, qr_string, demo, result_json, report_json, error`;

function mapRow(row: DbOrder): OrderRow {
  const status = (
    ["pending", "paid", "processed", "failed", "expired"].includes(row.status) ? row.status : "pending"
  ) as OrderStatus;
  return {
    order_id: row.order_id,
    url: row.url,
    plan: row.plan === "advance" ? "advance" : "regular",
    lang: row.lang === "en" ? "en" : "id",
    amount: Number(row.amount),
    status,
    qr_url: row.qr_url,
    qr_string: row.qr_string,
    demo: row.demo === true || row.demo === 1 || row.demo === "t" || row.demo === "true",
    result_json: row.result_json,
    report_json: row.report_json,
    error: row.error,
  };
}

export async function insertOrder(input: {
  orderId: string;
  url: string;
  plan: Plan;
  lang: Lang;
  amount: number;
  demo: boolean;
}) {
  const sql = await getSql();
  await sql`
    insert into fact_orders (order_id, url, plan, lang, amount, status, demo)
    values (${input.orderId}, ${input.url}, ${input.plan}, ${input.lang}, ${input.amount}, 'pending', ${input.demo})
  `;
}

export async function saveQr(orderId: string, qrUrl: string | null, qrString: string | null) {
  const sql = await getSql();
  await sql`
    update fact_orders
    set qr_url = ${qrUrl}, qr_string = ${qrString}, updated_at = now()
    where order_id = ${orderId}
  `;
}

export async function getOrder(orderId: string) {
  const sql = await getSql();
  const found = await sql.query<DbOrder>(`select ${COLS} from fact_orders where order_id = $1`, [orderId]);
  return found[0] ? mapRow(found[0]) : null;
}

/** Webhook: hanya pending yang boleh naik ke paid. */
export async function claimPending(orderId: string) {
  const sql = await getSql();
  const rows = await sql.query<DbOrder>(
    `update fact_orders
     set status = 'paid', error = null, updated_at = now()
     where order_id = $1 and status = 'pending'
     returning ${COLS}`,
    [orderId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Pemulihan: gagal, atau paid tanpa hasil yang macet lebih dari 2 menit. */
export async function claimRetry(orderId: string) {
  const sql = await getSql();
  const rows = await sql.query<DbOrder>(
    `update fact_orders
     set status = 'paid', error = null, updated_at = now()
     where order_id = $1
       and (
         status = 'failed'
         or (status = 'paid' and result_json is null and updated_at < now() - interval '2 minutes')
       )
     returning ${COLS}`,
    [orderId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function markProcessed(orderId: string, contract: FactContract, report: FactOk) {
  const sql = await getSql();
  await sql.query(
    `update fact_orders
     set status = 'processed', result_json = $2, report_json = $3, error = null, updated_at = now()
     where order_id = $1`,
    [orderId, JSON.stringify(contract), JSON.stringify(report)],
  );
}

export async function markFailed(orderId: string, error: string) {
  const sql = await getSql();
  await sql.query(
    `update fact_orders
     set status = 'failed', error = $2, updated_at = now()
     where order_id = $1 and status in ('pending', 'paid', 'failed')`,
    [orderId, error.slice(0, 200)],
  );
}

export async function markExpired(orderId: string) {
  const sql = await getSql();
  await sql.query(
    `update fact_orders
     set status = 'expired', updated_at = now()
     where order_id = $1 and status = 'pending'`,
    [orderId],
  );
}

export function readStored(order: OrderRow): { result: FactContract | null; report: FactOk | null } {
  return {
    result: parseStored<FactContract>(order.result_json),
    report: parseStored<FactOk>(order.report_json),
  };
}

function parseStored<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as T;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function publicOrder(order: OrderRow) {
  const stored = order.status === "processed" ? readStored(order) : { result: null, report: null };
  return {
    order_id: order.order_id,
    status: order.status,
    amount: order.amount,
    demo: order.demo,
    error: order.error,
    result: stored.result,
    report: stored.report,
  };
}
