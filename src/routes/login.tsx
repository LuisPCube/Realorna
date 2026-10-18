import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { say, useAccount } from "@/realorna/account";
import type { Lang } from "@/realorna/types";
export const Route = createFileRoute("/login")({ component: Login });
function safeDestination() {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") && !next.startsWith("/login") ? next : "/";
}
function Login() {
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lang, setLang] = useState<Lang>("id");
  const account = useAccount();
  useEffect(() => {
    try { if (JSON.parse(localStorage.getItem("rl:lang") || '"id"') === "en") setLang("en"); } catch { /* default */ }
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const result = register ? await authClient.signUp.email({ username: username.trim(), displayUsername: username.trim(),
        name: username.trim(), email: email.trim(), password }) : await authClient.signIn.username({ username: username.trim().toLowerCase(), password });
      if (result.error) {
        const code = result.error.code || "";
        setError(code.includes("USERNAME") && (code.includes("TAKEN") || code.includes("EXISTS"))
          ? say(lang, "This username is already taken. Choose another.", "Username sudah digunakan. Pilih yang lain.")
          : result.error.message || say(lang, "Sign-in failed.", "Gagal masuk."));
      } else window.location.assign(safeDestination());
    } catch { setError(say(lang, "Could not connect. Please try again.", "Koneksi gagal. Silakan coba lagi.")); }
    finally { setBusy(false); }
  }
  return <div className="rn" data-plan="regular"><div className="wrap auth-wrap">
    <header className="top"><a className="brand brand-name" href="/">Realorna</a><a className="account-link" href="/"><ArrowLeft size={16}/>{say(lang, "Back to checker", "Kembali")}</a></header>
    <main className="auth-layout"><div className="auth-story"><span className="eyebrow">REALORNA ACCOUNT</span>
      <h1>{say(lang, "A little clarity.\nOne account.", "Lebih jelas.\nSatu akun.")}</h1>
      <p>{say(lang, "Your check attempts, transfers and reports, in one place.", "Kesempatan cek, transfer, dan laporanmu dalam satu tempat.")}</p>
      <p className="auth-assurance"><ShieldCheck size={22}/>{say(lang, "Your attempts belong to your account.", "Kesempatan cek terikat pada akunmu.")}</p>
    </div><section className="account-card auth-card">
      <h2>{say(lang, register ? "Create your account" : "Welcome back", register ? "Buat akunmu" : "Selamat datang kembali")}</h2>
      {account.user ? <p>{say(lang, "You are signed in as", "Kamu masuk sebagai")} <strong>{account.user.username}</strong>. <a href="/">{say(lang,"Continue","Lanjutkan")}</a></p> : <>
      <form onSubmit={e => void submit(e)} className="stack-form" aria-busy={busy || account.loading}>
        <label htmlFor="login-username">Username<input id="login-username" name="username" autoComplete="username" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" value={username} onChange={e => setUsername(e.target.value)} disabled={busy || account.loading}/></label>
        <small>{say(lang, "3–30 letters, numbers, dots or underscores. Uppercase and lowercase count as the same username.", "3–30 huruf, angka, titik, atau garis bawah. Huruf besar dan kecil dianggap sama.")}</small>
        {register && <label htmlFor="login-email">Email<input id="login-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy || account.loading}/></label>}
        <label htmlFor="login-password">{say(lang,"Password","Kata sandi")}<input id="login-password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 10 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy || account.loading}/></label>
        {register && <small>{say(lang,"At least 10 characters.","Minimal 10 karakter.")}</small>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn primary wide" type="submit" disabled={busy || account.loading}>{busy || account.loading ? say(lang,"Please wait…","Tunggu…") : say(lang,register ? "Create account" : "Sign in",register ? "Buat akun" : "Masuk")}<ArrowRight size={17}/></button>
      </form><p className="auth-toggle">{say(lang, register ? "Already have an account?" : "New to Realorna?",register ? "Sudah punya akun?" : "Belum punya akun?")} <button className="link-btn" type="button" disabled={busy || account.loading} onClick={() => {setRegister(!register);setError("");setPassword("");}}>{say(lang,register ? "Sign in" : "Register",register ? "Masuk" : "Daftar")}</button></p>
      </>}
    </section></main>
  </div></div>;
}
