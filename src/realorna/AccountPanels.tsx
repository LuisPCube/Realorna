import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Gift, RefreshCw, ShieldCheck, Wallet, X } from "lucide-react";
import { apiRequest, errorMessage, RequestError, say, useAccount } from "./account";
import type { AccountOrder, AdminOrder, Attempt, TransferDetails } from "./account-types";
import type { Lang, Plan } from "./types";
import { PRICES, PROMOS } from "./safety";
const money = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

export function AccountPanel({ lang, onAttempt, onOrder }: { lang: Lang; onAttempt: (attempt: Attempt) => void; onOrder: (order: AccountOrder) => void }) {
  const { user, attempts, orders, refresh } = useAccount();
  if (!user) return null;
  const regular = attempts.filter(a => a.plan === "regular").length;
  const advance = attempts.filter(a => a.plan === "advance").length;
  return <section className="account-card account-overview" aria-label={say(lang,"Your account","Akunmu")}>
    <div className="account-section-head"><div><span className="eyebrow">{say(lang,"YOUR ACCOUNT","AKUNMU")}</span><h2>@{user.username}</h2></div><button className="icon-action" type="button" aria-label={say(lang,"Refresh account","Muat ulang akun")} onClick={() => void refresh()}><RefreshCw size={17}/></button></div>
    {user.admin ? <p className="success-line"><ShieldCheck size={18}/>{say(lang,"Admin account · Regular and Advance checks are free.","Akun admin · Cek Regular dan Advance gratis.")}</p> : <div className="credit-grid">
      <div><span>Regular</span><strong>{regular}</strong><small>{say(lang,"attempts available","kesempatan tersedia")}</small></div>
      <div><span>Advance</span><strong>{advance}</strong><small>{say(lang,"attempts available","kesempatan tersedia")}</small></div>
    </div>}
    {attempts.length > 0 && <details className="account-details"><summary>{say(lang,"Use an available attempt","Gunakan kesempatan tersedia")}</summary><ul className="account-list">
      {attempts.map(a => <li key={a.attempt_id}><span><Gift size={16}/><strong>{a.plan === "advance" ? "Advance" : "Regular"}</strong><small>{a.source === "admin" ? say(lang,"From admin","Dari admin") : say(lang,"Transfer verified","Transfer terverifikasi")}</small></span><button type="button" className="btn" onClick={() => onAttempt(a)}>{say(lang,"Use","Gunakan")}</button></li>)}
    </ul></details>}
    {orders.length > 0 && <details className="account-details"><summary>{say(lang,"Payments & recent checks","Pembayaran & pemeriksaan terbaru")}</summary><ul className="account-list">
      {orders.map(order => <li key={order.order_id}><span className="account-order-summary"><strong>{order.plan === "advance" ? "Advance" : "Regular"} · {order.status}</strong><small>{order.url}</small><small>{order.payment_method === "transfer" ? `${money(order.amount)} · ${order.order_id}` : say(lang,"Check attempt","Kesempatan cek")}</small></span>
        {order.payment_method === "transfer" && ["pending","submitted"].includes(order.status) ? <button type="button" className="btn" onClick={() => onOrder(order)}>{say(lang,"View payment","Lihat tagihan")}</button>
          : ["processed","failed","paid","processing"].includes(order.status) && order.payment_method !== "transfer" ? <button type="button" className="btn" onClick={() => onOrder(order)}>{order.status === "processed" ? say(lang,"Report","Laporan") : say(lang,"Resume / retry","Lanjut / ulang")}</button> : null}
      </li>)}
    </ul></details>}
  </section>;
}

