import ExcelJS from "exceljs";
import type { ExtractedDocument, ExtractedPage } from "../types";
import { extractedTextSha256 } from "./docx-source-provenance";
import { XlsxSourceProvenanceError, XlsxExtractionBudgetTracker } from "./xlsx-extraction-budget";
import { preflightOriginalXlsx } from "./xlsx-source-preflight";
import {
  boundedXlsxJson,
  XLSX_SOURCE_LIMITS as L,
  xlsxBound,
  xlsxIdentityMismatch,
  xlsxInvalid,
  xlsxSha,
} from "./xlsx-original-zip";
import {
  type XlsxReasonCode,
  xlsxPageSourceProvenanceSchema,
  type XlsxPageSourceProvenance,
  type XlsxFeature,
  type XlsxAttribute,
  type XlsxPart,
  xlsxAttributeValue,
  orderedXlsxReasons,
  xlsxDisposition,
  xlsxFormulaKind,
  classifyXlsxCell,
  classifyXlsxFeature,
  deriveXlsxPageReasons,
  strictIndex,
  xlsxAddress,
  xlsxRectangle,
  canonicalXlsxFacts,
  xlsxFactsSha256,
  compareXlsxAttributes,
  sheetNamespaces,
  relNamespaces,
} from "./xlsx-source-contract";

export { XlsxSourceProvenanceError } from "./xlsx-extraction-budget";
export {
  XLSX_REASON_CODES,
  type XlsxReasonCode,
  xlsxPartSchema,
  xlsxAttributeSchema,
  xlsxNodeTokenSchema,
  xlsxRelationshipSchema,
  xlsxFeatureSchema,
  xlsxStringRunsSchema,
  xlsxCellSchema,
  xlsxRowSchema,
  xlsxColumnSchema,
  xlsxSheetEntrySchema,
  xlsxSourceFactsSchema,
  xlsxPageSourceProvenanceSchema,
  type XlsxPageSourceProvenance,
  type XlsxSourceFacts,
  type XlsxCell,
  type XlsxFeature,
  type XlsxAttribute,
  type XlsxNodeToken,
  type XlsxStringRuns,
  type XlsxPart,
  type XlsxRelationship,
  xlsxAttributeValue,
  orderedXlsxReasons,
  xlsxDisposition,
  xlsxFormulaKind,
  classifyXlsxCell,
  classifyXlsxFeature,
  deriveXlsxPageReasons,
  strictIndex,
  xlsxAddress,
  xlsxRectangle,
  canonicalXlsxFacts,
  xlsxFactsSha256,
  compareXlsxAttributes,
} from "./xlsx-source-contract";

