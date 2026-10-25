export type NormalizedAccessibleTable = {
  header: string[];
  body: string[][];
  // GEN-H3: true when row/column inference for a clinical (dose/threshold) table
  // was ambiguous and the normalizer fell back to preserving the raw grid rather
  // than merging cells. Consumers must NOT promote a low-confidence table as
  // authoritative clinical evidence, because a mis-merge could pair a dose with
  // the wrong drug/parameter.
  lowConfidence?: boolean;
  lowConfidenceReason?: string;
};

export type NormalizeAccessibleTableOptions = {
  // When true (default), apply conservative handling for clinical tables: detect
  // ambiguous structure and preserve the raw grid + flag low-confidence instead
  // of heuristically merging generic columns / continuation rows.
  conservativeClinical?: boolean;
};

// Words that indicate a table carries dose/threshold/monitoring data, where a
// mis-paired cell is clinically dangerous.
const CLINICAL_TABLE_SIGNAL =
  /\b(dose|dosage|mg|mcg|microgram|titrat(?:e|es|ed|ing|ion|ions)|threshold|anc|fbc|wbc|neutrophil|level|mmol|range|monitor|withhold|cease|maximum|max\b|min\b|interval|weekly|daily|frequency)\b/i;

function rowsLookClinical(header: string[], body: string[][]): boolean {
  const sample = [header.join(" "), ...body.slice(0, 6).map((row) => row.join(" "))].join(" ");
  return CLINICAL_TABLE_SIGNAL.test(sample);
}

// Build a NormalizedAccessibleTable that preserves the raw grid 1:1 (no column
// merge, no row-continuation merge), padding ragged rows and synthesizing
// headers only where missing. Used as the conservative fallback (GEN-H3).
function buildRawGridTable(
  rawHeader: string[],
  rawBody: string[][],
  sourceColumnCount: number,
  reason: string,
): NormalizedAccessibleTable | null {
  const header = Array.from({ length: sourceColumnCount }, (_, index) => {
    const label = compactCell(rawHeader[index]);
    if (label && !isGenericHeader(label)) return label;
    return sourceColumnCount === 1 ? "Details" : `Column ${index + 1}`;
  });
  const body = rawBody
    .map((row) => Array.from({ length: sourceColumnCount }, (_, index) => compactCell(row[index])))
    .filter((row) => row.some((cell) => !isEmptyCell(cell)));
  if (!header.length || !body.length) return null;
  return { header, body, lowConfidence: true, lowConfidenceReason: reason };
}

function compactCell(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmptyCell(value: string | null | undefined) {
  const normalized = compactCell(value);
  return !normalized || /^[-–—]+$/.test(normalized);
}

function isGenericHeader(value: string | null | undefined) {
  const normalized = compactCell(value);
  return !normalized || /^column\s+\d+$/i.test(normalized);
}

function appendCell(existing: string, value: string) {
  const next = compactCell(value);
  if (!next) return existing;
  if (!existing) return next;
  if (next.length > 16 && existing.toLowerCase().includes(next.toLowerCase())) return existing;
  return `${existing} ${next}`;
}

function nearestNamedColumn(index: number, namedIndexes: number[]) {
  const previous = namedIndexes.filter((namedIndex) => namedIndex < index).at(-1);
  if (previous !== undefined) return previous;
  const next = namedIndexes.find((namedIndex) => namedIndex > index);
  return next ?? index;
}

function shouldStartNewRow(args: {
  normalizedRow: string[];
  rawRow: string[];
  keptIndexes: number[];
  previousRows: string[][];
}) {
  if (args.previousRows.length === 0) return true;
  const firstKeptIndex = args.keptIndexes[0] ?? 0;
  const firstRawCell = compactCell(args.rawRow[firstKeptIndex]);
  if (firstRawCell) return true;

  const firstNormalizedCell = compactCell(args.normalizedRow[0]);
  return /^[A-Z](?:\b|$)/.test(firstNormalizedCell) || /^\d{1,2}[.)]\s+/.test(firstNormalizedCell);
}

function looksLikeHeaderContinuation(args: { rawRow: string[]; keptIndexes: number[] }) {
  const firstKeptIndex = args.keptIndexes[0] ?? 0;
  if (compactCell(args.rawRow[firstKeptIndex])) return false;
  const nonEmptyCount = args.rawRow.filter((cell) => !isEmptyCell(cell)).length;
  if (nonEmptyCount === 0 || nonEmptyCount > 2) return false;
  const joined = args.rawRow.map(compactCell).filter(Boolean).join(" ");
  return !/^[A-F]\b/.test(joined);
}

