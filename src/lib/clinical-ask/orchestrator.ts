import { applyClarificationAnswers, clarificationsFor, projectConfirmedContext } from "@/lib/clinical-ask/context";
import type {
  ClinicalAskDependencies,
  ClinicalAskEvidence,
  ClinicalAskProgressEvent,
  ClinicalAskProgressStage,
  ClinicalAskRequest,
  ClinicalAskResponse,
} from "@/lib/clinical-ask/contracts";
import { annotateEvidenceCoverage, assessEvidenceSufficiency } from "@/lib/clinical-ask/evidence-sufficiency";
import { clinicalAskModeProfile } from "@/lib/clinical-ask/mode-profiles";
import { governClinicalAskDraft, publicClinicalAskEvidence } from "@/lib/clinical-ask/response-governance";
import { clinicalAskRequestPatientDetail } from "@/lib/clinical-question-patient-check-server";
import { logger } from "@/lib/logger";
import type { RetrievalAccessScope } from "@/lib/owner-scope";
import { safeErrorLogDetails } from "@/lib/privacy";
import { clinicalAskRequestSchema } from "@/lib/validation/clinical-ask-request";

const DEADLINE_MS = 45_000;

function failed(
  request: Pick<ClinicalAskRequest, "mode">,
  code: Extract<ClinicalAskResponse, { state: "failed" }>["code"],
  message: string,
  retryable = false,
): ClinicalAskResponse {
  return { state: "failed", mode: request.mode, code, retryable, message };
}

