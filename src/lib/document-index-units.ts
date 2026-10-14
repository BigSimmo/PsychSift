import { clinicalVocabularySearchText, clinicalVocabularyTerms } from "@/lib/clinical-vocabulary";
import { firstSourceSpan, type SourceSpan } from "@/lib/source-spans";
import type { ModelIndexProfile, ModelIndexProfileItem, ModelIndexTableFact } from "@/lib/model-index-extraction";
import type { ClinicalDocument, DocumentSectionMemory } from "@/lib/types";
import {
  deterministicStructuredVisualProfile,
  normalizeStructuredVisualProfile,
  visualIntelligenceVersion,
  type StructuredVisualProfile,
} from "@/lib/visual-intelligence";

export const documentIndexUnitVersion = "document-index-units-v1" as const;
export const documentIntelligenceVersion = "document-intelligence-v2" as const;

export type DocumentIndexUnitType =
  | "document_profile"
  | "section_summary"
  | "page_text"
  | "chunk_evidence"
  | "table_fact"
  | "askable_question"
  | "clinical_fact"
  | "threshold"
  | "workflow_step"
  | "medication_monitoring"
  | "alias"
  | "vocabulary_term"
  | "visual_summary"
  | "flowchart_step"
  | "diagram_decision"
  | "risk_matrix_cell"
  | "medication_chart_row"
  | "chart_finding"
  | "visual_askable_question"
  | "table_threshold";

export type DocumentIndexUnitInput = {
  owner_id: string | null;
  document_id: string;
  unit_type: DocumentIndexUnitType;
  source_chunk_id: string | null;
  source_image_id: string | null;
  page_start: number | null;
  page_end: number | null;
  heading_path: string[];
  title: string;
  content: string;
  normalized_terms: string[];
  source_span: SourceSpan | null;
  quality_score: number;
  extraction_mode: "deterministic" | "model_heavy" | "hybrid";
  metadata: Record<string, unknown>;
};

export type IndexUnitChunk = {
  id: string;
  document_id: string;
  page_number: number | null;
  chunk_index: number;
  section_heading: string | null;
  section_path?: string[] | null;
  content: string;
  metadata?: Record<string, unknown> | null;
};

export type IndexUnitVisualImage = {
  id: string;
  caption?: string | null;
  pageNumber: number | null;
  imageType?: string | null;
  sourceKind?: string | null;
  labels?: string[] | null;
  tableLabel?: string | null;
  tableTitle?: string | null;
  tableTextSnippet?: string | null;
  tableRole?: string | null;
  accessibleTableMarkdown?: string | null;
  tableRows?: string[][] | null;
  tableColumns?: string[] | null;
  structuredVisualProfile?: StructuredVisualProfile | null;
  candidatePriorityScore?: number | null;
  imageQualityScore?: number | null;
  cropCompleteness?: number | null;
  ocrTextDensity?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type IndexUnitTableFact = {
  source_chunk_id: string | null;
  source_image_id: string | null;
  page_number: number | null;
  table_title: string | null | undefined;
  row_label: string | null;
  clinical_parameter: string | null | undefined;
  threshold_value: string | null;
  action: string | null;
  metadata?: Record<string, unknown> | null;
};

function compact(value: unknown, limit = 900) {
  const compacted = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compacted) return "";
  return compacted.length <= limit ? compacted : `${compacted.slice(0, limit - 3).trim()}...`;
}

function boundedEditDistance(left: string, right: string, maxDistance: number) {
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMin = current[0]!;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const value = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + substitutionCost,
      );
      current[rightIndex] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[right.length] ?? maxDistance + 1;
}

function referenceDictionary(reference: string) {
  return Array.from(new Set(reference.toLowerCase().match(/[a-z]{6,}/g) ?? []));
}

function bestOcrRepair(fragment: string, dictionary: string[]) {
  const collapsed = fragment.toLowerCase().replace(/[^a-z]/g, "");
  if (collapsed.length < 6) return null;
  let best: { word: string; distance: number } | null = null;
  for (const word of dictionary) {
    const maxDistance = word.length >= 10 ? 2 : 1;
    if (Math.abs(word.length - collapsed.length) > maxDistance) continue;
    const distance = boundedEditDistance(collapsed, word, maxDistance);
    if (distance <= maxDistance && (!best || distance < best.distance)) best = { word, distance };
  }
  return best?.word ?? null;
}

function dropsIsolatedSingleLetterToken(fragment: string, repair: string) {
  const tokens = fragment.match(/\b[A-Za-z]+\b/g) ?? [];
  const repairLower = repair.toLowerCase();
  for (const token of tokens) {
    if (token.length !== 1) continue;
    const letterPattern = new RegExp(`\\b${token}\\b`, "i");
    if (!letterPattern.test(fragment) || letterPattern.test(repairLower)) continue;
    const remainingTokens = fragment
      .replace(letterPattern, "")
      .match(/\b[A-Za-z]+\b/g)
      ?.filter((remaining) => remaining.length > 0);
    if (!remainingTokens?.length) continue;
    if (remainingTokens.every((remaining) => new RegExp(`\\b${remaining}\\b`, "i").test(repairLower))) return true;
  }
  return false;
}

