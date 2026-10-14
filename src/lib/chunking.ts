import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { sourceSpanForText } from "@/lib/source-spans";
import { normalizeExtractedGlyphs, stripClassificationBanner } from "@/lib/source-text-sanitizer";
import type { ChunkInput, DocumentChunk } from "@/lib/types";

// Identity of the chunking strategy + params. Stamped into every chunk's metadata so a
// re-index can tell which chunker produced a row, and so bumping the strategy deliberately
// invalidates stale chunks. Bump this when chunk boundaries change (e.g. when cross-page
// document-mode chunking is enabled by default).
export const CHUNKER_VERSION = "1.2.0-page";
export const DOCUMENT_CHUNKER_VERSION = "1.2.0-document";

const sentenceBoundary = /(?<=[.!?])\s+/;
const paragraphBoundary = /\n{2,}/;
const metadataNoisePatterns: RegExp[] = [
  /\b(?:copyright|all rights reserved|document revision|do not distribute|downloaded from|www\.\S+)\b/i,
  /\b(?:version|revision)\s+\d+\s*$/i,
];
const lineNoisePatterns: RegExp[] = [
  // Audit M14: anchored to the WHOLE line. The previous unanchored form
  // matched an inline page reference anywhere in a sentence ("refer to p 3
  // for dosing", "titrate p 20 micrograms") and removePageNoise then deleted
  // the entire clinical line. Only a standalone page footer counts as noise.
  /^\s*(?:page|p\.?)\s*\d+\s*(?:(?:\/|of)\s*\d+)?\s*$/i,
  /^\s*[-*_]{3,}\s*$/,
  /^\s*[\u25cf\u25e6\u2022]\s*$/,
];
// PDF extraction wraps a dose across lines in narrow table cells — PyMuPDF's
// get_text("text", sort=True) emits each rendered line separately, so
// "12.5 mg" arrives as "12.5\nmg". The bare unit line is then <= 2 characters
// and looksLikeMetadataNoise would delete it, leaving a unitless dose in the
// indexed chunk. removePageNoise rejoins these lines before filtering.
const clinicalUnitLinePattern = /^(?:mg|mcg|µg|ug|g|kg|ml|l|iu|u|mmol|%)$/i;
const maxImageContextItemsPerPage = 3;
const highYieldSectionPattern =
  /\b(?:medicat(?:e|ed|ion|ions)|dose|dosage|dosing|administer|titrate|threshold|cut[\s-]?off|withhold|cease|stop|monitor|baseline|fbc|anc|neutrophil|level|risk|red flag|urgent|escalat(?:e|es|ed|ing|ion|ions)|contraindicat(?:e|es|ed|ion|ions)|caution|toxicity|required|must|criteria|observation)\b/i;
const narrativeSectionPattern =
  /\b(?:background|introduction|purpose|scope|principles|overview|rationale|references|bibliography|definitions)\b/i;
const boilerplateSynopsisPattern =
  /\b(?:document owner|authori[sz]ed by|published date|effective from|review date|version|amendment|copyright|uncontrolled when printed|supporting information|relevant standards)\b/i;

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function detectHeading(text: string) {
  const firstMeaningfulLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line.length < 120);

  if (!firstMeaningfulLine) return null;
  if (/^[A-Z0-9][A-Za-z0-9\s,;:()[\]/-]{3,}$/.test(firstMeaningfulLine)) {
    return firstMeaningfulLine.replace(/[:.\s]+$/, "");
  }

  return null;
}

function normalizeLookupText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:table|figure|appendix)\b/g, "")
    .trim();
}

// A line that is nothing but a PSPF protective marking ("OFFICIAL",
// "OFFICIAL: Sensitive") — running headers stamped on every page.
function isClassificationBannerLine(line: string) {
  return Boolean(line.trim()) && !stripClassificationBanner(line).trim();
}

function looksLikeMetadataNoise(line: string) {
  if (!line || line.length <= 2) return true;
  if (/^\d+$/.test(line)) return true;
  if (isClassificationBannerLine(line)) return true;
  if (metadataNoisePatterns.some((pattern) => pattern.test(line))) return true;
  if (lineNoisePatterns.some((pattern) => pattern.test(line))) return true;
  return false;
}