export function normalizeAccessibleTable(
  rows: string[][],
  columns?: string[] | null,
  options?: NormalizeAccessibleTableOptions,
): NormalizedAccessibleTable | null {
  const conservativeClinical = options?.conservativeClinical ?? true;
  const sourceRows = rows.filter((row) => row.some((cell) => !isEmptyCell(cell)));
  const rawRows = sourceRows.map((row) => row.map(compactCell));
  if (!rawRows.length) return null;

  const rawHeader = (columns?.length ? columns : rawRows[0]).map(compactCell);
  const rawBody = columns?.length ? rawRows : rawRows.slice(1);
  // compactCell folds newlines to spaces, so the multiline check must read the cells as extracted.
  const sourceBody = columns?.length ? sourceRows : sourceRows.slice(1);
  const sourceColumnCount = Math.max(rawHeader.length, ...rawBody.map((row) => row.length), 1);
  const paddedHeader = [
    ...rawHeader,
    ...Array.from({ length: Math.max(0, sourceColumnCount - rawHeader.length) }, () => ""),
  ];
  const namedIndexes = paddedHeader
    .map((cell, index) => (isGenericHeader(cell) ? null : index))
    .filter((index): index is number => index !== null);

  // GEN-H3: for clinical (dose/threshold) tables, when the header has unnamed
  // ("generic") columns interleaved with named ones, the merge into the nearest
  // named column can silently move a dose/threshold cell under the wrong
  // parameter. In that ambiguous case, preserve the raw grid and flag it
  // low-confidence rather than guessing.
  if (conservativeClinical && namedIndexes.length > 0 && rowsLookClinical(paddedHeader, rawBody)) {
    const hasInterleavedGenericColumn = paddedHeader.some(
      (cell, index) => isGenericHeader(cell) && index < (namedIndexes.at(-1) ?? 0),
    );
    const bodyHasMultilineCells = sourceBody.some((row) => row.some((cell) => /\n/.test(String(cell ?? "").trim())));
    if (hasInterleavedGenericColumn || bodyHasMultilineCells) {
      return buildRawGridTable(
        paddedHeader,
        rawBody,
        sourceColumnCount,
        hasInterleavedGenericColumn ? "ambiguous_generic_column" : "multiline_clinical_cell",
      );
    }
  }

  const keptIndexes = namedIndexes.length
    ? namedIndexes
    : Array.from({ length: sourceColumnCount }, (_, index) => index);
  const targetBySourceIndex = new Map<number, number>();

  for (let sourceIndex = 0; sourceIndex < sourceColumnCount; sourceIndex += 1) {
    const targetSourceIndex = namedIndexes.length
      ? isGenericHeader(paddedHeader[sourceIndex])
        ? nearestNamedColumn(sourceIndex, namedIndexes)
        : sourceIndex
      : sourceIndex;
    const targetIndex = keptIndexes.indexOf(targetSourceIndex);
    targetBySourceIndex.set(sourceIndex, targetIndex >= 0 ? targetIndex : 0);
  }

  const header = keptIndexes.map((sourceIndex, index) => {
    const label = compactCell(paddedHeader[sourceIndex]);
    return label || (keptIndexes.length === 1 ? "Details" : `Details ${index + 1}`);
  });

  const bodyRows = [...rawBody];
  while (bodyRows.length && looksLikeHeaderContinuation({ rawRow: bodyRows[0], keptIndexes })) {
    const continuation = bodyRows.shift() ?? [];
    continuation.forEach((cell, sourceIndex) => {
      if (isEmptyCell(cell)) return;
      const targetIndex = targetBySourceIndex.get(sourceIndex) ?? sourceIndex;
      if (targetIndex < 0 || targetIndex >= header.length) return;
      header[targetIndex] = appendCell(header[targetIndex], cell);
    });
  }

  const clinical = conservativeClinical && rowsLookClinical(paddedHeader, rawBody);
  let mergedContinuationRow = false;

  const body: string[][] = [];
  for (const rawBodyRow of bodyRows) {
    const paddedRow = [
      ...rawBodyRow,
      ...Array.from({ length: Math.max(0, sourceColumnCount - rawBodyRow.length) }, () => ""),
    ];
    const normalizedRow = Array.from({ length: header.length }, () => "");

    paddedRow.forEach((cell, sourceIndex) => {
      if (isEmptyCell(cell)) return;
      const targetIndex = targetBySourceIndex.get(sourceIndex) ?? sourceIndex;
      if (targetIndex < 0 || targetIndex >= normalizedRow.length) return;
      normalizedRow[targetIndex] = appendCell(normalizedRow[targetIndex], cell);
    });

    if (!normalizedRow.some((cell) => !isEmptyCell(cell))) continue;
    if (!shouldStartNewRow({ normalizedRow, rawRow: paddedRow, keptIndexes, previousRows: body })) {
      mergedContinuationRow = true;
      const previous = body[body.length - 1];
      normalizedRow.forEach((cell, index) => {
        previous[index] = appendCell(previous[index] ?? "", cell);
      });
      continue;
    }

    body.push(normalizedRow);
  }

  const nonEmptyColumnIndexes = header
    .map((_, index) => index)
    .filter((index) => body.some((row) => !isEmptyCell(row[index])) || !isGenericHeader(header[index]));
  const finalHeader = nonEmptyColumnIndexes.map((index) => header[index]);
  const finalBody = body.map((row) => nonEmptyColumnIndexes.map((index) => row[index] ?? ""));

  if (!finalHeader.length || !finalBody.length) return null;
  // GEN-H3: a continuation-row merge in a clinical table risks concatenating a
  // value onto the wrong row; flag it so it isn't promoted as authoritative.
  if (clinical && mergedContinuationRow) {
    return {
      header: finalHeader,
      body: finalBody,
      lowConfidence: true,
      lowConfidenceReason: "merged_continuation_row",
    };
  }
  return { header: finalHeader, body: finalBody };
}
