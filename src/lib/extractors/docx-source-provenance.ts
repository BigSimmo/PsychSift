import { createHash } from "node:crypto";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import type JSZip from "jszip";
import { z } from "zod";
import { assertDeclaredDocxTextBudget, DOCX_EXTRACTION_BUDGET } from "@/lib/extractors/docx-extraction-budget";

const WORD_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const ATTR_REL_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);
const shaSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const disposition = z.enum(["retained", "incomplete", "unverified", "refused"]);
const reasonCodeSchema = z.enum([
  "docx_revision_unverified",
  "docx_hidden_text_unverified",
  "docx_merged_cell_unsupported",
  "docx_source_feature_unsupported",
  "docx_nested_table_unsupported",
  "docx_body_element_unsupported",
  "docx_relationship_missing",
  "docx_relationship_mode_unknown",
  "docx_external_relationship_refused",
  "docx_relationship_unsupported",
]);
type DocxReasonCode = z.infer<typeof reasonCodeSchema>;
const packagePartSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !/[\\:?#%\u0000]/.test(value) &&
      value.split("/").every((part) => part && part !== "." && part !== ".."),
    "docx_package_part_invalid",
  );
const sourcePartSchema = packagePartSchema.refine((value) => value.endsWith(".xml"), "docx_source_xml_part_required");
const locator = z
  .object({ coordinateSourcePart: sourcePartSchema, bodyChildIndex: z.number().int().nonnegative() })
  .strict();
const cellSchema = z.object({ cellIndex: z.number().int().nonnegative(), text: z.string() }).strict();
const rowSchema = z
  .object({
    rowIndex: z.number().int().nonnegative(),
    cells: z.array(cellSchema),
    headerVerified: z.boolean(),
  })
  .strict();
