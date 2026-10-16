import { z } from "zod";
import {
  boundedXlsxJson,
  isCanonicalXlsxPart,
  XLSX_SOURCE_LIMITS as L,
  xlsxInvalid,
  xlsxSha,
} from "./xlsx-original-zip";

// XLSX source-fact shapes and pure classifiers, shared by the preflight reader and the
// provenance validator. Kept separate so neither of those modules imports the other.
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

export { sheetNamespaces as XLSX_SHEET_NAMESPACES, relNamespaces as XLSX_RELATIONSHIP_NAMESPACES };
