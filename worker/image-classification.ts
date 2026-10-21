// Pure image classification helpers for the captioning stage. Moved verbatim from worker/main.ts.
import { createHash } from "node:crypto";
import { env } from "../src/lib/env";
import {
  deterministicStructuredVisualProfile,
  visualIntelligenceVersion,
  type StructuredVisualProfile,
} from "../src/lib/visual-intelligence";
import { assessClinicalImageUse, clinicalImagePolicyVersion } from "../src/lib/image-filtering";
import type { classifyAndCaptionImageFromBase64 } from "../src/lib/openai";
import { redactCaptionIdentifiers } from "../src/lib/privacy";
import type { ExtractedDocument, ImageEvidenceCategory } from "../src/lib/types";
import { cleanString, compactSearchText } from "./ingestion-sanitize";

export function noteSkippedImage(skipReasons: Map<string, number>, reason: string) {
  skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
}

export function redactCaptionMetadataValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactCaptionIdentifiers(cleanString(value));
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactCaptionMetadataValue(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redactCaptionMetadataValue(entry)]),
    );
  }
  return value;
}

export function redactImageClassification<T extends ImageClassification>(classification: T): T {
  return {
    ...classification,
    caption: redactCaptionIdentifiers(cleanString(classification.caption)),
    structured_visual_profile: redactCaptionMetadataValue(
      (classification as ImageClassificationWithVisualProfile).structured_visual_profile,
    ) as ImageClassificationWithVisualProfile["structured_visual_profile"],
  } as T;
}

export type ImageClassification = Awaited<ReturnType<typeof classifyAndCaptionImageFromBase64>>;
export type ImageClassificationWithVisualProfile = ImageClassification & {
  structured_visual_profile?: StructuredVisualProfile;
  structured_extraction_confidence?: number;
};

export const imageEvidenceCategories = new Set<ImageEvidenceCategory>([
  "clinical_table",
  "flowchart_algorithm",
  "form_checklist",
  "risk_matrix",
  "medication_chart",
  "graph",
  "screenshot_ui",
  "photo",
  "logo_decorative",
  "unclear",
]);
export const imageCaptionCacheVersion = "clinical-image-caption-cache-v2";
export const visionClassificationPromptVersion = "clinical-image-classification-v1";

function metadataString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compactMetadataText(value: string | null, limit = 1200) {
  if (!value) return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > limit ? `${compact.slice(0, limit - 3).trim()}...` : compact;
}

export function imageTableMetadata(image: ExtractedDocument["images"][number]) {
  const metadata = image.metadata ?? {};
  const tableText = metadataString(metadata, "table_text");
  const confidence = Number(metadata.table_confidence);
  return {
    candidateType: metadataString(metadata, "candidate_type"),
    tableLabel: metadataString(metadata, "table_label"),
    tableTitle: metadataString(metadata, "table_title"),
    tableRole: metadataString(metadata, "table_role"),
    tableConfidence: Number.isFinite(confidence) ? confidence : null,
    tableText,
    tableTextSnippet: compactMetadataText(tableText),
    accessibleTableMarkdown: metadataString(metadata, "accessible_table_markdown") ?? tableText,
    tableRows: Array.isArray(metadata.table_rows) ? metadata.table_rows : null,
    tableColumns: Array.isArray(metadata.table_columns) ? metadata.table_columns : null,
    tableMergedCells: Array.isArray(metadata.table_merged_cells)
      ? (metadata.table_merged_cells as unknown[]).filter(
          (cell): cell is [number, number] =>
            Array.isArray(cell) && cell.length === 2 && cell.every((value) => Number.isInteger(value)),
        )
      : null,
  };
}

export function captionContextHash(args: {
  image: ExtractedDocument["images"][number];
  tableMetadata: ReturnType<typeof imageTableMetadata>;
  nearbyText?: string | null;
}) {
  const fingerprint = {
    cacheVersion: imageCaptionCacheVersion,
    promptVersion: visionClassificationPromptVersion,
    policyVersion: clinicalImagePolicyVersion,
    visualIntelligenceVersion,
    visionModel: env.OPENAI_VISION_MODEL,
    sourceKind: args.image.sourceKind ?? null,
    width: args.image.width ?? null,
    height: args.image.height ?? null,
    bbox: args.image.bbox ?? null,
    candidateType: args.tableMetadata.candidateType,
    tableLabel: args.tableMetadata.tableLabel,
    tableTitle: args.tableMetadata.tableTitle,
    tableRole: args.tableMetadata.tableRole,
    tableTextSnippet: compactMetadataText(args.tableMetadata.tableText, 900),
    nearbyText: compactSearchText(args.nearbyText ?? "", 900),
  };
  return createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex").slice(0, 32);
}