function exactCodes(actual: XlsxReasonCode[], mandatory: XlsxReasonCode[], normalized: boolean) {
  if (
    new Set(actual).size !== actual.length ||
    actual.some((code, i) => orderedXlsxReasons(actual)[i] !== code) ||
    mandatory.some((code) => !actual.includes(code)) ||
    (!normalized && actual.length !== mandatory.length)
  )
    xlsxInvalid();
}
function validateFacts(provenance: XlsxPageSourceProvenance) {
  const f = provenance.sourceFacts,
    normalized = provenance.textIdentity.metadataNormalizationApplied;
  const resolvedStyles = new Set(
    f.styleRefs.filter((style) => style.resolution !== "unresolved").map((style) => style.sourceIndex),
  );
  const sharedReferences = new Map(f.sharedStringRefs.map((reference) => [reference.sourceIndex, reference]));
  const parts = new Map<string, string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);
    const record = value as Record<string, unknown>;
    if (Object.hasOwn(record, "name") && Object.hasOwn(record, "originalBytesSha256")) {
      const p = record as XlsxPart;
      if (parts.has(p.name) && parts.get(p.name) !== p.originalBytesSha256) xlsxIdentityMismatch();
      parts.set(p.name, p.originalBytesSha256);
    }
    if (Object.hasOwn(record, "attributes") || Object.hasOwn(record, "rootAttributes")) {
      const attrs = (record.attributes ?? record.rootAttributes) as XlsxAttribute[];
      const seen = new Set<string>();
      attrs.forEach((attr, index) => {
        const key = `${attr.namespaceUri}\u0000${attr.localName}`;
        if (seen.has(key) || (index && compareXlsxAttributes(attrs[index - 1], attr) >= 0)) xlsxInvalid();
        seen.add(key);
      });
    }
    Object.values(record).forEach(visit);
  };
  visit(f);
  const relationArrays = [f.packageRelationships, f.workbook.relationships, f.worksheet.relationships];
  xlsxBound(
    relationArrays.reduce((total, records) => total + records.length, 0),
    L.relationships,
  );
  const relationIds = new Set<string>();
  for (const relations of relationArrays) {
    for (const relation of relations) {
      const key = `${relation.sourcePart.name}\u0000${relation.idToken}`;
      if (
        relationIds.has(key) ||
        (relation.status === "internal_resolved") !== (relation.resolvedInternalPart !== null) ||
        (relation.status === "external_unresolved") !== (relation.targetModeToken === "External")
      )
        xlsxInvalid();
      relationIds.add(key);
    }
  }
  const sheetIds = new Set<number>(),
    sheetNames = new Set<string>(),
    rids = new Set<string>();
  let emitted = 0;
  f.workbook.sheets.forEach((sheet, i) => {
    const id = strictIndex(sheet.sheetIdToken);
    if (
      sheet.sourceOrdinal !== i ||
      id === null ||
      id === 0 ||
      sheetIds.has(id) ||
      sheetNames.has(sheet.nameToken) ||
      rids.has(sheet.relationshipIdToken)
    )
      xlsxInvalid();
    sheetIds.add(id);
    sheetNames.add(sheet.nameToken);
    rids.add(sheet.relationshipIdToken);
    const relation = f.workbook.relationships.find((r) => r.idToken === sheet.relationshipIdToken);
    if (
      !relation ||
      relation.typeToken !== sheet.relationshipTypeToken ||
      relation.status !== "internal_resolved" ||
      !relation.resolvedInternalPart ||
      relation.resolvedInternalPart.name !== sheet.resolvedPart.name ||
      relation.resolvedInternalPart.originalBytesSha256 !== sheet.resolvedPart.originalBytesSha256
    )
      xlsxIdentityMismatch();
    const ordinaryRelationship = [...relNamespaces].some(
      (namespace) => sheet.relationshipTypeToken === `${namespace}/worksheet`,
    );
    if (sheet.status === "emitted_worksheet") {
      emitted++;
      if (sheet.emittedLogicalUnitIndex !== emitted || !ordinaryRelationship) xlsxInvalid();
    } else if (sheet.emittedLogicalUnitIndex !== null || ordinaryRelationship) xlsxInvalid();
    const expected: XlsxReasonCode[] = sheet.status === "unsupported_sheet" ? ["xlsx_unsupported_sheet_gap"] : [];
    if (sheet.stateToken !== null && sheet.stateToken !== "visible") expected.push("xlsx_visibility_unverified");
    exactCodes(sheet.reasonCodes, orderedXlsxReasons(expected), normalized);
  });
  const sheet = f.workbook.sheets[f.worksheet.sourceOrdinal];
  if (
    !sheet ||
    sheet.status !== "emitted_worksheet" ||
    sheet.emittedLogicalUnitIndex !== provenance.logicalUnitIndex ||
    sheet.resolvedPart.name !== f.worksheet.part.name ||
    sheet.resolvedPart.originalBytesSha256 !== f.worksheet.part.originalBytesSha256
  )
    xlsxIdentityMismatch();
  const rowIds = new Set<number>(),
    addresses = new Set<string>();
  let cellCount = 0,
    sparse = 0;
  f.worksheet.rows.forEach((row, index) => {
    const number = strictIndex(row.rowNumberToken);
    if (
      row.elementIndex !== index ||
      number === null ||
      number < 1 ||
      number > 1_048_576 ||
      rowIds.has(number) ||
      xlsxAttributeValue(row.attributes, "r") !== row.rowNumberToken
    )
      xlsxInvalid();
    rowIds.add(number);
    let high = 0;
    row.cells.forEach((cell, cellIndex) => {
      const coordinate = xlsxAddress(cell.address);
      if (
        cell.elementIndex !== cellIndex ||
        coordinate.row !== number ||
        cell.rowNumber !== coordinate.row ||
        cell.columnNumber !== coordinate.column ||
        addresses.has(cell.address) ||
        xlsxAttributeValue(cell.attributes, "r") !== cell.address ||
        cell.formulaKind !== xlsxFormulaKind(cell.formula) ||
        cell.explicitStyleIndexToken !== xlsxAttributeValue(cell.attributes, "s")
      )
        xlsxInvalid();
      addresses.add(cell.address);
      high = Math.max(high, coordinate.column);
      cellCount++;
      const type = xlsxAttributeValue(cell.attributes, "t");
      if (cell.value && (!sheetNamespaces.has(cell.value.namespaceUri) || cell.value.localName !== "v")) xlsxInvalid();
      if (cell.formula && (!sheetNamespaces.has(cell.formula.namespaceUri) || cell.formula.localName !== "f"))
        xlsxInvalid();
      if (
        (cell.inlineString !== null && (type !== "inlineStr" || cell.value !== null || cell.formula !== null)) ||
        (type === "inlineStr" && cell.value !== null) ||
        cell.sharedStringIndexToken !== (type === "s" ? (cell.value?.textToken ?? null) : null)
      )
        xlsxInvalid();
      if (cell.resolvedSharedString !== null) {
        const reference = sharedReferences.get(strictIndex(cell.sharedStringIndexToken) ?? -1);
        if (
          !reference ||
          boundedXlsxJson(reference.runs, L.pageBytes) !== boundedXlsxJson(cell.resolvedSharedString, L.pageBytes)
        )
          xlsxIdentityMismatch();
      }
      const expected = classifyXlsxCell(cell);
      if (cell.explicitStyleIndexToken !== null && !resolvedStyles.has(strictIndex(cell.explicitStyleIndexToken) ?? -1))
        expected.push("xlsx_style_unresolved");
      exactCodes(cell.reasonCodes, orderedXlsxReasons(expected), normalized);
      if (cell.structuralDisposition !== xlsxDisposition(cell.reasonCodes)) xlsxInvalid();
    });
    sparse = xlsxBound(sparse + high, L.allocation);
  });
  xlsxBound(cellCount, L.cells);
  let previousStyle = -1,
    previousString = -1;
  for (const style of f.styleRefs) {
    if (
      style.sourceIndex <= previousStyle ||
      !f.stylesPart ||
      style.cellXf.localName !== "xf" ||
      !sheetNamespaces.has(style.cellXf.namespaceUri) ||
      style.numFmtIdToken !== xlsxAttributeValue(style.cellXf.attributes, "numFmtId") ||
      (style.resolution === "custom_source") !== (style.customNumFmt !== null)
    )
      xlsxInvalid();
    if (
      style.customNumFmt &&
      (style.customNumFmt.localName !== "numFmt" ||
        xlsxAttributeValue(style.customNumFmt.attributes, "numFmtId") !== style.numFmtIdToken)
    )
      xlsxInvalid();
    previousStyle = style.sourceIndex;
  }
  for (const string of f.sharedStringRefs) {
    if (
      string.sourceIndex <= previousString ||
      !f.sharedStringsPart ||
      string.sourcePart.name !== f.sharedStringsPart.name ||
      string.sourcePart.originalBytesSha256 !== f.sharedStringsPart.originalBytesSha256
    )
      xlsxInvalid();
    previousString = string.sourceIndex;
  }
  for (const column of f.worksheet.columns) {
    const min = strictIndex(column.minToken),
      max = strictIndex(column.maxToken);
    if (
      min === null ||
      max === null ||
      min < 1 ||
      max < min ||
      max > 16_384 ||
      xlsxAttributeValue(column.attributes, "min") !== column.minToken ||
      xlsxAttributeValue(column.attributes, "max") !== column.maxToken
    )
      xlsxInvalid();
  }
  for (const merge of f.worksheet.merges) {
    const ref = xlsxAttributeValue(merge.attributes, "ref");
    if (merge.localName !== "mergeCell" || ref === null) xlsxInvalid();
    xlsxRectangle(ref);
  }
  const allFeatures: XlsxFeature[] = [
    ...f.packageFeatures,
    ...f.worksheet.otherChildren,
    ...f.worksheet.rows.flatMap((row) => row.otherChildren),
    ...f.styleRefs.flatMap((s) => s.otherChildren),
    ...f.sharedStringRefs.flatMap((s) => s.runs.otherChildren),
    ...f.worksheet.rows.flatMap((row) => row.cells.flatMap((c) => c.inlineString?.otherChildren ?? [])),
  ];
  for (const feature of allFeatures) {
    if (feature.reasonCode !== classifyXlsxFeature(feature, f)) xlsxInvalid();
    const gap =
      feature.reasonCode === "xlsx_unmodeled_content_gap" || feature.reasonCode === "xlsx_unsupported_sheet_gap";
    if ((feature.status === "coverage_gap") !== gap) xlsxInvalid();
    if (
      !gap &&
      !["xlsx_unknown_feature_unverified", "xlsx_rich_text_display_unverified", "xlsx_layout_unverified"].includes(
        feature.reasonCode,
      )
    )
      xlsxInvalid();
  }
}