function evidenceGap(request: ClinicalAskRequest, evidence: readonly ClinicalAskEvidence[], explanation: string) {
  return {
    state: "evidence_gap" as const,
    mode: request.mode,
    explanation,
    evidence: publicClinicalAskEvidence(evidence),
    missingInformation: ["The requested conclusion is not fully supported by the available evidence."],
    nextActions: ["Review the linked evidence", "Clarify the unsupported details"],
  };
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

async function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortReason(signal);
  let rejectAbort: ((reason?: unknown) => void) | undefined;
  const onAbort = () => rejectAbort?.(abortReason(signal));
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export async function runClinicalAsk(
  request: ClinicalAskRequest,
  accessScope: RetrievalAccessScope,
  dependencies: ClinicalAskDependencies,
  signal: AbortSignal,
  onEvent: (event: ClinicalAskProgressEvent) => void,
): Promise<ClinicalAskResponse> {
  const startedAt = Date.now();
  const deadlineController = new AbortController();
  const deadline = setTimeout(
    () => deadlineController.abort(new DOMException("Clinical Ask exceeded its 45-second deadline.", "TimeoutError")),
    DEADLINE_MS,
  );
  const operationSignal = AbortSignal.any([signal, deadlineController.signal]);
  const evidence: ClinicalAskEvidence[] = [];
  const emit = (stage: ClinicalAskProgressStage) =>
    onEvent({ type: "progress", stage, elapsedMs: Math.max(0, Date.now() - startedAt) });
  const finish = (response: ClinicalAskResponse) => {
    emit("complete");
    return response;
  };
  let retryAvailable = true;
  const retryOnce = async <T>(operation: () => Promise<T>) => {
    try {
      return await withAbort(operation(), operationSignal);
    } catch (error) {
      if (!retryAvailable || operationSignal.aborted) throw error;
      retryAvailable = false;
      return await withAbort(operation(), operationSignal);
    }
  };

  try {
    emit("validating");
    const validated = clinicalAskRequestSchema.safeParse(request);
    if (!validated.success) return finish(failed(request, "invalid_request", "The Clinical Ask request is invalid."));
    const projectedRequest = {
      ...validated.data,
      confirmedContext: applyClarificationAnswers(
        validated.data.mode,
        projectConfirmedContext(validated.data.mode, validated.data.confirmedContext),
        validated.data.clarificationAnswers,
      ),
    };
    // Answer's patient-detail check, before any provider call (audit ARCH-06).
    if (clinicalAskRequestPatientDetail(projectedRequest)) {
      return finish(
        failed(projectedRequest, "identifiable_input_blocked", "Remove identifying details before using Clinical Ask."),
      );
    }

    emit("confirming_context");
    const suggestions = await retryOnce(() => dependencies.suggestContext(projectedRequest, operationSignal));
    const clarifications = clarificationsFor(projectedRequest.mode, projectedRequest.confirmedContext);
    if (clarifications.length > 0) {
      emit("clarifying");
      return finish({
        state: "clarification_required",
        mode: projectedRequest.mode,
        suggestions,
        clarifications,
      });
    }

    emit("catalogue");
    evidence.push(
      ...(await withAbort(dependencies.retrieveCatalogue(projectedRequest, operationSignal), operationSignal)),
    );
    emit("indexed");
    evidence.push(
      ...(await withAbort(
        dependencies.retrieveIndexed(projectedRequest, accessScope, operationSignal),
        operationSignal,
      )),
    );

    const profile = clinicalAskModeProfile(projectedRequest.mode);
    let coverage = annotateEvidenceCoverage(profile, projectedRequest, evidence);
    let sufficiency = assessEvidenceSufficiency({ profile, request: projectedRequest, evidence, coverage });
    if (
      !sufficiency.sufficient &&
      projectedRequest.allowExternalFallback &&
      profile.allowedAuthorityIds.length > 0 &&
      sufficiency.externalFallbackReason
    ) {
      emit("external");
      try {
        const external = await withAbort(
          dependencies.retrieveExternal(projectedRequest, profile.allowedAuthorityIds, operationSignal),
          operationSignal,
        );
        evidence.push(...external);
        coverage = annotateEvidenceCoverage(profile, projectedRequest, evidence);
        sufficiency = assessEvidenceSufficiency({ profile, request: projectedRequest, evidence, coverage });
      } catch (error) {
        if (operationSignal.aborted) throw error;
        // The answer carries on without external evidence; the log is the operator's only signal.
        logger.warn("Clinical Ask external search failed", { mode: request.mode, ...safeErrorLogDetails(error) });
      }
    }

    if (evidence.length === 0) {
      return finish(evidenceGap(projectedRequest, evidence, "No relevant evidence was available."));
    }

    emit("synthesizing");
    let draft;
    try {
      draft = await retryOnce(() => dependencies.synthesize(projectedRequest, evidence, operationSignal));
    } catch (error) {
      if (operationSignal.aborted) throw error;
      logger.warn("Clinical Ask synthesis failed", { mode: request.mode, ...safeErrorLogDetails(error) });
      return finish(
        evidenceGap(projectedRequest, evidence, "Synthesis was unavailable; no uncited answer was produced."),
      );
    }
    emit("governing");
    let governed = governClinicalAskDraft(profile, draft, evidence);
    if (governed.state === "evidence_gap" && retryAvailable) {
      retryAvailable = false;
      try {
        draft = await withAbort(dependencies.synthesize(projectedRequest, evidence, operationSignal), operationSignal);
        governed = governClinicalAskDraft(profile, draft, evidence);
      } catch (error) {
        if (operationSignal.aborted) throw error;
        logger.warn("Clinical Ask synthesis retry failed", { mode: request.mode, ...safeErrorLogDetails(error) });
      }
    }
    return finish(governed);
  } catch (error) {
    if (deadlineController.signal.aborted) {
      return finish(
        evidence.length > 0
          ? evidenceGap(request, evidence, "Clinical Ask reached its deadline; only retrieved evidence is shown.")
          : failed(request, "timeout", "Clinical Ask timed out before an answer was available.", true),
      );
    }
    if (signal.aborted || (error as { name?: string }).name === "AbortError") {
      return finish(failed(request, "aborted", "Clinical Ask was cancelled."));
    }
    // Error name and redacted message only; the question and evidence never reach the log.
    logger.error("Clinical Ask failed", { mode: request.mode, ...safeErrorLogDetails(error) });
    return finish(failed(request, "provider_unavailable", "Clinical Ask is temporarily unavailable.", true));
  } finally {
    clearTimeout(deadline);
  }
}