/**
 * Placeholder classification for an image the vision provider refused (audit L12).
 *
 * The image row is still written â€” with a content-free skip_reason naming the
 * rejection â€” so the document completes and the clinician can see WHICH image
 * was skipped, instead of the whole upload failing with a provider error string.
 */
export function visionRejectedClassification(args: {
  skipReason: string;
  tableMetadata: ReturnType<typeof imageTableMetadata>;
  sourceKind?: string | null;
}) {
  const imageType: ImageEvidenceCategory = args.sourceKind === "table_crop" ? "clinical_table" : "unclear";
  const caption = "Image retained without a caption: the vision provider could not read it.";
  return {
    image_type: imageType,
    caption,
    searchable: false,
    clinical_relevance_score: 0,
    labels: ["needs-review"],
    skip_reason: args.skipReason,
    clinical_use_class: "ambiguous" as const,
    clinical_use_reason: args.skipReason,
    clinical_signal_score: 0,
    admin_signal_score: 0,
    structured_visual_profile: deterministicStructuredVisualProfile({
      imageType,
      caption,
      tableTitle: args.tableMetadata.tableTitle,
      tableLabel: args.tableMetadata.tableLabel,
      tableTextSnippet: args.tableMetadata.tableTextSnippet,
      tableRows: args.tableMetadata.tableRows as string[][] | null,
      tableColumns: args.tableMetadata.tableColumns as string[] | null,
      metadata: {},
    }),
    structured_extraction_confidence: 0,
  } satisfies ImageClassification;
}

export function nonClinicalTableClassification(args: {
  tableMetadata: ReturnType<typeof imageTableMetadata>;
  sourceKind?: string | null;
  imageType?: ImageEvidenceCategory;
}) {
  const assessment = assessClinicalImageUse({
    imageType: args.imageType ?? "clinical_table",
    searchable: true,
    clinicalRelevanceScore: 0.4,
    sourceKind: args.sourceKind,
    tableRole: args.tableMetadata.tableRole,
    tableText: args.tableMetadata.tableText,
    tableTitle: args.tableMetadata.tableTitle,
    tableLabel: args.tableMetadata.tableLabel,
  });
  if (assessment.clinical_use_class === "clinical_evidence" || assessment.clinical_use_class === "ambiguous") {
    return null;
  }
  return {
    image_type: args.imageType ?? ("clinical_table" as const),
    searchable: false,
    clinical_relevance_score: 0,
    labels: [],
    caption:
      assessment.clinical_use_class === "administrative"
        ? "Administrative document-control table retained for audit, not clinical evidence."
        : "Reference table retained for audit, not clinical evidence.",
    skip_reason: assessment.clinical_use_reason,
    clinical_use_class: assessment.clinical_use_class,
    clinical_use_reason: assessment.clinical_use_reason,
    clinical_signal_score: assessment.clinical_signal_score,
    admin_signal_score: assessment.admin_signal_score,
    structured_visual_profile: deterministicStructuredVisualProfile({
      imageType: args.imageType ?? "clinical_table",
      caption:
        assessment.clinical_use_class === "administrative"
          ? "Administrative document-control table retained for audit, not clinical evidence."
          : "Reference table retained for audit, not clinical evidence.",
      tableTitle: args.tableMetadata.tableTitle,
      tableLabel: args.tableMetadata.tableLabel,
      tableTextSnippet: args.tableMetadata.tableTextSnippet,
      tableRows: args.tableMetadata.tableRows as string[][] | null,
      tableColumns: args.tableMetadata.tableColumns as string[] | null,
      metadata: {},
    }),
    structured_extraction_confidence: 0.45,
  } satisfies ImageClassification;
}
