import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getBearerToken } from "@/lib/auth/client";
import type { AccountState } from "./account-types";
import type { Lang } from "./types";
export function say(lang: Lang, en: string, id: string) { return lang === "id" ? id : en; }
export class RequestError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
export async function apiRequest<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getBearerToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { method: body === undefined ? "GET" : "POST", headers,
    credentials: "same-origin", cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await res.json();
  if (!res.ok) throw new RequestError(data.error || data.code || "server_error", res.status);
  return data as T;
}
export function errorMessage(error: unknown, lang: Lang) {
  const code = error instanceof RequestError ? error.code : "network";
  const messages: Record<string, [string, string]> = {
    username_not_found: ["Username was not found. Ask the user to register first.", "Username tidak ditemukan. Minta pengguna daftar dahulu."],
    bank_reference_already_used: ["This bank reference has already been credited.", "Referensi bank ini sudah pernah dikreditkan."],
    payment_not_pending_or_amount_mismatch: ["Check the amount and invoice status. Expired invoices cannot be approved.", "Periksa nominal dan status tagihan. Tagihan kedaluwarsa tidak dapat disetujui."],
    payment_not_pending: ["This invoice is no longer pending.", "Tagihan ini tidak lagi menunggu pembayaran."],
    login_required: ["Please sign in again.", "Silakan masuk kembali."],
    admin_required: ["This menu requires an admin account.", "Menu ini hanya untuk admin."],
    transfer_unconfigured: ["Bank details have not been configured. Please contact the admin.", "Detail rekening belum diatur. Silakan hubungi admin."],
    configuration_required: ["The server needs its database and sign-in configuration.", "Database dan konfigurasi login server belum lengkap."],
    attempt_required: ["No unused attempt is available for this plan.", "Tidak ada kesempatan tersisa untuk paket ini."],
    request_conflict: ["This request was already used with different details. Refresh and try again.", "Permintaan ini sudah dipakai dengan detail berbeda. Muat ulang dan coba lagi."],
    rate: ["All available API keys are rate limited. Retry this check later from your account.", "Semua API key yang tersedia sedang mencapai batas. Coba ulang pemeriksaan ini nanti dari akunmu."],
    ai_unavailable: ["The AI service is not configured or its keys are unavailable. Your attempt stays with this check for retry.", "Layanan AI belum diatur atau key tidak tersedia. Kesempatanmu tetap terikat pada pemeriksaan ini untuk dicoba ulang."],
  };
  const item = messages[code];
  return item ? item[lang === "id" ? 1 : 0] : say(lang, "The request could not be completed. Please try again.", "Permintaan belum berhasil. Silakan coba lagi.");
}
type Context = AccountState & { loading: boolean; error: string; refresh: () => Promise<void> };
const AccountContext = createContext<Context>({ user: null, attempts: [], orders: [], loading: true, error: "", refresh: async () => {} });
export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState>({ user: null, attempts: [], orders: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try { setState(await apiRequest<AccountState>("/api/account")); setError(""); }
    catch (e) { setError(e instanceof RequestError ? e.code : "network"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15_000);
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [refresh]);
  return <AccountContext.Provider value={{ ...state, loading, error, refresh }}>{children}</AccountContext.Provider>;
}
export function useAccount() { return useContext(AccountContext); }
