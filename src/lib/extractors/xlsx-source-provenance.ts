import { z } from "zod";
import ExcelJS from "exceljs";
import type { ExtractedDocument, ExtractedPage } from "../types";
import { extractedTextSha256 } from "./docx-source-provenance";
import { XlsxSourceProvenanceError, XlsxExtractionBudgetTracker } from "./xlsx-extraction-budget";
import { preflightOriginalXlsx } from "./xlsx-source-preflight";
import {
  boundedXlsxJson,
  isCanonicalXlsxPart,
  XLSX_SOURCE_LIMITS as L,
  xlsxBound,
  xlsxIdentityMismatch,
  xlsxInvalid,
  xlsxSha,
} from "./xlsx-original-zip";

export { XlsxSourceProvenanceError } from "./xlsx-extraction-budget";
export const XLSX_REASON_CODES = [
  "xlsx_formula_interpretation_unverified",
  "xlsx_formula_kind_unverified",
  "xlsx_formula_cache_absent",
  "xlsx_source_error_unverified",
  "xlsx_source_type_unverified",
  "xlsx_shared_string_unresolved",
  "xlsx_style_unresolved",
  "xlsx_effective_style_unverified",
  "xlsx_rich_text_display_unverified",
  "xlsx_visibility_unverified",
  "xlsx_merge_interpretation_unverified",
  "xlsx_layout_unverified",
  "xlsx_external_relationship_unresolved",
  "xlsx_unknown_feature_unverified",
  "xlsx_unsupported_sheet_gap",
  "xlsx_unmodeled_content_gap",
  "xlsx_runtime_identity_unknown",
  "xlsx_metadata_tokens_normalized_unverified",
] as const;
export type XlsxReasonCode = (typeof XLSX_REASON_CODES)[number];
const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const integer = (max: number) => z.number().int().nonnegative().max(max).refine(Number.isSafeInteger);
function validDecodedToken(value: string) {
  for (const character of value) {
    const n = character.codePointAt(0)!;
    if (!(
      n === 9 ||
      n === 10 ||
      n === 13 ||
      (n >= 32 && n <= 0xd7ff) ||
      (n >= 0xe000 && n <= 0xfffd) ||
      (n >= 0x10000 && n <= 0x10ffff)
    ))
      return false;
  }
  return true;
}
const token = z
  .string()
  .refine((value) => Buffer.byteLength(value, "utf8") <= L.tokenBytes && validDecodedToken(value));
const identity = z
  .string()
  .min(1)
  .refine((value) => Buffer.byteLength(value, "utf8") <= L.identityBytes && validDecodedToken(value));
const nullableToken = token.nullable();
const codes = z.array(z.enum(XLSX_REASON_CODES)).max(XLSX_REASON_CODES.length);
const disposition = z.enum(["retained", "unverified", "incomplete"]);
export const xlsxPartSchema = z
  .object({ name: identity.refine((value) => isCanonicalXlsxPart(value)), originalBytesSha256: sha })
  .strict();
export const xlsxAttributeSchema = z
  .object({
    namespaceUri: token.refine((v) => Buffer.byteLength(v, "utf8") <= L.identityBytes),
    localName: identity.refine((v) => !v.includes(":")),
    qualifiedName: identity,
    value: token,
  })
  .strict()
  .refine(
    (a) =>
      a.qualifiedName === a.localName ||
      (a.namespaceUri !== "" && a.qualifiedName.endsWith(`:${a.localName}`) && a.qualifiedName.split(":").length === 2),
  );
const attributes = z.array(xlsxAttributeSchema).max(L.attributes);
export const xlsxNodeTokenSchema = z
  .object({
    namespaceUri: token.refine((v) => Buffer.byteLength(v, "utf8") <= L.identityBytes),
    localName: identity,
    attributes,
    textToken: token,
  })
  .strict();
