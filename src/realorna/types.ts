export type Plan = "regular" | "advance";
export type Lang = "en" | "id";

export type Verdict =
  | "FAKTA"
  | "HOAKS"
  | "MENYESATKAN"
  | "SEBAGIAN_BENAR"
  | "BELUM_TERVERIFIKASI";

export type ClaimStatus = "benar" | "salah" | "belum_jelas";
export type SafetyStatus = "ok" | "warn" | "bad" | "info";

export type SafetyCode =
  | "https_ok"
  | "https_bad"
  | "ip"
  | "puny"
  | "cred"
  | "look"
  | "kw"
  | "tld"
  | "short"
  | "clean"
  | "outlet"
  | "platform"
  | "unknown";

export type SafetyItem = {
  st: SafetyStatus;
  code: SafetyCode;
  params?: Record<string, string>;
};

export type Claim = {
  text: string;
  status: ClaimStatus;
  explanation: string;
};

export type Source = {
  title: string;
  url: string;
  publisher: string;
};

export type ContentMeta = {
  title: string;
  platform: string;
  author: string;
  published_at: string;
};

export type FactContract = {
  verdict: Verdict;
  confidence: number;
  summary: string;
  claims: Claim[];
  red_flags: string[];
  sources: Source[];
  meta: ContentMeta;
};

export type FactOk = {
  ok: true;
  verdict: Verdict;
  confidence: number;
  score: number;
  summary: string;
  summaryKey?: "sum_bad" | "sum_short" | "sum_http";
  claims: Claim[];
  red_flags: string[];
  sources: Source[];
  meta: ContentMeta;
  safety: SafetyItem[];
  host: string;
  kind: "news" | "video" | "link";
  platform: string | null;
  outlet: string | null;
  url: string;
  plan: Plan;
  mode: "structure" | "ai";
  engine?: "gemini" | "grok";
};

export type FactErrCode =
  | "invalid"
  | "video_plan"
  | "unreadable"
  | "rate"
  | "ai_unavailable"
  | "ai_failed";

export type FactErr = {
  ok: false;
  code: FactErrCode;
};

export type FactResponse = FactOk | FactErr;

export type AnalyzeInput = {
  url: string;
  plan: Plan;
  lang: Lang;
};
