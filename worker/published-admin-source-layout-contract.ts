/** Dependency-free DTO seam; supplier validates all values against its runtime schema. */
/** Separate public supplier interface; never impersonates the immutable provenance owner. */
export type PublishedAdminSectionRequest = Readonly<{
  requesterId: string;
  documentId: string;
  publicationApprovalId: string;
  expectedIndexGenerationId: string;
  selectedResults: readonly Readonly<{
    id: string;
    document_id: string;
    content: string;
    section_heading: string | null;
    section_path?: readonly string[];
    parent_heading?: string | null;
    anchor_id?: string | null;
    source_metadata?: unknown;
  }>[];
  signal?: AbortSignal;
}>;
export type PublishedAdminSectionProjection = Readonly<{
  version: "published-admin-text-section-projection-v1";
  provenanceOwnerId: string;
  publication: Readonly<{
    approvalId: string;
    manifestVersion: 2;
    manifestDigest: string;
    reviewedStateDigest: string;
    reviewedIndexGenerationId: string;
    sourceCatalogueKey: "nhmrc";
    sourcePolicyVersion: string;
    approvingOperatorId: string;
    approvedAt: string;
    preparationReceiptSha256: string;
  }>;
  requesterId: string;
  documentId: string;
  indexGenerationId: string;
  original: Readonly<{ sha256: `sha256:${string}`; utf8ByteLength: number; exactUtf8Text: string }>;
  retainedWitness: Readonly<{ artifactId: string; sha256: `sha256:${string}` }>;
  originalUnits: readonly Readonly<{
    sourceUnitId: string;
    kind: "section" | "complementary";
    utf8Start: number;
    utf8EndExclusive: number;
    section_heading: string | null;
    section_path: readonly string[];
    parent_heading: null;
    anchor_id: null;
  }>[];
  rowBindings: readonly Readonly<{ resultId: string; sourceUnitId: string }>[];
}>;