export const xlsxRelationshipSchema = z
  .object({
    sourcePart: xlsxPartSchema,
    idToken: identity,
    typeToken: token,
    targetModeToken: nullableToken,
    targetTokenSha256: sha,
    resolvedInternalPart: xlsxPartSchema.nullable(),
    status: z.enum(["internal_resolved", "external_unresolved", "unknown_unresolved"]),
  })
  .strict();
export const xlsxFeatureSchema = z
  .object({
    sourcePart: xlsxPartSchema,
    elementOrdinal: integer(L.nodes),
    namespaceUri: token.refine((v) => Buffer.byteLength(v, "utf8") <= L.identityBytes),
    localName: identity,
    attributes,
    status: z.enum(["source_observed_unverified", "coverage_gap"]),
    reasonCode: z.enum(XLSX_REASON_CODES),
  })
  .strict();
export const xlsxStringRunsSchema = z
  .object({
    attributes,
    textTokens: z.array(xlsxNodeTokenSchema).max(L.runs),
    otherChildren: z.array(xlsxFeatureSchema).max(L.features),
  })
  .strict();
export const xlsxCellSchema = z
  .object({
    elementIndex: integer(L.cells),
    address: identity,
    rowNumber: integer(1_048_576).refine((n) => n > 0),
    columnNumber: integer(16_384).refine((n) => n > 0),
    attributes,
    value: xlsxNodeTokenSchema.nullable(),
    formula: xlsxNodeTokenSchema.nullable(),
    formulaKind: z.enum(["none", "direct", "shared", "array", "data_table", "unknown"]),
    inlineString: xlsxStringRunsSchema.nullable(),
    sharedStringIndexToken: nullableToken,
    resolvedSharedString: xlsxStringRunsSchema.nullable(),
    explicitStyleIndexToken: nullableToken,
    structuralDisposition: disposition,
    reasonCodes: codes,
  })
  .strict();
export const xlsxRowSchema = z
  .object({
    elementIndex: integer(L.rows),
    rowNumberToken: identity,
    attributes,
    cells: z.array(xlsxCellSchema).max(L.cells),
    otherChildren: z.array(xlsxFeatureSchema).max(L.features),
  })
  .strict();
export const xlsxColumnSchema = z
  .object({ elementIndex: integer(L.definitions), minToken: identity, maxToken: identity, attributes })
  .strict();
export const xlsxSheetEntrySchema = z
  .object({
    sourceOrdinal: integer(L.sheets - 1),
    sheetIdToken: identity,
    nameToken: identity,
    relationshipIdToken: identity,
    stateToken: nullableToken,
    relationshipTypeToken: token,
    resolvedPart: xlsxPartSchema,
    emittedLogicalUnitIndex: integer(L.sheets)
      .refine((n) => n > 0)
      .nullable(),
    status: z.enum(["emitted_worksheet", "unsupported_sheet"]),
    reasonCodes: codes,
  })
  .strict();
export const xlsxSourceFactsSchema = z
  .object({
    packageRelationships: z.array(xlsxRelationshipSchema).max(L.relationships),
    workbook: z
      .object({
        part: xlsxPartSchema,
        relationshipsPart: xlsxPartSchema,
        relationships: z.array(xlsxRelationshipSchema).max(L.relationships),
        date1904Token: nullableToken,
        calcPr: xlsxNodeTokenSchema.nullable(),
        definedNames: z.array(xlsxNodeTokenSchema).max(L.names),
        sheets: z.array(xlsxSheetEntrySchema).max(L.sheets),
      })
      .strict(),
    worksheet: z
      .object({
        sourceOrdinal: integer(L.sheets - 1),
        part: xlsxPartSchema,
        relationshipsPart: xlsxPartSchema.nullable(),
        relationships: z.array(xlsxRelationshipSchema).max(L.relationships),
        rootAttributes: attributes,
        rows: z.array(xlsxRowSchema).max(L.rows),
        columns: z.array(xlsxColumnSchema).max(L.definitions),
        merges: z.array(xlsxNodeTokenSchema).max(L.definitions),
        printNodes: z.array(xlsxNodeTokenSchema).max(L.features),
        otherChildren: z.array(xlsxFeatureSchema).max(L.features),
      })
      .strict(),
    stylesPart: xlsxPartSchema.nullable(),
    styleRefs: z
      .array(
        z
          .object({
            sourceIndex: integer(L.cells),
            cellXf: xlsxNodeTokenSchema,
            numFmtIdToken: nullableToken,
            customNumFmt: xlsxNodeTokenSchema.nullable(),
            otherChildren: z.array(xlsxFeatureSchema).max(L.features),
            resolution: z.enum(["custom_source", "id_only", "unresolved"]),
          })
          .strict(),
      )
      .max(L.styles),
    sharedStringsPart: xlsxPartSchema.nullable(),
    sharedStringRefs: z
      .array(
        z.object({ sourceIndex: integer(L.cells), sourcePart: xlsxPartSchema, runs: xlsxStringRunsSchema }).strict(),
      )
      .max(L.strings),
    packageFeatures: z.array(xlsxFeatureSchema).max(L.features),
  })
  .strict();