/** Generic read validation checks persisted consistency; it cannot authenticate original XML. */
export function validateXlsxSourcePages(
  pages: Array<{
    pageNumber: number;
    text: string;
    ocrUsed?: boolean;
    needsOcr?: boolean;
    metadata?: { source_provenance?: unknown };
  }>,
) {
  const relevant = pages.some(
    (p) => (p?.metadata?.source_provenance as { format?: string } | undefined)?.format === "xlsx",
  );
  if (!relevant) return;
  if (!pages.length) xlsxInvalid();
  let source: string | null = null,
    workbook: string | null = null,
    audit: string | null = null;
  let total = 0;
  pages.forEach((page, index) => {
    if (!page || typeof page.text !== "string") xlsxInvalid();
    if (
      page.metadata &&
      Object.keys(page.metadata).some((key) => key !== "source_provenance" && key !== "image_coverage_ratio")
    )
      xlsxInvalid();
    if (page.metadata && "image_coverage_ratio" in page.metadata) {
      const value = (page.metadata as { image_coverage_ratio?: unknown }).image_coverage_ratio;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) xlsxInvalid();
    }
    boundedXlsxJson(page.metadata?.source_provenance, L.pageBytes);
    const parsed = xlsxPageSourceProvenanceSchema.safeParse(page.metadata?.source_provenance);
    if (!parsed.success) return xlsxInvalid();
    const p = parsed.data;
    if (page.pageNumber !== index + 1 || p.logicalUnitIndex !== page.pageNumber || page.ocrUsed || page.needsOcr)
      xlsxInvalid();
    validateFacts(p);
    const digest = xlsxFactsSha256(p.sourceFacts),
      normalized = p.textIdentity.metadataNormalizationApplied;
    if (
      digest !== p.sourceFactsIdentity.persistedFactsSha256 ||
      p.textIdentity.persistedTextSha256 !== extractedTextSha256(page.text) ||
      (!p.textIdentity.normalizationApplied &&
        p.textIdentity.originalExtractedTextSha256 !== p.textIdentity.persistedTextSha256) ||
      (!normalized && p.sourceFactsIdentity.originalFactsSha256 !== digest)
    )
      xlsxIdentityMismatch();
    exactCodes(p.reasonCodes, deriveXlsxPageReasons(p), normalized);
    if (
      p.structuralDisposition !== xlsxDisposition(p.reasonCodes) ||
      (normalized && p.structuralDisposition === "retained")
    )
      xlsxInvalid();
    const currentWorkbook = boundedXlsxJson(p.sourceFacts.workbook, L.pageBytes),
      currentAudit = boundedXlsxJson(p.packageAudit, L.pageBytes);
    if (
      (source !== null && source !== p.sourceContentSha256) ||
      (workbook !== null && workbook !== currentWorkbook) ||
      (audit !== null && audit !== currentAudit)
    )
      xlsxIdentityMismatch();
    source = p.sourceContentSha256;
    workbook = currentWorkbook;
    audit = currentAudit;
    if (p.sourceFacts.workbook.sheets.filter((s) => s.status === "emitted_worksheet").length !== pages.length)
      xlsxIdentityMismatch();
    total = xlsxBound(total + Buffer.byteLength(boundedXlsxJson(p, L.pageBytes), "utf8"), L.provenanceBytes);
  });
}

