import type { FactOk, Lang } from "./types";

export type ExampleKind = "real" | "nah" | "correction";
/** Illustrations only. No live market data, invented citations, payment or API call. */
export function exampleReport(kind: ExampleKind, lang: Lang): FactOk {
  const id = lang === "id";
  const point = (text: string, status: "benar" | "salah" | "keliru", explanation: string, correction = "", importance: "utama" | "detail" = "utama") =>
    ({ text, status, explanation, correction, importance, source_urls: [] });
  const claims = kind === "nah" ? [
    point(id ? "IHSG turun." : "The IHSG fell.", "benar", id ? "Dalam skenario contoh, arah pergerakannya memang turun." : "In this illustrative scenario, the index did fall."),
    point(id ? "IHSG turun ke 3.500." : "The IHSG fell to 3,500.", "salah", id ? "Angka pada klaim berbeda dari data simulasi untuk sesi yang sama." : "The claimed value differs from the simulated data for the same trading session.", id ? "IHSG berada di 4.900 pada sesi contoh tersebut." : "The IHSG was at 4,900 in that example session."),
  ] : [
    point(id ? "IHSG turun." : "The IHSG fell.", "benar", id ? "Arah pergerakan sesuai dengan data simulasi." : "The direction matches the simulated data."),
    point(id ? "IHSG ditutup di 4.900 pada sesi yang disebut." : "The IHSG closed at 4,900 in the stated session.", "benar", id ? "Angka dan sesi perdagangan sesuai dalam skenario contoh." : "The figure and trading session match in this example."),
    ...(kind === "correction" ? [point(id ? "Penutupan 4.900 terjadi pukul 15.00 WIB." : "The 4,900 close was at 15:00 WIB.", "keliru", id ? "Waktu disebut kurang tepat; arah dan angka utamanya tetap sesuai dalam contoh ini." : "The time is imprecise; the main direction and figure still match in this example.", id ? "Dalam simulasi ini, penutupan terjadi pukul 16.00 WIB." : "In this simulation, the close was at 16:00 WIB.", "detail")] : []),
  ];
  return {
    ok: true, demo: true, verdict: kind === "nah" ? "MENYESATKAN" : kind === "correction" ? "SEBAGIAN_BENAR" : "FAKTA", confidence: 0,
    summary: kind === "nah" ? id ? "Arah penurunannya benar, tetapi angka 3.500 salah. Dalam contoh ini, IHSG berada di 4.900." : "The fall is correct, but 3,500 is wrong. In this example, the IHSG was at 4,900."
      : kind === "correction" ? id ? "Klaim utama sesuai dengan data simulasi. Ada koreksi kecil pada waktu penutupannya." : "The main claims match the simulated data. The closing time needs a small correction."
      : id ? "Arah, angka, dan sesi perdagangan sesuai dengan data simulasi. Klaim utama dalam contoh ini benar." : "The direction, figure, and trading session match the simulated data. The main claims in this example are supported.",
    claims, sources: [], red_flags: [], safety: [], host: id ? "Contoh ilustratif" : "Illustrative example",
    meta: { title: kind === "nah" ? id ? "Klaim: IHSG turun ke 3.500" : "Claim: IHSG fell to 3,500" : id ? "Klaim: IHSG turun ke 4.900" : "Claim: IHSG fell to 4,900", platform: "", author: "", published_at: "" },
    kind: "news", platform: null, outlet: null, url: "", plan: "regular", mode: "structure",
    reference_date: id ? "Sesi perdagangan simulasi — bukan data pasar terkini" : "Simulated trading session — not current market data",
  };
}