export const xlsxPageSourceProvenanceSchema = z
  .object({
    version: z.literal("extracted-page-source-v1"),
    format: z.literal("xlsx"),
    coordinateSpace: z.literal("xlsx_worksheet_cells"),
    logicalUnitIndex: integer(L.sheets).refine((n) => n > 0),
    physicalPageNumber: z.null(),
    sourceContentSha256: sha,
    producer: z
      .object({
        contractVersion: z.literal("xlsx-original-xml-v1"),
        route: z.literal("exceljs_with_original_xml"),
        nodeVersion: identity.nullable(),
        exceljsVersion: z.literal("4.4.0"),
        jszipVersion: z.literal("3.10.2"),
        xmldomVersion: z.literal("0.8.15"),
      })
      .strict(),
    packageAudit: z
      .object({
        memberCount: integer(L.members),
        xmlPartCount: integer(L.xmlParts),
        expandedBytes: integer(L.expandedBytes),
        originalMemberManifestSha256: sha,
      })
      .strict(),
    sourceFacts: xlsxSourceFactsSchema,
    sourceFactsIdentity: z
      .object({
        originalFactsSha256: sha,
        persistedFactsSha256: sha,
        qualification: z.literal(
          "XML-decoded extraction facts; stored strings may be sanitized; original XML bytes identified separately; no byte spans",
        ),
      })
      .strict(),
    structuralDisposition: disposition,
    reasonCodes: codes,
    formulaEvaluation: z.literal("unperformed"),
    cachedResultFreshness: z.literal("unknown"),
    displayObservation: z
      .object({ status: z.literal("unverified"), value: z.null(), basis: z.literal("none") })
      .strict(),
    textMapping: z.object({ status: z.literal("not_established"), offsets: z.null() }).strict(),
    textIdentity: z
      .object({
        originalExtractedTextSha256: sha,
        persistedTextSha256: sha,
        normalizationApplied: z.boolean(),
        metadataNormalizationApplied: z.boolean(),
        qualification: z.literal("UTF-8 extracted/persisted text bytes; not original XLSX XML spans"),
      })
      .strict(),
  })
  .strict();
export type XlsxPageSourceProvenance = z.infer<typeof xlsxPageSourceProvenanceSchema>;
export type XlsxSourceFacts = z.infer<typeof xlsxSourceFactsSchema>;
export type XlsxCell = z.infer<typeof xlsxCellSchema>;
export type XlsxFeature = z.infer<typeof xlsxFeatureSchema>;
export type XlsxAttribute = z.infer<typeof xlsxAttributeSchema>;
export type XlsxNodeToken = z.infer<typeof xlsxNodeTokenSchema>;
export type XlsxStringRuns = z.infer<typeof xlsxStringRunsSchema>;
export type XlsxPart = z.infer<typeof xlsxPartSchema>;
export type XlsxRelationship = z.infer<typeof xlsxRelationshipSchema>;

