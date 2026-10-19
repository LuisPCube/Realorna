export type AiDiagnostic = {
  origin: "openai" | "transport" | "app_queue" | "app_pacing" | "app_cooldown" | "deadline" | "saved_check";
  reason?: string;
  provider_status?: number;
  provider_code?: string;
  provider_request_id?: string;
  client_request_id?: string;
};

export class AiServiceError extends Error {
  constructor(public code: "ai_quota" | "ai_timeout" | "ai_failed" | "ai_unavailable", public diagnostic: AiDiagnostic) {
    super(code === "ai_unavailable" ? "openai_off" : code === "ai_failed" ? "openai_failed" : code);
    this.name = "AiServiceError";
  }
}

// Never copy provider messages, bodies, request headers, keys or article text.
export function providerDiagnostic(response?: Response, data?: unknown, clientRequestId?: string): AiDiagnostic {
  const rawCode = (data as { error?: { code?: unknown; type?: unknown } } | null)?.error;
  const code = rawCode?.code ?? rawCode?.type;
  const requestId = response?.headers.get("x-request-id");
  return {
    origin: "openai",
    ...(response ? { provider_status: response.status } : {}),
    ...(typeof code === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(code) ? { provider_code: code } : {}),
    ...(requestId && /^[A-Za-z0-9_-]{1,160}$/.test(requestId) ? { provider_request_id: requestId } : {}),
    ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
  };
}
