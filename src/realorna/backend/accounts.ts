import { getSql } from "@/lib/db";
import { auth } from "@/lib/auth/server";
import type { Account, AccountOrder, Attempt } from "../account-types";
import { ApiError, assertOrigin } from "./http";
export async function currentAccount(request: Request): Promise<Account | null> {
  assertOrigin(request);
  if (process.env.VERCEL && (!process.env.DATABASE_URL?.trim() || !process.env.BETTER_AUTH_SECRET?.trim())) throw new ApiError("configuration_required", 503);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  const sql = await getSql();
  const users = await sql.query<{ id: string; username: string; email: string; role: string | null }>(
    `select u.id, u.username, u.email, r.role from "user" u left join fact_user_roles r on r.user_id = u.id where u.id = $1`, [session.user.id]);
  const user = users[0];
  if (!user?.username) return null;
  return { id: user.id, username: user.username, email: user.email, admin: user.role === "admin" };
}
export async function requireAccount(request: Request, admin = false) {
  const user = await currentAccount(request);
  if (!user) throw new ApiError("login_required", 401);
  if (admin && !user.admin) throw new ApiError("admin_required", 403);
  return user;
}
export async function accountState(request: Request) {
  const user = await currentAccount(request);
  if (!user) return { user: null, attempts: [], orders: [] };
  const sql = await getSql();
  await sql`update fact_orders set status = 'expired', updated_at = now() where user_id = ${user.id}
    and payment_method = 'transfer' and status in ('pending', 'submitted') and expires_at <= now()`;
  const [attempts, orders] = await Promise.all([
    sql.query<Attempt>(`select attempt_id, plan, source, created_at from fact_attempts where user_id = $1 and status = 'ready' order by created_at`, [user.id]),
    sql.query<AccountOrder>(`select order_id, url, plan, lang, amount, status, payment_method, transfer_reference, created_at, expires_at, error
      from fact_orders where user_id = $1 order by created_at desc limit 20`, [user.id]),
  ]);
  return { user, attempts, orders };
}
