import type { FactOk, Lang, Plan } from "./types";
export type Account = { id: string; username: string; email: string; admin: boolean };
export type Attempt = { attempt_id: string; plan: Plan; source: string; created_at: string };
export type TransferDetails = { bank: string; number: string; holder: string; note: string };
export type AccountOrder = {
  order_id: string; url: string; plan: Plan; lang: Lang; amount: number;
  status: string; payment_method: string; created_at: string; expires_at: string | null;
  transfer_reference: string | null; error: string | null; report?: FactOk | null;
  retry_after_at?: string | null;
};
export type AccountState = { user: Account | null; attempts: Attempt[]; orders: AccountOrder[] };
export type AdminOrder = AccountOrder & { username: string; bank_reference: string | null };