export function repairOcrDropoutAgainstReference(text: string, reference: string) {
  const dictionary = referenceDictionary(reference);
  if (dictionary.length === 0) return { text, replacements: [] as Array<{ from: string; to: string }> };
  const tokenMatches = Array.from(text.matchAll(/[A-Za-z]+/g));
  const replacements: Array<{ from: string; to: string }> = [];
  let repaired = text;

  for (let windowSize = 5; windowSize >= 2; windowSize -= 1) {
    for (let index = tokenMatches.length - windowSize; index >= 0; index -= 1) {
      const window = tokenMatches.slice(index, index + windowSize);
      if (!window.some((match) => match[0].length === 1)) continue;
      const start = window[0]!.index ?? 0;
      const last = window[window.length - 1]!;
      const end = (last.index ?? 0) + last[0].length;
      const fragment = text.slice(start, end);
      if (!/^[A-Za-z]+(?:\s+[A-Za-z]+)+$/.test(fragment)) continue;
      const repair = bestOcrRepair(fragment, dictionary);
      if (!repair || repair === fragment.toLowerCase()) continue;
      if (dropsIsolatedSingleLetterToken(fragment, repair)) continue;
      const currentFragment = repaired.slice(start, end);
      if (currentFragment !== fragment) continue;
      repaired = `${repaired.slice(0, start)}${repair}${repaired.slice(end)}`;
      replacements.push({ from: fragment, to: repair });
    }
  }

  return { text: repaired, replacements };
}

function indexGenerationFromChunk(chunk?: { metadata?: Record<string, unknown> | null } | null) {
  const generation = chunk?.metadata?.index_generation_id;
  return typeof generation === "string" && generation.trim() ? generation.trim() : null;
}

const sentenceBoundary = /(?<=[.!?])\s+|\n+/;
const thresholdPattern =
  /\b(?:threshold|cut[\s-]?off|level|range|score|scale|criteria|criterion|maximum|minimum|baseline|anc|fbc|wbc|neutrophil|withhold|cease|stop|urgent|review|<|>|<=|>=|\d+(?:\.\d+)?\s*(?:mg|mcg|mmol|x\s*10\^?9\/l|%))\b/i;
const medicationMonitoringPattern =
  /\b(?:clozapine|lithium|antipsychotic|benzodiazepine|olanzapine|lorazepam|diazepam|haloperidol|depot|lai|neuroleptic|dose|mg|mcg|route|oral|im\b|po\b|titrate|monitor|fbc|anc|level|toxicity)\b/i;
const workflowPattern =
  /\b(?:workflow|pathway|process|procedure|step|refer|review|document|record|complete|form|responsib\w*|follow[- ]?up|appointment|escalat\w*|urgent|required|must|should)\b/i;

function termsFor(...values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? ""))
        .flatMap((value) => [
          ...value
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((term) => term.length >= 2 && !["the", "and", "for", "with", "from", "that"].includes(term)),
          ...clinicalVocabularyTerms(value, 24),
        ]),
    ),
  ).slice(0, 48);
}

function splitSourceSentences(content: string) {
  return content
    .replace(/\[\[IMAGE_DATA_START\]\][\s\S]*?\[\[IMAGE_DATA_END\]\]/g, " ")
    .split(sentenceBoundary)
    .map((sentence) => compact(sentence, 520))
    .filter((sentence) => sentence.length >= 20);
}

function deterministicTypedCandidates(chunk: IndexUnitChunk) {
  const candidates: Array<{ unit_type: DocumentIndexUnitType; title: string; content: string; score: number }> = [];
  const sentences = splitSourceSentences(chunk.content);
  const add = (unit_type: DocumentIndexUnitType, title: string, content: string, score: number) => {
    if (!content) return;
    if (candidates.some((candidate) => candidate.unit_type === unit_type && candidate.content === content)) return;
    candidates.push({ unit_type, title, content, score });
  };

  for (const sentence of sentences) {
    if (thresholdPattern.test(sentence)) {
      add("threshold", chunk.section_heading || "Threshold", sentence, 0.7);
    }
    if (medicationMonitoringPattern.test(sentence)) {
      add("medication_monitoring", chunk.section_heading || "Medication monitoring", sentence, 0.68);
    }
    if (workflowPattern.test(sentence)) {
      add("workflow_step", chunk.section_heading || "Workflow step", sentence, 0.64);
    }
    if (candidates.length >= 6) break;
  }

  return candidates.slice(0, 4);
}

function unitTypeForClinicalItem(item: ModelIndexProfileItem): DocumentIndexUnitType {
  const text = `${item.title} ${item.content}`;
  if (thresholdPattern.test(text)) return "threshold";
  if (medicationMonitoringPattern.test(text)) return "medication_monitoring";
  if (workflowPattern.test(text)) return "workflow_step";
  return "clinical_fact";
}