export function xlsxAttributeValue(attrs: XlsxAttribute[], name: string, namespaceUri = "") {
  return attrs.find((a) => a.namespaceUri === namespaceUri && a.localName === name)?.value ?? null;
}
export function orderedXlsxReasons(reasons: Iterable<XlsxReasonCode>): XlsxReasonCode[] {
  const set = new Set(reasons);
  return XLSX_REASON_CODES.filter((code) => set.has(code));
}
export function xlsxDisposition(reasons: readonly XlsxReasonCode[]) {
  return reasons.some((code) => code === "xlsx_unsupported_sheet_gap" || code === "xlsx_unmodeled_content_gap")
    ? ("incomplete" as const)
    : reasons.length
      ? ("unverified" as const)
      : ("retained" as const);
}
const sheetNamespaces = new Set([
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://purl.oclc.org/ooxml/spreadsheetml/main",
]);
const relNamespaces = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);
export function xlsxFormulaKind(formula: XlsxNodeToken | null): XlsxCell["formulaKind"] {
  if (!formula) return "none";
  const type = xlsxAttributeValue(formula.attributes, "t");
  return type === null || type === "normal"
    ? "direct"
    : type === "shared"
      ? "shared"
      : type === "array"
        ? "array"
        : type === "dataTable"
          ? "data_table"
          : "unknown";
}
const falseHidden = new Set(["0", "false"]);
const sourceTypes = new Set(["n", "s", "str", "b", "e", "inlineStr", "d"]);
function unknownAttributes(attrs: XlsxAttribute[], known: readonly string[]) {
  return attrs.some(
    (a) =>
      !(a.namespaceUri === "" && known.includes(a.localName)) &&
      !(a.namespaceUri === "http://www.w3.org/XML/1998/namespace" && a.localName === "space") &&
      !(relNamespaces.has(a.namespaceUri) && a.localName === "id"),
  );
}
export function classifyXlsxCell(cell: XlsxCell): XlsxReasonCode[] {
  const reasons: XlsxReasonCode[] = [];
  if (cell.formula) {
    reasons.push("xlsx_formula_interpretation_unverified");
    if (xlsxFormulaKind(cell.formula) !== "direct") reasons.push("xlsx_formula_kind_unverified");
    if (!cell.value) reasons.push("xlsx_formula_cache_absent");
    if (
      unknownAttributes(cell.formula.attributes, [
        "t",
        "ref",
        "si",
        "aca",
        "bx",
        "ca",
        "del1",
        "del2",
        "dt2D",
        "dtr",
        "r1",
        "r2",
      ])
    )
      reasons.push("xlsx_unknown_feature_unverified");
  }
  const type = xlsxAttributeValue(cell.attributes, "t");
  if (type === "e") reasons.push("xlsx_source_error_unverified");
  if (type !== null && !sourceTypes.has(type)) reasons.push("xlsx_source_type_unverified");
  if (type === "s" && !cell.resolvedSharedString) reasons.push("xlsx_shared_string_unresolved");
  const runs = cell.inlineString ?? cell.resolvedSharedString;
  if (runs) {
    reasons.push(...featureReasons(runs.otherChildren));
    if (unknownAttributes(runs.attributes, []) || runs.textTokens.some((t) => unknownAttributes(t.attributes, [])))
      reasons.push("xlsx_unknown_feature_unverified");
  }
  if (
    unknownAttributes(cell.attributes, ["r", "s", "t", "cm", "vm", "ph"]) ||
    (cell.value && unknownAttributes(cell.value.attributes, []))
  )
    reasons.push("xlsx_unknown_feature_unverified");
  return orderedXlsxReasons(reasons);
}
/** Derive the current feature class from observed identity, never from its supplied reason/status. */
export function classifyXlsxFeature(
  feature: Pick<XlsxFeature, "sourcePart" | "namespaceUri" | "localName">,
  facts?: XlsxSourceFacts,
): XlsxReasonCode {
  const part = feature.sourcePart.name;
  if (facts?.workbook.sheets.some((sheet) => sheet.status === "unsupported_sheet" && sheet.resolvedPart.name === part))
    return "xlsx_unsupported_sheet_gap";
  const spreadsheet = sheetNamespaces.has(feature.namespaceUri);
  if (
    spreadsheet &&
    feature.localName === "worksheet" &&
    facts &&
    !facts.workbook.sheets.some((sheet) => sheet.status === "emitted_worksheet" && sheet.resolvedPart.name === part)
  )
    return "xlsx_unmodeled_content_gap";
  if (
    /^xl\/(?:drawings|charts|media|comments|tables|pivotTables|pivotCache)\//.test(part) ||
    /^xl\/comments\d+[.]xml$/.test(part) ||
    /[.]vml$/.test(part) ||
    (spreadsheet &&
      [
        "drawing",
        "legacyDrawing",
        "legacyDrawingHF",
        "picture",
        "chartsheet",
        "comments",
        "comment",
        "tableParts",
        "tablePart",
        "table",
        "pivotTable",
        "pivotTableDefinition",
        "pivotCacheDefinition",
        "pivotCacheRecords",
      ].includes(feature.localName)) ||
    /^(?:http:\/\/schemas[.]openxmlformats[.]org\/drawingml\/2006\/|http:\/\/purl[.]oclc[.]org\/ooxml\/drawingml\/)/.test(
      feature.namespaceUri,
    )
  )
    return "xlsx_unmodeled_content_gap";
  if (spreadsheet && ["r", "rPr", "rPh", "phoneticPr"].includes(feature.localName))
    return "xlsx_rich_text_display_unverified";
  if (
    spreadsheet &&
    ["pageSetup", "pageMargins", "rowBreaks", "colBreaks", "printOptions", "headerFooter"].includes(feature.localName)
  )
    return "xlsx_layout_unverified";
  return "xlsx_unknown_feature_unverified";
}
function featureReasons(features: XlsxFeature[], facts?: XlsxSourceFacts): XlsxReasonCode[] {
  return features.map((feature) => classifyXlsxFeature(feature, facts));
}
export function deriveXlsxPageReasons(provenance: XlsxPageSourceProvenance): XlsxReasonCode[] {
  const f = provenance.sourceFacts,
    reasons: XlsxReasonCode[] = [];
  const resolvedStyles = new Set(
    f.styleRefs.filter((style) => style.resolution !== "unresolved").map((style) => style.sourceIndex),
  );
  if (unknownAttributes(f.worksheet.rootAttributes, [])) reasons.push("xlsx_unknown_feature_unverified");
  if (provenance.producer.nodeVersion === null) reasons.push("xlsx_runtime_identity_unknown");
  for (const sheet of f.workbook.sheets) {
    if (sheet.status === "unsupported_sheet") reasons.push("xlsx_unsupported_sheet_gap");
    if (sheet.stateToken !== null && sheet.stateToken !== "visible") reasons.push("xlsx_visibility_unverified");
  }
  for (const relation of [...f.packageRelationships, ...f.workbook.relationships, ...f.worksheet.relationships]) {
    if (relation.status === "external_unresolved") reasons.push("xlsx_external_relationship_unresolved");
    if (relation.status === "unknown_unresolved") reasons.push("xlsx_unknown_feature_unverified");
  }
  for (const row of f.worksheet.rows) {
    const hidden = xlsxAttributeValue(row.attributes, "hidden");
    if (hidden !== null && !falseHidden.has(hidden)) reasons.push("xlsx_visibility_unverified");
    if (xlsxAttributeValue(row.attributes, "s") !== null) reasons.push("xlsx_effective_style_unverified");
    if (
      unknownAttributes(row.attributes, [
        "r",
        "spans",
        "s",
        "customFormat",
        "ht",
        "hidden",
        "customHeight",
        "outlineLevel",
        "collapsed",
        "thickTop",
        "thickBot",
        "ph",
      ])
    )
      reasons.push("xlsx_unknown_feature_unverified");
    reasons.push(...featureReasons(row.otherChildren, f));
    for (const cell of row.cells) {
      reasons.push(...classifyXlsxCell(cell));
      if (cell.explicitStyleIndexToken !== null && !resolvedStyles.has(strictIndex(cell.explicitStyleIndexToken) ?? -1))
        reasons.push("xlsx_style_unresolved");
    }
  }
  let previousMax = 0;
  for (const column of f.worksheet.columns) {
    const hidden = xlsxAttributeValue(column.attributes, "hidden");
    if (hidden !== null && !falseHidden.has(hidden)) reasons.push("xlsx_visibility_unverified");
    if (xlsxAttributeValue(column.attributes, "style") !== null) reasons.push("xlsx_effective_style_unverified");
    if (Number(column.minToken) <= previousMax)
      reasons.push("xlsx_effective_style_unverified", "xlsx_visibility_unverified");
    previousMax = Math.max(previousMax, Number(column.maxToken));
    if (
      unknownAttributes(column.attributes, [
        "min",
        "max",
        "width",
        "style",
        "hidden",
        "bestFit",
        "customWidth",
        "phonetic",
        "outlineLevel",
        "collapsed",
      ])
    )
      reasons.push("xlsx_unknown_feature_unverified");
  }
  if (f.worksheet.merges.length) reasons.push("xlsx_merge_interpretation_unverified");
  if (f.worksheet.printNodes.length) reasons.push("xlsx_layout_unverified");
  for (const name of f.workbook.definedNames)
    reasons.push(
      xlsxAttributeValue(name.attributes, "name")?.startsWith("_xlnm.Print_")
        ? "xlsx_layout_unverified"
        : "xlsx_unknown_feature_unverified",
    );
  reasons.push(...featureReasons(f.worksheet.otherChildren, f), ...featureReasons(f.packageFeatures, f));
  for (const style of f.styleRefs) {
    reasons.push(...featureReasons(style.otherChildren, f));
    if (
      unknownAttributes(style.cellXf.attributes, [
        "numFmtId",
        "fontId",
        "fillId",
        "borderId",
        "xfId",
        "applyNumberFormat",
        "applyFont",
        "applyFill",
        "applyBorder",
        "applyAlignment",
        "applyProtection",
        "pivotButton",
        "quotePrefix",
      ]) ||
      (style.customNumFmt && unknownAttributes(style.customNumFmt.attributes, ["numFmtId", "formatCode"]))
    )
      reasons.push("xlsx_unknown_feature_unverified");
  }
  for (const string of f.sharedStringRefs) reasons.push(...featureReasons(string.runs.otherChildren, f));
  if (
    provenance.textIdentity.metadataNormalizationApplied ||
    provenance.sourceFactsIdentity.originalFactsSha256 !== provenance.sourceFactsIdentity.persistedFactsSha256
  )
    reasons.push("xlsx_metadata_tokens_normalized_unverified");
  return orderedXlsxReasons(reasons);
}
export function strictIndex(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
export function xlsxAddress(value: string) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value);
  if (!match) return xlsxInvalid();
  let column = 0;
  for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (column > 16_384 || row > 1_048_576) xlsxInvalid();
  return { row, column };
}
export function xlsxRectangle(value: string) {
  const pieces = value.split(":");
  if (pieces.length > 2) xlsxInvalid();
  const first = xlsxAddress(pieces[0]),
    last = xlsxAddress(pieces[1] ?? pieces[0]);
  if (first.row > last.row || first.column > last.column) xlsxInvalid();
  return { top: first.row, bottom: last.row, left: first.column, right: last.column };
}
export function canonicalXlsxFacts(value: unknown): XlsxSourceFacts {
  const parsed = xlsxSourceFactsSchema.safeParse(value);
  if (!parsed.success) return xlsxInvalid();
  return parsed.data;
}
export function xlsxFactsSha256(value: unknown) {
  return xlsxSha(boundedXlsxJson(canonicalXlsxFacts(value), L.pageBytes));
}
function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function compareXlsxAttributes(a: XlsxAttribute, b: XlsxAttribute) {
  return (
    compareText(a.namespaceUri, b.namespaceUri) ||
    compareText(a.localName, b.localName) ||
    compareText(a.qualifiedName, b.qualifiedName)
  );
}
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
