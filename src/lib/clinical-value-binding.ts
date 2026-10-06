export type ClinicalTextSpan = { start: number; end: number };

const clinicalValueBindingPattern =
  /\b(?:at|is|are|equals?|of|monitor\w*|check\w*|dose|range|level|concentration|target|threshold|trough|peak|every|hourly|daily|weekly|fortnightly|monthly|quarterly|annually|yearly)\b/i;
const clinicalValueClauseBoundaryPattern = /[,.;]|\b(?:and|but|whereas|while)\b/i;

/** Whether an entity is explicitly tied to a value inside the same clause. */
export function explicitlyBindsEntityToClinicalValue(
  entity: ClinicalTextSpan,
  value: ClinicalTextSpan,
  evidenceText: string,
) {
  const betweenStart = Math.min(entity.end, value.end);
  const betweenEnd = Math.max(entity.start, value.start);
  const between = evidenceText.slice(betweenStart, betweenEnd);
  if (clinicalValueClauseBoundaryPattern.test(between)) return false;

  const distance = Math.max(0, Math.max(entity.start, value.start) - Math.min(entity.end, value.end));
  const adjacent = (entity.end <= value.start && distance <= 12) || (value.end <= entity.start && distance <= 12);
  return adjacent || clinicalValueBindingPattern.test(between);
}
