import type { FactOk, Lang } from "./types";

export function resultLabel(verdict: FactOk["verdict"], lang: Lang) {
  if (verdict === "FAKTA" || verdict === "SEBAGIAN_BENAR") return "Real";
  if (verdict === "HOAKS" || verdict === "MENYESATKAN") return "Nah (Hoax)";
  return lang === "id" ? "Belum cukup bukti" : "Not enough evidence";
}
export function reportText(result: FactOk, lang: Lang) {
  const id = lang === "id";
  return ["Realorna", ...(result.demo ? [id ? "CONTOH ILUSTRATIF — bukan data pasar aktual" : "ILLUSTRATIVE EXAMPLE — not actual market data"] : []),
    resultLabel(result.verdict, lang), result.meta.title, result.summary, "",
    ...result.claims.flatMap(c => [
      `${({ benar: "✓", salah: "✕", keliru: "~", belum_jelas: "?" })[c.status]} ${c.text}`,
      ...(c.correction ? [`✓ ${id ? "Koreksi" : "Correction"}: ${c.correction}`] : []),
      c.explanation,
      ...(c.source_urls ?? []).map(url => `${id ? "Bukti" : "Evidence"}: ${url}`),
    ]),
    ...(result.reference_date ? [`${id ? "Konteks waktu" : "Time context"}: ${result.reference_date}`] : []),
    ...(result.checked_at ? [`${id ? "Diperiksa" : "Checked"}: ${result.checked_at}`] : []),
    ...(!result.demo ? [result.url] : []),
  ].filter(Boolean).join("\n");
}
