import pg from "pg";
import { provisionAdmin } from "./admin-account.mjs";
if (!process.env.DATABASE_URL?.trim()) {
  if (process.env.VERCEL) throw new Error("Connect a Postgres database and set DATABASE_URL before deploying.");
  console.log("[admin] Local build: admin is seeded at dev startup when ADMIN_PASSWORD is set.");
} else if (!process.env.ADMIN_PASSWORD) {
  console.log("[admin] ADMIN_PASSWORD not set: no bootstrap account will be created.");
} else {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("select pg_advisory_xact_lock(782041006)");
    const result = await provisionAdmin(async (text, params) => (await client.query(text, params)).rows);
    await client.query("COMMIT");
    console.log(result.created ? "[admin] Bootstrap account created." : "[admin] Account already exists; password unchanged.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); await pool.end(); }
}