function normalizeRepeatedLine(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function looksLikeRepeatingBoilerplate(line: string) {
  const normalized = normalizeRepeatedLine(line);
  if (!normalized || normalized.length < 5 || normalized.length > 90) return false;
  if (looksLikeMetadataNoise(line)) return true;
  if (/^(?:clinical|corporate|mental health|government|department|hospital|health service)\b/i.test(line)) return true;
  if (/\b(?:confidential|printed|uncontrolled|guideline|procedure|policy|document|version|review date)\b/i.test(line)) {
    return true;
  }
  return false;
}

function buildRepeatedBoilerplateLines(inputs: ChunkInput[]) {
  const counts = new Map<string, number>();
  for (const input of inputs) {
    // Keys must be built from the SAME normalized text that removePageNoise
    // later compares against, or a ligature/soft-hyphen in a repeated header
    // ("Conﬁdential") would produce a mismatched key and survive filtering.
    const pageLines = new Set(
      normalizeExtractedGlyphs(input.pageText)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(looksLikeRepeatingBoilerplate)
        .map(normalizeRepeatedLine)
        .filter(Boolean),
    );
    for (const line of pageLines) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  return new Set([...counts.entries()].filter(([, count]) => count >= 2).map(([line]) => line));
}

// Rejoin a wrapped dose unit ("12.5" / "mg" on consecutive lines) into a single
// line so the unit is not deleted as short-line extraction debris. A lone unit
// token with no preceding number stays subject to the noise filter.
//
// A `line` is a wrapped dose unit continuing `previousLine` when the previous
// line ends in a digit and this line is a lone clinical unit token — the shape
// PDF extraction produces for "12.5\nmg". A standalone page footer preceding it
// (e.g. "Page 3 of 12") never counts, so a footer followed by a stray "mg" is
// left to the noise filter rather than being welded to the footer.
function isWrappedDoseUnitContinuation(previousLine: string | undefined, line: string) {
  return Boolean(
    previousLine &&
    /\d$/.test(previousLine) &&
    clinicalUnitLinePattern.test(line) &&
    !lineNoisePatterns.some((pattern) => pattern.test(previousLine)),
  );
}

function rejoinWrappedDoseUnits(lines: string[]) {
  return lines.reduce<string[]>((kept, line) => {
    const previous = kept[kept.length - 1];
    if (isWrappedDoseUnitContinuation(previous, line)) {
      kept[kept.length - 1] = `${previous} ${line}`;
    } else {
      kept.push(line);
    }
    return kept;
  }, []);
}

// How many wrapped dose units the rejoin would repair in `text`. Lets a corpus
// sample measure prevalence of the extraction bug without re-indexing: a
// positive count means the pre-fix chunker would have deleted that unit,
// indexing a unitless dose. Must run on raw extracted page text (the same input
// removePageNoise sees), since the deleted unit is not recoverable from stored
// chunks. Shares isWrappedDoseUnitContinuation with the fix so the two can't drift.
export function countWrappedDoseUnitLines(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  let count = 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (isWrappedDoseUnitContinuation(lines[index - 1], lines[index])) count += 1;
  }
  return count;
}

function removePageNoise(text: string, repeatedBoilerplateLines = new Set<string>()) {
  const lines = rejoinWrappedDoseUnits(text.split(/\r?\n/).map((line) => line.trim()));
  return lines
    .filter((line) => {
      if (line === "") return true;
      if (looksLikeMetadataNoise(line)) return false;
      if (repeatedBoilerplateLines.has(normalizeRepeatedLine(line))) return false;
      return true;
    })
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractSectionHeadings(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || line.length < 4) return false;
      if (looksLikeMetadataNoise(line)) return false;
      if (line.length < 90 && /^[A-Z][A-Za-z0-9\s,;:()\/\-\[\]]+$/.test(line)) return true;
      if (/^\d+\.?\s+[A-Z]/.test(line) && line.length < 110) return true;
      return false;
    });
}

function sectionAnchorId(heading: string | null) {
  if (!heading) return null;
  return (
    heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || null
  );
}

function headingLevel(heading: string | null, sectionPath: string[]) {
  if (!heading) return sectionPath.length > 0 ? Math.min(sectionPath.length, 6) : null;
  const numbered = heading.match(/^(\d+(?:\.\d+){0,5})\b/);
  if (numbered) return Math.min(numbered[1].split(".").length, 6);
  return sectionPath.includes(heading)
    ? Math.max(1, sectionPath.indexOf(heading) + 1)
    : Math.max(1, sectionPath.length);
}

function imageMatchScore(lookupText: string, sourceText: string) {
  if (!lookupText || !sourceText) return 0;
  const source = new Set(sourceText.split(/\s+/).filter(Boolean));
  const hits = lookupText
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => source.has(token)).length;
  return hits;
}

function dedupeChunkFingerprint(text: string) {
  return normalizeLookupText(text).replace(/\s+/g, " ").trim();
}

const imageDataTagPattern =
  /\[\[IMAGE_DATA_START\]\][\s\S]*?\[\[IMAGE_DATA_END\]\]|\[\[IMAGE_DATA_OMITTED\]\][\s\S]*?\[\[\/IMAGE_DATA_OMITTED\]\]/g;

