import { clinicalVocabularyTerms } from "../src/lib/clinical-vocabulary";

type TableFactJob = {
  document_id: string;
  documents: {
    owner_id: string | null;
  };
};

export type TableFactChunkRow = {
  id: string;
  page_number: number | null;
  chunk_index?: number | null;
  image_ids?: string[] | null;
  content?: string | null;
  section_heading?: string | null;
  section_path?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

export type TableFactImageRow = {
  id: string;
  caption?: string | null;
  pageNumber: number | null;
  imageType?: string | null;
  sourceKind?: string | null;
  labels?: string[] | null;
  tableLabel?: string | null;
  tableTitle?: string | null;
  tableTextSnippet?: string | null;
  tableRole?: string | null;
  accessibleTableMarkdown?: string | null;
  tableRows?: string[][] | null;
  tableColumns?: string[] | null;
  structuredVisualProfile?: {
    table_column_roles?: Record<string, string>;
  } | null;
};

export type TableFactInsert = {
  owner_id: string | null;
  document_id: string;
  source_chunk_id: string | null;
  source_image_id: string;
  page_number: number | null;
  table_title: string | null | undefined;
  row_label: string | null;
  clinical_parameter: string | null | undefined;
  threshold_value: string | null;
  action: string | null;
  normalized_terms: string[];
  metadata: Record<string, unknown>;
};

function compactSearchText(value: unknown, limit = 900) {
  const compact = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "";
  return compact.length > limit ? compact.slice(0, limit).trim() : compact;
}

function normalizedTerms(value: string, limit = 18) {
  return Array.from(
    new Set([
      ...value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2 && !["the", "and", "for", "with", "from", "that"].includes(term)),
      ...clinicalVocabularyTerms(value, limit),
    ]),
  ).slice(0, limit);
}

function firstMatchingColumn(columns: string[], candidates: RegExp[]) {
  return columns.findIndex((column) => candidates.some((pattern) => pattern.test(column)));
}

function firstRoleColumn(columns: string[], roles: Record<string, string> | undefined, roleCandidates: string[]) {
  if (!roles) return -1;
  const normalizedCandidates = new Set(roleCandidates);
  return columns.findIndex((column) => normalizedCandidates.has(String(roles[column] ?? "").toLowerCase()));
}

function firstColumnByRoleOrPattern(
  columns: string[],
  roles: Record<string, string> | undefined,
  roleCandidates: string[],
  patterns: RegExp[],
) {
  const roleIndex = firstRoleColumn(columns, roles, roleCandidates);
  return roleIndex >= 0 ? roleIndex : firstMatchingColumn(columns, patterns);
}

function tableFactValue(cells: string[], index: number) {
  return index >= 0 && index < cells.length ? compactSearchText(cells[index], 240) || null : null;
}

function overlapScore(needleText: string, haystackText: string) {
  const terms = normalizedTerms(needleText, 24);
  if (terms.length === 0) return 0;
  const haystack = new Set(normalizedTerms(haystackText, 120));
  return terms.reduce((score, term) => score + (haystack.has(term) ? 1 : 0), 0) / terms.length;
}

function chunkContextText(chunk: TableFactChunkRow) {
  return compactSearchText(
    [
      chunk.section_heading,
      chunk.section_path?.join(" "),
      Array.isArray(chunk.metadata?.subsection_path) ? (chunk.metadata.subsection_path as unknown[]).join(" ") : "",
      chunk.content,
    ]
      .filter(Boolean)
      .join(" "),
    3000,
  );
}