function firstChunk(chunks: IndexUnitChunk[], chunkIds: string[] = []) {
  if (chunkIds.length) {
    const direct = chunks.find((chunk) => chunkIds.includes(chunk.id));
    if (direct) return direct;
  }
  return chunks[0] ?? null;
}

function pageRange(chunks: IndexUnitChunk[]) {
  const pages = chunks.map((chunk) => chunk.page_number).filter((page): page is number => Boolean(page));
  return {
    page_start: pages.length ? Math.min(...pages) : null,
    page_end: pages.length ? Math.max(...pages) : null,
  };
}

function visualProfileForImage(image: IndexUnitVisualImage) {
  const sourceRegion =
    image.metadata && typeof image.metadata.bbox === "object" && image.metadata.bbox !== null
      ? (image.metadata.bbox as Record<string, unknown>)
      : null;
  if (image.structuredVisualProfile)
    return normalizeStructuredVisualProfile(image.structuredVisualProfile, {
      sourceImageId: image.id,
      pageNumber: image.pageNumber,
      sourceRegion,
    });
  return deterministicStructuredVisualProfile({
    imageType: image.imageType,
    caption: image.caption,
    tableTitle: image.tableTitle,
    tableLabel: image.tableLabel,
    tableTextSnippet: image.tableTextSnippet,
    tableRows: image.tableRows,
    tableColumns: image.tableColumns,
    metadata: image.metadata,
    sourceImageId: image.id,
    pageNumber: image.pageNumber,
    sourceRegion,
  });
}

function visualFamilyKey(image: IndexUnitVisualImage) {
  const metadata = image.metadata ?? {};
  const family =
    metadata.visual_family_id ?? metadata.visual_duplicate_group ?? metadata.perceptual_hash ?? metadata.image_hash;
  return typeof family === "string" && family.trim() ? family.trim() : image.id;
}

function visualRepresentativeScore(image: IndexUnitVisualImage) {
  const profileConfidence = Number(
    image.structuredVisualProfile?.confidence ?? image.metadata?.structured_extraction_confidence ?? 0.55,
  );
  const priority = Number(image.candidatePriorityScore ?? image.metadata?.candidate_priority_score ?? 0.55);
  const quality = Number(image.imageQualityScore ?? image.metadata?.image_quality_score ?? 0.55);
  const density = Number(image.ocrTextDensity ?? image.metadata?.ocr_text_density ?? 0);
  return priority * 0.42 + quality * 0.28 + profileConfidence * 0.22 + density * 0.08;
}

function representativeVisualImages(images: IndexUnitVisualImage[]) {
  const bestByFamily = new Map<string, IndexUnitVisualImage>();
  for (const image of images) {
    const familyKey = visualFamilyKey(image);
    const existing = bestByFamily.get(familyKey);
    if (!existing || visualRepresentativeScore(image) > visualRepresentativeScore(existing)) {
      bestByFamily.set(familyKey, image);
    }
  }
  return [...bestByFamily.values()].sort(
    (left, right) => visualRepresentativeScore(right) - visualRepresentativeScore(left),
  );
}

function sourceChunkForImage(image: IndexUnitVisualImage, chunks: IndexUnitChunk[]) {
  const linked = chunks.find(
    (chunk) =>
      Array.isArray((chunk as { image_ids?: string[] }).image_ids) &&
      (chunk as { image_ids?: string[] }).image_ids?.includes(image.id),
  );
  if (linked) return linked;
  return chunks.find((chunk) => image.pageNumber !== null && chunk.page_number === image.pageNumber) ?? null;
}

function visualTitle(image: IndexUnitVisualImage) {
  return (
    image.tableTitle || image.tableLabel || image.caption || `Visual evidence page ${image.pageNumber ?? "unknown"}`
  );
}