const blockSchema = z
  .object({
    kind: z.enum(["paragraph", "table", "section_break", "unsupported"]),
    ...locator.shape,
    disposition,
    reasonCodes: z.array(reasonCodeSchema),
    text: z.string().optional(),
    sectionBreak: z.boolean().optional(),
    tableIndex: z.number().int().nonnegative().optional(),
    rows: z.array(rowSchema).optional(),
    firstRow: z.array(z.string()).optional(),
    followingParagraphIndex: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((block, context) => {
    if (
      block.kind === "table" &&
      (block.tableIndex === undefined || block.rows === undefined || block.firstRow === undefined)
    )
      context.addIssue({ code: "custom", message: "docx_table_structure_required" });
    if (block.kind === "paragraph" && block.text === undefined)
      context.addIssue({ code: "custom", message: "docx_paragraph_text_required" });
  });
export const docxPageSourceProvenanceSchema = z
  .object({
    version: z.literal("extracted-page-source-v1"),
    format: z.literal("docx"),
    coordinateSpace: z.literal("docx_logical_document"),
    logicalUnitIndex: z.literal(1),
    physicalPageNumber: z.null(),
    sourceContentSha256: shaSchema,
    sourcePart: sourcePartSchema,
    sourcePartSha256: shaSchema,
    structuralDisposition: disposition,
    reasonCodes: z.array(reasonCodeSchema),
    blocks: z.array(blockSchema),
    sourceRelationships: z.array(
      z
        .object({
          relationshipId: z.string().min(1),
          relationshipType: z.string(),
          coordinateSourcePart: sourcePartSchema,
          targetPart: packagePartSchema.nullable(),
          targetMode: z.enum(["internal", "external", "unknown"]),
          disposition: z.enum(["retained", "unresolved", "unsupported", "refused"]),
          reasonCodes: z.array(reasonCodeSchema),
          text: z.string().optional(),
        })
        .strict(),
    ),
    textIdentity: z
      .object({
        originalExtractedTextSha256: shaSchema,
        persistedTextSha256: shaSchema,
        normalizationApplied: z.boolean(),
        metadataNormalizationApplied: z.boolean(),
        qualification: z.literal("UTF-8 extracted/persisted text bytes; not original DOCX spans"),
      })
      .strict(),
  })
  .strict();
export type DocxPageSourceProvenance = z.infer<typeof docxPageSourceProvenanceSchema>;
export function extractedTextSha256(value: string | Uint8Array) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function elements(node: Node): Element[] {
  return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
}
function word(element: Element, name: string) {
  return WORD_NAMESPACES.has(element.namespaceURI ?? "") && element.localName === name;
}
function descendants(element: Element): Element[] {
  return elements(element).flatMap((child) => [child, ...descendants(child)]);
}
function sourceText(element: Element): string {
  if (word(element, "t") || word(element, "delText")) return element.textContent ?? "";
  if (word(element, "tab")) return "\t";
  if (word(element, "br") || word(element, "cr")) return "\n";
  let text = "";
  let paragraphBoundary = false;
  for (const child of elements(element)) {
    const value = sourceText(child);
    if (!value) continue;
    if (text && (paragraphBoundary || word(child, "p"))) text += "\n";
    text += value;
    paragraphBoundary = word(child, "p");
  }
  return text;
}
function unsafeFeatures(element: Element): DocxReasonCode[] {
  const all = [element, ...descendants(element)];
  const codes = new Set<DocxReasonCode>();
  for (const child of all) {
    if (
      child.namespaceURI === "http://schemas.openxmlformats.org/markup-compatibility/2006" &&
      child.localName === "AlternateContent"
    )
      codes.add("docx_source_feature_unsupported");
    if (!WORD_NAMESPACES.has(child.namespaceURI ?? "")) continue;
    if (["ins", "del", "moveFrom", "moveTo"].includes(child.localName ?? "")) codes.add("docx_revision_unverified");
    if (["vanish", "webHidden"].includes(child.localName ?? "")) codes.add("docx_hidden_text_unverified");
    if (["gridSpan", "vMerge"].includes(child.localName ?? "")) codes.add("docx_merged_cell_unsupported");
    if (
      [
        "sym",
        "gridBefore",
        "gridAfter",
        "txbxContent",
        "drawing",
        "pict",
        "object",
        "fldSimple",
        "instrText",
        "footnoteReference",
        "endnoteReference",
      ].includes(child.localName ?? "")
    )
      codes.add("docx_source_feature_unsupported");
  }
  return [...codes];
}
function enabledHeader(row: Element) {
  const properties = elements(row).find((child) => word(child, "trPr"));
  const mark = properties && elements(properties).find((child) => word(child, "tblHeader"));
  if (!mark) return false;
  const attribute = mark.getAttributeNS(mark.namespaceURI, "val") ?? "";
  return !mark.hasAttributeNS(mark.namespaceURI, "val") || ["true", "1", "on"].includes(attribute.trim().toLowerCase());
}
function attr(element: Element, name: string): string {
  return element.getAttribute(name) ?? "";
}
function resolvePart(sourcePart: string, target: string): string | null {
  if (!target || target.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(target) || /[?#%]/.test(target)) return null;
  const resolved = path.posix.normalize(
    target.startsWith("/") ? target.slice(1) : path.posix.join(path.posix.dirname(sourcePart), target),
  );
  return resolved.startsWith("../") || resolved === ".." || resolved.startsWith("/") ? null : resolved;
}

/** Structural source observation only. No clinical inference, rights clearance, or physical pagination. */
export async function buildDocxSourceProvenance(args: {
  zip: JSZip;
  buffer: Buffer;
  originalText: string;
}): Promise<DocxPageSourceProvenance> {
  let totalBytes = 0;
  const parsedParts = new Map<string, { bytes: Buffer; root: Element }>();
  const readXml = async (part: string) => {
    const cached = parsedParts.get(part);
    if (cached) return cached;
    const entry = args.zip.file(part);
    if (!entry) throw new Error("docx_source_part_missing");
    const bytes = await entry.async("nodebuffer");
    totalBytes += bytes.byteLength;
    if (totalBytes > DOCX_EXTRACTION_BUDGET.maxTextBytes)
      throw new Error("DOCX_EXTRACTION_BUDGET_EXCEEDED: source provenance bytes");
    const xml = bytes.toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("docx_xml_dtd_or_entity_refused");
    let invalid = false;
    const document = new DOMParser({
      errorHandler: {
        warning: () => {
          invalid = true;
        },
        error: () => {
          invalid = true;
        },
        fatalError: () => {
          invalid = true;
        },
      },
    }).parseFromString(xml, "application/xml");
    if (invalid || !document.documentElement || document.getElementsByTagName("parsererror").length)
      throw new Error("docx_source_xml_invalid");
    const parsed = { bytes, root: document.documentElement };
    parsedParts.set(part, parsed);
    return parsed;
  };
  const readRelationships = async (part: string) => {
    const parsed = await readXml(part);
    if (parsed.root.namespaceURI !== REL_NS || parsed.root.localName !== "Relationships")
      throw new Error("docx_relationship_xml_invalid");
    const entries = elements(parsed.root);
    const ids = entries.map((entry) => attr(entry, "Id"));
    if (
      entries.some((entry) => entry.namespaceURI !== REL_NS || entry.localName !== "Relationship") ||
      ids.some((id) => !id) ||
      new Set(ids).size !== ids.length
    )
      throw new Error("docx_relationship_identity_invalid");
    return entries;
  };
  // Mammoth also consumes styles, numbering and notes. No consumed package XML
  // can bypass the DTD/entity refusal by living outside the main document part.
  const xmlParts = Object.keys(args.zip.files).filter(
    (part) => !args.zip.files[part].dir && /\.(xml|rels)$/i.test(part),
  );
  // Cover precisely the same package part set BEFORE any entry is inflated.
  assertDeclaredDocxTextBudget(xmlParts.map((part) => args.zip.files[part]));
  if (xmlParts.length > DOCX_EXTRACTION_BUDGET.maxArtifacts)
    throw new Error("DOCX_EXTRACTION_BUDGET_EXCEEDED: source XML part count");
  for (const part of xmlParts) await readXml(part);
  // No style cascade resolver is claimed: any package/style hidden formatting
  // makes visibility unverified for this conservative subset.
  const packageReasonCodes = [
    ...new Set(
      [...parsedParts.values()].flatMap((part) =>
        unsafeFeatures(part.root).filter((code) => code === "docx_hidden_text_unverified"),
      ),
    ),
  ];
  const packageRelationships = await readRelationships("_rels/.rels");
  const mainRelationships = packageRelationships.filter((entry) =>
    [...ATTR_REL_NAMESPACES].some((ns) => attr(entry, "Type") === `${ns}/officeDocument`),
  );
  if (mainRelationships.length !== 1 || !["", "Internal"].includes(attr(mainRelationships[0], "TargetMode")))
    throw new Error("docx_main_source_unresolved");
  const sourcePart = resolvePart("", attr(mainRelationships[0], "Target"));
  if (!sourcePart) throw new Error("docx_main_source_unresolved");
  const source = await readXml(sourcePart);
  if (!word(source.root, "document")) throw new Error("docx_source_xml_invalid");
  const body = elements(source.root).find((child) => word(child, "body"));
  if (!body) throw new Error("docx_source_body_missing");
  let tableIndex = 0;
  const blocks: DocxPageSourceProvenance["blocks"] = elements(body).map(
    (element, bodyChildIndex): DocxPageSourceProvenance["blocks"][number] => {
      const base = {
        coordinateSourcePart: sourcePart,
        bodyChildIndex,
        disposition: "retained" as const,
        reasonCodes: [...new Set([...packageReasonCodes, ...unsafeFeatures(element)])],
      };
      if (word(element, "p"))
        return {
          ...base,
          kind: "paragraph" as const,
          text: sourceText(element),
          sectionBreak: descendants(element).some((child) => word(child, "sectPr")),
        };
      if (word(element, "sectPr")) return { ...base, kind: "section_break" as const };
      if (word(element, "tbl")) {
        if (descendants(element).some((child) => word(child, "tbl")))
          base.reasonCodes.push("docx_nested_table_unsupported");
        const rows = elements(element)
          .filter((child) => word(child, "tr"))
          .map((row, rowIndex) => ({
            rowIndex,
            headerVerified: enabledHeader(row),
            cells: elements(row)
              .filter((child) => word(child, "tc"))
              .map((cell, cellIndex) => ({ cellIndex, text: sourceText(cell) })),
          }));
        if (
          rows.length === 0 ||
          rows.some((row) => row.cells.length === 0 || row.cells.length !== rows[0].cells.length)
        )
          base.reasonCodes.push("docx_source_feature_unsupported");
        return {
          ...base,
          kind: "table" as const,
          tableIndex: tableIndex++,
          rows,
          firstRow: rows[0]?.cells.map((cell) => cell.text) ?? [],
        };
      }
      return {
        ...base,
        kind: "unsupported" as const,
        disposition: "unverified" as const,
        reasonCodes: [...base.reasonCodes, "docx_body_element_unsupported"],
      };
    },
  );
  for (const [index, block] of blocks.entries()) {
    if (block.reasonCodes.length) block.disposition = "unverified";
    if (block.kind === "table" && blocks[index + 1]?.kind === "paragraph")
      block.followingParagraphIndex = blocks[index + 1].bodyChildIndex;
  }
  const relPart = path.posix.join(path.posix.dirname(sourcePart), "_rels", `${path.posix.basename(sourcePart)}.rels`);
  const related = args.zip.file(relPart) ? await readRelationships(relPart) : [];
  const referencedIds = new Set<string>();
  for (const element of [body, ...descendants(body)]) {
    for (const attr of Array.from(element.attributes)) {
      if (ATTR_REL_NAMESPACES.has(attr.namespaceURI ?? "") && ["id", "embed", "link"].includes(attr.localName ?? ""))
        referencedIds.add(attr.value);
    }
  }
  const sourceRelationships: DocxPageSourceProvenance["sourceRelationships"] = [];
  for (const id of referencedIds) {
    const relation = related.find((entry) => attr(entry, "Id") === id);
    const relationshipType = relation?.getAttribute("Type") ?? "";
    const mode = relation?.getAttribute("TargetMode") ?? "";
    const external = mode === "External";
    const unknownMode = Boolean(mode && mode !== "Internal" && mode !== "External");
    const targetPart = relation && !external && !unknownMode ? resolvePart(sourcePart, attr(relation, "Target")) : null;
    const observed: DocxPageSourceProvenance["sourceRelationships"][number] = {
      relationshipId: id,
      relationshipType,
      coordinateSourcePart: sourcePart,
      targetPart,
      targetMode: !relation || unknownMode ? "unknown" : external ? "external" : "internal",
      disposition: !relation || unknownMode ? "unresolved" : external ? "refused" : "unsupported",
      reasonCodes: [
        !relation
          ? "docx_relationship_missing"
          : unknownMode
            ? "docx_relationship_mode_unknown"
            : external
              ? "docx_external_relationship_refused"
              : "docx_relationship_unsupported",
      ],
    };
    const expectedRole = [...ATTR_REL_NAMESPACES].some((ns) => relationshipType === `${ns}/header`)
      ? "hdr"
      : [...ATTR_REL_NAMESPACES].some((ns) => relationshipType === `${ns}/footer`)
        ? "ftr"
        : null;
    if (targetPart && expectedRole && args.zip.file(targetPart)) {
      const parsed = await readXml(targetPart);
      if (word(parsed.root, expectedRole)) {
        observed.text = sourceText(parsed.root);
        observed.coordinateSourcePart = targetPart;
        observed.reasonCodes = [...new Set([...packageReasonCodes, ...unsafeFeatures(parsed.root)])];
        observed.disposition = observed.reasonCodes.length ? "unsupported" : "retained";
      }
    }
    sourceRelationships.push(observed);
  }
  const unitCount =
    blocks.length +
    blocks.reduce((count, block) => count + (block.rows?.reduce((cells, row) => cells + row.cells.length, 0) ?? 0), 0) +
    sourceRelationships.length;
  if (unitCount > DOCX_EXTRACTION_BUDGET.maxArtifacts)
    throw new Error("DOCX_EXTRACTION_BUDGET_EXCEEDED: source provenance units");
  const reasonCodes = [
    ...new Set([
      ...packageReasonCodes,
      ...blocks.flatMap((block) => block.reasonCodes),
      ...sourceRelationships.flatMap((relation) => relation.reasonCodes),
    ]),
  ];
  const textHash = extractedTextSha256(args.originalText);
  const result = {
    version: "extracted-page-source-v1",
    format: "docx",
    coordinateSpace: "docx_logical_document",
    logicalUnitIndex: 1,
    physicalPageNumber: null,
    sourceContentSha256: extractedTextSha256(args.buffer),
    sourcePart,
    sourcePartSha256: extractedTextSha256(source.bytes),
    structuralDisposition: reasonCodes.length ? "incomplete" : "retained",
    reasonCodes,
    blocks,
    sourceRelationships,
    textIdentity: {
      originalExtractedTextSha256: textHash,
      persistedTextSha256: textHash,
      normalizationApplied: false,
      metadataNormalizationApplied: false,
      qualification: "UTF-8 extracted/persisted text bytes; not original DOCX spans",
    },
  };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > DOCX_EXTRACTION_BUDGET.maxTextBytes)
    throw new Error("DOCX_EXTRACTION_BUDGET_EXCEEDED: serialized provenance bytes");
  return docxPageSourceProvenanceSchema.parse(result);
}
