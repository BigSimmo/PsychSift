// Extracted utilities for indexing-v3-agent

export const LABEL_STOPWORDS = new Set([
  "about",
  "above",
  "after",
  "again",
  "against",
  "also",
  "and",
  "are",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "can",
  "for",
  "from",
  "has",
  "have",
  "how",
  "into",
  "not",
  "off",
  "onto",
  "other",
  "our",
  "out",
  "over",
  "should",
  "than",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "this",
  "those",
  "under",
  "was",
  "were",
  "when",
  "where",
  "which",
  "while",
  "with",
  "within",
  "without",
]);

export const GENERIC_LABELS = new Set([
  "document",
  "documents",
  "information",
  "guidance",
  "content",
  "summary",
  "section",
  "sections",
  "page",
  "table",
  "figure",
  "clinical",
  "patient",
  "patients",
  "management",
  "treatment",
]);

export function normalizeText(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

export function tokenize(v: string): string[] {
  return Array.from(
    new Set(
      normalizeText(v)
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((x) => x.length > 2),
    ),
  ).slice(0, 40);
}

export function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function generationMetadata(indexGenerationId: string | null): Record<string, string> {
  return indexGenerationId === null ? {} : { index_generation_id: indexGenerationId };
}

export function compactString(value: unknown, limit = 180): string {
  const text = normalizeText(String(value ?? ""));
  return text.length > limit ? text.slice(0, limit).trim() : text;
}

export function uniqueStrings(values: string[], limit = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

export function structuredProfileFromMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return safeRecord(metadata.structured_visual_profile ?? metadata.v3_structured_visual);
}

export function stringArrayFrom(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((entry) => compactString(entry, 180)).filter(Boolean), limit);
}

export function textItemsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    const row = safeRecord(entry);
    return [row.label, row.name, row.parameter, row.value, row.threshold, row.action, row.management, row.source_text]
      .map((part) => compactString(part, 180))
      .filter(Boolean);
  });
}

export function sourceRegionsFromMetadata(metadata: Record<string, unknown>): Array<Record<string, unknown>> {
  const profile = structuredProfileFromMetadata(metadata);
  const regions = Array.isArray(profile.source_regions) ? profile.source_regions.map(safeRecord) : [];
  const metadataRegions = Array.isArray(metadata.source_regions) ? metadata.source_regions.map(safeRecord) : [];
  const directRegion = safeRecord(metadata.source_region);
  const bbox = Array.isArray(metadata.bbox) ? { bbox: metadata.bbox } : {};
  return [
    ...regions,
    ...metadataRegions,
    ...(Object.keys(directRegion).length ? [directRegion] : []),
    ...(Object.keys(bbox).length ? [bbox] : []),
  ].slice(0, 12);
}

export const CLINICAL_PHRASE_PATTERN =
  /\b(?:clozapine|lithium|olanzapine|haloperidol|benzodiazepine|lorazepam|diazepam|antipsychotic|antidepressant|insulin|heparin|warfarin|digoxin|dose|route|threshold|monitoring|observation|escalation|self harm|suicide|violence|agitation|risk matrix|flowchart|care plan|discharge|admission|assessment|screening|contraindication|side effect|adverse effect|fbc|anc|wbc|mmol|mg)\b(?:[\s:/-]+[a-z0-9]{3,}){0,3}/gi;

export function isLowQualityLabel(normalized: string): boolean {
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8) return true;
  if (!/[a-z]/.test(normalized)) return true;
  if (tokens.every((token) => LABEL_STOPWORDS.has(token))) return true;
  if (tokens.length === 1 && (LABEL_STOPWORDS.has(tokens[0]) || GENERIC_LABELS.has(tokens[0]))) return true;
  if (tokens.filter((token) => !LABEL_STOPWORDS.has(token)).length === 0) return true;
  return false;
}

export function phraseLabelCandidates(text: string, limit = 6): string[] {
  const phrases = Array.from(text.matchAll(CLINICAL_PHRASE_PATTERN)).map((match) => match[0]);
  const tokens = normalizeText(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 2 && !LABEL_STOPWORDS.has(token));

  for (let index = 0; index < tokens.length && phrases.length < limit * 2; index += 1) {
    const token = tokens[index];
    if (GENERIC_LABELS.has(token) && !/(risk|dose|monitor|threshold|flowchart|clozapine|lithium|agitation)/.test(token))
      continue;
    const next = tokens[index + 1];
    const third = tokens[index + 2];
    if (next) phrases.push([token, next, third].filter(Boolean).join(" "));
  }

  return uniqueStrings(
    phrases.map((phrase) => normalizeLabel(phrase)).filter((phrase) => !isLowQualityLabel(phrase)),
    limit,
  );
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeLabel(value: string): string {
  const cleaned = normalizeText(
    value
      .toLowerCase()
      .replace(/["'`]|[().,:;!?[\]{}]/g, " ")
      .replace(/\s+/g, " "),
  );
  return cleaned.slice(0, 72).trim();
}

export function normalizeLabelCandidate(rawLabel: string): string | null {
  const normalized = normalizeLabel(rawLabel);
  if (!normalized || normalized.length < 3) return null;
  if (["unknown", "n/a", "na", "tbc", "nil"].includes(normalized)) return null;
  if (isLowQualityLabel(normalized)) return null;
  return normalized;
}

export function canonicalUnitType(unitType: string): string {
  switch (unitType) {
    case "flowchart_step":
    case "diagram_decision":
      return "workflow_step";
    case "table_threshold":
    case "risk_matrix_cell":
      return "threshold";
    case "medication_chart_row":
      return "medication_monitoring";
    case "visual_askable_question":
      return "askable_question";
    case "visual_summary":
    case "chart_finding":
    default:
      return "clinical_fact";
  }
}

export function canonicalFieldType(unitType: string): string {
  switch (unitType) {
    case "flowchart_step":
    case "diagram_decision":
    case "medication_chart_row":
      return "clinical_action";
    case "table_threshold":
    case "risk_matrix_cell":
      return "threshold_fact";
    case "visual_summary":
    case "chart_finding":
    case "visual_askable_question":
    default:
      return "image_caption";
  }
}
