import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { XlsxSourceProvenanceError } from "./xlsx-extraction-budget";
import {
  openOriginalXlsxArchive,
  readOriginalXlsxMember,
  strictUtf8,
  boundedXlsxJson,
  XLSX_SOURCE_LIMITS as L,
  xlsxBound,
  xlsxInvalid,
  xlsxIdentityMismatch,
  xlsxSha,
  type OriginalXlsxArchive,
} from "./xlsx-original-zip";
import {
  compareXlsxAttributes,
  xlsxAttributeValue,
  xlsxAddress,
  xlsxRectangle,
  xlsxFormulaKind,
  classifyXlsxCell,
  classifyXlsxFeature,
  orderedXlsxReasons,
  xlsxDisposition,
  strictIndex,
  type XlsxAttribute,
  type XlsxCell,
  type XlsxFeature,
  type XlsxNodeToken,
  type XlsxPart,
  type XlsxRelationship,
  type XlsxSourceFacts,
  type XlsxStringRuns,
  type XlsxReasonCode,
} from "./xlsx-source-provenance";

const SS = new Set([
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://purl.oclc.org/ooxml/spreadsheetml/main",
]);
const OFFICE = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const XMLNS = "http://www.w3.org/2000/xmlns/";
const XML = "http://www.w3.org/XML/1998/namespace";
function officeType(value: string, local: string) {
  return [...OFFICE].some((namespace) => value === `${namespace}/${local}`);
}
function children(node: Node): Element[] {
  return Array.from(node.childNodes ?? []).filter((n): n is Element => n.nodeType === 1);
}
function ss(node: Element, name: string) {
  return SS.has(node.namespaceURI ?? "") && node.localName === name;
}
function attr(node: Element, name: string) {
  return node.hasAttribute(name) ? node.getAttribute(name) : null;
}
function required(node: Element, name: string) {
  const value = attr(node, name);
  if (value === null || value === "") return xlsxInvalid();
  return value;
}
function only(node: Element, name: string) {
  const matches = children(node).filter((child) => ss(child, name));
  if (matches.length > 1) xlsxInvalid();
  return matches[0] ?? null;
}
const active = /(?:vbaProject|macroEnabled|activeX|oleObject|embeddedPackage|\/embeddings\/|\/vbaProject|\/activeX\/)/i;
function validXmlCharacters(value: string) {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (!(
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff)
    ))
      xlsxInvalid();
  }
}
class SourceBudget {
  nodes = 0;
  relationships = 0;
  rows = 0;
  cells = 0;
  definitions = 0;
  merges = 0;
  features = 0;
  allocation = 0;
  rowUnits = 0;
  pairWork = 0;
  addAllocation(value: number) {
    this.allocation = xlsxBound(this.allocation + value, L.allocation);
  }
  addRows(value: number) {
    this.rowUnits = xlsxBound(this.rowUnits + value, L.rows);
  }
}
function parseXml(bytes: Buffer, budget: SourceBudget) {
  let text = strictUtf8(bytes);
  if (text.startsWith("\ufeff")) text = text.slice(1);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) xlsxInvalid();
  const declaration = /^<\?xml\s+[^?]*\?>/.exec(text)?.[0];
  const encoding = declaration?.match(/\bencoding\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (encoding && !/^utf-8$/i.test(encoding)) xlsxInvalid();
  validXmlCharacters(text);
  let malformed = false;
  const doc = new DOMParser({
    errorHandler: {
      warning: () => {
        malformed = true;
      },
      error: () => {
        malformed = true;
      },
      fatalError: () => {
        malformed = true;
      },
    },
  }).parseFromString(text, "application/xml");
  if (malformed || children(doc).length !== 1 || !doc.documentElement) xlsxInvalid();
  const stack: Array<[Node, number]> = [[doc, 0]];
  const ordinals = new WeakMap<Element, number>();
  let ordinal = 0;
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    budget.nodes = xlsxBound(budget.nodes + 1, L.nodes);
    xlsxBound(depth, L.depth);
    if (node.nodeType === 10 || node.nodeType === 5) xlsxInvalid();
    if (node.nodeType === 3 || node.nodeType === 4 || node.nodeType === 7 || node.nodeType === 8) {
      const value = node.nodeValue ?? "";
      validXmlCharacters(value);
      xlsxBound(Buffer.byteLength(value, "utf8"), L.tokenBytes);
    }
    if (node.nodeType === 1) {
      const element = node as Element;
      ordinals.set(element, ordinal++);
      xlsxBound(element.attributes.length, L.attributes);
      const expanded = new Set<string>();
      const ns = element.namespaceURI ?? "",
        local = element.localName ?? "";
      if (
        !local ||
        (element.prefix && (element.prefix === "xml" ? ns !== XML : element.lookupNamespaceURI(element.prefix) !== ns))
      )
        xlsxInvalid();
      for (const value of [ns, local, element.nodeName]) xlsxBound(Buffer.byteLength(value, "utf8"), L.identityBytes);
      for (const attribute of Array.from(element.attributes)) {
        validXmlCharacters(attribute.value);
        xlsxBound(Buffer.byteLength(attribute.value, "utf8"), L.tokenBytes);
        for (const value of [attribute.namespaceURI ?? "", attribute.localName ?? "", attribute.name])
          xlsxBound(Buffer.byteLength(value, "utf8"), L.identityBytes);
        const key = `${attribute.namespaceURI ?? ""}\u0000${attribute.localName}`;
        if (expanded.has(key)) xlsxInvalid();
        expanded.add(key);
        if (attribute.namespaceURI === XMLNS) {
          if (
            attribute.name === "xmlns:xmlns" ||
            attribute.value === XMLNS ||
            (attribute.name === "xmlns:xml" && attribute.value !== XML) ||
            (attribute.name !== "xmlns:xml" && attribute.value === XML) ||
            (attribute.prefix === "xmlns" && !attribute.value)
          )
            xlsxInvalid();
        } else if (
          attribute.prefix &&
          (attribute.prefix === "xml"
            ? attribute.namespaceURI !== XML
            : element.lookupNamespaceURI(attribute.prefix) !== attribute.namespaceURI)
        )
          xlsxInvalid();
      }
    }
    // xmldom terminal Text/CDATA/Comment/PI nodes have no childNodes list.
    const nodes = Array.from(node.childNodes ?? []);
    for (let i = nodes.length - 1; i >= 0; i--) stack.push([nodes[i], depth + 1]);
  }
  return { doc, ordinals };
}
function attrs(node: Element): XlsxAttribute[] {
  return Array.from(node.attributes)
    .filter((a) => a.namespaceURI !== XMLNS)
    .map((a) => ({
      namespaceUri: a.namespaceURI ?? "",
      localName: a.localName ?? a.name,
      qualifiedName: a.name,
      value: a.value,
    }))
    .sort(compareXlsxAttributes);
}
function unmodeledAttributes(node: Element, known: readonly string[]) {
  return attrs(node).some(
    (a) =>
      !(a.namespaceUri === "" && known.includes(a.localName)) && !(OFFICE.has(a.namespaceUri) && a.localName === "id"),
  );
}
function nodeToken(node: Element, leaf = true): XlsxNodeToken {
  if (leaf && children(node).length) xlsxInvalid();
  const textToken = node.textContent ?? "";
  xlsxBound(Buffer.byteLength(textToken, "utf8"), L.tokenBytes);
  return { namespaceUri: node.namespaceURI ?? "", localName: node.localName ?? "", attributes: attrs(node), textToken };
}
type ParsedPart = { part: XlsxPart; doc: Document; ordinals: WeakMap<Element, number> };
const workbookConsumerNames = new Set([
  "workbook",
  "fileVersion",
  "workbookPr",
  "bookViews",
  "workbookView",
  "sheets",
  "sheet",
  "definedNames",
  "definedName",
  "calcPr",
]);
const worksheetConsumerNames = new Set([
  "worksheet",
  "sheetPr",
  "dimension",
  "sheetViews",
  "sheetView",
  "sheetFormatPr",
  "cols",
  "col",
  "sheetData",
  "row",
  "c",
  "v",
  "f",
  "is",
  "t",
  "r",
  "rPr",
  "rPh",
  "phoneticPr",
  "mergeCells",
  "mergeCell",
  "dataValidations",
  "dataValidation",
  "formula1",
  "formula2",
  "pageSetup",
  "pageMargins",
  "rowBreaks",
  "colBreaks",
  "brk",
  "printOptions",
  "headerFooter",
  "oddHeader",
  "evenHeader",
  "firstHeader",
  "oddFooter",
  "evenFooter",
  "firstFooter",
  "hyperlinks",
  "hyperlink",
  "drawing",
  "legacyDrawing",
  "legacyDrawingHF",
  "picture",
  "tableParts",
  "tablePart",
  "sheetProtection",
  "autoFilter",
]);
const stringConsumerNames = new Set(["sst", "si", "is", "t", "r", "rPr", "rPh", "phoneticPr"]);
const styleConsumerNames = new Set([
  "styleSheet",
  "numFmts",
  "numFmt",
  "fonts",
  "font",
  "name",
  "sz",
  "b",
  "i",
  "u",
  "strike",
  "outline",
  "shadow",
  "condense",
  "extend",
  "vertAlign",
  "charset",
  "family",
  "scheme",
  "color",
  "fills",
  "fill",
  "patternFill",
  "fgColor",
  "bgColor",
  "gradientFill",
  "stop",
  "borders",
  "border",
  "left",
  "right",
  "top",
  "bottom",
  "diagonal",
  "vertical",
  "horizontal",
  "cellStyleXfs",
  "cellXfs",
  "xf",
  "alignment",
  "protection",
  "cellStyles",
  "cellStyle",
  "dxfs",
  "dxf",
  "tableStyles",
  "tableStyle",
]);
/** The installed xforms dispatch lexical names; wrong default namespaces cannot bypass source quotas. */
function assertConsumerNamespaces(source: ParsedPart) {
  const name = source.part.name;
  const recognized =
    name === "xl/workbook.xml"
      ? workbookConsumerNames
      : /^xl\/worksheets\/sheet\d+[.]xml$/.test(name)
        ? worksheetConsumerNames
        : name === "xl/sharedStrings.xml"
          ? stringConsumerNames
          : name === "xl/styles.xml"
            ? styleConsumerNames
            : null;
  if (!recognized) return;
  const stack: Element[] = [source.doc.documentElement];
  while (stack.length) {
    const node = stack.pop()!;
    if (recognized.has(node.nodeName) && !SS.has(node.namespaceURI ?? "")) xlsxInvalid();
    for (const child of children(node)) stack.push(child);
  }
}
export type XlsxOriginalSourceContext = {
  sourceContentSha256: string;
  packageAudit: {
    memberCount: number;
    xmlPartCount: number;
    expandedBytes: number;
    originalMemberManifestSha256: string;
  };
  worksheets: XlsxSourceFacts[];
};
function partOf(archive: OriginalXlsxArchive, name: string): XlsxPart {
  const member = archive.members.find((m) => m.name === name && !m.directory);
  if (!member || !member.originalBytesSha256) xlsxIdentityMismatch();
  return { name: member.name, originalBytesSha256: member.originalBytesSha256 };
}
function sourceFeature(
  source: ParsedPart,
  element: Element,
  budget: SourceBudget,
  reason?: XlsxReasonCode,
): XlsxFeature {
  budget.features = xlsxBound(budget.features + 1, L.features);
  const localName = element.localName ?? "";
  const reasonCode =
    reason ?? classifyXlsxFeature({ sourcePart: source.part, namespaceUri: element.namespaceURI ?? "", localName });
  return {
    sourcePart: source.part,
    elementOrdinal: source.ordinals.get(element)!,
    namespaceUri: element.namespaceURI ?? "",
    localName,
    attributes: attrs(element),
    status:
      reasonCode === "xlsx_unmodeled_content_gap" || reasonCode === "xlsx_unsupported_sheet_gap"
        ? "coverage_gap"
        : "source_observed_unverified",
    reasonCode,
  };
}
function relationOwner(name: string) {
  if (name === "_rels/.rels") return "";
  const match = /^(.*\/)?_rels\/([^/]+)[.]rels$/.exec(name);
  return match ? `${match[1] ?? ""}${match[2]}` : null;
}
function resolveTarget(owner: string | null, target: string) {
  if (
    owner === null ||
    !target ||
    /[\\%?#\u0000-\u001f\u007f]/.test(target) ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(target) ||
    target !== target.trim()
  )
    return null;
  const segments = target.startsWith("/")
    ? []
    : owner
      ? path.posix
          .dirname(owner)
          .split("/")
          .filter((s) => s !== ".")
      : [];
  const incoming = target.replace(/^\//, "").split("/");
  for (const segment of incoming) {
    if (!segment) return null;
    if (segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
}
function relationships(source: ParsedPart, archive: OriginalXlsxArchive, budget: SourceBudget) {
  const root = source.doc.documentElement;
  if (root.namespaceURI !== REL || root.localName !== "Relationships") xlsxInvalid();
  const ids = new Set<string>();
  const owner = relationOwner(source.part.name);
  const result: XlsxRelationship[] = [];
  for (const element of children(root)) {
    if (element.namespaceURI !== REL || element.localName !== "Relationship" || children(element).length) xlsxInvalid();
    budget.relationships = xlsxBound(budget.relationships + 1, L.relationships);
    const idToken = required(element, "Id"),
      typeToken = required(element, "Type"),
      target = required(element, "Target"),
      targetModeToken = attr(element, "TargetMode");
    if (ids.has(idToken) || active.test(typeToken) || /\/package$/.test(typeToken) || active.test(target))
      xlsxInvalid();
    ids.add(idToken);
    let resolvedInternalPart: XlsxPart | null = null;
    const resolved = targetModeToken === null || targetModeToken === "Internal" ? resolveTarget(owner, target) : null;
    if (resolved && archive.members.some((m) => m.name === resolved && !m.directory))
      resolvedInternalPart = partOf(archive, resolved);
    result.push({
      sourcePart: source.part,
      idToken,
      typeToken,
      targetModeToken,
      targetTokenSha256: xlsxSha(target),
      resolvedInternalPart,
      status:
        targetModeToken === "External"
          ? "external_unresolved"
          : resolvedInternalPart
            ? "internal_resolved"
            : "unknown_unresolved",
    });
  }
  return result;
}
function relationshipsName(part: string) {
  return path.posix.join(path.posix.dirname(part), "_rels", `${path.posix.basename(part)}.rels`);
}
function stringRuns(element: Element, source: ParsedPart, budget: SourceBudget): XlsxStringRuns {
  const textTokens: XlsxNodeToken[] = [],
    otherChildren: XlsxFeature[] = [];
  for (const child of children(element)) {
    if (ss(child, "t")) textTokens.push(nodeToken(child));
    else if (ss(child, "r")) {
      otherChildren.push(sourceFeature(source, child, budget, "xlsx_rich_text_display_unverified"));
      for (const runChild of children(child)) {
        if (ss(runChild, "t")) textTokens.push(nodeToken(runChild));
        else
          otherChildren.push(
            sourceFeature(
              source,
              runChild,
              budget,
              ss(runChild, "rPr") || ss(runChild, "rPh") ? "xlsx_rich_text_display_unverified" : undefined,
            ),
          );
      }
    } else
      otherChildren.push(
        sourceFeature(
          source,
          child,
          budget,
          ss(child, "rPh") || ss(child, "phoneticPr") ? "xlsx_rich_text_display_unverified" : undefined,
        ),
      );
    xlsxBound(textTokens.length, L.runs);
  }
  return { attributes: attrs(element), textTokens, otherChildren };
}
function listTokens(text: string) {
  // Mirror the installed defined-name xform's comma/quote grouping. It skips
  // empty and unterminated quoted items before the matrix admission test.
  const result: string[] = [];
  let quote = false,
    pending = "";
  for (const item of text.split(",")) {
    if (!item) continue;
    const quotes = (item.match(/'/g) ?? []).length;
    if (!quotes) {
      if (quote) pending += `${item},`;
      else result.push(item);
    } else if (!quote && quotes % 2 === 0) {
      result.push(item);
    } else if (quote && quotes % 2 !== 0) {
      quote = false;
      result.push(pending + item);
      pending = "";
    } else {
      quote = true;
      pending += `${item},`;
    }
  }
  return result;
}
function definedNameWork(node: XlsxNodeToken, budget: SourceBudget) {
  const name = xlsxAttributeValue(node.attributes, "name"),
    local = xlsxAttributeValue(node.attributes, "localSheetId");
  if (!name || (local !== null && strictIndex(local) === null)) xlsxInvalid();
  const print = name === "_xlnm.Print_Area" || name === "_xlnm.Print_Titles";
  for (const piece of listTokens(node.textToken)) {
    // The public xform splits the list before DefinedNames.model tests EACH range.
    // An ignored later item cannot hide an earlier admitted matrix allocation.
    const admitted = /[$](\w+)[$](\d+)(:[$](\w+)[$](\d+))?/.test(piece.split("!").pop() ?? "");
    if (!admitted && !print) continue;
    const match =
      /^(?:(?:'(?:[^']|'')+'|[^'!,\s:^]+)!)?((?:\$?[A-Z]{1,3}\$?[1-9]\d{0,6})(?::\$?[A-Z]{1,3}\$?[1-9]\d{0,6})?)$/.exec(
        piece,
      );
    if (!match) {
      if (name === "_xlnm.Print_Titles") {
        const title = /^(?:'(?:[^']|'')+'|[^'!,\s:^]+)!(\$[A-Z]{1,3}:\$[A-Z]{1,3}|\$[1-9]\d{0,6}:\$[1-9]\d{0,6})$/.exec(
          piece,
        );
        if (!title) xlsxInvalid();
        const [a, b] = title[1].replace(/\$/g, "").split(":");
        if (/^\d/.test(a)) {
          if (Number(a) > Number(b) || Number(b) > 1_048_576) xlsxInvalid();
        } else {
          const first = xlsxAddress(`${a}1`),
            last = xlsxAddress(`${b}1`);
          if (first.column > last.column) xlsxInvalid();
        }
        continue;
      }
      xlsxInvalid();
    }
    const rectangle = xlsxRectangle(match[1].replace(/\$/g, "")),
      height = rectangle.bottom - rectangle.top + 1;
    if (!print) {
      budget.addAllocation((rectangle.right - rectangle.left + 1) * height);
      budget.addRows(rectangle.bottom);
    }
  }
}