type Audit = { action: string; username: string; plan: string | null; created_at: string };
export function AdminPanel({ lang }: { lang: Lang }) {
  const [tab, setTab] = useState<"grant" | "transfers">("grant");
  const [username, setUsername] = useState("");
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const key = useRef<{ username: string; plan: Plan; value: string } | null>(null);
  const { refresh } = useAccount();
  const load = useCallback(async () => {
    try { const data = await apiRequest<{ orders: AdminOrder[]; audit: Audit[] }>("/api/admin"); setOrders(data.orders); setAudit(data.audit); }
    catch (e) { setError(errorMessage(e, lang)); }
  }, [lang]);
  useEffect(() => { void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 15_000); return () => clearInterval(timer); }, [load]);
  async function grant(plan: Plan) {
    if (busy || !username.trim()) return;
    setBusy(true); setError(""); setNote(""); setLink("");
    const normalized = username.trim().toLowerCase();
    if (!key.current || key.current.username !== normalized || key.current.plan !== plan) key.current = { username: normalized, plan, value: crypto.randomUUID() };
    try {
      const data = await apiRequest<{ username: string; plan: Plan; link: string }>("/api/admin", { action: "grant", username: normalized, plan, request_key: key.current.value });
      setNote(say(lang, `1 ${data.plan === "advance" ? "Advance" : "Regular"} attempt sent to @${data.username}.`, `1 kesempatan ${data.plan === "advance" ? "Advance" : "Regular"} dikirim ke @${data.username}.`));
      setLink(new URL(data.link, window.location.origin).toString()); key.current = null; setUsername(""); await load(); await refresh();
    } catch (e) { setError(errorMessage(e, lang)); }
    finally { setBusy(false); }
  }
  return <section className="account-card admin-panel" id="admin-panel">
    <div className="account-section-head"><div><span className="eyebrow">ADMIN</span><h2>{say(lang,"Account access","Akses akun")}</h2></div><ShieldCheck size={26}/></div>
    <div className="account-tabs" role="tablist" aria-label="Admin menu"><button role="tab" aria-selected={tab === "grant"} type="button" onClick={() => setTab("grant")}>{say(lang,"Send attempts","Kirim kesempatan")}</button><button role="tab" aria-selected={tab === "transfers"} type="button" onClick={() => setTab("transfers")}>{say(lang,"Transfer approvals","Verifikasi transfer")}{orders.length > 0 && <span className="count-tag">{orders.length}</span>}</button></div>
    {tab === "grant" ? <div role="tabpanel"><p>{say(lang,"Enter a registered username, then send one check attempt.","Masukkan username yang sudah terdaftar, lalu kirim satu kesempatan cek.")}</p>
      <form className="stack-form" onSubmit={e => { e.preventDefault(); void grant("regular"); }}>
        <label htmlFor="grant-username">Username<input id="grant-username" autoComplete="off" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" value={username} onChange={e => setUsername(e.target.value)} disabled={busy} placeholder="alex"/></label>
        <div className="grant-buttons"><button className="btn primary" type="submit" disabled={busy || !username.trim()}><Gift size={17}/>{say(lang,"Send Regular","Kirim Regular")}</button><button className="btn advance-button" type="button" disabled={busy || !username.trim()} onClick={() => void grant("advance")}><Gift size={17}/>{say(lang,"Send Advance","Kirim Advance")}</button></div>
      </form><p className="note">{say(lang,"For QRIS demos, show a one-time QR from your banking app. Verify the incoming payment there, then send the attempt here.","Untuk demo QRIS, tampilkan QR sekali pakai dari aplikasi bank. Periksa dana masuk di sana, lalu kirim kesempatan di sini.")}</p>
      {note && <p className="success-line" role="status"><Check size={18}/>{note}</p>}
      {link && <div className="attempt-share"><label htmlFor="attempt-link">{say(lang,"Account-bound attempt link","Tautan kesempatan khusus akun")}</label><div><input id="attempt-link" readOnly value={link}/><button className="btn" type="button" onClick={() => void navigator.clipboard.writeText(link).then(() => setNote(say(lang,"Link copied.","Tautan disalin."))).catch(() => setNote(say(lang,"Select the link and copy it manually.","Pilih dan salin tautan secara manual.")))}><Copy size={16}/>{say(lang,"Copy","Salin")}</button></div></div>}
      {audit.length > 0 && <details className="account-details"><summary>{say(lang,"Recent admin actions","Aktivitas admin terbaru")}</summary><ul className="audit-list">{audit.map((a,i) => <li key={a.created_at+i}><span>@{a.username} · {a.action}{a.plan ? ` · ${a.plan}` : ""}</span><time>{new Date(a.created_at).toLocaleString(lang === "id" ? "id-ID" : "en-GB")}</time></li>)}</ul></details>}
    </div> : <div role="tabpanel"><p>{say(lang,"Check your bank transaction history before approving. Enter the exact amount received and the bank transaction ID. One approval adds one attempt.","Periksa mutasi bank sebelum menyetujui. Masukkan nominal yang benar-benar diterima dan ID transaksi bank. Satu persetujuan menambah satu kesempatan.")}</p>
      <button className="link-btn" type="button" onClick={() => void load()}>{say(lang,"Refresh payments","Muat ulang pembayaran")}</button>
      {orders.length === 0 ? <p className="empty">{say(lang,"No transfers await approval.","Tidak ada transfer menunggu verifikasi.")}</p> : orders.map(order => <ApprovalCard key={order.order_id} order={order} lang={lang} onDone={async () => { await load(); await refresh(); }}/>)}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

function ApprovalCard({ order, lang, onDone }: { order: AdminOrder; lang: Lang; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState(""); const [reference, setReference] = useState("");
  const [checked, setChecked] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(action: "approve" | "reject") {
    if (busy) return; setBusy(true); setError("");
    try { await apiRequest("/api/admin", { action, order_id: order.order_id, amount: Number(amount), bank_reference: reference }); await onDone(); }
    catch (e) { setError(errorMessage(e, lang)); } finally { setBusy(false); }
  }
  return <article className="approval-card"><div className="account-section-head"><strong>@{order.username} · {order.plan}</strong><strong>{money(order.amount)}</strong></div><p className="note">{order.order_id} · {order.status}<br/>{say(lang,"User's transfer note:","Catatan transfer pengguna:")} {order.transfer_reference || "—"}</p>
    <form className="stack-form" onSubmit={e => { e.preventDefault(); if (checked) void submit("approve"); }}>
      <label>{say(lang,"Actual amount received (IDR)","Nominal diterima (IDR)")}<input aria-label={say(lang,"Actual amount received (IDR)","Nominal diterima (IDR)")} inputMode="numeric" type="number" step="1" min="1" required value={amount} onChange={e => setAmount(e.target.value)} disabled={busy}/></label>
      <label>{say(lang,"Bank transaction reference","Referensi transaksi bank")}<input aria-label={say(lang,"Bank transaction reference","Referensi transaksi bank")} required minLength={3} maxLength={100} value={reference} onChange={e => setReference(e.target.value)} disabled={busy}/></label>
      <label className="check-label"><input type="checkbox" required checked={checked} onChange={e => setChecked(e.target.checked)} disabled={busy}/>{say(lang,"I verified this transaction in the bank app.","Saya sudah memeriksa transaksi ini di aplikasi bank.")}</label>
      <div className="grant-buttons"><button className="btn primary" type="submit" disabled={busy || !checked}>{say(lang,"Approve & add attempt","Setujui & tambah kesempatan")}</button><button className="btn" type="button" disabled={busy} onClick={() => void submit("reject")}>{say(lang,"Reject","Tolak")}</button></div>
    </form>{error && <p className="form-error" role="alert">{error}</p>}
  </article>;
}

type Ticket = { order_id: string; amount: number; status: string; expires_at: string; transfer: TransferDetails; transfer_reference: string | null; attempt_id: string | null };
export function TransferDialog({ plan, url, lang, resumeOrderId, onClose, onApproved }: { plan: Plan; url: string; lang: Lang; resumeOrderId?: string; onClose: () => void; onApproved: (attemptId: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const key = useRef(""); const completed = useRef(false);
  const approved = useRef(onApproved); approved.current = onApproved;
  const [ticket, setTicket] = useState<Ticket | null>(null); const [promo, setPromo] = useState(""); const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [note, setNote] = useState("");
  const { refresh } = useAccount();
  useEffect(() => { const d = dialog.current; if (d && !d.open) d.showModal(); }, []);
  useEffect(() => {
    if (!resumeOrderId) return;
    void apiRequest<Ticket>(`/api/orders/${encodeURIComponent(resumeOrderId)}`).then(data => {setTicket(data);setReference(data.transfer_reference || "");}).catch(e => setError(errorMessage(e,lang)));
  }, [resumeOrderId, lang]);
  useEffect(() => {
    if (!ticket?.order_id) return;
    let stop = false; let running = false;
    const poll = async () => {
      if (running || stop || completed.current) return; running = true;
      try {
        const next = await apiRequest<Ticket>(`/api/orders/${encodeURIComponent(ticket.order_id)}`);
        if (stop) return; setTicket(next);
        if (next.status === "paid") {
          completed.current = true; await refresh();
          if (next.attempt_id) approved.current(next.attempt_id);
          else setNote(say(lang,"Payment approved. Its attempt is already in use.","Pembayaran disetujui. Kesempatannya sudah digunakan."));
        }
      } catch (e) { if (!stop && e instanceof RequestError && e.status === 401) setError(errorMessage(e,lang)); }
      finally { running = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 4000);
    return () => { stop = true; clearInterval(timer); };
  }, [ticket?.order_id, lang, refresh]);
  async function create() {
    if (busy || ticket) return; setBusy(true); setError("");
    if (!key.current) key.current = crypto.randomUUID();
    try { setTicket(await apiRequest<Ticket>("/api/create-payment", { url, plan, lang, promo, request_key: key.current })); await refresh(); }
    catch (e) { setError(errorMessage(e, lang)); } finally { setBusy(false); }
  }
  async function submitted() {
    if (!ticket || busy) return; setBusy(true); setError("");
    try { await apiRequest(`/api/orders/${encodeURIComponent(ticket.order_id)}`, { reference }); setTicket({ ...ticket, status: "submitted" }); setNote(say(lang,"Sent to admin for verification. Your attempt appears after approval.","Dikirim ke admin untuk verifikasi. Kesempatanmu masuk setelah disetujui.")); await refresh(); }
    catch (e) { setError(errorMessage(e,lang)); } finally { setBusy(false); }
  }
  const total = ticket?.amount ?? Math.round(PRICES[plan] * (1 - (PROMOS[promo.trim().toUpperCase()] || 0)));
  return <dialog className="transfer-dialog" ref={dialog} aria-labelledby="transfer-title" onCancel={e => {e.preventDefault();onClose();}}>
    <div className="account-section-head"><Wallet size={24}/><button type="button" className="icon-action" onClick={onClose} aria-label={say(lang,"Close","Tutup")}><X size={20}/></button></div>
    <h2 id="transfer-title">{say(lang,"Pay by bank transfer","Bayar lewat transfer")}</h2><p className="mid">{plan === "advance" ? "Advance" : "Regular"} · {say(lang,"1 check attempt","1 kesempatan cek")}</p>
    <strong className="transfer-total">{money(total)}</strong>
    {!ticket ? <><label className="stack-form">{say(lang,"Promo code (optional)","Kode promo (opsional)")}<input className="promo" value={promo} maxLength={30} disabled={busy} onChange={e => setPromo(e.target.value)}/></label><p className="note">{say(lang,"Create an invoice to see the bank details. An admin verifies your transfer before adding an attempt.","Buat tagihan untuk melihat rekening. Admin memverifikasi transfer sebelum menambahkan kesempatan.")}</p><button className="btn primary wide" type="button" disabled={busy || Boolean(resumeOrderId)} onClick={() => void create()}>{say(lang,busy ? "Preparing…" : "Show transfer details",busy ? "Menyiapkan…" : "Lihat rekening transfer")}</button></> : <>
      <dl className="transfer-details"><div><dt>{say(lang,"Bank","Bank")}</dt><dd>{ticket.transfer.bank}</dd></div><div><dt>{say(lang,"Account number","Nomor rekening")}</dt><dd>{ticket.transfer.number}</dd></div><div><dt>{say(lang,"Account holder","Atas nama")}</dt><dd>{ticket.transfer.holder}</dd></div><div><dt>{say(lang,"Invoice / transfer note","Tagihan / berita transfer")}</dt><dd>{ticket.order_id}</dd></div></dl>
      <p className="note">{say(lang,"Expires:","Berlaku sampai:")} {new Date(ticket.expires_at).toLocaleString(lang === "id" ? "id-ID" : "en-GB")}</p>{ticket.transfer.note && <p>{ticket.transfer.note}</p>}
      {["pending","submitted"].includes(ticket.status) ? <form className="stack-form" onSubmit={e => {e.preventDefault();void submitted();}}><label htmlFor="transfer-reference">{say(lang,"Your transfer reference / sender name","Referensi transfer / nama pengirim")}<input id="transfer-reference" required minLength={3} maxLength={100} value={reference} onChange={e => setReference(e.target.value)} disabled={busy}/></label><button className="btn primary wide" type="submit" disabled={busy}>{say(lang,busy ? "Sending…" : ticket.status === "submitted" ? "Update transfer note" : "I've transferred · notify admin",busy ? "Mengirim…" : ticket.status === "submitted" ? "Perbarui catatan transfer" : "Sudah transfer · beri tahu admin")}</button><p className="note">{say(lang,"This button requests verification. It does not confirm payment.","Tombol ini meminta verifikasi. Pembayaran tetap harus diperiksa admin.")}</p></form> : <p className="status-pill">{ticket.status}</p>}
    </>}
    <p className="note">{say(lang,"For a QRIS demo, ask the admin to show a one-time QR from their banking app.","Untuk demo QRIS, minta admin menampilkan QR sekali pakai dari aplikasi bank.")}</p>
    {note && <p className="success-line" role="status">{note}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    <button className="link-btn" type="button" onClick={onClose}>{say(lang,"Close · resume later from your account","Tutup · lanjutkan dari akun nanti")}</button>
  </dialog>;
}