function selectTableSourceChunk(image: TableFactImageRow, chunkRows: TableFactChunkRow[]) {
  const samePageChunks = chunkRows.filter(
    (chunk) => image.pageNumber !== null && chunk.page_number === image.pageNumber,
  );
  if (samePageChunks.length === 0) return null;

  const linked = samePageChunks.find((chunk) => (chunk.image_ids ?? []).includes(image.id));
  if (linked) return linked;

  const tableContext = compactSearchText(
    [image.tableTitle, image.tableLabel, image.caption, image.tableTextSnippet].filter(Boolean).join(" "),
    1000,
  );
  if (tableContext) {
    const scored = samePageChunks
      .map((chunk, index) => ({
        chunk,
        index,
        score: overlapScore(tableContext, chunkContextText(chunk)),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    if (scored[0]?.score > 0) return scored[0].chunk;
  }

  return samePageChunks[0] ?? null;
}

export function buildTableFactRows(args: {
  job: TableFactJob;
  chunkRows: TableFactChunkRow[];
  insertedImages: TableFactImageRow[];
}) {
  const facts: TableFactInsert[] = [];
  const seen = new Set<string>();

  for (const image of args.insertedImages) {
    if (!image.tableRows?.length) continue;
    const sourceChunk = selectTableSourceChunk(image, args.chunkRows);
    const columns = (image.tableColumns ?? []).map((column) => compactSearchText(column, 80));
    const roles = image.structuredVisualProfile?.table_column_roles;
    const parameterIndex = firstColumnByRoleOrPattern(
      columns,
      roles,
      ["parameter", "state", "score", "risk", "medication"],
      [/item/i, /parameter/i, /score/i, /state/i, /criterion/i],
    );
    const thresholdIndex = firstColumnByRoleOrPattern(
      columns,
      roles,
      ["threshold", "dose", "route", "frequency", "monitoring"],
      [/threshold/i, /value/i, /range/i, /level/i, /count/i, /dose/i],
    );
    const actionIndex = firstColumnByRoleOrPattern(
      columns,
      roles,
      ["action", "monitoring"],
      [/action/i, /management/i, /intervention/i, /response/i, /require/i],
    );

    // IDX-H6: raised from 120 to 400 to match the Python extractor's MAX_TABLE_ROWS so tail
    // rows of long dose/threshold tables are not silently dropped from the facts layer.
    for (const [rowIndex, rawCells] of image.tableRows.slice(0, 400).entries()) {
      const cells = rawCells.map((cell) => compactSearchText(cell, 240));
      // Native table extraction can include the column headings as its first row.
      // Retain the original row ordinal, but do not turn that heading into evidence.
      if (
        rowIndex === 0 &&
        columns.length > 0 &&
        cells.length === columns.length &&
        cells.every((cell, index) => cell === columns[index])
      )
        continue;
      const rowText = cells.filter(Boolean).join(" ");
      if (!rowText) continue;
      const rowLabel = tableFactValue(cells, parameterIndex >= 0 ? parameterIndex : 0);
      // Named columns constrain meaning: an unmatched concentration or interval
      // remains in metadata.cells without being relabelled a threshold or action.
      const threshold =
        thresholdIndex >= 0
          ? tableFactValue(cells, thresholdIndex)
          : columns.length === 0
            ? (cells.find((cell) => /(?:\d|mg|mcg|mmol|anc|fbc|score|level|threshold|withhold|cease)/i.test(cell)) ??
              null)
            : null;
      const action =
        actionIndex >= 0
          ? tableFactValue(cells, actionIndex)
          : columns.length === 0
            ? (cells[cells.length - 1] ?? null)
            : null;
      const dedupeKey = [image.id, rowLabel, threshold, action, rowText, image.tableTitle, image.tableLabel]
        .map((value) => String(value ?? "").toLowerCase())
        .join("\u001f");
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      facts.push({
        owner_id: args.job.documents.owner_id,
        document_id: args.job.document_id,
        source_chunk_id: sourceChunk?.id ?? null,
        source_image_id: image.id,
        page_number: image.pageNumber ?? sourceChunk?.page_number ?? null,
        table_title: image.tableTitle ?? image.tableLabel,
        row_label: rowLabel,
        clinical_parameter: rowLabel ?? image.tableTitle ?? image.tableLabel,
        threshold_value: threshold,
        action,
        normalized_terms: normalizedTerms(`${image.tableTitle ?? ""} ${image.tableLabel ?? ""} ${rowText}`),
        metadata: {
          row_index: rowIndex,
          columns,
          cells,
          table_role: image.tableRole,
          table_column_roles: roles ?? null,
          accessible_table_markdown: image.accessibleTableMarkdown,
          source_selection: sourceChunk
            ? {
                source_chunk_id: sourceChunk.id,
                matched_by_image_id: Boolean((sourceChunk.image_ids ?? []).includes(image.id)),
              }
            : null,
        },
      });
    }
  }

  return facts;
}
