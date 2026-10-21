// Audit F04 (#2F8K1V): group documents by the reader, OCR engine and chunker that produced their
// committed generation (documents.metadata.extraction_provenance, written by
// worker/extraction-provenance.ts), so a parser defect can be traced to the documents it touched.
// Pure; scripts/extraction-provenance-report.ts supplies the rows.

export type ProvenanceDocumentRow = {
  id: string;
  title: string | null;
  metadata: unknown;
};

export type ProvenanceFilter = {
  extractorVersion?: string;
  chunkerVersion?: string;
  ocrEngineVersion?: string;
};

export const NOT_RECORDED = "not recorded";

type Provenance = {
  extractorVersion: string;
  chunkerVersions: string[];
  ocrEngineVersions: string[];
};

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function readProvenance(metadata: unknown): Provenance | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = (metadata as Record<string, unknown>).extraction_provenance;
  if (!record || typeof record !== "object") return null;
  const provenance = record as Record<string, unknown>;
  return {
    extractorVersion: typeof provenance.version === "string" ? provenance.version : NOT_RECORDED,
    chunkerVersions: stringList(provenance.chunker_versions),
    ocrEngineVersions: stringList(provenance.ocr_engine_versions),
  };
}

// The same labels the report counts by, so `--extractor-version "not recorded"` (or the chunker
// equivalent) lists exactly the documents a count shows as not recorded.
function extractorLabel(provenance: Provenance | null) {
  return provenance?.extractorVersion ?? NOT_RECORDED;
}

function chunkerLabels(provenance: Provenance | null) {
  return provenance?.chunkerVersions.length ? provenance.chunkerVersions : [NOT_RECORDED];
}

export function matchesProvenanceFilter(provenance: Provenance | null, filter: ProvenanceFilter) {
  if (filter.extractorVersion && extractorLabel(provenance) !== filter.extractorVersion) return false;
  if (filter.chunkerVersion && !chunkerLabels(provenance).includes(filter.chunkerVersion)) return false;
  if (filter.ocrEngineVersion && !provenance?.ocrEngineVersions.includes(filter.ocrEngineVersion)) return false;
  return true;
}

export type ProvenanceReport = {
  scanned: number;
  matched: Array<{ id: string; title: string | null }>;
  byExtractorVersion: Record<string, number>;
  byChunkerVersion: Record<string, number>;
  byOcrEngineVersion: Record<string, number>;
};

function bump(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function buildProvenanceReport(rows: Iterable<ProvenanceDocumentRow>, filter: ProvenanceFilter = {}) {
  const report: ProvenanceReport = {
    scanned: 0,
    matched: [],
    byExtractorVersion: {},
    byChunkerVersion: {},
    byOcrEngineVersion: {},
  };
  for (const row of rows) {
    report.scanned += 1;
    const provenance = readProvenance(row.metadata);
    if (!matchesProvenanceFilter(provenance, filter)) continue;
    report.matched.push({ id: row.id, title: row.title });
    bump(report.byExtractorVersion, extractorLabel(provenance));
    for (const version of chunkerLabels(provenance)) bump(report.byChunkerVersion, version);
    for (const version of provenance?.ocrEngineVersions ?? []) bump(report.byOcrEngineVersion, version);
  }
  return report;
}

export function parseProvenanceArgs(argv: string[]): ProvenanceFilter & { listDocuments: boolean } {
  const valueOf = (name: string) => {
    const index = argv.indexOf(name);
    if (index < 0) return undefined;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
    return value;
  };
  return {
    extractorVersion: valueOf("--extractor-version"),
    chunkerVersion: valueOf("--chunker-version"),
    ocrEngineVersion: valueOf("--ocr-engine-version"),
    listDocuments: argv.includes("--list"),
  };
}