function visualSearchableText(image: IndexUnitVisualImage, profile: StructuredVisualProfile, title: string) {
  return [
    title,
    image.imageType,
    image.sourceKind,
    image.caption,
    image.tableTitle,
    image.tableLabel,
    image.tableTextSnippet,
    profile.clinical_purpose,
    profile.key_terms.join(" "),
    (image.tableRows ?? []).map((row) => row.join(" | ")).join(" "),
    (image.tableColumns ?? []).join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

type NeutralNativeTableRow = { fact: IndexUnitTableFact; columns: string[]; cells: string[]; rowIndex: number };

function neutralNativeTableRows(
  image: IndexUnitVisualImage,
  facts: IndexUnitTableFact[],
  chunks: IndexUnitChunk[],
  documentId: string,
): NeutralNativeTableRow[] | null {
  // This checks the existing Python descriptor/host adapter shape, not authenticated
  // producer identity. Supplied profiles and other extraction methods keep their path.
  const metadata = image.metadata;
  const columns = image.tableColumns;
  const rows = image.tableRows;
  if (
    image.structuredVisualProfile ||
    image.sourceKind !== "table_crop" ||
    metadata?.source_kind !== "table_crop" ||
    metadata.candidate_type !== "table" ||
    metadata.extraction_method !== "pymupdf_find_tables" ||
    !Number.isInteger(image.pageNumber) ||
    (image.pageNumber ?? 0) < 1 ||
    Boolean(image.caption?.trim() || image.tableTitle?.trim() || image.tableLabel?.trim() || image.imageType) ||
    ![undefined, null, "unclear"].includes(image.tableRole) ||
    ![undefined, null, "unclear"].includes(metadata.table_role as string | null | undefined) ||
    metadata.pageNumber !== image.pageNumber ||
    metadata.rows_truncated !== false ||
    !Number.isInteger(metadata.table_index) ||
    Number(metadata.table_index) < 1 ||
    !Array.isArray(columns) ||
    !columns.length ||
    !columns.every((column) => typeof column === "string" && column.trim().length > 0) ||
    !Array.isArray(rows) ||
    rows.length < 2 ||
    !rows.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === "string")) ||
    metadata.column_count !== columns.length ||
    metadata.row_count !== rows.length ||
    JSON.stringify(metadata.table_columns) !== JSON.stringify(columns) ||
    JSON.stringify(metadata.table_rows) !== JSON.stringify(rows) ||
    JSON.stringify(rows[0]) !== JSON.stringify(columns) ||
    facts.length !== rows.length - 1
  )
    return null;
  // This first neutral representation accepts only the independently declared
  // column schema. Unknown or explicit clinical schemas keep their existing path;
  // absence from a blacklist cannot establish neutral clinical meaning.
  const neutralColumns = ["Scenario", "Concentration", "Amount", "Volume", "Interval"];
  if (JSON.stringify(columns) !== JSON.stringify(neutralColumns)) return null;
  const sourceChunk = sourceChunkForImage(image, chunks);
  if (
    !sourceChunk ||
    sourceChunk.document_id !== documentId ||
    sourceChunk.page_number !== image.pageNumber ||
    !(sourceChunk as IndexUnitChunk & { image_ids?: string[] }).image_ids?.includes(image.id)
  )
    return null;
  const result: NeutralNativeTableRow[] = [];
  for (const [index, cells] of rows.slice(1).entries()) {
    const fact = facts[index];
    const roles = fact.metadata?.table_column_roles;
    if (
      cells.length !== columns.length ||
      !cells.every((cell) => typeof cell === "string") ||
      fact.source_image_id !== image.id ||
      fact.source_chunk_id !== sourceChunk.id ||
      fact.page_number !== image.pageNumber ||
      fact.threshold_value !== null ||
      fact.action !== null ||
      fact.row_label !== cells[0] ||
      fact.clinical_parameter !== cells[0] ||
      (fact.table_title ?? null) !== (image.tableTitle ?? image.tableLabel ?? null) ||
      fact.metadata?.row_index !== index + 1 ||
      JSON.stringify(fact.metadata?.columns) !== JSON.stringify(columns) ||
      JSON.stringify(fact.metadata?.cells) !== JSON.stringify(cells) ||
      ![undefined, null, "unclear"].includes(fact.metadata?.table_role as string | null | undefined) ||
      (roles !== null &&
        roles !== undefined &&
        (typeof roles !== "object" || Array.isArray(roles) || Object.keys(roles).length !== 0))
    )
      return null;
    result.push({ fact, columns, cells, rowIndex: index + 1 });
  }
  return result;
}

function fallbackVisualUnitType(
  image: IndexUnitVisualImage,
  profile: StructuredVisualProfile,
  text: string,
): DocumentIndexUnitType {
  // Audit M4: bare "yes"/"no" are common TABLE cell values ("No further
  // action", a Yes/No column), so they only count as flowchart evidence when
  // the image is not structurally a table (table_crop / extracted rows).
  // Specific flowchart terms still win outright.
  const structuralTable = image.sourceKind === "table_crop" || (image.tableRows?.length ?? 0) > 0;
  if (/\b(?:flow\s*chart|flowchart|algorithm|decision|next step|pathway)\b/i.test(text)) return "flowchart_step";
  if (!structuralTable && /\b(?:yes|no)\b/i.test(text)) return "flowchart_step";
  if (/\b(?:risk matrix|red zone|likelihood|consequence|high risk|visual alert)\b/i.test(text))
    return "risk_matrix_cell";
  if (
    /\b(?:medication|medicine|dose|dosage|mg|mcg|microgram|route|oral|intramuscular|\bim\b|\bpo\b|frequency)\b/i.test(
      text,
    ) ||
    image.imageType === "medication_chart"
  )
    return "medication_chart_row";
  if (thresholdPattern.test(text) || image.sourceKind === "table_crop" || (image.tableRows?.length ?? 0) > 0)
    return "table_threshold";
  if (profile.actions.length || profile.monitoring_items.length) return "flowchart_step";
  return "visual_summary";
}

