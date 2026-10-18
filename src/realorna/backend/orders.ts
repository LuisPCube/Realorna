import { randomBytes, randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import type { FactContract, FactOk, Lang, Plan } from "../types";
import type { Account, AdminOrder } from "../account-types";
import { ApiError } from "./http";
export type OrderStatus = "pending" | "submitted" | "paid" | "processing" | "processed" | "failed" | "expired" | "rejected";
export type OrderRow = {
  order_id: string; user_id: string; url: string; plan: Plan; lang: Lang; amount: number;
  status: OrderStatus; payment_method: string; result_json: string | null; report_json: string | null;
  error: string | null; claim_token: string | null; credit_attempt_id: string | null;
  expires_at: string | Date | null; transfer_reference: string | null; bank_reference: string | null;
  retry_after_at: string | Date | null;
};
export function createOrderId() { return `ro_${Date.now()}_${randomBytes(4).toString("hex")}`; }
export async function getOrder(orderId: string, userId?: string) {
  const sql = await getSql();
  const rows = await sql.query<OrderRow>(`select * from fact_orders where order_id = $1 and ($2::text is null or user_id = $2)`, [orderId, userId ?? null]);
  return rows[0] ?? null;
}
export async function createTransfer(input: { userId: string; url: string; plan: Plan; lang: Lang; amount: number; key: string }) {
  const sql = await getSql();
  const rows = await sql.query<OrderRow>(`insert into fact_orders
    (order_id, user_id, url, plan, lang, amount, status, payment_method, request_key, expires_at)
    values ($1, $2, $3, $4, $5, $6, 'pending', 'transfer', $7, now() + interval '24 hours')
    on conflict (user_id, request_key) do update set request_key = excluded.request_key returning *`,
    [createOrderId(), input.userId, input.url, input.plan, input.lang, input.amount, input.key]);
  const order = rows[0];
  if (order.payment_method !== "transfer" || order.url !== input.url || order.plan !== input.plan || order.lang !== input.lang || order.amount !== input.amount) throw new ApiError("request_conflict", 409);
  return order;
}
export async function submitTransfer(order: OrderRow, reference: string) {
  const sql = await getSql();
  if (reference.length < 3 || reference.length > 100) throw new ApiError("reference_required");
  const rows = await sql.query<OrderRow>(`update fact_orders set status = 'submitted', transfer_reference = $3, updated_at = now()
    where order_id = $1 and user_id = $2 and payment_method = 'transfer' and status in ('pending', 'submitted')
      and expires_at > now() returning *`, [order.order_id, order.user_id, reference]);
  if (!rows[0]) throw new ApiError("payment_not_pending", 409);
  return rows[0];
}
export async function grantAttempt(admin: Account, username: string, plan: Plan, key: string) {
  const sql = await getSql();
  const target = await sql.query<{ id: string; username: string }>(`select id, username from "user" where lower(username) = $1`, [username.trim().toLowerCase()]);
  if (!target[0]) throw new ApiError("username_not_found", 404);
  const [attempt] = await sql.query<{ attempt_id: string; user_id: string; plan: Plan }>(`with granted as (
    insert into fact_attempts (attempt_id, user_id, plan, source, granted_by, request_key) values ($1, $2, $3, 'admin', $4, $5)
    on conflict (granted_by, request_key) do update set request_key = excluded.request_key returning *
  ), audited as (
    insert into fact_admin_audit (audit_id, admin_id, action, target_user_id, attempt_id)
    select $6, $4, 'grant_attempt', user_id, attempt_id from granted on conflict (audit_id) do nothing
  ) select attempt_id, user_id, plan from granted`, [randomUUID(), target[0].id, plan, admin.id, key, `grant:${admin.id}:${key}`]);
  if (attempt.user_id !== target[0].id || attempt.plan !== plan) throw new ApiError("request_conflict", 409);
  return { attempt_id: attempt.attempt_id, username: target[0].username, plan: attempt.plan, link: `/?attempt=${attempt.attempt_id}` };
}
export async function approveTransfer(admin: Account, orderId: string, reference: string, amount: number) {
  if (!/^[A-Za-z0-9._:/ -]{3,100}$/.test(reference)) throw new ApiError("bank_reference_required");
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new ApiError("amount_mismatch");
  const sql = await getSql();
  try {
    const rows = await sql.query<OrderRow>(`with approved as (
      update fact_orders set status = 'paid', paid_at = now(), approved_by = $2, bank_reference = $3, updated_at = now()
      where order_id = $1 and payment_method = 'transfer' and amount = $4 and user_id is not null
        and status in ('pending', 'submitted') and expires_at > now() returning *
    ), credited as (
      insert into fact_attempts (attempt_id, user_id, plan, source, source_order_id, granted_by, request_key)
      select $5, user_id, plan, 'transfer', order_id, $2, 'payment:' || order_id from approved returning *
    ), audited as (
      insert into fact_admin_audit (audit_id, admin_id, action, target_user_id, attempt_id, order_id, note)
      select $6, $2, 'approve_transfer', user_id, attempt_id, source_order_id, $3 from credited
    ) select * from approved`, [orderId, admin.id, reference.trim().toLowerCase(), amount, randomUUID(), randomUUID()]);
    if (rows[0]) return rows[0];
    const existing = await getOrder(orderId);
    if (existing?.status === "paid" && existing.amount === amount && existing.bank_reference === reference.trim().toLowerCase()) return existing;
    throw new ApiError("payment_not_pending_or_amount_mismatch", 409);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new ApiError("bank_reference_already_used", 409);
    throw error;
  }
}
export async function rejectTransfer(admin: Account, orderId: string) {
  const sql = await getSql();
  const rows = await sql.query(`with rejected as (
    update fact_orders set status = 'rejected', approved_by = $2, updated_at = now()
    where order_id = $1 and payment_method = 'transfer' and status in ('pending', 'submitted') returning *
  ) insert into fact_admin_audit (audit_id, admin_id, action, target_user_id, order_id)
    select $3, $2, 'reject_transfer', user_id, order_id from rejected returning audit_id`, [orderId, admin.id, randomUUID()]);
  if (!rows[0]) throw new ApiError("payment_not_pending", 409);
}
export async function adminOrders() {
  const sql = await getSql();
  await sql`update fact_orders set status = 'expired', updated_at = now() where payment_method = 'transfer'
    and status in ('pending', 'submitted') and expires_at <= now()`;
  return sql.query<AdminOrder>(`select o.order_id, o.url, o.plan, o.lang, o.amount, o.status, o.payment_method,
    o.created_at, o.expires_at, o.transfer_reference, o.bank_reference, o.error, u.username
    from fact_orders o join "user" u on u.id = o.user_id where payment_method = 'transfer'
    and o.status in ('pending', 'submitted') order by o.created_at limit 100`);
}
export async function createCheck(user: Account, input: { url: string; plan: Plan; lang: Lang; key: string; attemptId?: string }) {
  const sql = await getSql();
  const validateExisting = (order: OrderRow) => {
    if (order.url !== input.url || order.plan !== input.plan || order.lang !== input.lang || !["credit", "admin"].includes(order.payment_method)
      || (!user.admin && input.attemptId && order.credit_attempt_id !== input.attemptId)) throw new ApiError("request_conflict", 409);
    return order;
  };
  const existing = await sql.query<OrderRow>(`select * from fact_orders where user_id = $1 and request_key = $2`, [user.id, input.key]);
  if (existing[0]) return validateExisting(existing[0]);
  const args = [createOrderId(), user.id, input.url, input.plan, input.lang, input.key];
  let rows: OrderRow[];
  if (user.admin) {
    rows = await sql.query<OrderRow>(`insert into fact_orders
      (order_id, user_id, url, plan, lang, amount, status, payment_method, request_key, paid_at)
      values ($1, $2, $3, $4, $5, 0, 'paid', 'admin', $6, now()) on conflict (user_id, request_key) do nothing returning *`, args);
  } else {
    rows = await sql.query<OrderRow>(`with available as (
      select attempt_id from fact_attempts where user_id = $2 and plan = $4 and status = 'ready'
        and ($7::text is null or attempt_id = $7) order by created_at limit 1 for update skip locked
    ), created as (
      insert into fact_orders (order_id, user_id, url, plan, lang, amount, status, payment_method, request_key, paid_at, credit_attempt_id)
      select $1, $2, $3, $4, $5, 0, 'paid', 'credit', $6, now(), attempt_id from available
      on conflict (user_id, request_key) do nothing returning *
    ), consumed as (
      update fact_attempts a set status = 'used', used_at = now(), used_order_id = c.order_id
      from created c where a.attempt_id = c.credit_attempt_id returning a.attempt_id
    ) select * from created`, [...args, input.attemptId ?? null]);
  }
  if (rows[0]) return rows[0];
  const concurrent = await sql.query<OrderRow>(`select * from fact_orders where user_id = $1 and request_key = $2`, [user.id, input.key]);
  if (concurrent[0]) return validateExisting(concurrent[0]);
  throw new ApiError("attempt_required", 402);
}
export async function claimRetry(orderId: string) {
  const sql = await getSql();
  const rows = await sql.query<OrderRow>(`update fact_orders set status = 'processing', error = null, claim_token = $2, retry_after_at = null, updated_at = now()
    where order_id = $1 and payment_method in ('admin', 'credit') and paid_at is not null
    and (retry_after_at is null or retry_after_at <= now())
    and (status in ('paid', 'failed') or (status = 'processing' and updated_at < now() - interval '5 minutes')) returning *`, [orderId, randomUUID()]);
  return rows[0] ?? null;
}
export async function markProcessed(orderId: string, contract: FactContract, report: FactOk, token: string | null) {
  const sql = await getSql();
  await sql.query(`update fact_orders set status = 'processed', result_json = $2, report_json = $3, error = null,
    claim_token = null, retry_after_at = null, updated_at = now() where order_id = $1 and status = 'processing' and claim_token = $4`,
    [orderId, JSON.stringify(contract), JSON.stringify(report), token]);
}
export async function markFailed(orderId: string, error: string, token: string | null, retryAfterSeconds = 0) {
  const sql = await getSql();
  await sql.query(`update fact_orders set status = 'failed', error = $2, claim_token = null, updated_at = now(),
    retry_after_at = case when $4::int > 0 then clock_timestamp() + ($4::int * interval '1 second') else null end
    where order_id = $1 and status = 'processing' and claim_token = $3`, [orderId, error.slice(0, 200), token, retryAfterSeconds]);
}
export function readStored(order: OrderRow) { return { result: parseStored<FactContract>(order.result_json), report: parseStored<FactOk>(order.report_json) }; }
function parseStored<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
export async function publicOrder(order: OrderRow) {
  const sql = await getSql();
  const attempts = order.payment_method === "transfer" && order.status === "paid"
    ? await sql.query<{ attempt_id: string }>(`select attempt_id from fact_attempts where source_order_id = $1 and user_id = $2 and status = 'ready'`, [order.order_id, order.user_id]) : [];
  return { order_id: order.order_id, url: order.url, plan: order.plan, lang: order.lang, status: order.status,
    amount: Number(order.amount), payment_method: order.payment_method, expires_at: order.expires_at,
    transfer_reference: order.transfer_reference, attempt_id: attempts[0]?.attempt_id ?? null, error: order.error, retry_after_at: order.retry_after_at,
    ...(order.status === "processed" ? readStored(order) : { result: null, report: null }) };
}
