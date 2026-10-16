/** Pure, fail-closed preparation for the admitted four-page PDF cohort.
 *
 * This module deliberately does not call an RPC or assert terminal readiness. The server must
 * independently recompute these checks against its registered profile and immutable row store.
 */
import { createHash } from "node:crypto";
import { parseIngestionFence, type IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import type { WholeOriginalProducerManifest } from "./whole-original-supplier";
import type {
  decodeManagedNativeParentClosureReadback,
  preflightManagedNativeParentClosure,
} from "./managed-native-parent-closure";

const SOURCE = "sha256:abbc8107a09582e18f36bf4905c75f1fc78af70cd516851b89bff8919ca5bece";
const EXPECTATION = "sha256:8fe858fddf8d36bee746d66fb8ed85ef0a0ecd6e9b4975e085c5d93be635acb0";
const WITNESS = "sha256:0f96a882972cc3898cd0428efa2b648eae777e0158f2d23682efe5e4514c14b8";
const FROZEN = "sha256:119422cdb8fa98821bec9bdec738685300213f24ef2264c5edea43346c32cfcf";
const SOURCE_ASSESSMENT = "sha256:186a990428afaf846d308715312ffdcab4da89b0c786e5d20928156d70419d86";
const REVIEW = "sha256:e5ccaa420a246eadc33842153a28fd97e8d25af90648792fa3a30d684ecb6137";
const REPORT = "sha256:6cee827920bce16995b5768b7926242c1525c00400587d80753d568798f2de5c";
const PROFILE = "nhmrc-ds14-four-page-native-pilot-v1";
const PAGE_MAP = [9, 10, 11, 62];
const PRINTED_MAP = ["4", "5", "6", "57"];
const REQUIRED_FAMILIES = ["chunks", "images"];
const OPTIONAL_FAMILIES = ["table_facts", "embedding_fields", "index_units"];
const SHA = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Identity = {
  documentId: string;
  generationId: string;
  jobId: string;
  ownerId: string;
  workerId: string;
  firstLeaseToken: string;
  attemptNumber: number;
  batchId: string | null;
  authorityDigest: string;
  predecessorGenerationId: string | null;
  sourceSha256: string;
  sourceByteLength: number;
  sourceExpectationDigest: string;
};
type Row = {
  family: string;
  rowId: string;
  row: Record<string, unknown>;
  receipt: { bytesHex: string; sha256: string; byteLength: number };
};
type Span = { rowId: string; contentStart: number; contentEnd: number; referenceStart: number; referenceEnd: number };
type Page = {
  pilotPage: number;
  parentPhysicalPage: number;
  parentPrintedPage: string;
  normalizationRule: "exact-current-accepted-report-bytes-v1";
  segments: Span[];
};
type Role = { family: "chunks" | "images"; requirementId: string; sourceEvidenceIds: string[]; rowIds: string[] };
type Visual = { rowId: string; binary: Uint8Array; provenance: Uint8Array; comparison: Uint8Array };
type Admission = {
  record: Uint8Array;
  sourceSha256: string;
  documentId: string;
  ownerId: string;
  generationId: string;
};
type Enrichment = {
  family: string;
  groupKey: string;
  state: "persisted" | "prepared_only" | "deferred" | "failed" | "unavailable";
  producerManifestDigest: string | null;
  expectedUnitIds: { family: string; key: string }[] | null;
  persistedRowIds: string[];
  reason: string | null;
};
type Blob = { bytesHex: string; sha256: string; byteLength: number };
type Packet = {
  version: "managed-admin-pdf-complete-v1";
  identity: Identity;
  profileId: typeof PROFILE;
  profileDigest: string;
  planDigest: string;
  nativePopulationDigest: string;
  sourceWitnessRef: Blob;
  sourceAssessmentRef: Blob;
  qualityReviewRef: Blob;
  evaluationRef: Blob;
  safetyRef: Blob;
  optionalEnrichment: Enrichment[];
};

// Bounded JSON views are not validators. Pinned bytes and the checks below remain authority.
type ReferencePage = { text: string };
type SourceRequirement = { id: string; sourceEvidenceIds: string[] };
type WitnessDocument = {
  qualification: string;
  sourceSha256: string;
  sourceByteLength: number;
  sourceUnits: unknown;
  groups: { family: string; population: { tag: string; requirements: SourceRequirement[] } }[];
};
type ExpectationDocument = { units: { required: boolean; nativeMapping: string }[] };
type FrozenTableDocument = {
  pilotOriginal: { sha256: string };
  table: {
    id: string;
    heading: string;
    unit: string;
    riskColumns: { percent: string; ratio: string }[];
    rows: { sex: string; drinkingFrequency: string; values: string[] }[];
  };
};
type TableCell = { sex: string; frequency: string; percent: string; ratio: string; value: string; unit: string };
type ReportImage = {
  sourceKind: string;
  pageNumber: number;
  metadata: {
    table_label: string;
    table_title: string;
    table_rows: string[][];
    rows_truncated: boolean;
    table_text: string;
    accessible_table_markdown: string;
  };
};
type QualityReportDocument = {
  native: {
    inputSha256: string;
    physicalParentMapping: number[];
    payload: { pages: ReferencePage[]; images: ReportImage[] };
  };
  ocr: { negativeFlags: { structuredTableArtifactCount: number } };
};
type SourceAssessmentDocument = {
  sourceUnitCount: number;
  chunkRequirementCount: number;
  requiredImageObligations: number;
  notEstablished: string[];
};
type QualityReviewDocument = {
  native: {
    decision: string;
    pageProof: {
      childPhysicalPage: number;
      parentPhysicalPage: number;
      completeNormalizedClinicalTextExact: boolean;
    }[];
    matchedCells: number;
    structuredTableCount: number;
  };
  evidence: { sha256: string }[];
};
type NativeReadback = ReturnType<typeof decodeManagedNativeParentClosureReadback>;
type IdentityReadback = Pick<
  NativeReadback,
  | "identity"
  | "projectionId"
  | "version"
  | "status"
  | "activated"
  | "sourceAssessment"
  | "planDigest"
  | "sqlPopulationDigest"
> & { populationCommitment: { sha256: string } };
type ManifestDocument = {
  version: string;
  qualification: string;
  identity: unknown;
  planDigest: string;
  projectionId: string;
  sourceExpectation: unknown;
};
type PopulationDocument = {
  version: string;
  identity: unknown;
  planDigest: string;
  projectionId: string;
  manifestSha256: string;
  population: { rowId: string; family: string; receiptSha256: string }[];
};
type RowReceiptDocument = {
  version: string;
  qualification: string;
  identity: unknown;
  rowId: string;
  family: string;
  projectionId: string;
  row: unknown;
  groupKey: string;
  parents: ({ kind: "retained"; sha256: string } | { kind: "row" })[];
  retainedReferences: { kind: "retained"; sha256: string }[];
};
type VisualComparisonDocument = {
  version: string;
  decision: string;
  sourceSha256: string;
  pilotPage: number;
  parentPhysicalPage: number;
  imageSha256: string;
  provenanceSha256: string;
};
type EvaluationDocument = {
  version: string;
  identity: unknown;
  profileId: string;
  profileDigest: string;
  planDigest: string;
  nativePopulationDigest: string;
  sourceExpectationRef: Blob;
  witnessRef: Blob;
  frozenRef: Blob;
  sourceFamilyAssessmentRef: Blob;
  qualityReviewRef: Blob;
  qualityReportRef: Blob;
  pageCoverage: Page[];
  sourceRoleMappings: Role[];
  tableCells: TableCell[];
  visualComparisonRef: Blob;
  safetyRef: Blob;
  optionalEnrichment: Enrichment[];
};
type TerminalResponse = {
  ok: boolean;
  managedAdminPdfTerminal: { status: string; replay: string; activated: boolean; seal: Blob };
};
type TerminalSealDocument = {
  version: string;
  packet: unknown;
  identity: unknown;
  scope: string;
  profileId: string;
  profileDigest: string;
  sourceAssessmentDigest: string;
  evaluationDigest: string;
  nativePopulationDigest: string;
  requiredCoverage: unknown;
  optionalEnrichment: unknown;
  activated: boolean;
  clinicalApproval: string;
  publicationApproval: string;
  parentCompleteness: string;
  completionRevision: string;
};

function refuse(reason: string): never {
  throw new Error(`managed_admin_pdf_${reason}`);
}
function requireThat(value: unknown, reason: string): asserts value {
  if (!value) refuse(reason);
}
function sha(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function utf8(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}
function parse<T>(bytes: Uint8Array): T {
  return JSON.parse(utf8(bytes)) as T;
}
function pin(bytes: Uint8Array, expected: string, name: string): Blob {
  requireThat(bytes instanceof Uint8Array && sha(bytes) === expected, `${name}_pin`);
  return { bytesHex: Buffer.from(bytes).toString("hex"), sha256: expected, byteLength: bytes.length };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
function digest(value: Json): string {
  return sha(Buffer.from(JSON.stringify(canonical(value)), "utf8"));
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function unique(values: string[], name: string): void {
  requireThat(new Set(values).size === values.length, `${name}_duplicate`);
}
function exactKeys(value: unknown, keys: string[], name: string): void {
  requireThat(
    value && typeof value === "object" && !Array.isArray(value) && same(Object.keys(value).sort(), [...keys].sort()),
    `${name}_schema`,
  );
}
function strictNestedEvaluation(evidence: EvaluationDocument): void {
  const reportPages = parse<QualityReportDocument>(
    bytes(evidence.qualityReportRef, "packet_evaluation_qualityReportRef"),
  ).native?.payload?.pages;
  requireThat(Array.isArray(reportPages) && reportPages.length === 4, "packet_page_reference");
  for (let index = 0; index < 4; index++) {
    const page = evidence.pageCoverage[index];
    exactKeys(
      page,
      ["pilotPage", "parentPhysicalPage", "parentPrintedPage", "normalizationRule", "segments"],
      "packet_page",
    );
    requireThat(
      page.pilotPage === index + 1 &&
        page.parentPhysicalPage === PAGE_MAP[index] &&
        page.parentPrintedPage === PRINTED_MAP[index] &&
        page.normalizationRule === "exact-current-accepted-report-bytes-v1" &&
        Array.isArray(page.segments) &&
        page.segments.length > 0,
      "packet_page_domain",
    );
    let offset = 0;
    for (const span of page.segments) {
      exactKeys(span, ["rowId", "contentStart", "contentEnd", "referenceStart", "referenceEnd"], "packet_span");
      requireThat(
        typeof span.rowId === "string" &&
          UUID.test(span.rowId) &&
          [span.contentStart, span.contentEnd, span.referenceStart, span.referenceEnd].every(
            (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0,
          ) &&
          span.contentEnd > span.contentStart &&
          span.referenceStart === offset &&
          span.referenceEnd > span.referenceStart,
        "packet_span_domain",
      );
      offset = span.referenceEnd;
    }
    requireThat(
      typeof reportPages[index]?.text === "string" && offset === Buffer.byteLength(reportPages[index].text, "utf8"),
      "packet_span_coverage",
    );
  }
  const witness = parse<WitnessDocument>(bytes(evidence.witnessRef, "packet_evaluation_witnessRef"));
  const requirements = witness.groups
    ?.filter((group) => REQUIRED_FAMILIES.includes(group.family))
    .flatMap(
      (group) => group.population?.requirements?.map((requirement) => ({ family: group.family, ...requirement })) ?? [],
    );
  requireThat(Array.isArray(requirements) && requirements.length === 62, "packet_role_reference");
  const roleKeys = new Set<string>();
  for (const role of evidence.sourceRoleMappings) {
    exactKeys(role, ["family", "requirementId", "sourceEvidenceIds", "rowIds"], "packet_role");
    requireThat(
      REQUIRED_FAMILIES.includes(role.family) &&
        typeof role.requirementId === "string" &&
        role.requirementId.length > 0 &&
        Array.isArray(role.sourceEvidenceIds) &&
        role.sourceEvidenceIds.length > 0 &&
        role.sourceEvidenceIds.every((id: unknown) => typeof id === "string" && id.length > 0) &&
        Array.isArray(role.rowIds) &&
        role.rowIds.length > 0 &&
        role.rowIds.every((id: unknown) => typeof id === "string" && UUID.test(id)),
      "packet_role_domain",
    );
    unique(role.sourceEvidenceIds, "packet_role_source_evidence");
    unique(role.rowIds, "packet_role_row");
    const key = `${role.family}\u0000${role.requirementId}`;
    requireThat(!roleKeys.has(key), "packet_role_duplicate");
    roleKeys.add(key);
    const required = requirements.find((item) => item.family === role.family && item.id === role.requirementId);
    requireThat(required && same(role.sourceEvidenceIds, required.sourceEvidenceIds), "packet_role_witness");
  }
  requireThat(roleKeys.size === requirements.length, "packet_role_population");
  const table = parse<FrozenTableDocument>(bytes(evidence.frozenRef, "packet_evaluation_frozenRef")).table;
  const expectedCells = table?.rows?.flatMap(
    (row) =>
      row.values?.map((value, index: number) => ({
        sex: row.sex,
        frequency: row.drinkingFrequency,
        percent: table.riskColumns[index]?.percent,
        ratio: table.riskColumns[index]?.ratio,
        value,
        unit: table.unit,
      })) ?? [],
  );
  requireThat(Array.isArray(expectedCells) && expectedCells.length === 56, "packet_cell_reference");
  const cellKeys = new Set<string>();
  for (const cell of evidence.tableCells) {
    exactKeys(cell, ["sex", "frequency", "percent", "ratio", "value", "unit"], "packet_cell");
    requireThat(
      Object.values(cell).every((value) => typeof value === "string") &&
        ["Men", "Women"].includes(cell.sex) &&
        cell.unit === "Standard drinks (per week)",
      "packet_cell_domain",
    );
    const key = JSON.stringify([cell.sex, cell.frequency, cell.percent, cell.ratio]);
    requireThat(!cellKeys.has(key), "packet_cell_duplicate");
    cellKeys.add(key);
    requireThat(
      expectedCells.some((expected) => same(cell, expected)),
      "packet_cell_frozen",
    );
  }
  requireThat(cellKeys.size === expectedCells.length, "packet_cell_population");
}
function bytes(blob: Blob, name: string): Uint8Array {
  exactKeys(blob, ["bytesHex", "sha256", "byteLength"], name);
  requireThat(
    blob &&
      SHA.test(blob.sha256) &&
      /^[0-9a-f]*$/.test(blob.bytesHex) &&
      blob.bytesHex.length === blob.byteLength * 2 &&
      blob.byteLength > 0,
    `${name}_shape`,
  );
  const decoded = Buffer.from(blob.bytesHex, "hex");
  requireThat(sha(decoded) === blob.sha256, `${name}_digest`);
  return decoded;
}
function checkIdentity(identity: Identity, readback: IdentityReadback): void {
  exactKeys(
    identity,
    [
      "documentId",
      "generationId",
      "jobId",
      "ownerId",
      "workerId",
      "firstLeaseToken",
      "attemptNumber",
      "batchId",
      "authorityDigest",
      "predecessorGenerationId",
      "sourceSha256",
      "sourceByteLength",
      "sourceExpectationDigest",
    ],
    "identity",
  );
  for (const key of ["documentId", "generationId", "jobId", "ownerId", "firstLeaseToken"] as const)
    requireThat(UUID.test(identity[key]), `identity_${key}`);
  requireThat(
    identity.sourceSha256 === SOURCE &&
      identity.sourceByteLength === 2211561 &&
      SHA.test(identity.sourceExpectationDigest),
    "identity_source",
  );
  requireThat(
    Number.isSafeInteger(identity.attemptNumber) &&
      identity.attemptNumber > 0 &&
      (identity.batchId === null || UUID.test(identity.batchId)) &&
      (identity.predecessorGenerationId === null || UUID.test(identity.predecessorGenerationId)) &&
      SHA.test(identity.authorityDigest) &&
      typeof identity.workerId === "string" &&
      identity.workerId.length > 0,
    "identity_issued",
  );
  requireThat(
    same(readback.identity, identity) && readback.projectionId === identity.generationId,
    "readback_identity",
  );
  requireThat(
    readback.version === "managed-native-parent-closure-readback-v1" &&
      readback.status === "retained_unverified" &&
      readback.activated === false &&
      readback.sourceAssessment === "unverified",
    "readback_qualification",
  );
  requireThat(
    SHA.test(readback.planDigest) &&
      SHA.test(readback.sqlPopulationDigest) &&
      readback.sqlPopulationDigest === readback.populationCommitment?.sha256,
    "readback_population",
  );
}
function indexRows(readback: NativeReadback): Map<string, Row> {
  requireThat(Array.isArray(readback.rows) && readback.rows.length <= 500, "row_population");
  const manifest = parse<ManifestDocument>(bytes(readback.manifest, "native_manifest"));
  const population = parse<PopulationDocument>(bytes(readback.populationCommitment, "native_population"));
  requireThat(
    manifest.version === "managed-native-parent-closure-manifest-v1" &&
      manifest.qualification === "derived_unverified" &&
      same(manifest.identity, readback.identity) &&
      manifest.planDigest === readback.planDigest &&
      manifest.projectionId === readback.projectionId,
    "native_manifest_binding",
  );
  requireThat(
    population.version === "managed-native-parent-closure-population-v1" &&
      same(population.identity, readback.identity) &&
      population.planDigest === readback.planDigest &&
      population.projectionId === readback.projectionId &&
      population.manifestSha256 === readback.manifest.sha256 &&
      population.population?.length === readback.rows.length,
    "native_population_binding",
  );
  const rows = new Map<string, Row>();
  for (const row of readback.rows as Row[]) {
    requireThat(
      UUID.test(row.rowId) && ["chunks", "images", ...OPTIONAL_FAMILIES].includes(row.family),
      "row_identity",
    );
    requireThat(!rows.has(row.rowId), "row_duplicate");
    bytes(row.receipt, "row_receipt");
    const receipt = parse<RowReceiptDocument>(bytes(row.receipt, "row_receipt"));
    requireThat(
      receipt.version === "managed-native-parent-closure-row-v1" &&
        receipt.qualification === "derived_unverified" &&
        same(receipt.identity, readback.identity) &&
        receipt.rowId === row.rowId &&
        receipt.family === row.family &&
        receipt.projectionId === readback.projectionId &&
        same(receipt.row, row.row),
      "row_receipt_binding",
    );
    requireThat(
      population.population.some(
        (entry) =>
          entry.rowId === row.rowId && entry.family === row.family && entry.receiptSha256 === row.receipt.sha256,
      ),
      "row_population_binding",
    );
    requireThat(
      row.row &&
        row.row.id === row.rowId &&
        row.row.document_id === readback.identity.documentId &&
        (row.family === "chunks"
          ? !Object.hasOwn(row.row, "owner_id")
          : row.row.owner_id === readback.identity.ownerId),
      "row_parent",
    );
    const generation =
      row.row.index_generation_id ?? (row.row.metadata as Record<string, unknown>)?.index_generation_id;
    requireThat(generation === readback.identity.generationId, "row_generation");
    rows.set(row.rowId, row);
  }
  for (const family of ["chunks", "images", ...OPTIONAL_FAMILIES])
    requireThat(
      [...rows.values()].filter((row) => row.family === family).length ===
        (readback.counts as Record<string, number>)?.[family],
      "row_count",
    );
  return rows;
}
function checkRoles(
  witness: WitnessDocument,
  expectation: ExpectationDocument,
  roles: Role[],
  rows: Map<string, Row>,
): void {
  requireThat(
    witness.qualification === "independently_declared_unverified" &&
      witness.sourceSha256 === SOURCE &&
      witness.sourceByteLength === 2211561,
    "witness_identity",
  );
  requireThat(same(witness.sourceUnits, expectation.units) && expectation.units.length === 62, "source_units");
  requireThat(
    expectation.units.every((unit) => unit.required === true && unit.nativeMapping === "unavailable"),
    "source_qualification",
  );
  const required = witness.groups.flatMap((group) => {
    requireThat(
      ["chunks", "images", ...OPTIONAL_FAMILIES].includes(group.family) && group.population?.tag === "known",
      "witness_group",
    );
    if (OPTIONAL_FAMILIES.includes(group.family))
      requireThat(group.population.requirements.length === 0, "optional_source_population");
    return REQUIRED_FAMILIES.includes(group.family)
      ? group.population.requirements.map((item) => ({ family: group.family, ...item }))
      : [];
  });
  requireThat(
    required.length === 62 &&
      required.filter((r) => r.family === "chunks").length === 61 &&
      required.filter((r) => r.family === "images").length === 1,
    "role_count",
  );
  requireThat(roles.length === required.length, "role_mapping_count");
  const mapped = new Map(roles.map((r) => [`${r.family}:${r.requirementId}`, r]));
  requireThat(mapped.size === required.length, "role_mapping_duplicate");
  for (const need of required) {
    const role = mapped.get(`${need.family}:${need.id}`);
    requireThat(
      role && same([...role.sourceEvidenceIds].sort(), [...need.sourceEvidenceIds].sort()) && role.rowIds.length > 0,
      "role_mapping_missing",
    );
    unique(role.rowIds, "role_rows");
    requireThat(
      role.rowIds.every((id) => rows.get(id)?.family === role.family),
      "role_row_family",
    );
  }
}
export function checkPages(referencePages: ReferencePage[], pages: Page[], rows: Map<string, Row>): void {
  requireThat(
    pages.length === 4 &&
      same(
        pages.map((p) => p.pilotPage),
        [1, 2, 3, 4],
      ),
    "page_map",
  );
  for (const page of pages) {
    requireThat(
      page.parentPhysicalPage === PAGE_MAP[page.pilotPage - 1] &&
        page.parentPrintedPage === PRINTED_MAP[page.pilotPage - 1],
      "parent_page_map",
    );
    requireThat(page.normalizationRule === "exact-current-accepted-report-bytes-v1", "normalization_rule");
    const reference = Buffer.from(referencePages[page.pilotPage - 1].text, "utf8");
    let offset = 0;
    requireThat(page.segments.length > 0, "page_segments");
    for (const segment of page.segments) {
      const row = rows.get(segment.rowId);
      requireThat(row?.family === "chunks" && typeof row.row.content === "string", "page_chunk");
      requireThat(row.row.page_number === page.pilotPage, "chunk_page_locator");
      const content = Buffer.from(row.row.content as string, "utf8");
      requireThat(
        segment.referenceStart === offset && segment.referenceEnd > offset && segment.referenceEnd <= reference.length,
        "page_reference_range",
      );
      requireThat(
        Number.isSafeInteger(segment.contentStart) &&
          Number.isSafeInteger(segment.contentEnd) &&
          segment.contentStart >= 0 &&
          segment.contentEnd > segment.contentStart &&
          segment.contentEnd <= content.length,
        "page_content_range",
      );
      requireThat(
        reference
          .subarray(segment.referenceStart, segment.referenceEnd)
          .equals(content.subarray(segment.contentStart, segment.contentEnd)),
        "page_bytes",
      );
      offset = segment.referenceEnd;
    }
    requireThat(offset === reference.length, "page_coverage_gap");
  }
}
export function checkRoleCoverage(roles: Role[], pages: Page[], visualRowId: string): void {
  const roleRows = new Map(roles.map((role) => [`${role.family}:${role.requirementId}`, new Set(role.rowIds)]));
  for (const page of pages) {
    const relevant = roleRows.get(`chunks:pilot-native-page-${page.pilotPage}`);
    requireThat(relevant && page.segments.every((segment) => relevant.has(segment.rowId)), "native_page_role_binding");
  }
  const tableRows = new Set(pages[3].segments.map((segment) => segment.rowId));
  for (const role of roles.filter(
    (role) => role.family === "chunks" && role.requirementId.startsWith("pilot-table-a2-1-"),
  ))
    requireThat(
      role.rowIds.some((id) => tableRows.has(id)),
      "table_role_binding",
    );
  requireThat(
    same(roleRows.get("images:pilot-table-a2-1-visual") ? [...roleRows.get("images:pilot-table-a2-1-visual")!] : [], [
      visualRowId,
    ]),
    "table_image_role_binding",
  );
}
function checkTable(frozen: FrozenTableDocument, report: QualityReportDocument): { cells: Json[]; image: ReportImage } {
  const images = report.native.payload.images.filter((image) => image.sourceKind === "table_crop");
  requireThat(images.length === 1 && images[0].pageNumber === 4, "table_image_count");
  const image = images[0];
  const table = frozen.table;
  requireThat(
    image.metadata.table_label === `Table ${table.id}` && image.metadata.table_title === table.heading,
    "table_caption",
  );
  requireThat(image.metadata.table_rows?.length === 18 && image.metadata.rows_truncated === false, "table_rows");
  const expected: string[][] = [
    ["Drinking frequency", "Risk level", "", "", ""],
    ["", ...table.riskColumns.map((r) => `${r.percent} (${r.ratio})`)],
  ];
  let sex = "";
  const cells: Json[] = [];
  for (const row of table.rows) {
    if (row.sex !== sex) {
      sex = row.sex;
      expected.push([sex, table.unit, "", "", ""]);
    }
    expected.push([row.drinkingFrequency, ...row.values]);
    for (let index = 0; index < 4; index++)
      cells.push({
        sex,
        frequency: row.drinkingFrequency,
        percent: table.riskColumns[index].percent,
        ratio: table.riskColumns[index].ratio,
        value: row.values[index],
        unit: table.unit,
      });
  }
  requireThat(cells.length === 56 && same(image.metadata.table_rows, expected), "table_relations");
  requireThat(
    report.native.payload.pages[3].text.includes(image.metadata.table_text) &&
      image.metadata.accessible_table_markdown === image.metadata.table_text,
    "table_in_page",
  );
  return { cells, image };
}
export function checkVisual(
  visual: Visual,
  image: ReportImage,
  rows: Map<string, Row>,
  registeredVisualDigest: string,
): Blob {
  const row = rows.get(visual.rowId);
  requireThat(row?.family === "images" && registeredVisualDigest && SHA.test(registeredVisualDigest), "visual_parent");
  const receipt = parse<RowReceiptDocument>(bytes(row.receipt, "visual_row_receipt"));
  requireThat(
    receipt.parents?.some((parent) => parent.kind === "retained" && parent.sha256 === sha(visual.binary)),
    "visual_binary_parent",
  );
  requireThat(
    receipt.retainedReferences?.some(
      (reference) => reference.kind === "retained" && reference.sha256 === sha(visual.provenance),
    ),
    "visual_provenance_parent",
  );
  const comparison = pin(visual.comparison, registeredVisualDigest, "visual_comparison");
  const accepted = parse<VisualComparisonDocument>(visual.comparison);
  requireThat(
    accepted?.version === "four-page-pilot-table-visual-comparison-v1" &&
      accepted?.decision === "accepted" &&
      accepted?.sourceSha256 === SOURCE &&
      accepted?.pilotPage === 4 &&
      accepted?.parentPhysicalPage === 62 &&
      accepted?.imageSha256 === sha(visual.binary) &&
      accepted?.provenanceSha256 === sha(visual.provenance),
    "visual_comparison_binding",
  );
  const descriptor = Object.fromEntries(
    Object.entries(image).filter(([key]) => !["path", "artifactSha256", "artifactByteLength"].includes(key)),
  );
  requireThat(
    row.row.page_number === 4 && row.row.source_kind === "table_crop" && same(row.row.descriptor, descriptor),
    "visual_descriptor_binding",
  );
  requireThat(
    row.row.metadata &&
      (row.row.metadata as Record<string, unknown>).table_label === image.metadata.table_label &&
      (row.row.metadata as Record<string, unknown>).table_title === image.metadata.table_title,
    "visual_row_metadata",
  );
  return comparison;
}
export function checkEnrichment(
  dispositions: Enrichment[],
  rows: Map<string, Row>,
  manifests: WholeOriginalProducerManifest[],
): Enrichment[] {
  const optional = manifests.filter(
    (manifest) => !(manifest.group.groupKey === "worker_core" && REQUIRED_FAMILIES.includes(manifest.group.family)),
  );
  const key = (family: string, groupKey: string) => `${family}:${groupKey}`;
  requireThat(dispositions.length === optional.length, "enrichment_group_count");
  const supplied = new Map(dispositions.map((item) => [key(item.family, item.groupKey), item]));
  requireThat(supplied.size === optional.length, "enrichment_group_duplicate");
  for (const manifest of optional) {
    const family = manifest.group.family,
      groupKey = manifest.group.groupKey;
    const item = supplied.get(key(family, groupKey));
    requireThat(item && item.producerManifestDigest === manifest.preparedManifestDigest, "enrichment_manifest");
    const population = manifest.group.declaration.population;
    const expected = population.tag === "known" ? population.expectedUnits : null;
    requireThat(same(item.expectedUnitIds, expected), "enrichment_expected_units");
    const actual = [...rows.values()]
      .filter((row) => {
        if (row.family !== family) return false;
        return parse<RowReceiptDocument>(bytes(row.receipt, "enrichment_row_receipt")).groupKey === groupKey;
      })
      .map((row) => row.rowId)
      .sort();
    requireThat(same([...item.persistedRowIds].sort(), actual), "enrichment_rows");
    const state =
      manifest.state === "prepared"
        ? actual.length === (expected?.length ?? -1) && actual.length > 0
          ? "persisted"
          : actual.length === 0
            ? "prepared_only"
            : "invalid"
        : manifest.state === "pending"
          ? "deferred"
          : manifest.state === "unavailable"
            ? "unavailable"
            : "invalid";
    requireThat(state !== "invalid" && item.state === state, "enrichment_state");
    requireThat(
      (actual.length === 0 || expected !== null) && (state !== "persisted" || actual.length === expected!.length),
      "enrichment_population",
    );
  }
  return [...dispositions].sort((a, b) => key(a.family, a.groupKey).localeCompare(key(b.family, b.groupKey)));
}

export async function evaluateManagedAdminPdfCompletion(input: {
  identity: Identity;
  original: Uint8Array;
  sourceExpectation: Uint8Array;
  witness: Uint8Array;
  frozenOriginal: Uint8Array;
  sourceFamilyAssessment: Uint8Array;
  qualityReview: Uint8Array;
  qualityReport: Uint8Array;
  nativeBasis: Parameters<typeof preflightManagedNativeParentClosure>[0];
  nativePacket: Parameters<typeof decodeManagedNativeParentClosureReadback>[0]["packet"];
  nativeResponse: unknown;
  roles: Role[];
  pages: Page[];
  visual: Visual;
  registeredVisualDigest: string;
  admission: Admission;
  registeredAdmissionDigest: string;
  registeredProfileDigest: string;
  dispositions: Enrichment[];
}): Promise<{ packet: Packet; evidence: Json }> {
  requireThat(input.original.length === 2211561 && sha(input.original) === SOURCE, "original_source");
  const expectationRef = pin(input.sourceExpectation, EXPECTATION, "expectation");
  const witnessRef = pin(input.witness, WITNESS, "witness");
  const frozenRef = pin(input.frozenOriginal, FROZEN, "frozen_original");
  const sourceAssessmentRef = pin(input.sourceFamilyAssessment, SOURCE_ASSESSMENT, "source_family_assessment");
  const reviewRef = pin(input.qualityReview, REVIEW, "quality_review");
  const reportRef = pin(input.qualityReport, REPORT, "quality_report");
  const expectation = parse<ExpectationDocument>(input.sourceExpectation),
    witness = parse<WitnessDocument>(input.witness),
    frozen = parse<FrozenTableDocument>(input.frozenOriginal);
  const sourceAssessment = parse<SourceAssessmentDocument>(input.sourceFamilyAssessment);
  const review = parse<QualityReviewDocument>(input.qualityReview),
    report = parse<QualityReportDocument>(input.qualityReport);
  requireThat(
    sourceAssessment.sourceUnitCount === 62 &&
      sourceAssessment.chunkRequirementCount === 61 &&
      sourceAssessment.requiredImageObligations === 1 &&
      sourceAssessment.notEstablished?.includes("producerCoverage"),
    "source_assessment_scope",
  );
  requireThat(
    review.native?.decision === "ACCEPT_CONTENT_FIDELITY_FOR_LABELLED_FOUR_PAGE_EXTRACTION_ONLY" &&
      review.native.pageProof?.length === 4 &&
      review.native.matchedCells === 56 &&
      review.native.structuredTableCount === 1,
    "quality_review_scope",
  );
  requireThat(
    review.native.pageProof.every(
      (page, index: number) =>
        page.childPhysicalPage === index + 1 &&
        page.parentPhysicalPage === PAGE_MAP[index] &&
        page.completeNormalizedClinicalTextExact === true,
    ),
    "quality_review_pages",
  );
  requireThat(
    review.evidence?.some((item) => item.sha256 === REPORT.slice(7)) &&
      review.evidence?.some((item) => item.sha256 === FROZEN.slice(7)),
    "quality_review_inputs",
  );
  requireThat(
    report.native?.payload?.pages?.length === 4 &&
      report.native.inputSha256 === SOURCE.slice(7) &&
      report.ocr?.negativeFlags?.structuredTableArtifactCount === 0,
    "quality_report_scope",
  );
  requireThat(
    same(report.native.physicalParentMapping, PAGE_MAP) || same(report.native.physicalParentMapping, [9, 10, 11, 62]),
    "source_page_map",
  );
  requireThat(
    frozen.pilotOriginal?.sha256 === SOURCE.slice(7) || frozen.pilotOriginal?.sha256 === SOURCE,
    "frozen_source",
  );
  requireThat(SHA.test(input.registeredProfileDigest), "profile_registration");
  // Import at this boundary so even malformed source references cannot run the current preparer.
  // The real decoder verifies the entire prepared population/row/parent graph; no substitute verifier is accepted.
  const native = await import("./managed-native-parent-closure");
  const basis = native.preflightManagedNativeParentClosure(input.nativeBasis);
  const readback = native.decodeManagedNativeParentClosureReadback({
    ...input.nativeBasis,
    packet: input.nativePacket,
    response: input.nativeResponse,
  });
  checkIdentity(input.identity, readback);
  requireThat(input.identity.sourceExpectationDigest === digest(expectation), "expectation_generation_digest");
  requireThat(
    same(parse<ManifestDocument>(bytes(readback.manifest, "native_manifest")).sourceExpectation, expectation),
    "native_source_expectation",
  );
  const rows = indexRows(readback);
  checkRoles(witness, expectation, input.roles, rows);
  checkPages(report.native.payload.pages, input.pages, rows);
  checkRoleCoverage(input.roles, input.pages, input.visual.rowId);
  const table = checkTable(frozen, report);
  const visualRef = checkVisual(input.visual, table.image, rows, input.registeredVisualDigest);
  requireThat(
    input.admission.sourceSha256 === SOURCE &&
      input.admission.documentId === input.identity.documentId &&
      input.admission.ownerId === input.identity.ownerId &&
      input.admission.generationId === input.identity.generationId,
    "admission_identity",
  );
  const safetyRef = pin(input.admission.record, input.registeredAdmissionDigest, "admission");
  const optionalEnrichment = checkEnrichment(input.dispositions, rows, basis.plan.producerManifests);
  const evidence: Json = {
    version: "managed-admin-pdf-evaluation-v1",
    identity: input.identity as unknown as Json,
    profileId: PROFILE,
    profileDigest: input.registeredProfileDigest,
    planDigest: readback.planDigest,
    nativePopulationDigest: readback.sqlPopulationDigest,
    sourceExpectationRef: expectationRef as unknown as Json,
    witnessRef: witnessRef as unknown as Json,
    frozenRef: frozenRef as unknown as Json,
    sourceFamilyAssessmentRef: sourceAssessmentRef as unknown as Json,
    qualityReviewRef: reviewRef as unknown as Json,
    qualityReportRef: reportRef as unknown as Json,
    pageCoverage: input.pages as unknown as Json,
    sourceRoleMappings: input.roles as unknown as Json,
    tableCells: table.cells as Json[],
    visualComparisonRef: visualRef as unknown as Json,
    safetyRef: safetyRef as unknown as Json,
    optionalEnrichment: optionalEnrichment as unknown as Json,
  };
  const evidenceBytes = Buffer.from(JSON.stringify(canonical(evidence)), "utf8");
  const packet: Packet = {
    version: "managed-admin-pdf-complete-v1",
    identity: input.identity,
    profileId: PROFILE,
    profileDigest: input.registeredProfileDigest,
    planDigest: readback.planDigest,
    nativePopulationDigest: readback.sqlPopulationDigest,
    sourceWitnessRef: witnessRef,
    sourceAssessmentRef,
    qualityReviewRef: reviewRef,
    evaluationRef: {
      bytesHex: evidenceBytes.toString("hex"),
      sha256: sha(evidenceBytes),
      byteLength: evidenceBytes.length,
    },
    safetyRef,
    optionalEnrichment,
  };
  requireThat(Buffer.byteLength(JSON.stringify(packet), "utf8") <= 2097152, "packet_transport_limit");
  return { packet, evidence };
}

function strictPacket(packet: Packet): asserts packet is Packet {
  exactKeys(
    packet,
    [
      "version",
      "identity",
      "profileId",
      "profileDigest",
      "planDigest",
      "nativePopulationDigest",
      "sourceWitnessRef",
      "sourceAssessmentRef",
      "qualityReviewRef",
      "evaluationRef",
      "safetyRef",
      "optionalEnrichment",
    ],
    "packet",
  );
  requireThat(
    packet.version === "managed-admin-pdf-complete-v1" &&
      packet.profileId === PROFILE &&
      SHA.test(packet.profileDigest) &&
      SHA.test(packet.planDigest) &&
      SHA.test(packet.nativePopulationDigest),
    "packet_identity",
  );
  checkIdentity(packet.identity, {
    identity: packet.identity,
    projectionId: packet.identity?.generationId,
    version: "managed-native-parent-closure-readback-v1",
    status: "retained_unverified",
    activated: false,
    sourceAssessment: "unverified",
    planDigest: packet.planDigest,
    sqlPopulationDigest: packet.nativePopulationDigest,
    populationCommitment: { sha256: packet.nativePopulationDigest },
  });
  requireThat(
    packet.sourceWitnessRef.sha256 === WITNESS &&
      packet.sourceAssessmentRef.sha256 === SOURCE_ASSESSMENT &&
      packet.qualityReviewRef.sha256 === REVIEW,
    "packet_reference_pins",
  );
  for (const name of ["sourceWitnessRef", "sourceAssessmentRef", "qualityReviewRef", "evaluationRef", "safetyRef"])
    bytes(
      packet[name as "sourceWitnessRef" | "sourceAssessmentRef" | "qualityReviewRef" | "evaluationRef" | "safetyRef"],
      `packet_${name}`,
    );
  const evidence = parse<EvaluationDocument>(bytes(packet.evaluationRef, "packet_evaluation"));
  requireThat(
    utf8(bytes(packet.evaluationRef, "packet_evaluation")) === JSON.stringify(canonical(evidence)),
    "packet_evaluation_canonical",
  );
  exactKeys(
    evidence,
    [
      "version",
      "identity",
      "profileId",
      "profileDigest",
      "planDigest",
      "nativePopulationDigest",
      "sourceExpectationRef",
      "witnessRef",
      "frozenRef",
      "sourceFamilyAssessmentRef",
      "qualityReviewRef",
      "qualityReportRef",
      "pageCoverage",
      "sourceRoleMappings",
      "tableCells",
      "visualComparisonRef",
      "safetyRef",
      "optionalEnrichment",
    ],
    "packet_evaluation",
  );
  requireThat(
    evidence.version === "managed-admin-pdf-evaluation-v1" &&
      same(evidence.identity, packet.identity) &&
      evidence.profileId === PROFILE &&
      evidence.profileDigest === packet.profileDigest &&
      evidence.planDigest === packet.planDigest &&
      evidence.nativePopulationDigest === packet.nativePopulationDigest,
    "packet_evaluation_binding",
  );
  requireThat(
    evidence.sourceExpectationRef?.sha256 === EXPECTATION &&
      evidence.frozenRef?.sha256 === FROZEN &&
      evidence.qualityReportRef?.sha256 === REPORT,
    "packet_evaluation_pins",
  );
  for (const name of ["sourceExpectationRef", "frozenRef", "qualityReportRef", "visualComparisonRef"])
    bytes(
      evidence[name as "sourceExpectationRef" | "frozenRef" | "qualityReportRef" | "visualComparisonRef"],
      `packet_evaluation_${name}`,
    );
  requireThat(
    Array.isArray(evidence.pageCoverage) &&
      evidence.pageCoverage.length === 4 &&
      Array.isArray(evidence.sourceRoleMappings) &&
      evidence.sourceRoleMappings.length === 62 &&
      Array.isArray(evidence.tableCells) &&
      evidence.tableCells.length === 56,
    "packet_evaluation_counts",
  );
  requireThat(
    same(evidence.witnessRef, packet.sourceWitnessRef) &&
      same(evidence.sourceFamilyAssessmentRef, packet.sourceAssessmentRef) &&
      same(evidence.qualityReviewRef, packet.qualityReviewRef) &&
      same(evidence.safetyRef, packet.safetyRef),
    "packet_evaluation_refs",
  );
  strictNestedEvaluation(evidence);
  requireThat(
    Array.isArray(packet.optionalEnrichment) && same(evidence.optionalEnrichment, packet.optionalEnrichment),
    "packet_enrichment",
  );
  const enrichmentKeys = new Set<string>();
  for (const item of packet.optionalEnrichment) {
    exactKeys(
      item,
      ["family", "groupKey", "state", "producerManifestDigest", "expectedUnitIds", "persistedRowIds", "reason"],
      "packet_enrichment_item",
    );
    requireThat(
      typeof item.family === "string" &&
        item.family.length > 0 &&
        typeof item.groupKey === "string" &&
        item.groupKey.length > 0 &&
        ["persisted", "prepared_only", "deferred", "failed", "unavailable"].includes(item.state),
      "packet_enrichment_state",
    );
    requireThat(
      item.producerManifestDigest === null || SHA.test(item.producerManifestDigest),
      "packet_enrichment_digest",
    );
    requireThat(item.expectedUnitIds === null || Array.isArray(item.expectedUnitIds), "packet_enrichment_units");
    if (item.expectedUnitIds !== null) {
      const unitKeys = new Set<string>();
      for (const unit of item.expectedUnitIds) {
        exactKeys(unit, ["family", "key"], "packet_enrichment_unit");
        requireThat(
          unit.family === item.family && typeof unit.key === "string" && unit.key.length > 0,
          "packet_enrichment_unit_domain",
        );
        const key = `${unit.family}\u0000${unit.key}`;
        requireThat(!unitKeys.has(key), "packet_enrichment_unit_duplicate");
        unitKeys.add(key);
      }
    }
    requireThat(
      Array.isArray(item.persistedRowIds) &&
        item.persistedRowIds.every((id: unknown) => typeof id === "string" && UUID.test(id)),
      "packet_enrichment_rows",
    );
    unique(item.persistedRowIds, "packet_enrichment_row");
    requireThat(item.reason === null || typeof item.reason === "string", "packet_enrichment_reason");
    const key = `${item.family}\u0000${item.groupKey}`;
    requireThat(!enrichmentKeys.has(key), "packet_enrichment_duplicate");
    enrichmentKeys.add(key);
  }
  requireThat(Buffer.byteLength(JSON.stringify(packet), "utf8") <= 2097152, "packet_transport_limit");
}

/** Decode only a completed immutable server seal; never turns a draft packet into authority. */
export function decodeManagedAdminPdfTerminalReadback(packet: Packet, response: unknown) {
  strictPacket(packet);
  exactKeys(response, ["ok", "managedAdminPdfTerminal"], "response");
  exactKeys(
    (response as TerminalResponse).managedAdminPdfTerminal,
    ["status", "replay", "activated", "seal"],
    "response_terminal",
  );
  requireThat(Buffer.byteLength(JSON.stringify(response), "utf8") <= 2097152, "response_transport_limit");
  requireThat(
    (response as TerminalResponse)?.ok === true &&
      (response as TerminalResponse).managedAdminPdfTerminal?.status === "admin_pdf_completed" &&
      (response as TerminalResponse).managedAdminPdfTerminal?.activated === true,
    "terminal_response",
  );
  const result = (response as TerminalResponse).managedAdminPdfTerminal;
  requireThat(["completed", "already_completed"].includes(result.replay), "terminal_replay");
  const body = parse<TerminalSealDocument>(bytes(result.seal, "terminal_seal"));
  exactKeys(
    body,
    [
      "version",
      "packet",
      "identity",
      "scope",
      "profileId",
      "profileDigest",
      "sourceAssessmentDigest",
      "evaluationDigest",
      "nativePopulationDigest",
      "requiredCoverage",
      "optionalEnrichment",
      "activated",
      "clinicalApproval",
      "publicationApproval",
      "parentCompleteness",
      "completionRevision",
    ],
    "terminal_body",
  );
  requireThat(utf8(bytes(result.seal, "terminal_seal")) === JSON.stringify(canonical(body)), "terminal_seal_canonical");
  requireThat(
    body.version === "managed-admin-pdf-seal-v1" &&
      body.scope === "whole_admitted_four_page_native_pdf_pilot" &&
      same(body.packet, packet),
    "terminal_packet",
  );
  requireThat(
    same(body.identity, packet.identity) &&
      body.profileId === PROFILE &&
      body.profileDigest === packet.profileDigest &&
      body.sourceAssessmentDigest === packet.sourceAssessmentRef.sha256 &&
      body.evaluationDigest === packet.evaluationRef.sha256 &&
      body.nativePopulationDigest === packet.nativePopulationDigest,
    "terminal_binding",
  );
  requireThat(
    same(body.requiredCoverage, {
      nativePages: 4,
      semanticRequirements: 61,
      tableCells: 56,
      tableVisualRequirements: 1,
    }),
    "terminal_coverage",
  );
  requireThat(
    same(body.optionalEnrichment, packet.optionalEnrichment) &&
      body.activated === true &&
      body.clinicalApproval === "not_assessed" &&
      body.publicationApproval === "not_granted" &&
      body.parentCompleteness === "not_claimed" &&
      typeof body.completionRevision === "string" &&
      body.completionRevision.length > 0,
    "terminal_qualification",
  );
  return {
    replay: result.replay as "completed" | "already_completed",
    sealSha256: result.seal.sha256,
    completionRevision: body.completionRevision as string,
  };
}

/** Evidence comes only from the current authenticated mounted source supplier. */
export type ManagedAdminPdfCompletionEvidence = Omit<
  Parameters<typeof evaluateManagedAdminPdfCompletion>[0],
  "identity" | "original" | "nativeBasis" | "nativePacket" | "nativeResponse"
>;

/** Uses the existing fenced completion RPC. Only the tagged server branch may accept it. */
export function completeManagedAdminPdfAttempt(args: {
  attempt: IngestionAttempt;
  packet: Awaited<ReturnType<typeof evaluateManagedAdminPdfCompletion>>["packet"];
  stopHeartbeat: () => void;
  rpc: (
    name: string,
    payload: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
}) {
  args.stopHeartbeat();
  return args.attempt.serialize(async () => {
    const packet = JSON.parse(JSON.stringify(args.packet)) as Packet;
    strictPacket(packet);
    const fence = parseIngestionFence(args.attempt.fence);
    requireThat(
      same(fence, {
        job_kind: "node",
        job_id: packet.identity.jobId,
        document_id: packet.identity.documentId,
        worker_id: packet.identity.workerId,
        lease_token: packet.identity.firstLeaseToken,
        expected_generation_id: packet.identity.predecessorGenerationId,
        authority_digest: packet.identity.authorityDigest,
      }),
      "fence_mismatch",
    );
    const dispatch = async (readOnly: boolean) => {
      const result = await args.rpc("complete_managed_admin_text", {
        p_fence: fence,
        p_generation: packet.identity.generationId,
        p_packet: packet,
        p_read_only: readOnly,
      });
      if (result.error) throw new Error(result.error.message);
      return decodeManagedAdminPdfTerminalReadback(packet, result.data);
    };
    try {
      args.attempt.check();
      let written: ReturnType<typeof decodeManagedAdminPdfTerminalReadback> | undefined;
      try {
        written = await dispatch(false);
      } catch {
        // A lost/malformed acknowledgement proves nothing. Strict completed read is the only recovery.
      }
      const read = await dispatch(true);
      requireThat(
        read.replay === "already_completed" &&
          (!written ||
            (["completed", "already_completed"].includes(written.replay) &&
              written.sealSha256 === read.sealSha256 &&
              written.completionRevision === read.completionRevision)),
        "replay_mismatch",
      );
      return read;
    } finally {
      args.attempt.cancel();
    }
  });
}