function visualQuality(image: IndexUnitVisualImage, profile: StructuredVisualProfile) {
  const imageQuality = Number(image.imageQualityScore ?? image.metadata?.image_quality_score ?? 0.62);
  const extraction = Number(image.metadata?.structured_extraction_confidence ?? profile.confidence);
  const priority = Number(image.candidatePriorityScore ?? image.metadata?.candidate_priority_score ?? 0.6);
  const score = imageQuality * 0.28 + extraction * 0.42 + priority * 0.3;
  return Math.max(0.35, Math.min(1, Number(score.toFixed(3))));
}

function visualUnit(args: {
  document: Pick<ClinicalDocument, "id" | "owner_id" | "title" | "file_name">;
  image: IndexUnitVisualImage;
  chunks: IndexUnitChunk[];
  unit_type: DocumentIndexUnitType;
  title: string;
  content: string;
  profile: StructuredVisualProfile;
  metadata?: Record<string, unknown>;
  quality_score?: number;
}) {
  const sourceChunk = sourceChunkForImage(args.image, args.chunks);
  const metadata = args.image.metadata ?? {};
  const sourceRegion =
    metadata.bbox && typeof metadata.bbox === "object" && !Array.isArray(metadata.bbox)
      ? (metadata.bbox as Record<string, unknown>)
      : null;
  return buildUnit({
    document: args.document,
    unit_type: args.unit_type,
    sourceChunk,
    source_image_id: args.image.id,
    page_start: args.image.pageNumber,
    page_end: args.image.pageNumber,
    title: args.title,
    content: args.content,
    quality_score: args.quality_score ?? visualQuality(args.image, args.profile),
    extraction_mode: args.profile.confidence >= 0.65 ? "hybrid" : "deterministic",
    metadata: {
      source: "visual_intelligence",
      generated_by: "local-worker",
      visual_intelligence_version: visualIntelligenceVersion,
      image_type: args.image.imageType ?? null,
      source_kind: args.image.sourceKind ?? null,
      table_title: args.image.tableTitle ?? null,
      table_label: args.image.tableLabel ?? null,
      source_image_id: args.image.id,
      page_number: args.image.pageNumber,
      source_region: sourceRegion,
      visual_family_id: metadata.visual_family_id ?? visualFamilyKey(args.image),
      visual_duplicate_group:
        metadata.visual_duplicate_group ?? metadata.perceptual_hash ?? metadata.image_hash ?? null,
      structured_extraction_confidence: args.profile.confidence,
      image_quality_score: args.image.imageQualityScore ?? args.image.metadata?.image_quality_score ?? null,
      candidate_priority_score:
        args.image.candidatePriorityScore ?? args.image.metadata?.candidate_priority_score ?? null,
      ...args.metadata,
    },
  });
}

