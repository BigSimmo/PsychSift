import { normalizeExtractedGlyphs, stripClassificationBanner, readableWhitespace } from "@/lib/source-text-sanitizer";
import { registryCorpusDetailHref } from "@/lib/registry-corpus-links";
import type { Citation, CitationProvenance, SearchResult } from "@/lib/types";

// Citation titles come straight from document extraction, so repair glyph
// artifacts (ligatures, soft hyphens, control chars), drop protective-marking
// banners ("OFFICIAL:"), and drop the synthetic prefix before they reach any
// label — keeps mobile/compact labels consistent with the cleaned titles
// rendered elsewhere (cleanDisplayTitle).
function cleanCitationTitle(value: string) {
  return (
    readableWhitespace(stripClassificationBanner(normalizeExtractedGlyphs(value)))
      .replace(/^Synthetic\s+/i, "")
      .replace(/\n/g, " ") // ensure single line
      // Uploaded titles routinely arrive with the bracket jammed against the
      // preceding word — "Lithium Clinical Guideline(EMHS)" — because the
      // extractor read it that way. Every citation label in the product runs
      // through here, so normalising it once fixes the safety card, the rail
      // cards, the drawer and print together. Display only: the stored title is
      // untouched, and nothing downstream matches on it.
      //
      // Not before a receptor subtype: "5-HT(2A)", "5-HT(1A)" and "D(2)" are one
      // name, and "5-HT (2A)" misreads as a gloss. A bracket holding one digit and at
      // most one letter is that shape; a year or an organisation code still gets
      // its space ("Policy(2024)", "Guideline(EMHS)").
      .replace(/(\w)\((?!\d[A-Za-z]?\))/g, "$1 (")
  );
}

export function citationFromResult(result: SearchResult, provenance: CitationProvenance = "retrieval_only"): Citation {
  return {
    chunk_id: result.id,
    document_id: result.document_id,
    title: result.title,
    file_name: result.file_name,
    page_number: result.page_number,
    chunk_index: result.chunk_index,
    similarity: result.similarity,
    source_metadata: result.source_metadata,
    provenance,
  };
}

export function formatCitationLabel(citation: Pick<Citation, "title" | "file_name" | "page_number">) {
  const page = citation.page_number ? `p. ${citation.page_number}` : "source";
  const title = cleanCitationTitle(citation.title || citation.file_name || "Source") || "Source";
  return `${title}, ${page}`;
}

// Generic filler words dropped from compact citation labels so the label keeps
// the distinguishing words of the actual document title (e.g. drug/topic names)
// rather than collapsing to boilerplate.
const COMPACT_LABEL_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "guideline",
  "guidelines",
  "policy",
  "procedure",
  "document",
]);

function compactTitleWords(rawTitle: string) {
  const cleaned = rawTitle
    .replace(/\.(pdf|docx|xlsx|txt)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const significant = words.filter((word) => !COMPACT_LABEL_STOPWORDS.has(word.toLowerCase()));
  return (significant.length ? significant : words).slice(0, 3).join(" ") || "Source";
}

export function formatCompactCitationLabel(citation: Pick<Citation, "title" | "file_name" | "page_number">) {
  // Derive the short label from the actual title (not a hardcoded drug whitelist)
  // so real-corpus documents are labelled correctly instead of being mislabeled
  // as one of a few demo drug names. Dropping filler words and keeping up to
  // three significant words preserves both drugs in a multi-drug title (e.g.
  // "Clozapine and lithium co-prescribing") rather than collapsing to "Clozapine and".
  const rawTitle = cleanCitationTitle(citation.title || citation.file_name || "Source") || "Source";
  const shortTitle = compactTitleWords(rawTitle);
  const page = citation.page_number ? `p.${citation.page_number}` : "source";
  return `${shortTitle} ${page}`;
}

type CitationNavigationInput = Pick<Citation, "chunk_id" | "document_id" | "page_number"> & {
  source_metadata?: unknown;
};

function registryCitationHref(citation: CitationNavigationInput) {
  const metadata =
    citation.source_metadata && typeof citation.source_metadata === "object" && !Array.isArray(citation.source_metadata)
      ? (citation.source_metadata as Record<string, unknown>)
      : null;
  if (metadata?.source_kind !== "registry_record") return null;

  const slug = typeof metadata.registry_record_slug === "string" ? metadata.registry_record_slug : null;
  if (!slug) return null;

  return registryCorpusDetailHref({
    kind: typeof metadata.registry_record_kind === "string" ? metadata.registry_record_kind : undefined,
    slug: encodeURIComponent(slug),
    subkind: typeof metadata.registry_record_subkind === "string" ? metadata.registry_record_subkind : undefined,
  });
}

export function documentCitationHref(citation: CitationNavigationInput) {
  const registryHref = registryCitationHref(citation);
  if (registryHref) return registryHref;

  const params = new URLSearchParams();
  if (citation.page_number) params.set("page", String(citation.page_number));
  params.set("chunk", citation.chunk_id);
  return `/documents/${encodeURIComponent(citation.document_id)}?${params.toString()}`;
}

export function citationIdentity(citation: Pick<Citation, "chunk_id" | "document_id" | "page_number">) {
  return [citation.document_id, citation.page_number ?? "n/a", citation.chunk_id].join(":");
}

export function uniqueCitations<T extends Citation>(citations: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const citation of citations) {
    const key = citationIdentity(citation);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(citation);
  }

  return unique;
}

export function compactCitations(results: SearchResult[], limit = 6, provenance: CitationProvenance = "review_only") {
  const seen = new Set<string>();
  const citations: Citation[] = [];

  for (const result of results) {
    const citation = citationFromResult(result, provenance);
    const key = citationIdentity(citation);
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(citation);
    if (citations.length >= limit) break;
  }

  return citations;
}

export function allowedChunkMap(results: SearchResult[]) {
  return new Map(results.map((result) => [result.id, result]));
}
