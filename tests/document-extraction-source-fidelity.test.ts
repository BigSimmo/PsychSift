import { rm } from "node:fs/promises";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { extractDocument, parseExtractedDocumentPayload } from "@/lib/extractors/document";
import type { ExtractedPage } from "@/lib/types";
import {
  buildDocxSourceProvenance,
  docxPageSourceProvenanceSchema,
  extractedTextSha256,
} from "@/lib/extractors/docx-source-provenance";
import { buildDocumentPageRowsForPersistence } from "../worker/behavior";

function docxProvenance(page: ExtractedPage) {
  const provenance = page.metadata?.source_provenance;
  if (provenance?.format !== "docx") throw new Error("Expected DOCX source provenance");
  return provenance;
}

// Authored E-Q01..08 oracle; never reconstructed from extracted output.
const evidence = {
  scope: "This specimen applies only to fictional QA scenario Q-17.",
  regimen: "Use SYNTH-DRUG-Q by the fictional oral route at 20:00 in this QA specimen only.",
  measurement: "Accept the synthetic measurement only when 3.2 mmol/L <= x < 4.1 mmol/L.",
  timings:
    "Repeat the fictional observation after 15 min; record the result at 30 min. Stop this QA sequence if the result is unavailable.",
  footnote:
    "Rows A and B are alternative QA scenarios. Do not combine them. No conversion to a real medicine is supported.",
  tail: "END-QA-731: the final requirement is to record the specimen lot QA-L9 and the missing-result reason. This does not establish suitability for clinical use.",
};
const rowA = ["Q-A", "0.5 mg/mL", "2 mg", "4 mL", "24 h"];
const rowB = ["Q-B", "0.5 mg/mL", "3.5 mg", "7 mL", "48 h"];
const marker = "SYNTHETIC QA ONLY — NOT FOR CLINICAL USE";
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const wordNs = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const relNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRelNs = "http://schemas.openxmlformats.org/package/2006/relationships";
async function source(
  options: {
    footnoteRemoved?: boolean;
    merged?: boolean;
    headerVal?: string;
    revision?: boolean;
    external?: boolean;
    malformed?: boolean;
    dtd?: boolean;
    stylesDtd?: boolean;
    drawing?: boolean;
    multipleParagraphs?: boolean;
    symbol?: boolean;
    alternateContent?: boolean;
    inheritedHidden?: boolean;
    headerType?: string;
    headerRoot?: string;
    unevenCells?: boolean;
    zeroCells?: boolean;
    gridBefore?: boolean;
    mainMode?: string;
  } = {},
) {
  const zip = new JSZip();
  const paragraph = (text: string) => `<q:p><q:r><q:t>${escape(text)}</q:t></q:r></q:p>`;
  const row = (cells: string[], header = false) =>
    `<q:tr>${options.gridBefore && !header ? '<q:trPr><q:gridBefore q:val="1"/></q:trPr>' : ""}${header ? `<q:trPr><q:tblHeader${options.headerVal === undefined ? "" : ` q:val="${options.headerVal}"`}/></q:trPr>` : ""}${cells.map((text, index) => `<q:tc>${options.merged && index === 0 && !header ? '<q:tcPr><q:gridSpan q:val="2"/></q:tcPr>' : ""}${options.multipleParagraphs && !header && index === 2 ? paragraph("2") + paragraph("0 mg") : paragraph(text)}</q:tc>`).join("")}</q:tr>`;
  const table = `<q:tbl>${row(["Scenario", "Concentration", "Amount", "Volume", "Interval"], true)}${row(rowA)}${row(options.zeroCells ? [] : options.unevenCells ? rowB.slice(0, 4) : rowB)}</q:tbl>`;
  const scope = options.symbol
    ? `<q:p><q:r><q:t>${escape(evidence.scope)}</q:t><q:sym q:font="Symbol" q:char="F0A3"/></q:r></q:p>`
    : options.alternateContent
      ? `<mc:AlternateContent><mc:Choice Requires="q">${paragraph(evidence.scope)}</mc:Choice><mc:Fallback>${paragraph("UNVERIFIED FALLBACK")}</mc:Fallback></mc:AlternateContent>`
      : options.drawing
        ? `<q:p><q:r><q:drawing/></q:r></q:p>`
        : options.revision
          ? `<q:ins>${paragraph(evidence.scope)}</q:ins>`
          : paragraph(evidence.scope);
  const document = `${options.dtd ? '<!DOCTYPE q:document [<!ENTITY fake "unsafe">]>' : ""}<q:document xmlns:q="${wordNs}" xmlns:r="${relNs}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><q:body>${paragraph(marker)}${options.inheritedHidden ? scope.replace("<q:p>", '<q:p><q:pPr><q:pStyle q:val="HiddenInherited"/></q:pPr>') : scope}${paragraph(evidence.regimen)}${paragraph(evidence.measurement)}${paragraph(evidence.timings)}${table}${options.footnoteRemoved ? "" : paragraph(evidence.footnote)}<q:p><q:pPr><q:sectPr/></q:pPr></q:p>${paragraph(evidence.tail)}<q:sectPr><q:headerReference r:id="rIdQAHeader"/></q:sectPr></q:body>${options.malformed ? "" : "</q:document>"}`;
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    `<Relationships xmlns="${packageRelNs}"><Relationship Id="rId1" Type="${relNs}/officeDocument" Target="word/document.xml"${options.mainMode ? ` TargetMode="${options.mainMode}"` : ""}/></Relationships>`,
  );
  zip.file("word/document.xml", document);
  if (options.inheritedHidden)
    zip.file(
      "word/styles.xml",
      `<q:styles xmlns:q="${wordNs}"><q:style q:type="paragraph" q:styleId="HiddenInherited"><q:rPr><q:vanish/></q:rPr></q:style></q:styles>`,
    );
  if (options.stylesDtd)
    zip.file("word/styles.xml", `<!DOCTYPE q:styles [<!ENTITY fake "unsafe">]><q:styles xmlns:q="${wordNs}"/>`);
  zip.file(
    "word/_rels/document.xml.rels",
    `<Relationships xmlns="${packageRelNs}"><Relationship Id="rIdQAHeader" Type="${options.headerType ?? `${relNs}/header`}" Target="${options.external ? "https://synthetic.invalid/header" : "header1.xml"}"${options.external ? ' TargetMode="External"' : ""}/></Relationships>`,
  );
  zip.file(
    "word/header1.xml",
    `<q:${options.headerRoot ?? "hdr"} xmlns:q="${wordNs}">${paragraph(marker)}${options.multipleParagraphs ? paragraph("2") + paragraph("0 mg") : ""}</q:${options.headerRoot ?? "hdr"}>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}
async function extracted(options: Parameters<typeof source>[0] = {}) {
  const buffer = await source(options);
  const result = await extractDocument({
    buffer,
    fileName: "synthetic.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const temporaryPaths = "temporaryPaths" in result ? (result.temporaryPaths ?? []) : [];
  await Promise.all(temporaryPaths.map((target) => rm(target, { recursive: true, force: true })));
  return { buffer, result: parseExtractedDocumentPayload(JSON.stringify(result)) };
}
const clean = (value: string) =>
  value
    .replace(/\u0000/g, "")
    .replace(/\\u0000/g, "")
    .toWellFormed();
function sanitize(value: unknown): unknown {
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]));
  return value;
}
const sanitation = {
  cleanString: clean,
  sanitizeJsonbRecord(value: unknown): Record<string, unknown> {
    const sanitized = sanitize(value);
    if (sanitized === null || typeof sanitized !== "object" || Array.isArray(sanitized))
      throw new Error("Synthetic metadata must be a record");
    return sanitized as Record<string, unknown>;
  },
};

describe("DOCX source structure through existing page serialization", () => {
  it("retains authored row relationships, qualification, header and logical source locators", async () => {
    const { buffer, result } = await extracted();
    const page = result.pages[0];
    const provenance = docxProvenance(page);
    expect(provenance).toMatchObject({
      structuralDisposition: "retained",
      coordinateSpace: "docx_logical_document",
      physicalPageNumber: null,
      sourcePart: "word/document.xml",
      sourceContentSha256: extractedTextSha256(buffer),
    });
    const table = provenance.blocks.find((block) => block.kind === "table")!;
    expect(table).toMatchObject({
      bodyChildIndex: 5,
      tableIndex: 0,
      followingParagraphIndex: 6,
      coordinateSourcePart: "word/document.xml",
    });
    expect(table.rows![0].headerVerified).toBe(true);
    expect(table.rows![1].cells.map((cell) => cell.text)).toEqual(rowA);
    expect(table.rows![2].cells.map((cell) => cell.text)).toEqual(rowB);
    expect(provenance.blocks[6].text).toBe(evidence.footnote);
    expect(provenance.blocks[8].text).toBe(evidence.tail);
    expect(provenance.sourceRelationships).toContainEqual(
      expect.objectContaining({
        relationshipId: "rIdQAHeader",
        coordinateSourcePart: "word/header1.xml",
        targetPart: "word/header1.xml",
        disposition: "retained",
        text: marker,
      }),
    );
    for (const text of [
      evidence.scope,
      evidence.regimen,
      evidence.measurement,
      evidence.timings,
      evidence.footnote,
      evidence.tail,
    ])
      expect(page.text).toContain(text);
    expect(page.text.match(new RegExp(marker, "g"))).toHaveLength(1); // Header stays separate from body.
    const [persisted] = buildDocumentPageRowsForPersistence("synthetic-document", result, sanitation);
    expect(persisted.metadata.source_provenance).toEqual(provenance);
    // This is the exact existing p_pages field projection, without worker startup or Supabase.
    expect(
      JSON.parse(JSON.stringify({ p_pages: [persisted] })).p_pages[0].metadata.source_provenance.blocks[5].rows[2]
        .cells[2].text,
    ).toBe("3.5 mg");
  });
  it("retains the authored critical expectation when a source footnote is missing", async () => {
    const { result } = await extracted({ footnoteRemoved: true });
    const provenance = docxProvenance(result.pages[0]);
    expect(provenance.blocks.some((block) => block.text === evidence.footnote)).toBe(false);
    expect(provenance.blocks.find((block) => block.kind === "table")!.followingParagraphIndex).toBe(6);
    // The source reader reports adjacency only; it cannot invent the missing E-Q05 qualification.
    expect(result.pages[0].text).not.toContain(evidence.footnote);
    expect(evidence.footnote).toBe(
      "Rows A and B are alternative QA scenarios. Do not combine them. No conversion to a real medicine is supported.",
    );
  });
  it("marks merged critical cells and revisions incomplete rather than flattening a supported pass", async () => {
    for (const options of [{ merged: true }, { revision: true }, { drawing: true }]) {
      const { result } = await extracted(options);
      expect(docxProvenance(result.pages[0]).structuralDisposition).toBe("incomplete");
      expect(docxProvenance(result.pages[0]).reasonCodes).toContain(
        options.merged
          ? "docx_merged_cell_unsupported"
          : options.revision
            ? "docx_revision_unverified"
            : "docx_source_feature_unsupported",
      );
    }
  });
  it.each(["false", "0", "off"])("does not infer a header when explicit tblHeader is %s", async (headerVal) => {
    const { result } = await extracted({ headerVal });
    const table = docxProvenance(result.pages[0]).blocks.find((block) => block.kind === "table")!;
    expect(table.firstRow).toEqual(["Scenario", "Concentration", "Amount", "Volume", "Interval"]);
    expect(table.rows![0].headerVerified).toBe(false);
  });
  it("refuses external relationships without resolving or claiming their header text", async () => {
    const { result } = await extracted({ external: true });
    expect(docxProvenance(result.pages[0]).sourceRelationships[0]).toMatchObject({
      targetMode: "external",
      targetPart: null,
      disposition: "refused",
      reasonCodes: ["docx_external_relationship_refused"],
    });
    expect(docxProvenance(result.pages[0]).structuralDisposition).toBe("incomplete");
  });
  it.each([{ malformed: true }, { dtd: true }, { stylesDtd: true }])(
    "rejects invalid/active source XML before the text reader: %j",
    async (options) => {
      await expect(extracted(options)).rejects.toThrow(
        options.dtd || options.stylesDtd ? "docx_xml_dtd_or_entity_refused" : "docx_source_xml_invalid",
      );
    },
  );
  it("preserves ordinary paragraph boundaries inside cells and headers without inventing a number", async () => {
    const { result } = await extracted({ multipleParagraphs: true });
    const provenance = docxProvenance(result.pages[0]);
    const table = provenance.blocks.find((block) => block.kind === "table")!;
    expect(table.rows![1].cells[2].text).toBe("2\n0 mg");
    expect(table.rows![1].cells[2].text).not.toBe("20 mg");
    expect(provenance.sourceRelationships[0].text).toBe(`${marker}\n2\n0 mg`);
    const [persisted] = buildDocumentPageRowsForPersistence("synthetic-document", result, sanitation);
    expect(
      docxPageSourceProvenanceSchema.parse(persisted.metadata.source_provenance).blocks[5].rows![1].cells[2].text,
    ).toBe("2\n0 mg");
  });
  it.each([{ symbol: true }, { alternateContent: true }, { inheritedHidden: true }])(
    "does not mark unsupported source semantics retained: %j",
    async (options) => {
      const { result } = await extracted(options);
      const provenance = docxProvenance(result.pages[0]);
      expect(provenance.structuralDisposition).toBe("incomplete");
      expect(provenance.reasonCodes).toContain(
        options.inheritedHidden ? "docx_hidden_text_unverified" : "docx_source_feature_unsupported",
      );
      expect(provenance.blocks.find((block) => block.bodyChildIndex === 1)!.disposition).toBe("unverified");
      expect(result.pages[0].text).toContain("SYNTH-DRUG-Q");
    },
  );
  it.each([{ headerType: "https://synthetic.invalid/header" }, { headerRoot: "ftr" }])(
    "keeps unknown or mismatched source relationship roles unsupported: %j",
    async (options) => {
      const { result } = await extracted(options);
      const relationship = docxProvenance(result.pages[0]).sourceRelationships[0];
      expect(relationship.disposition).toBe("unsupported");
      expect(relationship.text).toBeUndefined();
      expect(docxProvenance(result.pages[0]).structuralDisposition).toBe("incomplete");
    },
  );
  it.each([{ unevenCells: true }, { zeroCells: true }, { gridBefore: true }])(
    "does not infer a supported simple grid for %j",
    async (options) => {
      const { result } = await extracted(options);
      const provenance = docxProvenance(result.pages[0]);
      expect(provenance.structuralDisposition).toBe("incomplete");
      expect(provenance.blocks.find((block) => block.kind === "table")!.disposition).toBe("unverified");
      expect(provenance.reasonCodes).toContain("docx_source_feature_unsupported");
    },
  );
  it("refuses an unknown main-document relationship mode", async () => {
    await expect(extracted({ mainMode: "UnknownMode" })).rejects.toThrow("docx_main_source_unresolved");
  });
  it.each(["_rels/.rels", "[Content_Types].xml", "custom/oversized.xml", "CUSTOM/oversized.XML", "_rels/.RELS"])(
    "checks declared aggregate XML size before inflating %s",
    async (part) => {
      const inflate = vi.fn();
      const zip = {
        files: { [part]: { dir: false, _data: { uncompressedSize: 33 * 1024 * 1024 }, async: inflate } },
        file: vi.fn(),
      } as unknown as JSZip;
      await expect(
        buildDocxSourceProvenance({ zip, buffer: Buffer.from("synthetic"), originalText: "" }),
      ).rejects.toThrow("DOCX_EXTRACTION_BUDGET_EXCEEDED");
      expect(inflate).not.toHaveBeenCalled();
      expect(zip.file).not.toHaveBeenCalled();
    },
  );

  it("rejects unknown provenance versions instead of silently stripping them", async () => {
    const { result } = await extracted();
    const payload = JSON.parse(JSON.stringify(result));
    payload.pages[0].metadata.source_provenance.version = "unknown-version";
    expect(() => parseExtractedDocumentPayload(JSON.stringify(payload))).toThrow();
  });
  it.each(["../word/document.xml", "https://synthetic.invalid/document.xml"])(
    "rejects a fabricated source locator: %s",
    async (part) => {
      const { result } = await extracted();
      const payload = JSON.parse(JSON.stringify(result));
      payload.pages[0].metadata.source_provenance.sourcePart = part;
      expect(() => parseExtractedDocumentPayload(JSON.stringify(payload))).toThrow();
    },
  );
  it("rejects arbitrary newly trusted metadata and unknown source reason codes", async () => {
    const { result } = await extracted();
    const payload = JSON.parse(JSON.stringify(result));
    payload.pages[0].metadata.unreviewedAuthority = "approved";
    expect(() => parseExtractedDocumentPayload(JSON.stringify(payload))).toThrow();
    delete payload.pages[0].metadata.unreviewedAuthority;
    payload.pages[0].metadata.source_provenance.reasonCodes = ["arbitrary_source_text"];
    expect(() => parseExtractedDocumentPayload(JSON.stringify(payload))).toThrow();
  });
  it("qualifies original and persisted UTF-8 hashes when SQL sanitation changes text or metadata", async () => {
    const { result } = await extracted();
    result.pages[0].text += "\u0000literal\\u0000tail\ud800";
    docxProvenance(result.pages[0]).blocks[0].text += "\u0000";
    const original = result.pages[0].text;
    const [persisted] = buildDocumentPageRowsForPersistence("synthetic-document", result, sanitation);
    const persistedProvenance = docxPageSourceProvenanceSchema.parse(persisted.metadata.source_provenance);
    const identity = persistedProvenance.textIdentity;
    expect(identity).toMatchObject({
      originalExtractedTextSha256: extractedTextSha256(original),
      persistedTextSha256: extractedTextSha256(clean(original)),
      normalizationApplied: true,
      metadataNormalizationApplied: true,
    });
    expect(identity.originalExtractedTextSha256).not.toBe(identity.persistedTextSha256);
    expect(persisted.text).not.toContain("\u0000");
    expect(persistedProvenance.blocks[0].text).toBe(marker);
    expect(docxProvenance(result.pages[0]).sourceContentSha256).not.toBe(identity.persistedTextSha256);
  });
});