const freshDocuments = new WeakMap<ExtractedDocument, string>();
/** Called only after the producer reconciles actual worksheets to inspected original facts. */
function bindFreshXlsxDocument(document: ExtractedDocument) {
  validateXlsxSourcePages(document.pages);
  for (const page of document.pages) {
    const p = page.metadata?.source_provenance;
    if (
      !p ||
      p.format !== "xlsx" ||
      p.textIdentity.normalizationApplied ||
      p.textIdentity.metadataNormalizationApplied ||
      p.sourceFactsIdentity.originalFactsSha256 !== p.sourceFactsIdentity.persistedFactsSha256
    )
      xlsxIdentityMismatch();
  }
  boundedXlsxJson(document, L.resultBytes);
  freshDocuments.set(document, freshIdentity(document));
  return document;
}
function freshIdentity(document: ExtractedDocument) {
  return xlsxSha(
    boundedXlsxJson(
      {
        pages: document.pages.map((page) => ({
          pageNumber: page.pageNumber,
          text: page.text,
          ocrUsed: page.ocrUsed ?? false,
          needsOcr: page.needsOcr ?? false,
          source: xlsxPageSourceProvenanceSchema.parse(page.metadata?.source_provenance),
          imageCoverage: page.metadata?.image_coverage_ratio ?? null,
        })),
        images: document.images,
      },
      L.resultBytes,
    ),
  );
}
export function hasFreshXlsxBinding(document: ExtractedDocument) {
  return freshDocuments.has(document);
}
export function validateFreshXlsxDocument(document: ExtractedDocument) {
  try {
    validateXlsxSourcePages(document.pages);
    if (freshDocuments.get(document) !== freshIdentity(document)) xlsxIdentityMismatch();
    for (const page of document.pages) {
      const p = page.metadata?.source_provenance;
      if (
        !p ||
        p.format !== "xlsx" ||
        p.textIdentity.normalizationApplied ||
        p.textIdentity.metadataNormalizationApplied
      )
        xlsxIdentityMismatch();
    }
  } catch (error) {
    if (error instanceof XlsxSourceProvenanceError) throw error;
    xlsxInvalid();
  }
}
/** Only locator/identity observations are compared; value tokens can carry qualified sanitized history. */
function locatorIdentity(p: XlsxPageSourceProvenance) {
  const project = (item: unknown, key = ""): unknown => {
    if (Array.isArray(item)) return item.map((child) => project(child));
    if (!item || typeof item !== "object") {
      return [
        "value",
        "textToken",
        "date1904Token",
        "stateToken",
        "targetModeToken",
        "numFmtIdToken",
        "sharedStringIndexToken",
        "explicitStyleIndexToken",
      ].includes(key)
        ? null
        : item;
    }
    return Object.fromEntries(Object.entries(item).map(([childKey, child]) => [childKey, project(child, childKey)]));
  };
  return boundedXlsxJson(
    {
      source: p.sourceContentSha256,
      producer: p.producer,
      audit: p.packageAudit,
      logical: p.logicalUnitIndex,
      facts: project(p.sourceFacts),
    },
    L.pageBytes,
  );
}
export function refreshXlsxAfterSanitation(
  original: XlsxPageSourceProvenance,
  candidate: unknown,
  originalText: string,
  persistedText: string,
  finalPass: boolean,
) {
  const parsed = xlsxPageSourceProvenanceSchema.safeParse(candidate);
  if (!parsed.success) return xlsxInvalid();
  const next = parsed.data;
  if (locatorIdentity(original) !== locatorIdentity(next)) xlsxIdentityMismatch();
  // A source coordinate stored as an attribute is an identity token too.
  const identityAttributes = new Set(["r", "min", "max", "ref", "sheetId", "name", "localSheetId", "id", "si", "s"]);
  const attributeLocators = (value: unknown): unknown[] => {
    const found: unknown[] = [];
    const visit = (v: unknown) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) return v.forEach(visit);
      const record = v as Record<string, unknown>;
      if (
        typeof record.localName === "string" &&
        Object.hasOwn(record, "qualifiedName") &&
        identityAttributes.has(record.localName)
      )
        found.push(record);
      Object.values(record).forEach(visit);
    };
    visit(value);
    return found;
  };
  if (
    boundedXlsxJson(attributeLocators(original.sourceFacts), L.pageBytes) !==
    boundedXlsxJson(attributeLocators(next.sourceFacts), L.pageBytes)
  )
    xlsxIdentityMismatch();
  const originalCanonical = boundedXlsxJson(original, L.pageBytes),
    sanitizedCanonical = boundedXlsxJson(next, L.pageBytes);
  const changed = originalCanonical !== sanitizedCanonical;
  next.sourceFactsIdentity.originalFactsSha256 = original.sourceFactsIdentity.originalFactsSha256;
  next.textIdentity.originalExtractedTextSha256 = original.textIdentity.originalExtractedTextSha256;
  next.textIdentity.persistedTextSha256 = extractedTextSha256(persistedText);
  next.textIdentity.normalizationApplied =
    original.textIdentity.normalizationApplied || (!finalPass && originalText !== persistedText);
  next.textIdentity.metadataNormalizationApplied = original.textIdentity.metadataNormalizationApplied || changed;
  if (finalPass && original.textIdentity.persistedTextSha256 !== extractedTextSha256(persistedText))
    xlsxIdentityMismatch();
  const resolvedStyles = new Set(
    next.sourceFacts.styleRefs.filter((style) => style.resolution !== "unresolved").map((style) => style.sourceIndex),
  );
  for (let r = 0; r < next.sourceFacts.worksheet.rows.length; r++) {
    for (let c = 0; c < next.sourceFacts.worksheet.rows[r].cells.length; c++) {
      const cell = next.sourceFacts.worksheet.rows[r].cells[c],
        before = original.sourceFacts.worksheet.rows[r]?.cells[c];
      if (!before) xlsxIdentityMismatch();
      cell.formulaKind = xlsxFormulaKind(cell.formula);
      const mandatory = classifyXlsxCell(cell);
      if (cell.explicitStyleIndexToken !== null && !resolvedStyles.has(strictIndex(cell.explicitStyleIndexToken) ?? -1))
        mandatory.push("xlsx_style_unresolved");
      cell.reasonCodes = orderedXlsxReasons([...before.reasonCodes, ...mandatory]);
      cell.structuralDisposition = xlsxDisposition(cell.reasonCodes);
    }
  }
  next.sourceFactsIdentity.persistedFactsSha256 = xlsxFactsSha256(next.sourceFacts);
  next.reasonCodes = orderedXlsxReasons([
    ...original.reasonCodes,
    ...deriveXlsxPageReasons(next),
    ...(next.textIdentity.metadataNormalizationApplied ? ["xlsx_metadata_tokens_normalized_unverified" as const] : []),
  ]);
  next.structuralDisposition = xlsxDisposition(next.reasonCodes);
  return next;
}

