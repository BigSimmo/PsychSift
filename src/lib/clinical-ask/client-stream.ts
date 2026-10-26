import type { ClinicalAskFinalPayload, ClinicalAskRequest, ClinicalAskStreamEvent } from "@/lib/clinical-ask/contracts";
import { parseClinicalAskSseFrame } from "@/lib/clinical-ask-stream-contract";
import { ANSWER_DAILY_LIMIT_CODE, answerBurstLimitMessage, answerDailyLimitMessage } from "@/lib/answer-limit-copy";

type ClientFailureCode = "aborted" | "internal_error" | "unauthorized" | "rate_limited";

const failureMessages: Record<ClientFailureCode, string> = {
  aborted: "Clinical Ask was cancelled.",
  internal_error: "Clinical Ask stream could not be read.",
  unauthorized: "Sign in to use Clinical Ask.",
  rate_limited: "Too many Clinical Ask requests.",
};

function failedPayload(
  request: ClinicalAskRequest,
  code: ClientFailureCode,
  message?: string,
  retryable = code === "internal_error" || code === "rate_limited",
): ClinicalAskFinalPayload {
  return {
    response: {
      state: "failed",
      mode: request.mode,
      code,
      retryable,
      message: message ?? failureMessages[code],
    },
    feedback: null,
  };
}

function retryAfterSeconds(response: Response, body: unknown) {
  const header = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header);
  const details =
    body && typeof body === "object" && "details" in body ? (body as { details?: unknown }).details : undefined;
  const fromBody =
    details && typeof details === "object" && "retryAfterSeconds" in details
      ? (details as { retryAfterSeconds?: unknown }).retryAfterSeconds
      : undefined;
  return typeof fromBody === "number" && Number.isFinite(fromBody) && fromBody > 0 ? Math.ceil(fromBody) : null;
}

/**
 * Map a non-OK JSON response from the route onto the contract's public error
 * codes. The 401 and 429 envelopes are the server's own `jsonError` /
 * `rateLimitJsonResponse` payloads, never provider text; any other status is a
 * generic failure whose body is never surfaced (audit L17).
 */
async function rejectedPayload(request: ClinicalAskRequest, response: Response): Promise<ClinicalAskFinalPayload> {
  if (response.status === 401) return failedPayload(request, "unauthorized");
  if (response.status !== 429) return failedPayload(request, "internal_error");
  const body: unknown = await response.json().catch(() => null);
  const seconds = retryAfterSeconds(response, body);
  const retryAfterMs = seconds ? seconds * 1000 : null;
  // The daily cap cannot clear on Retry, so it is not offered, and the wait is a clock time
  // rather than "Try again in 86400 seconds" (design audit D26-09, D26-10).
  if (rateLimitCode(body) === ANSWER_DAILY_LIMIT_CODE) {
    return failedPayload(request, "rate_limited", answerDailyLimitMessage(retryAfterMs), false);
  }
  return failedPayload(request, "rate_limited", answerBurstLimitMessage(retryAfterMs));
}

function rateLimitCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  if (typeof code === "string") return code;
  const details = (body as { details?: unknown }).details;
  const detailsCode = details && typeof details === "object" ? (details as { code?: unknown }).code : undefined;
  return typeof detailsCode === "string" ? detailsCode : null;
}

export async function streamClinicalAsk(
  request: ClinicalAskRequest,
  signal: AbortSignal,
  onEvent: (event: ClinicalAskStreamEvent) => void,
): Promise<ClinicalAskFinalPayload> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch("/api/clinical-ask/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) return await rejectedPayload(request, response);
    if (!response.body) return failedPayload(request, "internal_error");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let terminal: ClinicalAskFinalPayload | null = null;
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        if (!frame.trim()) continue;
        const event = parseClinicalAskSseFrame(`${frame}\n\n`);
        if (!event) continue;
        if (terminal) throw new Error("Clinical Ask stream sent data after its terminal event.");
        onEvent(event);
        if (event.type === "final") terminal = event.payload;
        if (event.type === "error") {
          terminal = {
            response: {
              state: "failed",
              mode: request.mode,
              code: event.code,
              retryable: event.retryable,
              message: event.message,
            },
            feedback: null,
          };
        }
      }
      if (done) break;
    }
    if (!terminal) throw new Error("Clinical Ask stream ended without a terminal event.");
    return terminal;
  } catch {
    controller.abort();
    return failedPayload(request, signal.aborted ? "aborted" : "internal_error");
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
