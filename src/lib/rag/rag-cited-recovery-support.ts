import type { RagAnswer } from "@/lib/types";

/** Recovery authority must come from the exact cited chunks and documents. */
export function hasCitedRecoverySupport(answer: RagAnswer): boolean {
  const sourceSelection = answer.smartApiPlan?.answerPlan.sourceSelection;
  if (!sourceSelection?.selectedCount || !sourceSelection.requiredSignalsSatisfied) return false;
  if (sourceSelection.missingRequiredSignals.length > 0) return false;

  // Selection-wide signals can belong to an uncited document. Recovery needs
  // evidence from the exact cited chunks, including their document identities.
  const citedSources = answer.sources.filter((source) =>
    answer.citations.some((citation) => citation.chunk_id === source.id && citation.document_id === source.document_id),
  );
  const matchedSignals = citedSources.flatMap((source) =>
    (source.match_explanation?.reasons ?? [])
      .filter((reason) => reason.startsWith("retrieval_signal:"))
      .map((reason) => reason.slice("retrieval_signal:".length)),
  );
  const requiredSignals = answer.smartApiPlan?.answerPlan.retrievalIntent?.requiredTermSignals ?? [];
  if (requiredSignals.some((signal) => !matchedSignals.includes(signal))) return false;
  const hasSpecificSourceSignal = matchedSignals.some(
    (signal) =>
      signal.startsWith("index_unit:") ||
      [
        "document_title",
        "document_title_phrase",
        "document_label",
        "table_fact",
        "source_image",
        "visual_table",
        "direct_relevance",
        "active_community",
        "ed",
        "agitation",
        "dose_amount",
        "route",
        "flowchart_or_pathway",
      ].includes(signal),
  );
  const hasStructuredChunk = matchedSignals.some((signal) =>
    ["table", "flowchart", "medication_chart", "patient_education"].includes(signal),
  );

  return hasSpecificSourceSignal || hasStructuredChunk;
}