/** Bound installed lexical consumers without allocating a range, row array or validation grid. */
function worksheetResourceWork(source: ParsedPart, budget: SourceBudget, consumed: boolean) {
  let maximumRow = 0,
    maximumColumn = 0,
    mergeCount = 0;
  type RowWork = { number: number; highest: number };
  type Frame = { node: Element; validationContainer: boolean; row?: RowWork; close?: boolean };
  const stack: Frame[] = [{ node: source.doc.documentElement, validationContainer: false }];
  while (stack.length) {
    const { node, validationContainer, row: parentRow, close } = stack.pop()!;
    let row = parentRow;
    if (close) {
      budget.addAllocation(row!.highest);
      continue;
    }
    // ExcelJS dispatches lexical names, including below ignored wrappers. Charging
    // all such descendants is conservative when another active xform ignores them.
    if (ss(node, "row")) {
      budget.rows = xlsxBound(budget.rows + 1, L.rows);
      const number = strictIndex(required(node, "r"));
      if (number === null || number < 1 || number > 1_048_576) xlsxInvalid();
      maximumRow = Math.max(maximumRow, number);
      row = { number, highest: 0 };
      stack.push({ node, row, validationContainer, close: true });
    } else if (ss(node, "c") && row) {
      budget.cells = xlsxBound(budget.cells + 1, L.cells);
      const position = xlsxAddress(required(node, "r"));
      if (position.row !== row.number) xlsxInvalid();
      row.highest = Math.max(row.highest, position.column);
    } else if (ss(node, "col")) {
      budget.definitions = xlsxBound(budget.definitions + 1, L.definitions);
      const min = strictIndex(required(node, "min")),
        max = strictIndex(required(node, "max"));
      if (min === null || max === null || min < 1 || max < min || max > 16_384) xlsxInvalid();
      maximumColumn = Math.max(maximumColumn, max);
    } else if (ss(node, "mergeCell")) {
      budget.merges = xlsxBound(budget.merges + 1, L.definitions);
      const rectangle = xlsxRectangle(required(node, "ref")),
        height = rectangle.bottom - rectangle.top + 1;
      maximumRow = Math.max(maximumRow, rectangle.bottom);
      budget.addAllocation(rectangle.right * height);
      budget.addRows(height);
      mergeCount++;
    }
    if (consumed && validationContainer && node.nodeName === "dataValidation") {
      // The installed parser splits on whitespace, assigns singles, and expands
      // every colon range. Reject empty/partial/qualified tokens before it runs.
      for (const token of required(node, "sqref").split(/\s+/g)) {
        if (!/^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}(?::\$?[A-Z]{1,3}\$?[1-9]\d{0,6})?$/.test(token)) xlsxInvalid();
        const pieces = token.replace(/\$/g, "").split(":"),
          first = xlsxAddress(pieces[0]),
          last = xlsxAddress(pieces[1] ?? pieces[0]);
        // Range.decodeEx normalizes reversed endpoints. Each duplicate/overlap
        // still incurs the full interpretation work and is charged separately.
        budget.addAllocation((Math.abs(last.column - first.column) + 1) * (Math.abs(last.row - first.row) + 1));
      }
    }
    const inValidation = validationContainer || node.nodeName === "dataValidations";
    for (const child of children(node)) stack.push({ node: child, row, validationContainer: inValidation });
  }
  budget.addAllocation(maximumColumn);
  budget.pairWork = xlsxBound(budget.pairWork + (mergeCount * (mergeCount - 1)) / 2, L.pairWork);
  if (consumed) budget.addRows(maximumRow);
}

