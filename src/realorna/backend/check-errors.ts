import { randomUUID } from "node:crypto";
import type { FactErrCode } from "../types";
import { AiServiceError, type AiDiagnostic } from "./ai-errors";
import { AiRateLimitError } from "./ai-rate-policy";
import { json } from "./http";

export class CheckError extends Error {
  constructor(public code: FactErrCode, public retryAfterSeconds = 0,
    public retryReason: "rate" | "quota" | "busy" = "rate", public diagnostic?: AiDiagnostic) {
    super(code);
  }
}

export function asCheckError(error: unknown): CheckError {
  if (error instanceof CheckError) return error;
  if (error instanceof AiServiceError) return new CheckError(error.code, 0,
    error.code === "ai_quota" ? "quota" : "rate", error.diagnostic);
  if (error instanceof AiRateLimitError) return new CheckError(
    error.reason === "quota" ? "ai_quota" : error.reason === "busy" ? "ai_busy" : "rate",
    error.reason === "quota" ? 0 : error.retryAfterSeconds, error.reason, error.diagnostic);
  return new CheckError("ai_failed");
}

export function checkErrorResponse(error: CheckError) {
  const status = error.code === "rate" ? 429 : error.code === "ai_timeout" ? 504
    : ["ai_busy", "ai_quota", "ai_unavailable"].includes(error.code) ? 503
    : error.code === "ai_failed" ? 502 : 422;
  const retry = ["rate", "ai_busy"].includes(error.code) && error.retryAfterSeconds > 0;
  const supportId = randomUUID();
  const diagnostic = error.diagnostic;
  const body = {
    error: error.code, support_id: supportId,
    ...(retry ? { retry_after_seconds: Math.ceil(error.retryAfterSeconds), retry_reason: error.retryReason } : {}),
    ...(diagnostic ? { error_origin: diagnostic.origin, diagnostic_reason: diagnostic.reason,
      provider_status: diagnostic.provider_status, provider_code: diagnostic.provider_code,
      provider_request_id: diagnostic.provider_request_id, client_request_id: diagnostic.client_request_id } : {}),
  };
  // Only structured, bounded metadata. Never log the submitted URL, key, or raw error.
  console.warn("[realorna] check_failed", JSON.stringify(body));
  const response = json(body, status);
  if (retry) response.headers.set("Retry-After", String(Math.ceil(error.retryAfterSeconds)));
  return response;
}