function normalizeChunkKeyContent(content: string) {
  return content.replace(imageDataTagPattern, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

// CI-4: a stable, position-independent identity for a chunk. Keyed on the document, the
// section anchor, and the normalized text — NOT on chunk_index or page — so re-indexing the
// same source yields the same key. This makes re-index idempotent and lets cached citations
// and eval anchors survive re-pagination and chunk reordering. Genuinely-identical content
// within one section shares a key, which is the intended "same content = same identity"
// semantics (a duplicate key is informational metadata, not a DB uniqueness constraint).
export function chunkContentKey(documentId: string, sectionAnchor: string | null, content: string) {
  return createHash("sha256")
    .update(`${documentId}\0${sectionAnchor ?? ""}\0${normalizeChunkKeyContent(content)}`)
    .digest("hex")
    .slice(0, 32);
}

function clampChunkSize(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function adaptiveChunkProfile(text: string, sectionPath: string[]) {
  const sectionText = sectionPath.join(" ");
  const highYield = highYieldSectionPattern.test(`${sectionText}\n${text}`);
  const narrative = narrativeSectionPattern.test(sectionText) && !highYield;
  const baseSize = env.CHUNK_SIZE;
  const baseOverlap = env.CHUNK_OVERLAP;

  if (highYield) {
    return {
      chunkSize: clampChunkSize(Math.min(baseSize * 0.62, 1250), 850, baseSize),
      overlap: clampChunkSize(Math.max(baseOverlap, baseSize * 0.12), 180, 340),
      profile: "high_yield",
    };
  }

  if (narrative) {
    return {
      chunkSize: clampChunkSize(Math.max(baseSize * 1.35, 2600), baseSize, 3400),
      overlap: clampChunkSize(Math.min(baseOverlap, 180), 80, baseOverlap),
      profile: "narrative",
    };
  }

  return {
    chunkSize: baseSize,
    overlap: baseOverlap,
    profile: "standard",
  };
}

export function chunkTextWithOverlap(text: string, chunkSize = env.CHUNK_SIZE, overlap = env.CHUNK_OVERLAP) {
  const clean = removePageNoise(normalizeExtractedGlyphs(text))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];

  if (isTableBlock(clean)) {
    return chunkTableBlock(clean, chunkSize);
  }

  const paragraphs = clean
    .split(paragraphBoundary)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) {
    const chunks: string[] = [];
    let current = "";

    for (const paragraph of paragraphs) {
      if (isTableBlock(paragraph)) {
        if (current) {
          chunks.push(current.trim());
          current = "";
        }
        chunks.push(...chunkTableBlock(paragraph, chunkSize));
        continue;
      }

      if (paragraph.length > chunkSize) {
        if (current) {
          chunks.push(current.trim());
          current = "";
        }
        chunks.push(...chunkTextBySentence(paragraph, chunkSize, overlap));
        continue;
      }

      const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
      if (candidate.length > chunkSize && current) {
        chunks.push(current.trim());
        const flushed = current.trim();
        const tail = readableOverlapTail(flushed, overlap);
        const successor = tail ? `${tail}\n\n${paragraph}` : paragraph;
        // The full tail is already retained above; omit only redundant overlap if it cannot fit.
        current = successor.length <= chunkSize * 1.35 ? successor : paragraph;
      } else {
        current = candidate;
      }
    }

    if (current) chunks.push(current.trim());
    return chunks.filter(Boolean);
  }

  return chunkTextBySentence(clean, chunkSize, overlap);
}

function readableOverlapTail(text: string, overlap: number) {
  if (overlap <= 0 || !text) return "";
  if (text.length <= overlap) return text;
  const start = readableOverlapStart(text, text.length, overlap);
  return text.slice(start).trim();
}

const tableRowPattern = /^\s*\|.*\|\s*$/;

function isTableBlock(block: string) {
  const lines = block.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return false;
  return lines.every((line) => tableRowPattern.test(line));
}

function chunkTableBlock(block: string, chunkSize: number) {
  const lines = block.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (block.length <= chunkSize) return [block.trim()];

  const separatorIndex = lines.findIndex((line) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-"));
  const headerLines = separatorIndex > 0 ? lines.slice(0, separatorIndex + 1) : lines.slice(0, 1);
  const bodyLines = lines.slice(headerLines.length);
  const header = headerLines.join("\n");

  const chunks: string[] = [];
  let current = header;
  for (const row of bodyLines) {
    const candidate = `${current}\n${row}`;
    if (candidate.length > chunkSize && current !== header) {
      chunks.push(current.trim());
      current = `${header}\n${row}`;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [block.trim()];
}

const clinicalProhibitionPattern =
  /\b(?:contraindicat(?:e|ed|ion|ions)|do not|does not|must not|should not|shall not|cannot|can't|never|avoid|withhold|cease|black box warning)\b/i;
const sentenceEndPattern = /(?<=[.!?])(?:\s+|$)/;

function readableOverlapStart(clean: string, end: number, overlap: number) {
  if (overlap <= 0) return end;
  let start = Math.max(0, end - overlap);

  while (start > 0 && start < end && /\S/.test(clean[start - 1] ?? "") && /\S/.test(clean[start] ?? "")) {
    start -= 1;
  }
  while (start < end && /\s/.test(clean[start] ?? "")) {
    start += 1;
  }

  // Keep the subject, condition and negation with the governing sentence, not just its keyword.
  let sentenceStart = start;
  while (
    sentenceStart > 0 &&
    !(/[.!?]/.test(clean[sentenceStart - 1] ?? "") && /\s/.test(clean[sentenceStart] ?? ""))
  ) {
    sentenceStart -= 1;
  }
  while (sentenceStart < end && /\s/.test(clean[sentenceStart] ?? "")) sentenceStart += 1;
  const sentenceWindow = clean.slice(sentenceStart, end);
  const boundary = sentenceEndPattern.exec(sentenceWindow);
  const governingSentence = sentenceWindow.slice(0, boundary?.index ?? sentenceWindow.length);
  if (clinicalProhibitionPattern.test(governingSentence)) start = sentenceStart;

  return start < end ? start : Math.max(0, end - overlap);
}

function chunkTextBySentence(clean: string, chunkSize: number, overlap: number) {
  const chunks: string[] = [];
  // Record actual offsets once; never scan the remaining document for every chunk.
  const sentenceEnds = Array.from(clean.matchAll(new RegExp(sentenceBoundary.source, "g")), (match) => match.index);
  if (sentenceEnds.at(-1) !== clean.length) sentenceEnds.push(clean.length);
  let boundaryIndex = 0;
  let start = 0;

  while (start < clean.length) {
    const nominalEnd = Math.min(start + chunkSize, clean.length);
    while (sentenceEnds[boundaryIndex] < nominalEnd) boundaryIndex += 1;
    const completingEnd = sentenceEnds[boundaryIndex];
    const precedingEnd = boundaryIndex > 0 ? sentenceEnds[boundaryIndex - 1] : 0;
    // Ordinary chunks retain the 35% elongation budget. An indivisible longer sentence is
    // one atomic chunk: splitting or dropping it could change a clinical assertion's scope.
    const end = completingEnd <= start + chunkSize * 1.35 || precedingEnd <= start ? completingEnd : precedingEnd;

    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;
    if (end - start > chunkSize * 1.35) {
      start = end;
      continue;
    }
    // Audit M17: when overlap >= chunkSize, readableOverlapStart can return a
    // position at or before the current start and the loop never advances,
    // hanging the ingestion worker on that document. Force strict forward
    // progress: if the overlap window does not move us forward, continue from
    // the end of the current chunk instead.
    const nextStart = readableOverlapStart(clean, end, overlap);
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

// Word-safe truncation for stored display text (synopses, caption snippets).
// A raw slice cut mid-word ("where poss...") and every surface downstream
// inherited the artifact; cutting at a clause boundary when one lands late
// enough, otherwise at the last word boundary, keeps the stored tail readable.
function truncateAtWordBoundary(value: string, limit: number) {
  if (value.length <= limit) return value;
  const window = value.slice(0, limit - 3);
  const clauseCut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; "), window.lastIndexOf(": "));
  const wordCut = window.lastIndexOf(" ");
  const cut = clauseCut >= limit * 0.6 ? clauseCut + 1 : wordCut > 0 ? wordCut : window.length;
  const trimmed = window
    .slice(0, cut)
    .replace(/[\s,;:([{\-–—]+$/, "")
    .trim();
  return trimmed ? `${trimmed}...` : `${window.trim()}...`;
}

function compactImageText(value: string | null | undefined, limit = 420) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return truncateAtWordBoundary(text, limit);
}

function compactSynopsisText(value: string | null | undefined, limit = 720) {
  const withoutImageTags = String(value ?? "")
    .replace(/\[\[IMAGE_DATA_START\]\][\s\S]*?\[\[IMAGE_DATA_END\]\]/g, " ")
    .replace(/\[\[IMAGE_DATA_OMITTED\]\][\s\S]*?\[\[\/IMAGE_DATA_OMITTED\]\]/g, " ");
  const sentences = withoutImageTags
    .split(/(?<=[.!?])\s+|\n+/)
    // Extraction glues the protective-marking header onto body sentences
    // ("OFFICIAL: OFFICIAL Lithium Therapy …"); shed the banner prefix so it
    // never enters the stored synopsis.
    .map((sentence) => stripClassificationBanner(sentence.replace(/\s+/g, " ").trim()).trim())
    .filter((sentence) => sentence.length >= 12 && !boilerplateSynopsisPattern.test(sentence));
  const highYieldSentences = sentences.filter((sentence) => highYieldSectionPattern.test(sentence));
  const selected = (highYieldSentences.length ? highYieldSentences : sentences).slice(0, 4).join(" ");
  const compact = selected.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return truncateAtWordBoundary(compact, limit);
}

function buildRetrievalSynopsis(args: {
  content: string;
  heading: string | null;
  sectionContext: string[];
  pageNumber: number | null;
  referencedImageCount: number;
}) {
  const section = args.sectionContext.length ? args.sectionContext.join(" > ") : args.heading;
  const prefix = [
    section ? `Section: ${section}` : "",
    args.pageNumber ? `Page: ${args.pageNumber}` : "",
    args.referencedImageCount > 0 ? `Visual/table context: ${args.referencedImageCount}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  const facts = compactSynopsisText(args.content);
  return truncateAtWordBoundary([prefix, facts].filter(Boolean).join(" | "), 900);
}

export function buildImageTag(image: {
  id: string;
  caption: string;
  imageType?: string | null;
  sourceKind?: string | null;
  tableLabel?: string | null;
  tableTitle?: string | null;
  tableRole?: string | null;
  tableTextSnippet?: string | null;
  accessibleTableMarkdown?: string | null;
}) {
  const conciseTableText = image.tableTextSnippet
    ? `Table text: ${compactImageText(image.tableTextSnippet, 220)}`
    : image.accessibleTableMarkdown
      ? `Table text: ${compactImageText(image.accessibleTableMarkdown, 220)}`
      : "";
  const parts = [
    `Image ID: ${image.id}`,
    image.sourceKind ? `Source kind: ${image.sourceKind}` : "",
    image.imageType ? `Image type: ${image.imageType}` : "",
    image.tableLabel ? `Table label: ${image.tableLabel}` : "",
    image.tableTitle ? `Table title: ${image.tableTitle}` : "",
    image.tableRole ? `Table role: ${image.tableRole}` : "",
    conciseTableText,
    `Description: ${compactImageText(image.caption, 260)}`,
  ].filter(Boolean);
  return `[[IMAGE_DATA_START]] ${parts.join("; ")} [[IMAGE_DATA_END]]`;
}

function buildPageImageContext(pageImages: NonNullable<ChunkInput["images"]>) {
  const selectedImages = pageImages.slice(0, maxImageContextItemsPerPage).map(buildImageTag);
  const omitted = pageImages.length - selectedImages.length;
  if (omitted > 0) {
    selectedImages.push(
      `[[IMAGE_DATA_OMITTED]] ${omitted} additional image/table blocks on this page. [[/IMAGE_DATA_OMITTED]]`,
    );
  }
  return selectedImages.join("\n");
}

type ChunkImages = NonNullable<ChunkInput["images"]>;
type ChunkProfile = ReturnType<typeof adaptiveChunkProfile>;
type SpanPage = { pageNumber: number | null; pageText: string };

function nativeTableBlock(image: ChunkImages[number]) {
  const columns = image.tableColumns;
  const rows = image.tableRows;
  if (!Array.isArray(columns) || columns.length < 2 || !Array.isArray(rows)) return null;
  const normalizeCell = (cell: unknown) =>
    typeof cell === "string" && !/[\r\n|\\]/.test(cell) ? cell.replace(/\s+/g, " ").trim() : null;
  const normalizedColumns = columns.map(normalizeCell);
  if (normalizedColumns.some((cell) => !cell)) return null;
  const dataRows: string[][] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== columns.length) return null;
    const cells = row.map(normalizeCell);
    if (cells.some((cell) => cell === null)) return null;
    if (cells.every((cell) => cell === "")) continue;
    if (cells.some((cell) => !cell)) return null;
    const checked = cells as string[];
    if (checked.every((cell, index) => cell === normalizedColumns[index])) continue;
    if (checked.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    dataRows.push(checked);
  }
  if (!dataRows.length) return null;
  return { columns: normalizedColumns as string[], rows: dataRows };
}

function narrativeTableBlocks(text: string) {
  let openMarker: string | null = null;
  for (const marker of text.matchAll(
    /\[\[(IMAGE_DATA_START|IMAGE_DATA_END|IMAGE_DATA_OMITTED|\/IMAGE_DATA_OMITTED)\]\]/g,
  )) {
    if (marker[1] === "IMAGE_DATA_START" || marker[1] === "IMAGE_DATA_OMITTED") {
      if (openMarker) return null;
      openMarker = marker[1];
    } else {
      const expected = marker[1] === "IMAGE_DATA_END" ? "IMAGE_DATA_START" : "IMAGE_DATA_OMITTED";
      if (openMarker !== expected) return null;
      openMarker = null;
    }
  }
  if (openMarker) return null;
  const narrative = text.replace(imageDataTagPattern, " ");
  if (/\[\[\/?IMAGE_DATA|\bIMAGE_DATA_/.test(narrative)) return null;
  const lines = narrative.split(/\r?\n/).map((line) => line.trim());
  const blocks: Array<{ columns: string[]; rows: string[][] }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("|")) continue;
    const rows: string[][] = [];
    while (index < lines.length && lines[index].startsWith("|")) {
      const line = lines[index];
      if (!line.endsWith("|") || line.includes("\\")) return null;
      rows.push(
        line
          .slice(1, -1)
          .split("|")
          .map((cell) => cell.replace(/\s+/g, " ").trim()),
      );
      index += 1;
    }
    index -= 1;
    const [columns, ...remaining] = rows;
    if (columns.some((cell) => !cell)) return null;
    if (remaining[0]?.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      if (remaining[0].length !== columns.length) return null;
      remaining.shift();
    }
    if (remaining.some((row) => row.length !== columns.length || row.some((cell) => !cell))) return null;
    if (remaining.some((row) => row.every((cell) => /^:?-{3,}:?$/.test(cell)))) return null;
    if (remaining.length) blocks.push({ columns, rows: remaining });
  }
  return blocks;
}

// Native association is deliberately page-local and exact. Injected image context,
// partial tables and ambiguous crops cannot supply their own linkage evidence.
function matchesNativeTableBlock(
  image: ChunkImages[number],
  args: {
    content: string;
    pageNumber: number | null;
    pageStart: number | null;
    pageEnd: number | null;
    images: ChunkImages;
    spanPages: SpanPage[];
    chunkerVersion: string;
  },
  imageIndex: number,
) {
  if (
    args.chunkerVersion !== CHUNKER_VERSION ||
    !Number.isInteger(image.pageNumber) ||
    (image.pageNumber ?? 0) <= 0 ||
    args.spanPages.length !== 1 ||
    args.spanPages[0].pageNumber !== image.pageNumber ||
    args.pageNumber !== image.pageNumber ||
    args.pageStart !== image.pageNumber ||
    args.pageEnd !== image.pageNumber
  )
    return false;
  const table = nativeTableBlock(image);
  if (!table) return false;
  const units =
    /^(?:mg|mcg|µg|μg|ug|g|kg|ng|pg|ml|l|dl|h|hr|hrs|hour|hours|min|s|sec|second|seconds|day|days|wk|week|weeks|mmol|mol|meq|iu|u|unit|units|mmhg|cm|bpm|x)$/i;
  const hasRowIdentifier = table.rows.some((row) => {
    // First slice supports explicit labels, not a semantic classifier for plain words/units.
    if (!/^[A-Z0-9]+(?:[-_][A-Z0-9]+)+$/.test(row[0]) || !/[A-Z]/.test(row[0])) return false;
    const withoutNumbers = row[0].replace(/[+-]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:e[+-]?\d+)?/gi, " ");
    return withoutNumbers.split(/[^\p{L}]+/u).some((word) => word && !units.test(word));
  });
  if (!hasRowIdentifier) return false;
  const rowSignatures = new Set(table.rows.map((row) => JSON.stringify(row)));
  const signature = JSON.stringify(table);
  const uniqueNarrativeMatch = (text: string) => {
    const blocks = narrativeTableBlocks(text);
    if (!blocks || blocks.filter((block) => JSON.stringify(block) === signature).length !== 1) return false;
    return !blocks.some(
      (block) =>
        JSON.stringify(block) !== signature && block.rows.some((row) => rowSignatures.has(JSON.stringify(row))),
    );
  };
  if (!uniqueNarrativeMatch(args.content) || !uniqueNarrativeMatch(args.spanPages[0].pageText)) return false;
  const descriptor = (peer: ChunkImages[number]) =>
    JSON.stringify([
      nativeTableBlock(peer),
      peer.pageNumber,
      peer.sourceKind,
      peer.caption,
      peer.tableLabel ?? null,
      peer.tableTitle ?? null,
      peer.tableRole ?? null,
      peer.imageType ?? null,
      peer.tableTextSnippet ?? null,
      peer.accessibleTableMarkdown ?? null,
      peer.tableColumns ?? null,
      peer.tableRows ?? null,
      peer.labels ?? null,
    ]);
  for (const peer of args.images) {
    if (peer.id === image.id && descriptor(peer) !== descriptor(image)) return false;
    if (peer.sourceKind !== "table_crop" || peer.pageNumber !== image.pageNumber) continue;
    const peerTable = nativeTableBlock(peer);
    if (!peerTable) return false;
    if (peer.id !== image.id && peerTable.rows.some((row) => rowSignatures.has(JSON.stringify(row)))) return false;
  }
  // Only consistent duplicates may collapse, after checking every descriptor/peer.
  return args.images.findIndex((peer) => peer.id === image.id) === imageIndex;
}

function pageLocalExcerptForChunk(chunkExcerpt: string, pageText: string) {
  const compactPage = pageText.replace(/\s+/g, " ").trim();
  if (!compactPage) return chunkExcerpt;

  const chunkWords = new Set(
    normalizeLookupText(chunkExcerpt)
      .split(/\s+/)
      .filter((word) => word.length >= 3),
  );
  if (chunkWords.size === 0) return compactPage;

  const candidates = compactPage
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const words = normalizeLookupText(part).split(/\s+/).filter(Boolean);
      const hits = words.filter((word) => chunkWords.has(word)).length;
      return { part, hits };
    })
    .filter((entry) => entry.hits > 0)
    .sort((left, right) => right.hits - left.hits);

  const selected = candidates
    .slice(0, 3)
    .map((entry) => entry.part)
    .join(" ");
  return selected || compactPage;
}

// Shared chunk emission used by BOTH the page and document strategies so they produce an
// identical DocumentChunk shape. Page mode passes a single page (pageStart===pageEnd, one
// span page); document mode passes a page range and one span page per contributing page.
function emitChunk(args: {
  chunks: DocumentChunk[];
  content: string;
  documentId: string;
  pageNumber: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  sectionPath: string[];
  images: ChunkImages;
  spanPages: SpanPage[];
  baseMetadata: Record<string, unknown>;
  pageLookupText: string;
  chunkProfile: ChunkProfile;
  pageChunkIndex: number;
  chunkerVersion: string;
}) {
  const { content, sectionPath } = args;
  const contentLookup = normalizeLookupText(content);
  const heading = detectHeading(content);
  const sectionContext = sectionPath.includes(heading ?? "") ? sectionPath : [...sectionPath];
  const sectionAnchor = sectionAnchorId(heading);
  const level = headingLevel(heading, sectionContext);
  const parentHeading = sectionContext.length > 1 ? sectionContext[sectionContext.length - 2] : null;
  const referencedImageIds = args.images
    .filter((image, imageIndex) => {
      if (
        image.sourceKind === "table_crop" &&
        !image.caption.trim() &&
        !(image.tableLabel ?? "").trim() &&
        !(image.tableTitle ?? "").trim()
      ) {
        return matchesNativeTableBlock(image, args, imageIndex);
      }
      const label = normalizeLookupText(image.tableLabel ?? "");
      const title = normalizeLookupText(image.tableTitle ?? "");
      const caption = normalizeLookupText(image.caption);
      const imageText = [label, title, caption].filter(Boolean).flatMap((value) => value.split(/\s+/).filter(Boolean));
      const imageLookup = imageText.join(" ");
      const headerBoost = heading && imageText.some((token) => normalizeLookupText(heading).includes(token)) ? 1 : 0;
      const direct = imageMatchScore(caption, contentLookup) >= 1 || imageMatchScore(imageLookup, contentLookup) >= 2;
      const pathHit =
        sectionContext.some((candidate) =>
          normalizeLookupText(candidate)
            .split(/\s+/)
            .some((token) => imageLookup.includes(token)),
        ) && image.sourceKind !== "embedded";
      return direct || pathHit || (image.sourceKind === "table_crop" && headerBoost > 0) || headerBoost >= 1;
    })
    .map((image) => image.id);

  const excerpt = content.replace(/\[\[IMAGE_DATA_START\]\][\s\S]*?\[\[IMAGE_DATA_END\]\]/g, "").trim();
  args.chunks.push({
    document_id: args.documentId,
    page_number: args.pageNumber,
    chunk_index: args.chunks.length,
    section_heading: heading,
    section_path: sectionContext,
    heading_level: level,
    parent_heading: parentHeading,
    anchor_id: sectionAnchor,
    content,
    retrieval_synopsis: buildRetrievalSynopsis({
      content,
      heading,
      sectionContext,
      pageNumber: args.pageNumber,
      referencedImageCount: referencedImageIds.length,
    }),
    token_estimate: estimateTokens(content),
    image_ids: referencedImageIds,
    metadata: {
      ...args.baseMetadata,
      chunk_key: chunkContentKey(args.documentId, sectionAnchor, content),
      chunker_version: args.chunkerVersion,
      chunk_strategy: args.chunkerVersion === DOCUMENT_CHUNKER_VERSION ? "document" : "page",
      page_chunk_index: args.pageChunkIndex,
      chunk_profile: args.chunkProfile.profile,
      adaptive_chunk_size: args.chunkProfile.chunkSize,
      adaptive_chunk_overlap: args.chunkProfile.overlap,
      page_start: args.pageStart,
      page_end: args.pageEnd,
      source_spans: args.spanPages.map((span) => {
        const pageExcerpt = args.spanPages.length > 1 ? pageLocalExcerptForChunk(excerpt, span.pageText) : excerpt;
        return sourceSpanForText({
          pageNumber: span.pageNumber,
          pageText: span.pageText,
          excerpt: pageExcerpt,
          fallbackExcerpt: content,
        });
      }),
      heading_lookup: args.pageLookupText,
      subsection_path: sectionContext,
      section_anchor: sectionAnchor,
      section_path: sectionContext,
      heading_level: level,
      parent_heading: parentHeading,
      anchor_id: sectionAnchor,
    },
  });
}

// Page-bounded chunking (default). Behavior is intentionally unchanged from the original
// buildChunks; the per-chunk emission is delegated to emitChunk.
function buildPageModeChunks(inputs: ChunkInput[]) {
  const chunks: DocumentChunk[] = [];
  const chunkFingerprint = new Map<string, number>();
  const repeatedBoilerplateLines = buildRepeatedBoilerplateLines(inputs);
  let activeSectionPath: string[] = [];

  for (const input of inputs) {
    const pageImages = input.images ?? [];
    const imageContext = buildPageImageContext(pageImages);
    // Normalize glyph artifacts once so chunk content, the heading lookup, and the
    // source-span excerpt all derive from the same text. Otherwise the normalized
    // excerpt cannot be located in the raw page and span offsets drop to null.
    const normalizedPageText = normalizeExtractedGlyphs(input.pageText);
    const cleanedPageText = removePageNoise(normalizedPageText, repeatedBoilerplateLines);
    const pageSectionPath = extractSectionHeadings(cleanedPageText);
    if (pageSectionPath.length > 0) activeSectionPath = pageSectionPath;
    const sectionPath = activeSectionPath;
    const pageText = [cleanedPageText, imageContext].filter(Boolean).join("\n\n");
    const pageLookupText = normalizeLookupText(normalizedPageText);
    const chunkProfile = adaptiveChunkProfile(cleanedPageText, sectionPath);
    const pageChunks = chunkTextWithOverlap(pageText, chunkProfile.chunkSize, chunkProfile.overlap);

    pageChunks.forEach((content, pageChunkIndex) => {
      const fingerprint = dedupeChunkFingerprint(content);
      const pageScopedFingerprint = fingerprint ? `${input.pageNumber ?? "unknown"}:${fingerprint}` : "";
      if (pageScopedFingerprint && chunkFingerprint.has(pageScopedFingerprint)) return;
      if (pageScopedFingerprint) chunkFingerprint.set(pageScopedFingerprint, chunks.length);
      emitChunk({
        chunks,
        content,
        documentId: input.documentId,
        pageNumber: input.pageNumber,
        pageStart: input.pageNumber,
        pageEnd: input.pageNumber,
        sectionPath,
        images: pageImages,
        spanPages: [{ pageNumber: input.pageNumber, pageText: normalizedPageText }],
        baseMetadata: input.metadata ?? {},
        pageLookupText,
        chunkProfile,
        pageChunkIndex,
        chunkerVersion: CHUNKER_VERSION,
      });
    });
  }

  return chunks;
}

type DocumentPage = {
  pageNumber: number | null;
  normalizedText: string;
  cleanedText: string;
  images: ChunkImages;
  metadata: Record<string, unknown>;
  sectionHeadings: string[];
  wordSet: Set<string>;
};

// CI-1: attribute a cross-page chunk to the page(s) that actually contributed its words,
// by word-set overlap. Offset recovery is unreliable here (removePageNoise, whitespace
// collapse and paragraph rejoin mean chunk text is not a verbatim substring of any page), so
// word overlap is the robust signal. This only affects page_start/page_end/source_spans
// metadata — never chunk content or the retrieval text.
function attributeChunkToPages(contentWords: Set<string>, pages: DocumentPage[]): DocumentPage[] {
  if (pages.length <= 1) return pages;
  const scored = pages.map((page) => {
    let hits = 0;
    for (const word of contentWords) if (page.wordSet.has(word)) hits += 1;
    return { page, hits, fraction: contentWords.size ? hits / contentWords.size : 0 };
  });
  const best = Math.max(...scored.map((entry) => entry.fraction));
  if (best <= 0) return [pages[0]];
  const threshold = Math.min(0.15, best * 0.5);
  const contributing = scored
    .filter((entry) => entry.hits >= 3 && entry.fraction >= threshold)
    .map((entry) => entry.page);
  const result = contributing.length
    ? contributing
    : [scored.reduce((top, entry) => (entry.fraction > top.fraction ? entry : top)).page];
  return result.slice().sort((left, right) => (left.pageNumber ?? 0) - (right.pageNumber ?? 0));
}

// Structure-aware, cross-page chunking (CI-1). Documents are segmented into sections; each
// section's pages are chunked together so a chunk can span a page break within the section.
// A new section starts whenever a page introduces its own headings; heading-less continuation
// pages append to the current section (this is where cross-page merging happens).
function buildDocumentModeChunks(inputs: ChunkInput[]) {
  const chunks: DocumentChunk[] = [];
  if (inputs.length === 0) return chunks;
  const documentId = inputs[0].documentId;
  const repeatedBoilerplateLines = buildRepeatedBoilerplateLines(inputs);
  // Document-scoped dedupe: unlike page mode (which keeps identical content on different
  // pages), cross-page duplicates within a document are repeated boilerplate worth collapsing.
  const chunkFingerprint = new Map<string, number>();

  const pages: DocumentPage[] = inputs.map((input) => {
    const normalizedText = normalizeExtractedGlyphs(input.pageText);
    const cleanedText = removePageNoise(normalizedText, repeatedBoilerplateLines);
    return {
      pageNumber: input.pageNumber,
      normalizedText,
      cleanedText,
      images: input.images ?? [],
      metadata: input.metadata ?? {},
      sectionHeadings: extractSectionHeadings(cleanedText),
      wordSet: new Set(normalizeLookupText(cleanedText).split(/\s+/).filter(Boolean)),
    };
  });

  type Section = { sectionPath: string[]; pages: DocumentPage[] };
  const sections: Section[] = [];
  let activeSectionPath: string[] = [];
  for (const page of pages) {
    if (page.sectionHeadings.length > 0) {
      activeSectionPath = page.sectionHeadings;
      sections.push({ sectionPath: activeSectionPath, pages: [page] });
    } else if (sections.length === 0) {
      sections.push({ sectionPath: activeSectionPath, pages: [page] });
    } else {
      sections[sections.length - 1].pages.push(page);
    }
  }

  for (const section of sections) {
    const combinedText = section.pages
      .map((page) => [page.cleanedText, buildPageImageContext(page.images)].filter(Boolean).join("\n\n"))
      .filter(Boolean)
      .join("\n\n");
    const combinedCleanText = section.pages
      .map((page) => page.cleanedText)
      .filter(Boolean)
      .join("\n\n");
    const chunkProfile = adaptiveChunkProfile(combinedCleanText, section.sectionPath);
    const pageLookupText = normalizeLookupText(section.pages.map((page) => page.normalizedText).join(" "));
    const sectionChunks = chunkTextWithOverlap(combinedText, chunkProfile.chunkSize, chunkProfile.overlap);

    sectionChunks.forEach((content, pageChunkIndex) => {
      const contentWords = new Set(
        normalizeLookupText(content.replace(imageDataTagPattern, " ")).split(/\s+/).filter(Boolean),
      );
      const contributing = attributeChunkToPages(contentWords, section.pages);
      const pageNumbers = contributing
        .map((page) => page.pageNumber)
        .filter((value): value is number => typeof value === "number");
      const pageStart = pageNumbers.length ? Math.min(...pageNumbers) : (section.pages[0]?.pageNumber ?? null);
      const pageEnd = pageNumbers.length ? Math.max(...pageNumbers) : pageStart;
      const representativePage = pageStart === pageEnd ? pageStart : null;
      const fingerprint = dedupeChunkFingerprint(content);
      const contextualFingerprint = fingerprint
        ? [section.sectionPath.join(" > "), pageStart ?? "unknown", pageEnd ?? "unknown", fingerprint].join(":")
        : "";
      if (contextualFingerprint && chunkFingerprint.has(contextualFingerprint)) return;
      if (contextualFingerprint) chunkFingerprint.set(contextualFingerprint, chunks.length);
      const contributingImages = contributing.flatMap((page) => page.images);

      emitChunk({
        chunks,
        content,
        documentId,
        pageNumber: representativePage,
        pageStart,
        pageEnd,
        sectionPath: section.sectionPath,
        images: contributingImages,
        spanPages: contributing.map((page) => ({ pageNumber: page.pageNumber, pageText: page.normalizedText })),
        baseMetadata: contributing[0]?.metadata ?? section.pages[0]?.metadata ?? {},
        pageLookupText,
        chunkProfile,
        pageChunkIndex,
        chunkerVersion: DOCUMENT_CHUNKER_VERSION,
      });
    });
  }

  return chunks;
}

export function buildChunks(inputs: ChunkInput[]) {
  return env.CHUNK_STRATEGY === "document" ? buildDocumentModeChunks(inputs) : buildPageModeChunks(inputs);
}