/** Complete original-stream/XML observation precedes the unchanged public ExcelJS load. */
export async function preflightOriginalXlsx(buffer: Buffer): Promise<XlsxOriginalSourceContext> {
  try {
    return await preflight(buffer);
  } catch (error) {
    if (error instanceof XlsxSourceProvenanceError) throw error;
    return xlsxInvalid();
  }
}
async function preflight(buffer: Buffer): Promise<XlsxOriginalSourceContext> {
  const archive = await openOriginalXlsxArchive(buffer),
    budget = new SourceBudget();
  const byName = new Map(archive.members.map((member) => [member.name, member]));
  const baseXml = new Set(
    archive.members.filter((m) => !m.directory && /(?:\.xml|\.rels|\.vml)$/.test(m.name)).map((m) => m.name),
  );
  const contentMember = byName.get("[Content_Types].xml");
  if (!contentMember || contentMember.directory) xlsxInvalid();
  baseXml.add(contentMember.name);
  const declaredXml = (names: Set<string>) => {
    xlsxBound(names.size, L.xmlParts);
    let total = 0;
    for (const name of names) {
      const member = byName.get(name);
      if (!member || member.directory) xlsxInvalid();
      xlsxBound(member.uncompressedSize, L.xmlBytes);
      total = xlsxBound(total + member.uncompressedSize, L.allXmlBytes);
    }
  };
  declaredXml(baseXml);
  for (const member of archive.members)
    if (!member.directory && !baseXml.has(member.name)) xlsxBound(member.uncompressedSize, L.binaryBytes);
  const contentBytes = await readOriginalXlsxMember(archive, contentMember, true),
    contentParsed = parseXml(contentBytes, budget);
  const root = contentParsed.doc.documentElement;
  if (root.namespaceURI !== CT || root.localName !== "Types") xlsxInvalid();
  const defaults = new Map<string, string>(),
    overrides = new Map<string, string>();
  for (const child of children(root)) {
    if (child.namespaceURI !== CT || children(child).length) xlsxInvalid();
    const type = required(child, "ContentType");
    if (active.test(type)) xlsxInvalid();
    if (child.localName === "Default") {
      const extension = required(child, "Extension");
      if (defaults.has(extension) || /[./\\%:]/.test(extension)) xlsxInvalid();
      defaults.set(extension, type);
    } else if (child.localName === "Override") {
      const name = required(child, "PartName");
      if (!name.startsWith("/") || overrides.has(name.slice(1)) || !byName.has(name.slice(1))) xlsxInvalid();
      overrides.set(name.slice(1), type);
    } else xlsxInvalid();
  }
  const xmlNames = new Set(baseXml);
  for (const member of archive.members) {
    if (active.test(member.name)) xlsxInvalid();
    const type = overrides.get(member.name) ?? defaults.get(path.posix.extname(member.name).slice(1));
    if (type && active.test(type)) xlsxInvalid();
    if (!member.directory && type && /(?:xml|vml)/i.test(type)) xmlNames.add(member.name);
  }
  declaredXml(xmlNames);
  const parsed = new Map<string, ParsedPart>(),
    preflightFeatures: XlsxFeature[] = [];
  const featureParts = new Set<string>();
  parsed.set(contentMember.name, { part: partOf(archive, contentMember.name), ...contentParsed });
  for (const member of archive.members) {
    if (member === contentMember) continue;
    if (member.directory) {
      await readOriginalXlsxMember(archive, member, false);
      continue;
    }
    const xml = xmlNames.has(member.name),
      bytes = await readOriginalXlsxMember(archive, member, xml);
    if (xml) {
      const source = { part: partOf(archive, member.name), ...parseXml(bytes, budget) };
      assertConsumerNamespaces(source);
      const knownRoot =
        member.name === "xl/workbook.xml"
          ? "workbook"
          : member.name === "xl/styles.xml"
            ? "styleSheet"
            : member.name === "xl/sharedStrings.xml"
              ? "sst"
              : /^xl\/worksheets\/sheet\d+[.]xml$/.test(member.name)
                ? "worksheet"
                : null;
      if (knownRoot && !ss(source.doc.documentElement, knownRoot)) xlsxInvalid();
      const root = source.doc.documentElement;
      if (
        (/^xl\/comments\d+[.]xml$/.test(member.name) && !ss(root, "comments")) ||
        (/^xl\/tables\/table\d+[.]xml$/.test(member.name) && !ss(root, "table"))
      )
        xlsxInvalid();
      if (
        /^xl\/theme\/[a-zA-Z0-9]+[.]xml$/.test(member.name) &&
        (root.localName !== "theme" ||
          ![
            "http://schemas.openxmlformats.org/drawingml/2006/main",
            "http://purl.oclc.org/ooxml/drawingml/main",
          ].includes(root.namespaceURI ?? ""))
      )
        xlsxInvalid();
      if (
        /^xl\/drawings\/drawing\d+[.]xml$/.test(member.name) &&
        (root.localName !== "wsDr" ||
          ![
            "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
            "http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing",
          ].includes(root.namespaceURI ?? ""))
      )
        xlsxInvalid();
      if (/^xl\/drawings\/vmlDrawing\d+[.]vml$/.test(member.name) && (root.localName !== "xml" || root.namespaceURI))
        xlsxInvalid();
      const consulted =
        member.name.endsWith(".rels") ||
        ["workbook", "worksheet", "chartsheet", "dialogsheet", "styleSheet", "sst"].some((name) => ss(root, name));
      if (consulted) parsed.set(member.name, source);
      else {
        preflightFeatures.push(sourceFeature(source, root, budget));
        featureParts.add(member.name);
      }
    }
  }
  const relations = new Map<string, XlsxRelationship[]>();
  for (const [name, source] of parsed)
    if (name.endsWith(".rels")) relations.set(name, relationships(source, archive, budget));
  const rootPackageRelationships = relations.get("_rels/.rels");
  if (!rootPackageRelationships) xlsxInvalid();
  const office = rootPackageRelationships.filter((r) => officeType(r.typeToken, "officeDocument"));
  if (office.length !== 1 || office[0].status !== "internal_resolved" || !office[0].resolvedInternalPart)
    xlsxIdentityMismatch();
  const workbookPart = office[0].resolvedInternalPart;
  const workbookSource = parsed.get(workbookPart.name),
    workbookRelationshipsName = relationshipsName(workbookPart.name);
  const workbookRels = relations.get(workbookRelationshipsName);
  if (!workbookSource || !workbookRels) xlsxIdentityMismatch();
  const workbookRoot = workbookSource.doc.documentElement;
  if (!ss(workbookRoot, "workbook")) xlsxInvalid();
  const workbookRelationshipsPart = partOf(archive, workbookRelationshipsName);
  const sheetsRoot = only(workbookRoot, "sheets");
  if (!sheetsRoot) xlsxInvalid();
  const sheets: XlsxSourceFacts["workbook"]["sheets"] = [],
    ids = new Set<number>(),
    names = new Set<string>(),
    rids = new Set<string>();
  let emitted = 0;
  for (const node of children(sheetsRoot)) {
    if (!ss(node, "sheet") || children(node).length) xlsxInvalid();
    xlsxBound(sheets.length + 1, L.sheets);
    const sheetIdToken = required(node, "sheetId"),
      nameToken = required(node, "name"),
      id = strictIndex(sheetIdToken);
    const relationshipIds = Array.from(node.attributes).filter(
      (a) => OFFICE.has(a.namespaceURI ?? "") && a.localName === "id",
    );
    if (
      relationshipIds.length !== 1 ||
      id === null ||
      id < 1 ||
      id > 2_147_483_647 ||
      ids.has(id) ||
      names.has(nameToken) ||
      rids.has(relationshipIds[0].value)
    )
      xlsxInvalid();
    ids.add(id);
    names.add(nameToken);
    rids.add(relationshipIds[0].value);
    const relationshipIdToken = relationshipIds[0].value,
      relation = workbookRels.find((r) => r.idToken === relationshipIdToken);
    if (!relation || relation.status !== "internal_resolved" || !relation.resolvedInternalPart) xlsxIdentityMismatch();
    const worksheet = officeType(relation.typeToken, "worksheet"),
      stateToken = attr(node, "state");
    const reasons: XlsxReasonCode[] = worksheet ? [] : ["xlsx_unsupported_sheet_gap"];
    if (stateToken !== null && stateToken !== "visible") reasons.push("xlsx_visibility_unverified");
    sheets.push({
      sourceOrdinal: sheets.length,
      sheetIdToken,
      nameToken,
      relationshipIdToken,
      stateToken,
      relationshipTypeToken: relation.typeToken,
      resolvedPart: relation.resolvedInternalPart,
      emittedLogicalUnitIndex: worksheet ? ++emitted : null,
      status: worksheet ? "emitted_worksheet" : "unsupported_sheet",
      reasonCodes: orderedXlsxReasons(reasons),
    });
  }
  if (!emitted) xlsxIdentityMismatch();
  const properties = only(workbookRoot, "workbookPr"),
    calcPr = only(workbookRoot, "calcPr"),
    definedRoot = only(workbookRoot, "definedNames");
  const definedNames: XlsxNodeToken[] = [];
  // WorkbookXform also activates known lexical families below ignored wrappers.
  // Resource accounting is independent of the unchanged direct source-facts view.
  const workbookStack: Element[] = [workbookRoot];
  let maximumSheetId = 0,
    sheetCount = 0,
    nameCount = 0;
  while (workbookStack.length) {
    const node = workbookStack.pop()!;
    if (ss(node, "sheet")) {
      sheetCount = xlsxBound(sheetCount + 1, L.sheets);
      const relationshipIds = Array.from(node.attributes).filter(
        (a) => OFFICE.has(a.namespaceURI ?? "") && a.localName === "id",
      );
      if (relationshipIds.length !== 1) xlsxInvalid();
      const relation = workbookRels.find((r) => r.idToken === relationshipIds[0].value);
      if (!relation || relation.status !== "internal_resolved" || !relation.resolvedInternalPart)
        xlsxIdentityMismatch();
      // WorkbookXform.reconcile maps the worksheet target without consulting
      // Relationship.Type. An unsupported type must not hide an allocatable ID.
      if (
        /^xl\/worksheets\/sheet\d+[.]xml$/.test(relation.resolvedInternalPart.name) &&
        !officeType(relation.typeToken, "worksheet")
      )
        xlsxIdentityMismatch();
      if (officeType(relation.typeToken, "worksheet")) {
        const id = strictIndex(required(node, "sheetId"));
        if (id === null || id < 1 || id > 2_147_483_647) xlsxInvalid();
        maximumSheetId = Math.max(maximumSheetId, id);
      }
    } else if (ss(node, "definedName")) {
      nameCount = xlsxBound(nameCount + 1, L.names);
      definedNameWork(nodeToken(node), budget);
    }
    for (const child of children(node)) workbookStack.push(child);
  }
  budget.addAllocation(maximumSheetId);
  if (definedRoot)
    for (const node of children(definedRoot)) {
      if (!ss(node, "definedName")) xlsxInvalid();
      xlsxBound(definedNames.length + 1, L.names);
      const token = nodeToken(node);
      definedNames.push(token);
    }
  const workbook = {
    part: workbookPart,
    relationshipsPart: workbookRelationshipsPart,
    relationships: workbookRels,
    date1904Token: properties ? attr(properties, "date1904") : null,
    calcPr: calcPr ? nodeToken(calcPr) : null,
    definedNames,
    sheets,
  };
  const packageFeatures: XlsxFeature[] = preflightFeatures;
  if (unmodeledAttributes(workbookRoot, [])) packageFeatures.push(sourceFeature(workbookSource, workbookRoot, budget));
  if (
    properties &&
    unmodeledAttributes(properties, [
      "date1904",
      "showObjects",
      "showBorderUnselectedTables",
      "filterPrivacy",
      "promptedSolutions",
      "showInkAnnotation",
      "backupFile",
      "saveExternalLinkValues",
      "updateLinks",
      "codeName",
      "hidePivotFieldList",
      "allowRefreshQuery",
      "publishItems",
      "checkCompatibility",
      "autoCompressPictures",
      "refreshAllConnections",
      "defaultThemeVersion",
    ])
  )
    packageFeatures.push(sourceFeature(workbookSource, properties, budget));
  for (const node of children(sheetsRoot))
    if (unmodeledAttributes(node, ["name", "sheetId", "state"]))
      packageFeatures.push(sourceFeature(workbookSource, node, budget));
  for (const node of children(workbookRoot))
    if (!["sheets", "workbookPr", "calcPr", "definedNames"].some((name) => ss(node, name)))
      packageFeatures.push(sourceFeature(workbookSource, node, budget));
  const usedParts = new Set([contentMember.name, "_rels/.rels", workbookPart.name, workbookRelationshipsName]);
  const styleRelationship = workbookRels.filter((r) => officeType(r.typeToken, "styles")),
    stringRelationship = workbookRels.filter((r) => officeType(r.typeToken, "sharedStrings"));
  if (styleRelationship.length > 1 || stringRelationship.length > 1) xlsxInvalid();
  const stylesPart = styleRelationship[0]?.resolvedInternalPart ?? null,
    sharedStringsPart = stringRelationship[0]?.resolvedInternalPart ?? null;
  if (stylesPart) usedParts.add(stylesPart.name);
  if (sharedStringsPart) usedParts.add(sharedStringsPart.name);
  const stylesSource = stylesPart ? parsed.get(stylesPart.name) : undefined,
    stringsSource = sharedStringsPart ? parsed.get(sharedStringsPart.name) : undefined;
  if ((stylesPart && !stylesSource) || (sharedStringsPart && !stringsSource)) xlsxIdentityMismatch();
  if (
    (stylesSource && !ss(stylesSource.doc.documentElement, "styleSheet")) ||
    (stringsSource && !ss(stringsSource.doc.documentElement, "sst"))
  )
    xlsxInvalid();
  // The public loader reads fixed paths; different relationship-resolved dictionaries must not be relabelled.
  if (
    (stylesPart && stylesPart.name !== "xl/styles.xml") ||
    (sharedStringsPart && sharedStringsPart.name !== "xl/sharedStrings.xml")
  )
    xlsxIdentityMismatch();
  const cellXfsRoot = stylesSource ? only(stylesSource.doc.documentElement, "cellXfs") : null;
  const cellXfs = cellXfsRoot ? children(cellXfsRoot) : [],
    numFmtsRoot = stylesSource ? only(stylesSource.doc.documentElement, "numFmts") : null;
  const numFmts = numFmtsRoot ? children(numFmtsRoot) : [];
  const allStringElements = stringsSource ? children(stringsSource.doc.documentElement) : [];
  if (
    cellXfs.some((node) => !ss(node, "xf")) ||
    numFmts.some((node) => !ss(node, "numFmt")) ||
    allStringElements.some((node) => !ss(node, "si"))
  )
    xlsxInvalid();
  // ExcelJS parses unreferenced entries too: count their runs without retaining a second dictionary.
  for (const element of allStringElements) {
    const stack = [element];
    let runs = 0;
    while (stack.length) {
      const current = stack.pop()!;
      if (ss(current, "t")) {
        runs = xlsxBound(runs + 1, L.runs);
        nodeToken(current);
      }
      for (const child of children(current)) stack.push(child);
    }
  }
  const customIds = new Map<string, Element[]>();
  for (const node of numFmts) {
    const id = required(node, "numFmtId");
    if (strictIndex(id) === null) xlsxInvalid();
    customIds.set(id, [...(customIds.get(id) ?? []), node]);
  }
  const worksheetSources = [...parsed.values()].filter(
    (source) =>
      /^xl\/worksheets\/sheet\d+[.]xml$/.test(source.part.name) || ss(source.doc.documentElement, "worksheet"),
  );
  const worksheetFacts = new Map<string, XlsxSourceFacts["worksheet"]>();
  const referencedStyleIndices = new Set<number>(),
    referencedStringIndices = new Set<number>();
  const dictionaryStrings = new Map<number, XlsxStringRuns>();
  const dictionaryStyles = new Map<number, XlsxSourceFacts["styleRefs"][number]>();
  const retainStyle = (indexToken: string | null) => {
    const index = strictIndex(indexToken);
    if (index === null || index >= cellXfs.length || !stylesSource || dictionaryStyles.has(index)) return;
    referencedStyleIndices.add(index);
    xlsxBound(referencedStyleIndices.size, L.styles);
    const xf = cellXfs[index],
      numFmtIdToken = attr(xf, "numFmtId"),
      matching = numFmtIdToken === null ? [] : (customIds.get(numFmtIdToken) ?? []);
    dictionaryStyles.set(index, {
      sourceIndex: index,
      cellXf: { ...nodeToken(xf, false), textToken: "" },
      numFmtIdToken,
      customNumFmt: matching.length === 1 ? nodeToken(matching[0]) : null,
      otherChildren: children(xf).map((n) => sourceFeature(stylesSource, n, budget)),
      resolution:
        matching.length > 1 ||
        (numFmtIdToken !== null &&
          (strictIndex(numFmtIdToken) === null || (Number(numFmtIdToken) >= 164 && matching.length === 0)))
          ? "unresolved"
          : matching.length === 1
            ? "custom_source"
            : "id_only",
    });
  };
  for (const source of worksheetSources) {
    if (!ss(source.doc.documentElement, "worksheet")) xlsxInvalid();
    // Only these fixed worksheet paths are parsed by the installed public loader.
    worksheetResourceWork(source, budget, /^xl\/worksheets\/sheet\d+[.]xml$/.test(source.part.name));
    const sourceSheet = sheets.find(
      (sheet) => sheet.status === "emitted_worksheet" && sheet.resolvedPart.name === source.part.name,
    );
    if (sourceSheet && sheets.filter((sheet) => sheet.resolvedPart.name === source.part.name).length !== 1)
      xlsxIdentityMismatch();
    const relName = relationshipsName(source.part.name),
      relPart = parsed.has(relName) ? partOf(archive, relName) : null;
    usedParts.add(source.part.name);
    if (relPart) usedParts.add(relName);
    const root = source.doc.documentElement,
      data = only(root, "sheetData"),
      columnsRoot = only(root, "cols"),
      mergesRoot = only(root, "mergeCells");
    const rows: XlsxSourceFacts["worksheet"]["rows"] = [],
      columns: XlsxSourceFacts["worksheet"]["columns"] = [],
      merges: XlsxNodeToken[] = [],
      otherChildren: XlsxFeature[] = [],
      printNodes: XlsxNodeToken[] = [];
    const rowIds = new Set<number>(),
      addresses = new Set<string>();
    if (data)
      for (const rowNode of children(data)) {
        if (!ss(rowNode, "row")) {
          otherChildren.push(sourceFeature(source, rowNode, budget));
          continue;
        }
        const rowNumberToken = required(rowNode, "r"),
          rowNumber = strictIndex(rowNumberToken);
        if (rowNumber === null || rowNumber < 1 || rowNumber > 1_048_576 || rowIds.has(rowNumber)) xlsxInvalid();
        rowIds.add(rowNumber);
        retainStyle(attr(rowNode, "s"));
        const cells: XlsxCell[] = [],
          rowOther: XlsxFeature[] = [];
        for (const cellNode of children(rowNode)) {
          if (!ss(cellNode, "c")) {
            rowOther.push(sourceFeature(source, cellNode, budget));
            continue;
          }
          const address = required(cellNode, "r"),
            position = xlsxAddress(address);
          if (position.row !== rowNumber || addresses.has(address)) xlsxInvalid();
          addresses.add(address);
          const valueNode = only(cellNode, "v"),
            formulaNode = only(cellNode, "f"),
            inlineNode = only(cellNode, "is");
          if (children(cellNode).some((n) => !ss(n, "v") && !ss(n, "f") && !ss(n, "is")))
            rowOther.push(
              ...children(cellNode)
                .filter((n) => !ss(n, "v") && !ss(n, "f") && !ss(n, "is"))
                .map((n) => sourceFeature(source, n, budget)),
            );
          const type = attr(cellNode, "t"),
            value = valueNode ? nodeToken(valueNode) : null,
            formula = formulaNode ? nodeToken(formulaNode) : null;
          if (formula) {
            const formulaRef = xlsxAttributeValue(formula.attributes, "ref"),
              formulaIndex = xlsxAttributeValue(formula.attributes, "si");
            if (formulaRef !== null) xlsxRectangle(formulaRef);
            if (formulaIndex !== null && strictIndex(formulaIndex) === null) xlsxInvalid();
          }
          if ((inlineNode && (type !== "inlineStr" || value || formula)) || (type === "inlineStr" && value))
            xlsxInvalid();
          const sharedStringIndexToken = type === "s" ? (value?.textToken ?? null) : null,
            stringIndex = strictIndex(sharedStringIndexToken),
            explicitStyleIndexToken = attr(cellNode, "s"),
            styleIndex = strictIndex(explicitStyleIndexToken);
          if (
            stringIndex !== null &&
            stringIndex < allStringElements.length &&
            stringsSource &&
            !dictionaryStrings.has(stringIndex)
          ) {
            referencedStringIndices.add(stringIndex);
            xlsxBound(referencedStringIndices.size, L.strings);
            dictionaryStrings.set(stringIndex, stringRuns(allStringElements[stringIndex], stringsSource, budget));
          }
          retainStyle(explicitStyleIndexToken);
          const cell: XlsxCell = {
            elementIndex: cells.length,
            address,
            rowNumber,
            columnNumber: position.column,
            attributes: attrs(cellNode),
            value,
            formula,
            formulaKind: xlsxFormulaKind(formula),
            inlineString: inlineNode ? stringRuns(inlineNode, source, budget) : null,
            sharedStringIndexToken,
            resolvedSharedString: stringIndex === null ? null : (dictionaryStrings.get(stringIndex) ?? null),
            explicitStyleIndexToken,
            structuralDisposition: "retained",
            reasonCodes: [],
          };
          cell.reasonCodes = classifyXlsxCell(cell);
          if (
            explicitStyleIndexToken !== null &&
            (styleIndex === null ||
              !dictionaryStyles.has(styleIndex) ||
              dictionaryStyles.get(styleIndex)?.resolution === "unresolved")
          )
            cell.reasonCodes = orderedXlsxReasons([...cell.reasonCodes, "xlsx_style_unresolved"]);
          cell.structuralDisposition = xlsxDisposition(cell.reasonCodes);
          cells.push(cell);
        }
        rows.push({
          elementIndex: rows.length,
          rowNumberToken,
          attributes: attrs(rowNode),
          cells,
          otherChildren: rowOther,
        });
      }
    if (columnsRoot)
      for (const column of children(columnsRoot)) {
        if (!ss(column, "col")) {
          otherChildren.push(sourceFeature(source, column, budget));
          continue;
        }
        const minToken = required(column, "min"),
          maxToken = required(column, "max"),
          min = strictIndex(minToken),
          max = strictIndex(maxToken);
        if (min === null || max === null || min < 1 || max < min || max > 16_384) xlsxInvalid();
        columns.push({ elementIndex: columns.length, minToken, maxToken, attributes: attrs(column) });
        retainStyle(attr(column, "style"));
      }
    if (mergesRoot)
      for (const merge of children(mergesRoot)) {
        if (!ss(merge, "mergeCell")) {
          otherChildren.push(sourceFeature(source, merge, budget));
          continue;
        }
        xlsxRectangle(required(merge, "ref"));
        merges.push(nodeToken(merge));
      }
    for (const node of children(root)) {
      if (["sheetData", "cols", "mergeCells"].some((name) => ss(node, name))) continue;
      if (
        ["pageSetup", "pageMargins", "rowBreaks", "colBreaks", "printOptions", "headerFooter"].some((name) =>
          ss(node, name),
        )
      ) {
        printNodes.push(nodeToken(node, false));
        xlsxBound(printNodes.length, L.features);
      } else otherChildren.push(sourceFeature(source, node, budget));
    }
    worksheetFacts.set(source.part.name, {
      sourceOrdinal: sourceSheet?.sourceOrdinal ?? 0,
      part: source.part,
      relationshipsPart: relPart,
      relationships: relations.get(relName) ?? [],
      rootAttributes: attrs(root),
      rows,
      columns,
      merges,
      printNodes,
      otherChildren,
    });
    if (!sourceSheet) packageFeatures.push({ ...sourceFeature(source, root, budget, "xlsx_unmodeled_content_gap") });
  }
  for (const sheet of sheets) {
    if (sheet.status === "emitted_worksheet") {
      if (
        workbookPart.name !== "xl/workbook.xml" ||
        !/^xl\/worksheets\/sheet\d+[.]xml$/.test(sheet.resolvedPart.name) ||
        !worksheetFacts.has(sheet.resolvedPart.name)
      )
        xlsxIdentityMismatch();
    } else {
      const source = parsed.get(sheet.resolvedPart.name);
      if (!source) xlsxIdentityMismatch();
      packageFeatures.push(sourceFeature(source, source.doc.documentElement, budget, "xlsx_unsupported_sheet_gap"));
      usedParts.add(sheet.resolvedPart.name);
    }
  }
  for (const member of archive.members) {
    if (member.directory || usedParts.has(member.name) || featureParts.has(member.name)) continue;
    const source = parsed.get(member.name);
    if (source) packageFeatures.push(sourceFeature(source, source.doc.documentElement, budget));
    else {
      budget.features = xlsxBound(budget.features + 1, L.features);
      const sourcePart = partOf(archive, member.name);
      const reasonCode = classifyXlsxFeature({ sourcePart, namespaceUri: "", localName: "opaquePackagePart" });
      packageFeatures.push({
        sourcePart,
        elementOrdinal: 0,
        namespaceUri: "",
        localName: "opaquePackagePart",
        attributes: [],
        status: reasonCode === "xlsx_unmodeled_content_gap" ? "coverage_gap" : "source_observed_unverified",
        reasonCode,
      });
    }
  }
  const styleRefs = [...dictionaryStyles.values()].sort((a, b) => a.sourceIndex - b.sourceIndex);
  const sharedStringRefs = [...dictionaryStrings]
    .sort((a, b) => a[0] - b[0])
    .map(([sourceIndex, runs]) => ({ sourceIndex, sourcePart: sharedStringsPart!, runs }));
  // Retain owner-qualified records from nested relationship parts that have no dedicated facts array.
  const representedRelationshipParts = new Set([
    "_rels/.rels",
    workbookRelationshipsName,
    ...sheets
      .filter((sheet) => sheet.status === "emitted_worksheet")
      .map((sheet) => relationshipsName(sheet.resolvedPart.name)),
  ]);
  const packageRelationships = [
    ...rootPackageRelationships,
    ...[...relations].filter(([name]) => !representedRelationshipParts.has(name)).flatMap(([, records]) => records),
  ];
  xlsxBound(packageRelationships.length, L.relationships);
  const worksheets = sheets
    .filter((sheet) => sheet.status === "emitted_worksheet")
    .map((sheet): XlsxSourceFacts => ({
      packageRelationships,
      workbook,
      worksheet: worksheetFacts.get(sheet.resolvedPart.name)!,
      stylesPart,
      styleRefs,
      sharedStringsPart,
      sharedStringRefs,
      packageFeatures,
    }));
  return {
    sourceContentSha256: archive.sourceContentSha256,
    packageAudit: {
      memberCount: archive.members.length,
      xmlPartCount: xmlNames.size,
      expandedBytes: archive.expandedBytes,
      originalMemberManifestSha256: xlsxSha(boundedXlsxJson(archive.members, L.resultBytes)),
    },
    worksheets,
  };
}
