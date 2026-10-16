import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { extractDocument, parseExtractedDocumentPayload } from "@/lib/extractors/document";
import { validatePdfSourcePages } from "@/lib/extractors/pdf-source-provenance";
import { boundedXlsxJson, inspectOriginalXlsxZip, xlsxCrc32 } from "@/lib/extractors/xlsx-original-zip";
import { preflightOriginalXlsx } from "@/lib/extractors/xlsx-source-preflight";
import {
  orderedXlsxReasons,
  xlsxFactsSha256,
  xlsxPageSourceProvenanceSchema,
  XlsxSourceProvenanceError,
} from "@/lib/extractors/xlsx-source-provenance";
import {
  buildDocumentPageRowsForPersistence,
  ingestionFailureDecision,
  serializeDocumentPageRowsForCommit,
} from "../worker/behavior";

const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
async function sourceArchive(
  sheetData: string,
  options: {
    sheetTail?: string;
    workbookTail?: string;
    workbookName?: string;
    sheetId?: string;
    extra?: Record<string, string>;
    styles?: string;
    shared?: string;
  } = {},
) {
  const zip = new JSZip();
  const files: Record<string, string> = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="document" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="${options.workbookName ?? "Source"}" sheetId="${options.sheetId ?? "11"}" r:id="named-id"/></sheets>${options.workbookTail ?? ""}</workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="named-id" Type="${rel}/worksheet" Target="worksheets/sheet7.xml"/>${options.styles ? `<Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/>` : ""}${options.shared ? `<Relationship Id="strings" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/>` : ""}</Relationships>`,
    "xl/worksheets/sheet7.xml": `<worksheet xmlns="${ns}"><sheetData>${sheetData}</sheetData>${options.sheetTail ?? ""}</worksheet>`,
    ...(options.styles ? { "xl/styles.xml": options.styles } : {}),
    ...(options.shared ? { "xl/sharedStrings.xml": options.shared } : {}),
    ...options.extra,
  };
  for (const [name, text] of Object.entries(files)) zip.file(name, text, { createFolders: false });
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }));
}
const extract = (buffer: Buffer) => extractDocument({ buffer, fileName: "synthetic.xlsx", mimeType });
const noSanitation = {
  cleanString: (s: string) => s,
  sanitizeJsonbRecord: (v: unknown) => structuredClone(v) as Record<string, unknown>,
};
const sourcePacket = (document: Awaited<ReturnType<typeof extract>>) =>
  xlsxPageSourceProvenanceSchema.parse(document.pages[0].metadata?.source_provenance);

describe("bounded original XLSX source observations", () => {
  it("traverses xmldom terminal text, CDATA, comment and processing-instruction nodes", async () => {
    const buffer = await sourceArchive(
      '\n<!-- synthetic terminal node --><?synthetic terminal?><row r="1"><c r="A1"><v><![CDATA[7]]></v></c></row>\n',
    );
    const source = await preflightOriginalXlsx(buffer);
    expect(source.worksheets[0].worksheet.rows[0].cells[0].value?.textToken).toBe("7");
  });
  it("accepts the implicit reserved xml prefix and refuses its namespace rebinding", async () => {
    const source = await preflightOriginalXlsx(
      await sourceArchive('<row r="1"><c r="A1" t="inlineStr"><is><t xml:space="preserve"> source </t></is></c></row>'),
    );
    expect(source.worksheets[0].worksheet.rows[0].cells[0].inlineString?.textTokens[0].textToken).toBe(" source ");
    await expect(
      preflightOriginalXlsx(
        await sourceArchive(
          '<row r="1"><c r="A1" t="inlineStr"><is><t xmlns:xml="urn:synthetic-spoof" xml:space="preserve"> source </t></is></c></row>',
        ),
      ),
    ).rejects.toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
  });
  const namespaceSpoofCases: Array<{
    sheetData?: string;
    sheetTail?: string;
    workbookTail?: string;
    extra?: Record<string, string>;
  }> = [
    { sheetData: '<row xmlns="urn:synthetic-spoof" r="1"><c r="A1"><v>7</v></c></row>' },
    { sheetData: '<row r="1"><c xmlns="urn:synthetic-spoof" r="A1"><v>7</v></c></row>' },
    { sheetTail: '<cols><col xmlns="urn:synthetic-spoof" min="1" max="2"/></cols>' },
    { sheetTail: '<mergeCells><mergeCell xmlns="urn:synthetic-spoof" ref="A1:B2"/></mergeCells>' },
    { sheetTail: '<dataValidations><dataValidation xmlns="urn:synthetic-spoof" sqref="A1:B2"/></dataValidations>' },
    {
      sheetTail:
        '<dataValidations><dataValidation sqref="A1"><formula1 xmlns="urn:synthetic-spoof">7</formula1></dataValidation></dataValidations>',
    },
    {
      workbookTail:
        '<definedNames><definedName xmlns="urn:synthetic-spoof" name="Synthetic">Source!$A$1</definedName></definedNames>',
    },
    {
      extra: {
        "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship xmlns="urn:synthetic-spoof" Id="document" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      },
    },
    {
      extra: {
        "[Content_Types].xml":
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default xmlns="urn:synthetic-spoof" Extension="xml" ContentType="application/xml"/></Types>',
      },
    },
  ];
  it.each(namespaceSpoofCases)(
    "refuses consumer-recognized lexical namespace spoofing before obtaining the ExcelJS loader: %j",
    async (input) => {
      const buffer = await sourceArchive(input.sheetData ?? '<row r="1"><c r="A1"><v>7</v></c></row>', input);
      const loader = vi.spyOn(ExcelJS.Workbook.prototype, "xlsx", "get");
      try {
        await expect(extract(buffer)).rejects.toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
        expect(loader).not.toHaveBeenCalled();
      } finally {
        loader.mockRestore();
      }
    },
  );
  it("retains a prefixed unknown family without treating its local row name as an ExcelJS allocation", async () => {
    const source = await preflightOriginalXlsx(
      await sourceArchive('<alien:row xmlns:alien="urn:synthetic-unknown" r="1"/>'),
    );
    expect(source.worksheets[0].worksheet.otherChildren).toContainEqual(
      expect.objectContaining({
        namespaceUri: "urn:synthetic-unknown",
        localName: "row",
        reasonCode: "xlsx_unknown_feature_unverified",
      }),
    );
  });
  it("preserves the exact public producer text and distinct sheet/part/page identities", async () => {
    const buffer = await sourceArchive(
      '<row r="1"><c r="C1" t="inlineStr"><is><t>comma, newline&#10;tail</t></is></c></row>',
    );
    const prior = new ExcelJS.Workbook();
    await prior.xlsx.load(buffer as unknown as Parameters<typeof prior.xlsx.load>[0]);
    const expected = prior.worksheets.map((sheet) => {
      const rows: string[] = [];
      sheet.eachRow({ includeEmpty: false }, (row) =>
        rows.push((Array.isArray(row.values) ? row.values.slice(1) : []).map((value) => String(value ?? "")).join(",")),
      );
      return `Sheet: ${sheet.name}\n${rows.join("\n")}`;
    });
    const document = await extract(buffer),
      packet = sourcePacket(document);
    expect(document.pages.map((page) => page.text)).toEqual(expected);
    expect(packet.sourceFacts.workbook.sheets[0]).toMatchObject({
      sheetIdToken: "11",
      sourceOrdinal: 0,
      emittedLogicalUnitIndex: 1,
      relationshipIdToken: "named-id",
      resolvedPart: { name: "xl/worksheets/sheet7.xml" },
    });
    expect(packet.sourceFacts.worksheet.rows[0].cells[0]).toMatchObject({
      address: "C1",
      columnNumber: 3,
      inlineString: { textTokens: [{ textToken: "comma, newline\ntail" }] },
    });
    expect(packet.sourceFactsIdentity.originalFactsSha256).toBe(xlsxFactsSha256(packet.sourceFacts));
    expect(packet).toMatchObject({
      formulaEvaluation: "unperformed",
      cachedResultFreshness: "unknown",
      displayObservation: { status: "unverified", value: null },
    });
    expect(parseExtractedDocumentPayload(JSON.stringify(document))).toEqual(document);
  });

  it("retains absent, empty, zero, Boolean, error and stale formula-cache tokens separately", async () => {
    const buffer = await sourceArchive(
      '<row r="1"><c r="A1"><f>1+1</f></c><c r="B1"><f>1+1</f><v/></c><c r="C1"><f>1+1</f><v>0</v></c><c r="D1" t="b"><f>1=2</f><v>0</v></c><c r="E1" t="e"><f>1/0</f><v>#DIV/0!</v></c><c r="F1"><f>4+0</f><v>400</v></c></row>',
    );
    const packet = sourcePacket(await extract(buffer)),
      cells = packet.sourceFacts.worksheet.rows[0].cells;
    expect(cells.map((cell) => cell.value?.textToken ?? null)).toEqual([null, "", "0", "0", "#DIV/0!", "400"]);
    expect(cells.every((cell) => cell.reasonCodes.includes("xlsx_formula_interpretation_unverified"))).toBe(true);
    expect(cells[0].reasonCodes).toContain("xlsx_formula_cache_absent");
    expect(cells[1].reasonCodes).not.toContain("xlsx_formula_cache_absent");
    expect(cells[4].reasonCodes).toContain("xlsx_source_error_unverified");
  });

  it("retains merge, hidden, rich/shared and custom-style facts without display inference", async () => {
    const buffer = await sourceArchive('<row r="1" hidden="1" s="0"><c r="A1" t="s" s="0"><v>0</v></c></row>', {
      sheetTail:
        '<cols><col min="1" max="2" hidden="1" style="0"/></cols><mergeCells><mergeCell ref="A1:B2"/></mergeCells><pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>',
      styles: `<styleSheet xmlns="${ns}"><numFmts><numFmt numFmtId="164" formatCode="0.0%"/></numFmts><cellXfs><xf numFmtId="164" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>`,
      shared: `<sst xmlns="${ns}"><si><r><rPr><b/></rPr><t xml:space="preserve"> rich </t></r><r><t>tail</t></r></si></sst>`,
    });
    const context = await preflightOriginalXlsx(buffer),
      f = context.worksheets[0];
    expect(f.worksheet.rows).toHaveLength(1);
    expect(f.worksheet.rows[0].cells).toHaveLength(1);
    expect(f.styleRefs[0]).toMatchObject({
      resolution: "custom_source",
      customNumFmt: {
        attributes: expect.arrayContaining([expect.objectContaining({ localName: "formatCode", value: "0.0%" })]),
      },
    });
    expect(f.sharedStringRefs[0].runs.textTokens.map((t) => t.textToken)).toEqual([" rich ", "tail"]);
    expect(f.worksheet.merges[0].attributes).toContainEqual(
      expect.objectContaining({ localName: "ref", value: "A1:B2" }),
    );
  });

  it("rejects unbranded JSON clones and mutation of a branded fresh extraction", async () => {
    const document = await extract(await sourceArchive('<row r="1"><c r="A1"><v>7</v></c></row>'));
    const parsed = parseExtractedDocumentPayload(JSON.stringify(document));
    expect(() => buildDocumentPageRowsForPersistence("synthetic", parsed, noSanitation)).toThrow(
      "XLSX_SOURCE_PROVENANCE_IDENTITY_MISMATCH",
    );
    const rows = buildDocumentPageRowsForPersistence("synthetic", document, noSanitation);
    expect(serializeDocumentPageRowsForCommit(rows, noSanitation)[0].text).toBe(document.pages[0].text);
    delete document.pages[0].metadata?.source_provenance;
    expect(() => buildDocumentPageRowsForPersistence("synthetic", document, noSanitation)).toThrow(
      XlsxSourceProvenanceError,
    );
  });
  it("retains nested external relationship owners, permits owner-local ID reuse and rejects rehashed status downgrade", async () => {
    const document = await extract(
      await sourceArchive('<row r="1"><c r="A1"><v>7</v></c></row>', {
        workbookTail: '<externalReferences><externalReference r:id="external"/></externalReferences>',
        extra: {
          "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="named-id" Type="${rel}/worksheet" Target="worksheets/sheet7.xml"/><Relationship Id="external" Type="${rel}/externalLink" Target="externalLinks/externalLink1.xml"/></Relationships>`,
          "xl/externalLinks/externalLink1.xml": `<externalLink xmlns="${ns}" xmlns:r="${rel}"><externalBook r:id="document"/></externalLink>`,
          "xl/externalLinks/_rels/externalLink1.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="document" Type="${rel}/externalLinkPath" Target="https://synthetic.invalid/qualifier.xlsx" TargetMode="External"/></Relationships>`,
        },
      }),
    );
    const source = sourcePacket(document);
    const nested = source.sourceFacts.packageRelationships.find(
      (record) => record.sourcePart.name === "xl/externalLinks/_rels/externalLink1.xml.rels",
    );
    expect(nested).toMatchObject({
      idToken: "document",
      targetModeToken: "External",
      status: "external_unresolved",
      resolvedInternalPart: null,
    });
    expect(nested?.targetTokenSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(source.sourceFacts.packageRelationships.filter((record) => record.idToken === "document")).toHaveLength(2);
    expect(source.reasonCodes).toContain("xlsx_external_relationship_unresolved");
    expect(parseExtractedDocumentPayload(JSON.stringify(document))).toEqual(document);
    const altered = structuredClone(document),
      packet = altered.pages[0].metadata!.source_provenance;
    if (!packet || packet.format !== "xlsx") throw new Error("synthetic test setup");
    const alteredRelation = packet.sourceFacts.packageRelationships.find(
      (record) => record.sourcePart.name === "xl/externalLinks/_rels/externalLink1.xml.rels",
    );
    if (!alteredRelation) throw new Error("synthetic test setup");
    alteredRelation.status = "unknown_unresolved";
    packet.sourceFactsIdentity.originalFactsSha256 = packet.sourceFactsIdentity.persistedFactsSha256 = xlsxFactsSha256(
      packet.sourceFacts,
    );
    packet.reasonCodes = orderedXlsxReasons([
      ...packet.reasonCodes.filter((reason) => reason !== "xlsx_external_relationship_unresolved"),
      "xlsx_unknown_feature_unverified",
    ]);
    expect(() => parseExtractedDocumentPayload(JSON.stringify(altered))).toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
  });

  it.each([false, true])(
    "rejects rehashed relabeling of a known omitted chart feature, normalized=%s",
    async (normalized) => {
      const altered = structuredClone(
        await extract(
          await sourceArchive('<row r="1"><c r="A1"><v>7</v></c></row>', {
            extra: {
              "xl/charts/chart1.xml":
                '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
            },
          }),
        ),
      );
      const packet = altered.pages[0].metadata!.source_provenance;
      if (!packet || packet.format !== "xlsx") throw new Error("synthetic test setup");
      const feature = packet.sourceFacts.packageFeatures.find(
        (item) => item.sourcePart.name === "xl/charts/chart1.xml",
      );
      if (!feature) throw new Error("synthetic test setup");
      expect(feature.reasonCode).toBe("xlsx_unmodeled_content_gap");
      feature.reasonCode = "xlsx_unknown_feature_unverified";
      feature.status = "source_observed_unverified";
      packet.sourceFactsIdentity.originalFactsSha256 = packet.sourceFactsIdentity.persistedFactsSha256 =
        xlsxFactsSha256(packet.sourceFacts);
      packet.textIdentity.metadataNormalizationApplied = normalized;
      packet.reasonCodes = orderedXlsxReasons([
        ...packet.reasonCodes.filter((reason) => reason !== "xlsx_unmodeled_content_gap"),
        "xlsx_unknown_feature_unverified",
        ...(normalized ? ["xlsx_metadata_tokens_normalized_unverified" as const] : []),
      ]);
      packet.structuralDisposition = "unverified";
      expect(() => parseExtractedDocumentPayload(JSON.stringify(altered))).toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
    },
  );
  it("requires the metadata normalization reason even when both facts hashes remain equal", async () => {
    const altered = structuredClone(
      await extract(await sourceArchive('<row r="1"><c r="A1"><f>1+1</f><v>0</v></c></row>')),
    );
    const packet = altered.pages[0].metadata!.source_provenance;
    if (!packet || packet.format !== "xlsx") throw new Error("synthetic test setup");
    expect(packet.reasonCodes).toContain("xlsx_formula_interpretation_unverified");
    expect(packet.structuralDisposition).toBe("unverified");
    expect(packet.sourceFactsIdentity.originalFactsSha256).toBe(packet.sourceFactsIdentity.persistedFactsSha256);
    packet.textIdentity.metadataNormalizationApplied = true;
    expect(() => parseExtractedDocumentPayload(JSON.stringify(altered))).toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
    packet.reasonCodes = orderedXlsxReasons([...packet.reasonCodes, "xlsx_metadata_tokens_normalized_unverified"]);
    expect(parseExtractedDocumentPayload(JSON.stringify(altered))).toEqual(altered);
  });
  it("accepts JSONB object-key reorder and rejects forged facts/classification/hash or worksheet identity", async () => {
    const document = await extract(await sourceArchive('<row r="1"><c r="A1"><f>1+1</f><v>0</v></c></row>'));
    const reorder = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reorder)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, child]) => [key, reorder(child)]),
            )
          : value;
    expect(parseExtractedDocumentPayload(JSON.stringify(reorder(document)))).toEqual(document);
    const altered = structuredClone(document),
      packet = altered.pages[0].metadata!.source_provenance;
    if (!packet || packet.format !== "xlsx") throw new Error("synthetic test setup");
    packet.sourceFacts.worksheet.rows[0].cells[0].value!.textToken = "400";
    expect(() => parseExtractedDocumentPayload(JSON.stringify(altered))).toThrow(
      "XLSX_SOURCE_PROVENANCE_IDENTITY_MISMATCH",
    );
    packet.sourceFactsIdentity.originalFactsSha256 = packet.sourceFactsIdentity.persistedFactsSha256 = xlsxFactsSha256(
      packet.sourceFacts,
    );
    packet.reasonCodes = [];
    packet.structuralDisposition = "retained";
    expect(() => parseExtractedDocumentPayload(JSON.stringify(altered))).toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
    expect(() =>
      validatePdfSourcePages(document.pages, {
        sourceSha256: "sha256:" + "0".repeat(64),
        scriptSha256: "sha256:" + "0".repeat(64),
        requireEveryPage: true,
      }),
    ).toThrow("PDF_SOURCE_PROVENANCE_INVALID");
  });

  it.each([
    { data: '<row r="1"><c r="A2"><v>1</v></c></row>', tail: "", code: "XLSX_SOURCE_PROVENANCE_INVALID" },
    { data: '<row r="1"><c r="A1"><v>1</v><v>2</v></c></row>', tail: "", code: "XLSX_SOURCE_PROVENANCE_INVALID" },
    {
      data: '<row r="1"><c r="XFD1"><v>1</v></c></row>',
      tail: '<mergeCells><mergeCell ref="A1:XFD1048576"/></mergeCells>',
      code: "XLSX_EXTRACTION_BUDGET_EXCEEDED",
    },
    { data: "", tail: '<cols><col min="1" max="16385"/></cols>', code: "XLSX_SOURCE_PROVENANCE_INVALID" },
  ])("refuses malformed coordinates and bounded pre-load expansion $code", async ({ data, tail, code }) => {
    await expect(preflightOriginalXlsx(await sourceArchive(data, { sheetTail: tail }))).rejects.toMatchObject({ code });
  });

  it("refuses admitted enormous/ambiguous ordinary defined names before the public loader", async () => {
    for (const value of ["Source!$A$1:$XFD$1048576", "SUM(Source!$A$1)", "Source!$a$1"]) {
      const buffer = await sourceArchive("", {
        workbookTail: `<definedNames><definedName name="ordinary">${value}</definedName></definedNames>`,
      });
      await expect(preflightOriginalXlsx(buffer)).rejects.toBeInstanceOf(XlsxSourceProvenanceError);
    }
  });

  const validation = (sqref: string) => `<dataValidations><dataValidation sqref="${sqref}"/></dataValidations>`;
  const ordinaryName = (range: string) =>
    `<definedNames><definedName name="ordinary">${range}</definedName></definedNames>`;
  const resourceRefusals: Array<{
    label: string;
    data?: string;
    options?: Parameters<typeof sourceArchive>[1];
  }> = [
    { label: "enormous numeric source sheet ID", options: { sheetId: "2147483647" } },
    { label: "sheet ID plus source cell crosses W", options: { sheetId: "2000000" } },
    { label: "far explicit source row", data: '<row r="1048576"><c r="A1048576"><v>7</v></c></row>' },
    {
      label: "far one-row merge",
      options: { sheetTail: '<mergeCells><mergeCell ref="A200000:B200000"/></mergeCells>' },
    },
    { label: "far ordinary named matrix", options: { workbookTail: ordinaryName("Source!$A$200000") } },
    {
      label: "mixed admitted and ignored named matrix list",
      options: { workbookTail: ordinaryName("Source!$A$1:$A$1048576,Other!A1") },
    },
    {
      label: "quoted comma name with an ignored final item",
      options: { workbookTail: ordinaryName("'Source, O''Brien'!$A$200000,Other!A1") },
    },
    {
      label: "duplicate ordinary name bottoms",
      options: { workbookTail: ordinaryName("Source!$A$100000,Source!$A$100000") },
    },
    { label: "large validation rectangle", options: { sheetTail: validation("A1:XFD1048576") } },
    {
      label: "reversed dollar validation rectangle still expands",
      options: { sheetTail: validation("$XFD$1048576:$A$1") },
    },
    { label: "validation single rectangle crosses combined W", options: { sheetTail: validation("A1:T100000") } },
    {
      label: "overlapping validation tokens charge each full area",
      options: { sheetTail: validation("A1:A999994 A1:A999995") },
    },
    {
      label: "duplicate validation elements accumulate",
      options: {
        sheetTail:
          '<dataValidations><dataValidation sqref="A1:A1000000"/><dataValidation sqref="A1:A1000000"/></dataValidations>',
      },
    },
    {
      label: "validation single addresses count and duplicate",
      options: { sheetId: "1999997", sheetTail: validation("A1 A1 A1") },
    },
    {
      label: "combined row merge and ordinary name H",
      data: '<row r="99999"><c r="A99999"><v>7</v></c></row>',
      options: {
        sheetTail: '<mergeCells><mergeCell ref="B100000:B100000"/></mergeCells>',
        workbookTail: ordinaryName("Source!$A$100000"),
      },
    },
    {
      label: "consumed orphan worksheet extent accumulates",
      data: '<row r="100000"/>',
      options: {
        extra: {
          "xl/worksheets/sheet8.xml": `<worksheet xmlns="${ns}"><sheetData><row r="100001"/></sheetData></worksheet>`,
        },
      },
    },
    {
      label: "consumed orphan validation is charged",
      options: {
        extra: {
          "xl/worksheets/sheet8.xml": `<worksheet xmlns="${ns}"><sheetData/>${validation("A1:XFD1048576")}</worksheet>`,
        },
      },
    },
    {
      label: "wrapped validation is still a lexical consumer",
      options: { sheetTail: `<unknown>${validation("A1:XFD1048576")}</unknown>` },
    },
    {
      label: "wrapped source rows retain existing W",
      options: {
        sheetTail: `<unknown><sheetData>${Array.from({ length: 123 }, (_, index) => `<row r="${index + 1}"><c r="XFD${index + 1}"><v>7</v></c></row>`).join("")}</sheetData></unknown>`,
      },
    },
    {
      label: "wrapped merge retains existing W",
      options: { sheetTail: '<unknown><mergeCells><mergeCell ref="A1:XFD123"/></mergeCells></unknown>' },
    },
    {
      label: "wrapped columns retain existing W",
      options: { sheetId: "1990000", sheetTail: '<unknown><cols><col min="1" max="16384"/></cols></unknown>' },
    },
    {
      label: "wrapped ordinary names retain W and H",
      options: { workbookTail: `<unknown>${ordinaryName("Source!$A$200000")}</unknown>` },
    },
    {
      label: "wrapped sheets retain source ID extent",
      options: {
        workbookTail:
          '<unknown><sheets><sheet name="Wrapped" sheetId="2147483647" r:id="named-id"/></sheets></unknown>',
      },
    },
    {
      label: "wrapped sheets retain aggregate source sheet cap",
      options: {
        workbookTail: `<unknown><sheets>${'<sheet name="Wrapped" sheetId="1" r:id="named-id"/>'.repeat(256)}</sheets></unknown>`,
      },
    },
    {
      label: "merge pair-work cap remains enforced",
      options: { sheetTail: `<mergeCells>${'<mergeCell ref="A1:A1"/>'.repeat(2001)}</mergeCells>` },
    },
  ];
  it.each(resourceRefusals)(
    "refuses tiny original ZIP resource path before obtaining public loader: $label",
    async ({ data, options }) => {
      const buffer = await sourceArchive(data ?? '<row r="1"><c r="A1"><v>7</v></c></row>', options);
      expect(buffer.length).toBeLessThan(64 * 1024);
      const loader = vi.spyOn(ExcelJS.Workbook.prototype, "xlsx", "get");
      try {
        await expect(extract(buffer)).rejects.toMatchObject({
          code: "XLSX_EXTRACTION_BUDGET_EXCEEDED",
          message: "XLSX_EXTRACTION_BUDGET_EXCEEDED",
        });
        expect(loader).not.toHaveBeenCalled();
      } finally {
        loader.mockRestore();
      }
    },
  );

  it.each([
    "A1:B2:C3",
    "A1:B2junk",
    "A1:B2, C3",
    "Source!A1:B2",
    "a1:B2",
    "A0:B2",
    "A1:B1048577",
    "A1:XFE2",
    "A1:2",
    "1:2",
    "A:A",
    "$A$$1:B2",
    "#REF!",
    " A1",
    "A1 ",
    "",
  ])("refuses ambiguous validation syntax before obtaining public loader: %s", async (sqref) => {
    const buffer = await sourceArchive('<row r="1"><c r="A1"><v>7</v></c></row>', { sheetTail: validation(sqref) });
    const loader = vi.spyOn(ExcelJS.Workbook.prototype, "xlsx", "get");
    try {
      await expect(extract(buffer)).rejects.toMatchObject({
        code: "XLSX_SOURCE_PROVENANCE_INVALID",
        message: "XLSX_SOURCE_PROVENANCE_INVALID",
      });
      expect(loader).not.toHaveBeenCalled();
    } finally {
      loader.mockRestore();
    }
  });
  it("admits exact combined W/H boundaries without expanding grids in preflight", async () => {
    const row = '<row r="1"><c r="A1"><v>7</v></c></row>';
    for (const options of [
      { sheetId: "1999999" }, // E + highest source column = 2,000,000.
      { sheetTail: validation("A1:A999994 A1:A999994") }, // 11 + 1 + 2 * 999,994.
      { sheetId: "1999997", sheetTail: validation("A1 A1") },
      { workbookTail: ordinaryName("Source!$A$199999") }, // row extent 1 + name bottom 199,999.
      { sheetTail: '<mergeCells><mergeCell ref="B199999:B199999"/></mergeCells>' },
    ]) {
      expect(
        (await preflightOriginalXlsx(await sourceArchive(row, options))).worksheets[0].workbook.sheets[0].sheetIdToken,
      ).toBe(options.sheetId ?? "11");
    }
    const sparse = await preflightOriginalXlsx(await sourceArchive('<row r="200000"/>'));
    expect(sparse.worksheets[0].worksheet.rows[0].rowNumberToken).toBe("200000");
  });
  it.each(["A1000000 Bad!$A$1", "A1000000^Bad!$A$1", "Source!$A$1junk", "Source!$A$1:$B$2:$C$3"])(
    "refuses permissive named-range decoding ambiguities before obtaining public loader: %s",
    async (range) => {
      const buffer = await sourceArchive('<row r="1"><c r="A1"><v>7</v></c></row>', {
        workbookTail: ordinaryName(range),
      });
      const loader = vi.spyOn(ExcelJS.Workbook.prototype, "xlsx", "get");
      try {
        await expect(extract(buffer)).rejects.toMatchObject({
          code: "XLSX_SOURCE_PROVENANCE_INVALID",
          message: "XLSX_SOURCE_PROVENANCE_INVALID",
        });
        expect(loader).not.toHaveBeenCalled();
      } finally {
        loader.mockRestore();
      }
    },
  );
  it("keeps wholly unadmitted and unterminated quoted ordinary-name text as observed uncertainty", async () => {
    for (const range of ["'ignored", "'ignored!$A$1048576", "Source!A1048576", ",Other!A1,"]) {
      const source = await preflightOriginalXlsx(
        await sourceArchive('<row r="1"><c r="A1"><v>7</v></c></row>', {
          workbookTail: ordinaryName(range),
        }),
      );
      expect(source.worksheets[0].workbook.definedNames[0].textToken).toBe(range);
    }
  });
  it("preserves unsupported chart IDs outside the ordinary worksheet extent term", async () => {
    const source = await preflightOriginalXlsx(
      await sourceArchive('<row r="1"><c r="A1"><v>7</v></c></row>', {
        extra: {
          "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Source" sheetId="11" r:id="named-id"/><sheet name="Chart" sheetId="2147483647" r:id="chart-id"/></sheets></workbook>`,
          "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="named-id" Type="${rel}/worksheet" Target="worksheets/sheet7.xml"/><Relationship Id="chart-id" Type="${rel}/chartsheet" Target="chartsheets/sheet1.xml"/></Relationships>`,
          "xl/chartsheets/sheet1.xml": `<chartsheet xmlns="${ns}"/>`,
        },
      }),
    );
    expect(source.worksheets[0].workbook.sheets[1]).toMatchObject({
      sheetIdToken: "2147483647",
      status: "unsupported_sheet",
      reasonCodes: ["xlsx_unsupported_sheet_gap"],
    });
  });
  it.each([false, true])(
    "refuses an unsupported relationship mapped to an allocatable ordinary worksheet before public load (wrapped=%s)",
    async (wrapped) => {
      const extraSheet = '<sheet name="Disguised" sheetId="2147483647" r:id="disguised-id"/>';
      const buffer = await sourceArchive('<row r="1"><c r="A1"><v>7</v></c></row>', {
        extra: {
          "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Source" sheetId="11" r:id="named-id"/>${wrapped ? "" : extraSheet}</sheets>${wrapped ? `<unknown><sheets>${extraSheet}</sheets></unknown>` : ""}</workbook>`,
          "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="named-id" Type="${rel}/worksheet" Target="worksheets/sheet7.xml"/><Relationship Id="disguised-id" Type="${rel}/chartsheet" Target="worksheets/sheet8.xml"/></Relationships>`,
          "xl/worksheets/sheet8.xml": `<worksheet xmlns="${ns}"><sheetData/></worksheet>`,
        },
      });
      const loader = vi.spyOn(ExcelJS.Workbook.prototype, "xlsx", "get");
      try {
        await expect(extract(buffer)).rejects.toMatchObject({
          code: "XLSX_SOURCE_PROVENANCE_IDENTITY_MISMATCH",
          message: "XLSX_SOURCE_PROVENANCE_IDENTITY_MISMATCH",
        });
        expect(loader).not.toHaveBeenCalled();
      } finally {
        loader.mockRestore();
      }
    },
  );
  it("loads admitted sparse rows and dollar/reversed validations with original IDs and producer text", async () => {
    const buffer = await sourceArchive('<row r="1001"><c r="C1001"><v>7</v></c></row>', {
      sheetId: "101",
      sheetTail: validation("$B$3:$A$2 C4  A2 A2 $A$1048576"),
      workbookTail: ordinaryName("Source!$A$1002,Other!A1"),
    });
    const prior = new ExcelJS.Workbook();
    await prior.xlsx.load(buffer as unknown as Parameters<typeof prior.xlsx.load>[0]);
    const expected: string[] = [];
    prior.worksheets[0].eachRow({ includeEmpty: false }, (row) =>
      expected.push(
        (Array.isArray(row.values) ? row.values.slice(1) : []).map((value) => String(value ?? "")).join(","),
      ),
    );
    const loader = vi.spyOn(ExcelJS.Workbook.prototype, "xlsx", "get");
    try {
      const document = await extract(buffer),
        packet = sourcePacket(document);
      expect(loader).toHaveBeenCalled();
      expect(document.pages[0].text).toBe(`Sheet: Source\n${expected.join("\n")}`);
      expect(document.pages[0].text).toBe("Sheet: Source\n,,7");
      expect(packet.sourceFacts.workbook.sheets[0]).toMatchObject({
        sheetIdToken: "101",
        relationshipIdToken: "named-id",
        resolvedPart: { name: "xl/worksheets/sheet7.xml" },
      });
      expect(packet.sourceFacts.worksheet.rows[0]).toMatchObject({
        rowNumberToken: "1001",
        cells: [expect.objectContaining({ address: "C1001", value: expect.objectContaining({ textToken: "7" }) })],
      });
      expect(packet.sourceFacts.workbook.definedNames[0].textToken).toBe("Source!$A$1002,Other!A1");
    } finally {
      loader.mockRestore();
    }
  });

  it.each([
    '<!DOCTYPE worksheet [<!ENTITY private "synthetic">]><worksheet/>',
    `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="n" t="s"/></row></sheetData></worksheet>`,
    `<worksheet xmlns="${ns}"><sheetData></worksheet>`,
    '<?xml version="1.0" encoding="UTF-16"?><worksheet/>',
  ])("refuses consumed malformed/DTD/encoding XML with fixed safe error", async (xml) => {
    const buffer = await sourceArchive("", { extra: { "xl/worksheets/sheet7.xml": xml } });
    await expect(extract(buffer)).rejects.toMatchObject({
      code: "XLSX_SOURCE_PROVENANCE_INVALID",
      message: "XLSX_SOURCE_PROVENANCE_INVALID",
    });
  });

  it("checks original local names, CRC and duplicate records before normalized ZIP interpretation", async () => {
    const buffer = await sourceArchive('<row r="1"><c r="A1"><v>7</v></c></row>');
    const crcBroken = Buffer.from(buffer);
    const dataStart = 30 + crcBroken.readUInt16LE(26) + crcBroken.readUInt16LE(28);
    crcBroken[dataStart] ^= 1;
    await expect(extract(crcBroken)).rejects.toMatchObject({ code: "XLSX_SOURCE_PROVENANCE_INVALID" });
    const nameBroken = Buffer.from(buffer);
    nameBroken[30] ^= 1;
    expect(() => inspectOriginalXlsxZip(nameBroken)).toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
    const duplicated = await sourceArchive("", { extra: { "same1.xml": "<root/>", "same2.xml": "<root/>" } });
    let central = duplicated.readUInt32LE(duplicated.length - 6);
    while (duplicated.readUInt32LE(central) === 0x02014b50) {
      const length = duplicated.readUInt16LE(central + 28),
        name = duplicated.subarray(central + 46, central + 46 + length).toString("utf8");
      if (name === "same2.xml") {
        const local = duplicated.readUInt32LE(central + 42);
        duplicated.write("same1.xml", central + 46, "utf8");
        duplicated.write("same1.xml", local + 30, "utf8");
      }
      central += 46 + length + duplicated.readUInt16LE(central + 30) + duplicated.readUInt16LE(central + 32);
      if (central >= duplicated.length - 22) break;
    }
    expect(() => inspectOriginalXlsxZip(duplicated)).toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
    expect(xlsxCrc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
  it.each([
    "../xl/worksheets/sheet7.xml",
    "xl/worksheets/sheet7.xml.trailing",
    "xl\\worksheets\\sheet7.xml",
    "xl/%2e%2e/alias.xml",
  ])("refuses original member alias %s", async (name) => {
    const buffer = await sourceArchive("", { extra: { [name]: "<root/>" } });
    expect(() => inspectOriginalXlsxZip(buffer)).toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
  });
  it("refuses flag, split-disk, preamble, extra-field and data-descriptor ambiguity in the original protocol", async () => {
    const original = await sourceArchive("");
    const eocd = original.length - 22,
      central = original.readUInt32LE(eocd + 16);
    const flags = Buffer.from(original);
    flags.writeUInt16LE(1, 6);
    flags.writeUInt16LE(1, central + 8);
    expect(() => inspectOriginalXlsxZip(flags)).toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
    const disk = Buffer.from(original);
    disk.writeUInt16LE(1, eocd + 4);
    expect(() => inspectOriginalXlsxZip(disk)).toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
    expect(() => inspectOriginalXlsxZip(Buffer.concat([Buffer.from("SFX"), original]))).toThrow(
      "XLSX_SOURCE_PROVENANCE_INVALID",
    );
    const extra = Buffer.from(original);
    extra.writeUInt16LE(3, 28);
    expect(() => inspectOriginalXlsxZip(extra)).toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
    const descriptor = Buffer.from(original);
    descriptor.writeUInt16LE(8, 6);
    descriptor.writeUInt16LE(8, central + 8);
    expect(() => inspectOriginalXlsxZip(descriptor)).toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
  });

  it("accounts for escaped JSON bytes before serialization and makes source refusals terminal", () => {
    expect(boundedXlsxJson({ text: 'é\\\n"\ud800😀' }, 128)).toBe(JSON.stringify({ text: 'é\\\n"\ud800😀' }));
    expect(() => boundedXlsxJson({ text: "x".repeat(20) }, 16)).toThrow("XLSX_EXTRACTION_BUDGET_EXCEEDED");
    for (const atomicReindex of [false, true])
      expect(
        ingestionFailureDecision({
          error: new XlsxSourceProvenanceError("XLSX_SOURCE_PROVENANCE_INVALID"),
          attemptCount: 0,
          maxAttempts: 5,
          atomicReindex,
        }),
      ).toMatchObject({
        retry: false,
        documentStatus: atomicReindex ? "indexed" : "failed",
        stage: "failed",
        errorMessage: "XLSX_SOURCE_PROVENANCE_INVALID",
      });
  });
});