/** Sole fresh-evidence issuance: actual original bytes, actual producer, complete source reconciliation. */
export async function extractOriginalXlsxDocument(buffer: Buffer): Promise<ExtractedDocument> {
  try {
    xlsxBound(buffer.byteLength, L.receivedBytes);
    // Pin the received bytes across both async loads; callers cannot mutate the source in between.
    buffer = Buffer.from(buffer);
    const source = await preflightOriginalXlsx(buffer);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const budget = new XlsxExtractionBudgetTracker();
    budget.assertSheetCount(workbook.worksheets.length);
    const pages: ExtractedPage[] = [];
    if (workbook.worksheets.length !== source.worksheets.length) xlsxIdentityMismatch();
    const mapped = new Set<number>();
    for (const [index, sheet] of workbook.worksheets.entries()) {
      const facts = source.worksheets.find((f) => {
        const s = f.workbook.sheets[f.worksheet.sourceOrdinal];
        return s.nameToken === sheet.name && strictIndex(s.sheetIdToken) === sheet.id;
      });
      if (
        !facts ||
        mapped.has(facts.worksheet.sourceOrdinal) ||
        facts.workbook.sheets[facts.worksheet.sourceOrdinal].emittedLogicalUnitIndex !== index + 1
      )
        xlsxIdentityMismatch();
      mapped.add(facts.worksheet.sourceOrdinal);
      // Preserve the existing ExcelJS 4.4 stream, including sparse values and empty-sheet newline.
      const heading = `Sheet: ${sheet.name}`;
      const textParts = [heading, "\n"];
      budget.addText(heading);
      budget.addText("\n");
      let rowIndex = 0;
      sheet.eachRow({ includeEmpty: false }, (row) => {
        budget.addRow(row.cellCount);
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        const rowText = values.map((value) => String(value ?? "")).join(",");
        if (rowIndex > 0) {
          budget.addText("\n");
          textParts.push("\n");
        }
        budget.addText(rowText);
        textParts.push(rowText);
        rowIndex += 1;
      });
      const text = textParts.join(""),
        textHash = extractedTextSha256(text),
        canonicalFacts = canonicalXlsxFacts(facts),
        factsHash = xlsxFactsSha256(canonicalFacts);
      const provenance: XlsxPageSourceProvenance = {
        version: "extracted-page-source-v1",
        format: "xlsx",
        coordinateSpace: "xlsx_worksheet_cells",
        logicalUnitIndex: index + 1,
        physicalPageNumber: null,
        sourceContentSha256: source.sourceContentSha256,
        producer: {
          contractVersion: "xlsx-original-xml-v1",
          route: "exceljs_with_original_xml",
          nodeVersion: process.version || null,
          exceljsVersion: "4.4.0",
          jszipVersion: "3.10.2",
          xmldomVersion: "0.8.15",
        },
        packageAudit: source.packageAudit,
        sourceFacts: canonicalFacts,
        sourceFactsIdentity: {
          originalFactsSha256: factsHash,
          persistedFactsSha256: factsHash,
          qualification:
            "XML-decoded extraction facts; stored strings may be sanitized; original XML bytes identified separately; no byte spans",
        },
        structuralDisposition: "retained",
        reasonCodes: [],
        formulaEvaluation: "unperformed",
        cachedResultFreshness: "unknown",
        displayObservation: { status: "unverified", value: null, basis: "none" },
        textMapping: { status: "not_established", offsets: null },
        textIdentity: {
          originalExtractedTextSha256: textHash,
          persistedTextSha256: textHash,
          normalizationApplied: false,
          metadataNormalizationApplied: false,
          qualification: "UTF-8 extracted/persisted text bytes; not original XLSX XML spans",
        },
      };
      provenance.reasonCodes = deriveXlsxPageReasons(provenance);
      provenance.structuralDisposition = xlsxDisposition(provenance.reasonCodes);
      const parsed = xlsxPageSourceProvenanceSchema.safeParse(provenance);
      if (!parsed.success) xlsxInvalid();
      if (
        boundedXlsxJson(parsed.data.sourceFacts, L.pageBytes) !== boundedXlsxJson(canonicalFacts, L.pageBytes) ||
        parsed.data.sourceContentSha256 !== source.sourceContentSha256 ||
        boundedXlsxJson(parsed.data.packageAudit, L.pageBytes) !== boundedXlsxJson(source.packageAudit, L.pageBytes)
      )
        xlsxIdentityMismatch();
      pages.push({ pageNumber: index + 1, text, ocrUsed: false, metadata: { source_provenance: parsed.data } });
      // Account for repeated inventories as they are appended, before the final serialization.
      boundedXlsxJson({ pages, images: [] }, L.resultBytes);
    }
    return bindFreshXlsxDocument({ pages, images: [] });
  } catch (error) {
    if (error instanceof XlsxSourceProvenanceError) throw error;
    return xlsxInvalid();
  }
}
