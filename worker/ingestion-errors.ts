// Error shaping shared by the ingestion worker stages. Moved verbatim from worker/main.ts.
import { ProviderEgressDeniedError } from "../src/lib/document-ingress-safety";
import { safeErrorLogDetails } from "../src/lib/privacy";

export type OptionalIndexWriteIssue = {
  stage: string;
  message: string;
  code?: string | null;
};

export function supabaseStageError(
  stage: string,
  error: { message?: string; code?: string; details?: string; hint?: string },
) {
  const wrapped = new Error(`${stage}: ${error.message ?? "Supabase request failed"}`);
  Object.assign(wrapped, {
    code: error.code,
    details: error.details,
    hint: error.hint,
  });
  return wrapped;
}

export function rethrowTerminalProviderError(error: unknown) {
  if (error instanceof ProviderEgressDeniedError || (error instanceof Error && error.name === "AbortError"))
    throw error;
}

export function optionalIndexWriteWarning(stage: string, error: unknown): OptionalIndexWriteIssue {
  const details = safeErrorLogDetails(error);
  console.warn(`Optional ${stage} write failed`, details);
  return {
    stage,
    message: String(details.message ?? "Optional index write failed."),
    code: typeof details.code === "string" ? details.code : null,
  };
}