export function buildVisualDocumentIndexUnitInputs(args: {
  document: Pick<ClinicalDocument, "id" | "owner_id" | "title" | "file_name">;
  chunks: IndexUnitChunk[];
  images: IndexUnitVisualImage[];
  tableFacts?: IndexUnitTableFact[];
}) {
  const units: DocumentIndexUnitInput[] = [];
  const add = (unit: DocumentIndexUnitInput | null) => {
    if (unit) units.push(unit);
  };
  const factsByImage = new Map<string, IndexUnitTableFact[]>();
  for (const fact of args.tableFacts ?? []) {
    if (!fact.source_image_id) continue;
    factsByImage.set(fact.source_image_id, [...(factsByImage.get(fact.source_image_id) ?? []), fact]);
  }

  for (const image of representativeVisualImages(args.images)) {
    const linkedFacts = factsByImage.get(image.id) ?? [];
    const neutralRows = neutralNativeTableRows(image, linkedFacts, args.chunks, args.document.id);
    const profile = visualProfileForImage(image);
    const title = visualTitle(image);
    const summaryContent = [
      profile.clinical_purpose,
      image.caption,
      image.tableTextSnippet ? `Visible table text: ${image.tableTextSnippet}` : "",
      profile.key_terms.length ? `Key terms: ${profile.key_terms.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    add(
      visualUnit({
        document: args.document,
        image,
        chunks: args.chunks,
        unit_type: "visual_summary",
        title,
        content: summaryContent,
        profile,
      }),
    );
    add(
      visualUnit({
        document: args.document,
        image,
        chunks: args.chunks,
        unit_type: "visual_askable_question",
        title: `Show source image for ${title}`,
        content: `Can show the source image/table for ${title}. ${summaryContent}`,
        profile,
        quality_score: Math.max(0.58, visualQuality(image, profile) - 0.04),
      }),
    );

    const hasTypedProfileEvidence =
      profile.thresholds.length +
        profile.flowchart_nodes.length +
        profile.flowchart_edges.length +
        profile.risk_matrix_cells.length +
        profile.chart_findings.length >
      0;
    const hasLinkedTableFacts = (factsByImage.get(image.id) ?? []).length > 0;
    const shouldCreateSparseVisualFallback =
      !hasLinkedTableFacts && (!hasTypedProfileEvidence || image.imageType === "medication_chart");
    if (shouldCreateSparseVisualFallback) {
      const fallbackText = visualSearchableText(image, profile, title);
      const fallbackType = fallbackVisualUnitType(image, profile, fallbackText);
      if (fallbackType !== "visual_summary" && fallbackText.trim()) {
        add(
          visualUnit({
            document: args.document,
            image,
            chunks: args.chunks,
            unit_type: fallbackType,
            title:
              fallbackType === "medication_chart_row"
                ? `Medication chart evidence: ${title}`
                : fallbackType === "risk_matrix_cell"
                  ? `Risk matrix evidence: ${title}`
                  : fallbackType === "flowchart_step"
                    ? `Flowchart evidence: ${title}`
                    : `Table threshold evidence: ${title}`,
            content: compact(fallbackText, 900),
            profile,
            quality_score: Math.max(0.56, visualQuality(image, profile) - 0.06),
            metadata: { visual_item_type: "sparse_visual_fallback" },
          }),
        );
      }
    }

    for (const threshold of neutralRows ? [] : profile.thresholds) {
      add(
        visualUnit({
          document: args.document,
          image,
          chunks: args.chunks,
          unit_type: "table_threshold",
          title: threshold.label,
          content: [title, threshold.label, threshold.value, threshold.action, threshold.source_text]
            .filter(Boolean)
            .join(" | "),
          profile,
          quality_score: threshold.confidence,
          metadata: { visual_item_type: "threshold", threshold },
        }),
      );
    }

    for (const fact of linkedFacts) {
      const neutralRow = neutralRows?.find((row) => row.fact === fact);
      if (neutralRow) {
        add(
          visualUnit({
            document: args.document,
            image,
            chunks: args.chunks,
            unit_type: "table_fact",
            title: fact.row_label || fact.clinical_parameter || fact.table_title || title,
            content: neutralRow.columns.map((column, index) => `${column}: ${neutralRow.cells[index]}`).join(" | "),
            profile,
            metadata: {
              visual_item_type: "table_fact",
              table_fact_metadata: fact.metadata,
              columns: neutralRow.columns,
              cells: neutralRow.cells,
              row_index: neutralRow.rowIndex,
              named_cells: neutralRow.columns.map((column, index) => ({ column, cell: neutralRow.cells[index] })),
              threshold_value: null,
              action: null,
              native_table_descriptor: image.metadata,
              source_qualification: "derived_unverified",
            },
          }),
        );
        continue;
      }
      const factText = [fact.table_title, fact.row_label, fact.clinical_parameter, fact.threshold_value, fact.action]
        .filter(Boolean)
        .join(" | ");
      add(
        visualUnit({
          document: args.document,
          image,
          chunks: args.chunks,
          unit_type: /(?:dose|route|frequency|mg|mcg|\bim\b|\bpo\b)/i.test(factText)
            ? "medication_chart_row"
            : "table_threshold",
          title: fact.row_label || fact.clinical_parameter || fact.table_title || title,
          content: factText,
          profile,
          quality_score: Math.max(0.62, visualQuality(image, profile)),
          metadata: { visual_item_type: "table_fact", table_fact_metadata: fact.metadata ?? null },
        }),
      );
    }

    for (const [index, node] of profile.flowchart_nodes.entries()) {
      add(
        visualUnit({
          document: args.document,
          image,
          chunks: args.chunks,
          unit_type: /decision|choice|yes|no/i.test(node.type ?? node.label) ? "diagram_decision" : "flowchart_step",
          title: node.label,
          content: `${title} flowchart step ${index + 1}: ${node.label}`,
          profile,
          metadata: { visual_item_type: "flowchart_node", node },
        }),
      );
    }
    for (const edge of profile.flowchart_edges) {
      add(
        visualUnit({
          document: args.document,
          image,
          chunks: args.chunks,
          unit_type: "diagram_decision",
          title: edge.label || `${edge.from} to ${edge.to}`,
          content: `${title} decision path: ${edge.from} -> ${edge.to}${edge.label ? ` when ${edge.label}` : ""}`,
          profile,
          metadata: { visual_item_type: "flowchart_edge", edge },
        }),
      );
    }
    for (const cell of profile.risk_matrix_cells) {
      add(
        visualUnit({
          document: args.document,
          image,
          chunks: args.chunks,
          unit_type: "risk_matrix_cell",
          title: `${cell.row} / ${cell.column}: ${cell.risk}`,
          content: [title, cell.row, cell.column, cell.risk, cell.action].filter(Boolean).join(" | "),
          profile,
          quality_score: cell.confidence,
          metadata: { visual_item_type: "risk_matrix_cell", cell },
        }),
      );
    }
    for (const finding of profile.chart_findings) {
      add(
        visualUnit({
          document: args.document,
          image,
          chunks: args.chunks,
          unit_type: "chart_finding",
          title: finding.label,
          content: [title, finding.label, finding.value, finding.interpretation].filter(Boolean).join(" | "),
          profile,
          quality_score: finding.confidence,
          metadata: { visual_item_type: "chart_finding", finding, chart_axes: profile.chart_axes },
        }),
      );
    }
  }

  const seen = new Set<string>();
  return units.filter((unit) => {
    const key = `${unit.unit_type}:${unit.source_image_id}:${unit.title.toLowerCase()}:${unit.content.toLowerCase().slice(0, 160)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildUnit(args: {
  document: Pick<ClinicalDocument, "id" | "owner_id" | "title" | "file_name">;
  unit_type: DocumentIndexUnitType;
  sourceChunk: IndexUnitChunk | null;
  source_image_id?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  heading_path?: string[];
  title: string;
  content: string;
  source_span?: SourceSpan | null;
  quality_score?: number;
  extraction_mode: DocumentIndexUnitInput["extraction_mode"];
  metadata?: Record<string, unknown>;
}): DocumentIndexUnitInput | null {
  const title = compact(args.title, 160);
  const ocrRepair = args.sourceChunk?.content
    ? repairOcrDropoutAgainstReference(args.content, args.sourceChunk.content)
    : { text: args.content, replacements: [] as Array<{ from: string; to: string }> };
  const content = compact(clinicalVocabularySearchText(ocrRepair.text), 1400);
  if (!title || !content) return null;
  return {
    owner_id: args.document.owner_id ?? null,
    document_id: args.document.id,
    unit_type: args.unit_type,
    source_chunk_id: args.sourceChunk?.id ?? null,
    source_image_id: args.source_image_id ?? null,
    page_start: args.page_start ?? args.sourceChunk?.page_number ?? null,
    page_end: args.page_end ?? args.sourceChunk?.page_number ?? null,
    heading_path: args.heading_path ?? args.sourceChunk?.section_path ?? [],
    title,
    content,
    normalized_terms: termsFor(args.document.title, args.document.file_name, title, content),
    source_span: args.source_span ?? firstSourceSpan(args.sourceChunk?.metadata),
    quality_score: Math.max(0, Math.min(1, args.quality_score ?? 0.7)),
    extraction_mode: args.extraction_mode,
    metadata: {
      document_index_unit_version: documentIndexUnitVersion,
      document_intelligence_version: documentIntelligenceVersion,
      index_generation_id: indexGenerationFromChunk(args.sourceChunk),
      chunk_index: args.sourceChunk?.chunk_index ?? null,
      section_heading: args.sourceChunk?.section_heading ?? null,
      ...(ocrRepair.replacements.length
        ? {
            ocr_repair_version: "clean-chunk-fragment-v1",
            ocr_replacements: ocrRepair.replacements.slice(0, 8),
          }
        : {}),
      ...args.metadata,
    },
  };
}

function itemUnit(args: {
  document: Pick<ClinicalDocument, "id" | "owner_id" | "title" | "file_name">;
  chunks: IndexUnitChunk[];
  item: ModelIndexProfileItem;
  unit_type: DocumentIndexUnitType;
  metadata?: Record<string, unknown>;
}) {
  const sourceChunk = firstChunk(args.chunks, args.item.source_chunk_ids);
  return buildUnit({
    document: args.document,
    unit_type: args.unit_type,
    sourceChunk,
    source_image_id: args.item.source_image_ids[0] ?? null,
    title: args.item.title,
    content: args.item.content,
    quality_score: args.item.confidence,
    extraction_mode: "model_heavy",
    metadata: {
      source_chunk_ids: args.item.source_chunk_ids,
      source_image_ids: args.item.source_image_ids,
      ...args.metadata,
    },
  });
}

function tableUnit(args: {
  document: Pick<ClinicalDocument, "id" | "owner_id" | "title" | "file_name">;
  chunks: IndexUnitChunk[];
  item: ModelIndexTableFact;
}) {
  const sourceChunk = firstChunk(args.chunks, args.item.source_chunk_ids);
  return buildUnit({
    document: args.document,
    unit_type: "table_fact",
    sourceChunk,
    source_image_id: args.item.source_image_ids[0] ?? null,
    title: args.item.table_title || args.item.title,
    content: [
      args.item.table_title,
      args.item.clinical_parameter,
      args.item.threshold_value,
      args.item.action,
      args.item.content,
    ]
      .filter(Boolean)
      .join(" | "),
    quality_score: args.item.confidence,
    extraction_mode: "model_heavy",
    metadata: {
      source: "model_index_profile",
      source_chunk_ids: args.item.source_chunk_ids,
      source_image_ids: args.item.source_image_ids,
      table_title: args.item.table_title,
      clinical_parameter: args.item.clinical_parameter,
      threshold_value: args.item.threshold_value,
      action: args.item.action,
    },
  });
}

export function buildDocumentIndexUnitInputs(args: {
  document: Pick<ClinicalDocument, "id" | "owner_id" | "title" | "file_name">;
  chunks: IndexUnitChunk[];
  sections?: Array<Omit<DocumentSectionMemory, "id" | "created_at" | "updated_at">>;
  modelProfile?: ModelIndexProfile | null;
  summary?: string | null;
  images?: IndexUnitVisualImage[];
  tableFacts?: IndexUnitTableFact[];
}) {
  const units: DocumentIndexUnitInput[] = [];
  const add = (unit: DocumentIndexUnitInput | null) => {
    if (unit) units.push(unit);
  };

  const first = firstChunk(args.chunks);
  add(
    buildUnit({
      document: args.document,
      unit_type: "document_profile",
      sourceChunk: first,
      page_start: pageRange(args.chunks).page_start,
      page_end: pageRange(args.chunks).page_end,
      title: args.document.title,
      content: [args.document.title, args.document.file_name, args.summary].filter(Boolean).join(" | "),
      quality_score: 0.72,
      extraction_mode: args.modelProfile ? "hybrid" : "deterministic",
      metadata: { source: "document_profile", model_profile_version: args.modelProfile?.version ?? null },
    }),
  );

  for (const section of args.sections ?? []) {
    const sourceChunk = firstChunk(args.chunks, section.chunk_ids);
    add(
      buildUnit({
        document: args.document,
        unit_type: "section_summary",
        sourceChunk,
        page_start: section.page_start,
        page_end: section.page_end,
        heading_path: section.heading_path,
        title: section.heading,
        content: section.summary,
        quality_score:
          section.extraction_quality === "good" ? 0.78 : section.extraction_quality === "partial" ? 0.58 : 0.42,
        extraction_mode: "hybrid",
        metadata: { source: "document_sections", chunk_ids: section.chunk_ids, tags: section.tags },
      }),
    );
  }

  for (const chunk of args.chunks) {
    add(
      buildUnit({
        document: args.document,
        unit_type: "chunk_evidence",
        sourceChunk: chunk,
        title: chunk.section_heading || `Page ${chunk.page_number ?? "unknown"} chunk ${chunk.chunk_index}`,
        content: chunk.content,
        quality_score: 0.62,
        extraction_mode: "deterministic",
        metadata: { source: "document_chunks" },
      }),
    );

    for (const candidate of deterministicTypedCandidates(chunk)) {
      add(
        buildUnit({
          document: args.document,
          unit_type: candidate.unit_type,
          sourceChunk: chunk,
          title: candidate.title,
          content: candidate.content,
          quality_score: candidate.score,
          extraction_mode: "deterministic",
          metadata: {
            source: "deterministic_chunk_signal",
            typed_signal: candidate.unit_type,
          },
        }),
      );
    }
  }

  for (const item of args.modelProfile?.sections ?? []) {
    add(
      itemUnit({
        document: args.document,
        chunks: args.chunks,
        item,
        unit_type: "section_summary",
        metadata: { source: "model_sections" },
      }),
    );
  }
  for (const item of args.modelProfile?.askable_questions ?? []) {
    add(
      itemUnit({
        document: args.document,
        chunks: args.chunks,
        item,
        unit_type: "askable_question",
        metadata: { source: "model_askable_questions" },
      }),
    );
  }
  for (const item of args.modelProfile?.clinical_facts ?? []) {
    add(
      itemUnit({
        document: args.document,
        chunks: args.chunks,
        item,
        unit_type: unitTypeForClinicalItem(item),
        metadata: { source: "model_clinical_facts", original_unit_type: "clinical_fact" },
      }),
    );
  }
  for (const item of args.modelProfile?.table_facts ?? []) {
    add(tableUnit({ document: args.document, chunks: args.chunks, item }));
  }
  for (const alias of args.modelProfile?.aliases ?? []) {
    const sourceChunk = firstChunk(args.chunks, alias.source_chunk_ids);
    add(
      buildUnit({
        document: args.document,
        unit_type: "alias",
        sourceChunk,
        title: alias.canonical,
        content: `${alias.alias} means ${alias.canonical}`,
        quality_score: alias.confidence,
        extraction_mode: "model_heavy",
        metadata: {
          source: "model_aliases",
          alias: alias.alias,
          canonical: alias.canonical,
          alias_type: alias.alias_type,
          source_chunk_ids: alias.source_chunk_ids,
        },
      }),
    );
  }

  for (const unit of buildVisualDocumentIndexUnitInputs({
    document: args.document,
    chunks: args.chunks,
    images: args.images ?? [],
    tableFacts: args.tableFacts ?? [],
  })) {
    add(unit);
  }

  const seen = new Set<string>();
  return units.filter((unit) => {
    const key = `${unit.unit_type}:${unit.source_chunk_id ?? ""}:${unit.title.toLowerCase()}:${unit.content.toLowerCase().slice(0, 180)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function countDocumentIndexUnitsByType(units: Array<Pick<DocumentIndexUnitInput, "unit_type">>) {
  return units.reduce<Record<string, number>>((counts, unit) => {
    counts[unit.unit_type] = (counts[unit.unit_type] ?? 0) + 1;
    return counts;
  }, {});
}

export function embeddingTextForDocumentIndexUnit(unit: DocumentIndexUnitInput) {
  return [
    `Type: ${unit.unit_type}`,
    `Title: ${unit.title}`,
    unit.heading_path.length ? `Path: ${unit.heading_path.join(" > ")}` : "",
    `Content: ${unit.content}`,
    unit.normalized_terms.length ? `Terms: ${unit.normalized_terms.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
