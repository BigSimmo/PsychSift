export type AustralianEvidenceChangeState = Readonly<{
  change_state?: unknown;
  superseded_by_document_id?: unknown;
}>;

/** The single active-state meaning shared by evidence eligibility and promotion. */
export function hasActiveAustralianChangeState(source: AustralianEvidenceChangeState) {
  const replacement = source.superseded_by_document_id;
  const hasNoReplacement = replacement == null || (typeof replacement === "string" && replacement.trim() === "");
  return (source.change_state === "unchanged" || source.change_state === "changed") && hasNoReplacement;
}
