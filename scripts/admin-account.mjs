import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";

/** query must run on a single transaction connection (pg or PGLite). */
export async function provisionAdmin(query, config = process.env) {
  const username = (config.ADMIN_USERNAME || "realorna_admin").trim().toLowerCase();
  const password = config.ADMIN_PASSWORD;
  const email = (config.ADMIN_EMAIL || "admin@realorna.local").trim().toLowerCase();
  if (!password) return { skipped: true };
  if (!/^[a-z0-9_.]{3,30}$/.test(username) || password.length < 16 || password.length > 128) {
    throw new Error("ADMIN_USERNAME must be 3–30 letters/numbers/underscores/dots; ADMIN_PASSWORD must be 16–128 characters.");
  }
  const existing = await query(`select u.id, r.role from "user" u left join fact_user_roles r on r.user_id = u.id
    where lower(u.username) = $1 or lower(u.email) = $2`, [username, email]);
  if (existing.length) {
    if (existing.length !== 1 || existing[0].role !== "admin") throw new Error("Admin identity conflicts with an existing non-admin account. No privileges were changed.");
    return { exists: true };
  }
  const id = randomUUID();
  const hash = await hashPassword(password);
  await query(`insert into "user" (id, name, email, "emailVerified", username, "displayUsername") values ($1, 'Administrator', $2, true, $3, $3)`, [id, email, username]);
  await query(`insert into account (id, "accountId", "providerId", "userId", password, "updatedAt") values ($1, $2, 'credential', $2, $3, now())`, [randomUUID(), id, hash]);
  await query(`insert into fact_user_roles (user_id, role) values ($1, 'admin')`, [id]);
  return { created: true };
}
