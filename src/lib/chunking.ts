import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { sourceSpanForText } from "@/lib/source-spans";
import { normalizeExtractedGlyphs, stripClassificationBanner } from "@/lib/source-text-sanitizer";
import type { ChunkInput, DocumentChunk } from "@/lib/types";

// Identity of the chunking strategy + params. Stamped into every chunk's metadata so a
// re-index can tell which chunker produced a row, and so bumping the strategy deliberately
// invalidates stale chunks. Bump this when chunk boundaries change (e.g. when cross-page
// document-mode chunking is enabled by default).
export const CHUNKER_VERSION = "1.3.3-page";
export const DOCUMENT_CHUNKER_VERSION = "1.3.3-document";

const sentenceBoundary = /(?<=[.!?])\s+/;
const sentenceBoundaryGlobal = new RegExp(sentenceBoundary.source, "g");
const paragraphBoundary = /\n{2,}/;
const lineBreakPattern = /\r?\n/;
const whitespaceRunPattern = /\s+/g;
const whitespaceSplitPattern = /\s+/;
const horizontalWhitespaceRunPattern = /[ \t]+/g;
const trailingHorizontalWhitespaceBeforeNewlinePattern = /[ \t]+\n/g;
const excessBlankLinesPattern = /\n{3,}/g;
const nonAlphanumericRunPattern = /[^a-z0-9]+/g;
const lookupArtifactWordPattern = /\b(?:table|figure|appendix)\b/g;
const headingLinePattern = /^[A-Z0-9][A-Za-z0-9\s,;:()[\]/-]{3,}$/;
const trailingHeadingPunctuationPattern = /[:.\s]+$/;
const digitsOnlyLinePattern = /^\d+$/;
// Audit 2026-10-20 ING-B-02: "Clinical ..." and "Mental health ..." also open
// ordinary clinical headings ("Clinical monitoring"), so on their own they only
// mark a running header when the line also names an organisation.
const boilerplateOrgPrefixPattern = /^(?:corporate|government|department|hospital|health service)\b/i;
const boilerplateAmbiguousOrgPrefixPattern = /^(?:clinical|mental health)\b/i;
const boilerplateOrgNounPattern =
  /\b(?:services?|directorate|division|network|department|hospital|government|authority|governance)\b/i;
// A repeated line is a running header or footer only within this many content
// lines of the top or bottom of the page.
const runningHeaderFooterWindow = 3;
const numberWithUnitPattern =
  /\d\s*(?:mg|mcg|µg|μg|ug|g|kg|ng|ml|l|dl|iu|units?|mmol|mol|meq|mmhg|bpm|%|x\s*10)(?![a-z])/i;
const boilerplateKeywordPattern =
  /\b(?:confidential|printed|uncontrolled|guideline|procedure|policy|document|version|review date)\b/i;
const trailingDigitPattern = /\d$/;
const sectionHeadingTextPattern = /^[A-Z][A-Za-z0-9\s,;:()\/\-\[\]]+$/;
const numberedSectionHeadingPattern = /^\d+\.?\s+[A-Z]/;
const edgeHyphenPattern = /(^-|-$)/g;
const headingNumberPrefixPattern = /^(\d+(?:\.\d+){0,5})\b/;
const tableSeparatorRowPattern = /^\s*\|?[\s:|-]+\|?\s*$/;
const nonWhitespaceCharPattern = /\S/;
const whitespaceCharPattern = /\s/;
const sentenceTerminalPunctuationPattern = /[.!?]/;
const trailingClausePunctuationPattern = /[\s,;:([{\-–—]+$/;
const imageDataStartEndBlockPattern = /\[\[IMAGE_DATA_START\]\][\s\S]*?\[\[IMAGE_DATA_END\]\]/g;
const imageDataOmittedBlockPattern = /\[\[IMAGE_DATA_OMITTED\]\][\s\S]*?\[\[\/IMAGE_DATA_OMITTED\]\]/g;
const sentenceOrLineSplitPattern = /(?<=[.!?])\s+|\n+/;
const invalidTableCellCharPattern = /[\r\n|\\]/;
const markdownTableAlignmentCellPattern = /^:?-{3,}:?$/;
const imageDataMarkerGlobalPattern =
  /\[\[(IMAGE_DATA_START|IMAGE_DATA_END|IMAGE_DATA_OMITTED|\/IMAGE_DATA_OMITTED)\]\]/g;
const danglingImageDataMarkerPattern = /\[\[\/?IMAGE_DATA|\bIMAGE_DATA_/;
const tableIdentifierUnitPattern =
  /^(?:mg|mcg|µg|μg|ug|g|kg|ng|pg|ml|l|dl|h|hr|hrs|hour|hours|min|s|sec|second|seconds|day|days|wk|week|weeks|mmol|mol|meq|iu|u|unit|units|mmhg|cm|bpm|x)$/i;
const explicitRowIdentifierShapePattern = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)+$/;
const uppercaseAsciiLetterPattern = /[A-Z]/;
const numericLiteralGlobalPattern = /[+-]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:e[+-]?\d+)?/gi;
const nonUnicodeLetterSplitPattern = /[^\p{L}]+/u;
// Audit 2026-10-20 ING-B-01: these markers used to delete any line containing
// them, including "Max dose 400 mg daily, see www..." and a clozapine ANC
// threshold sharing a line with a copyright note. A marked line is now dropped
// only when it reads as a notice as a whole (see looksLikeBoilerplateNotice).
const boilerplateNoticeMarkerPattern =
  /\b(?:copyright|all rights reserved|document revision|do not distribute|downloaded from|www\.\S+)\b/i;
const boilerplateNoticeLeadPattern =
  /^\W*(?:©|\(c\)|copyright\b|all rights reserved\b|document revision\b|do not distribute\b|downloaded from\b)/i;
const boilerplateNoticeStripPattern =
  /https?:\/\/\S+|www\.\S+|©|\(c\)|\b(?:copyright|all rights reserved|document revision|do not distribute|downloaded from)\b/gi;
const urlPattern = /https?:\/\/\S+|www\.\S+/i;
const urlGlobalPattern = /https?:\/\/\S+|www\.\S+/gi;
const residualWordGlobalPattern = /\p{L}{2,}/gu;
const maxBoilerplateNoticeResidualWords = 6;
const clinicalComparatorPattern = /[<>≤≥]/;
const metadataNoisePatterns: RegExp[] = [/\b(?:version|revision)\s+\d+\s*$/i];
// Lines of one or two characters are kept when they are a word or number
// ("No", "Na", "0", "10"); punctuation and bullet debris is still dropped.
const shortContentLinePattern = /^[\p{L}\p{N}]{1,2}$/u;
// Audit 2026-10-24 EXT-01 (chunker 1.3.2): borderless tables arrive one cell per line, so a short
// line holding a digit, a comparison sign or a plus/minus sign is a threshold cell ("<5", "≥8",
// "5%", "-1", a lone "<" or "−"), never debris. A lone ASCII hyphen is still treated as a bullet.
const shortThresholdCellPattern = /[\p{N}<>≤≥=±+\u2212]/u;
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
    .split(lineBreakPattern)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line.length < 120);

  if (!firstMeaningfulLine) return null;
  if (headingLinePattern.test(firstMeaningfulLine)) {
    return firstMeaningfulLine.replace(trailingHeadingPunctuationPattern, "");
  }

  return null;
}

function normalizeLookupText(value: string) {
  return value.toLowerCase().replace(nonAlphanumericRunPattern, " ").replace(lookupArtifactWordPattern, "").trim();
}

// A line that is nothing but a PSPF protective marking ("OFFICIAL",
// "OFFICIAL: Sensitive") — running headers stamped on every page.
function isClassificationBannerLine(line: string) {
  return Boolean(line.trim()) && !stripClassificationBanner(line).trim();
}

function hasClinicalSignal(line: string) {
  return highYieldSectionPattern.test(line) || numberWithUnitPattern.test(line) || clinicalComparatorPattern.test(line);
}

// A line carrying a copyright, download-stamp or web-address marker is a notice
// only when it has no clinical signal and either opens with the notice or has
// little left once the notice words and addresses are removed.
function looksLikeBoilerplateNotice(line: string) {
  if (!boilerplateNoticeMarkerPattern.test(line)) return false;
  if (hasClinicalSignal(line)) return false;
  if (boilerplateNoticeLeadPattern.test(line)) return true;
  // Chunker 1.3.1: a line whose only marker is a web address is a referral
  // ("Crisis line: www.example.org"), not a notice. removePageNoise strips it
  // only at the top or bottom edge of the page (see isUrlReferralLine).
  if (isUrlReferralLine(line)) return false;
  const residualWords = line.replace(boilerplateNoticeStripPattern, " ").match(residualWordGlobalPattern) ?? [];
  return residualWords.length <= maxBoilerplateNoticeResidualWords;
}

// A short line whose only notice marker is a web address.
function isUrlReferralLine(line: string) {
  if (!urlPattern.test(line)) return false;
  return !boilerplateNoticeMarkerPattern.test(line.replace(urlGlobalPattern, " "));
}

// An edge-of-page web address with little else on the line reads as a running
// footer or header ("www.example.org", "Downloaded ... www..." is handled above).
function looksLikeEdgeUrlNotice(line: string) {
  if (!isUrlReferralLine(line) || hasClinicalSignal(line)) return false;
  // Owner ruling 21 Oct 2026: only a bare web address is stripped at the page edge. Any
  // words or numbers beside it ("Lifeline 13 11 14 www.lifeline.org.au") make it a
  // referral that is kept.
  return !/[\p{L}\p{N}]/u.test(line.replace(urlGlobalPattern, " "));
}

function looksLikeMetadataNoise(line: string) {
  if (!line) return true;
  if (
    line.length <= 2 &&
    !shortThresholdCellPattern.test(line) &&
    (!shortContentLinePattern.test(line) || clinicalUnitLinePattern.test(line))
  )
    return true;
  if (isClassificationBannerLine(line)) return true;
  if (looksLikeBoilerplateNotice(line)) return true;
  if (metadataNoisePatterns.some((pattern) => pattern.test(line))) return true;
  if (lineNoisePatterns.some((pattern) => pattern.test(line))) return true;
  return false;
}

function normalizeRepeatedLine(value: string) {
  return value.toLowerCase().replace(nonAlphanumericRunPattern, " ").trim();
}

// "strong" lines are boilerplate on their own evidence (metadata, organisation names). "keyword"
// lines only contain a word such as policy, procedure or guideline, which real headings share.
function repeatingBoilerplateKind(line: string): "strong" | "keyword" | null {
  const normalized = normalizeRepeatedLine(line);
  if (!normalized || normalized.length < 5 || normalized.length > 90) return null;
  if (looksLikeMetadataNoise(line)) return "strong";
  // Audit 2026-10-20 ING-B-02: never treat a repeated line that states a dose,
  // measurement, threshold comparator or clinical action as a running header.
  if (hasClinicalSignal(line)) return null;
  if (boilerplateOrgPrefixPattern.test(line)) return "strong";
  if (boilerplateAmbiguousOrgPrefixPattern.test(line) && boilerplateOrgNounPattern.test(line)) return "strong";
  if (boilerplateKeywordPattern.test(line)) return "keyword";
  return null;
}

// Indexes of the lines within `runningHeaderFooterWindow` content lines of the
// top or bottom of a page. Lines that are noise on their own do not count
// towards the window, so a protective-marking banner above a header does not
// push the header out of it.
function runningHeaderFooterIndexes(lines: string[]) {
  const contentIndexes = lines.flatMap((line, index) => (line && !looksLikeMetadataNoise(line) ? [index] : []));
  return new Set([
    ...contentIndexes.slice(0, runningHeaderFooterWindow),
    ...contentIndexes.slice(-runningHeaderFooterWindow),
  ]);
}

function splitPageLines(text: string) {
  return rejoinWrappedDoseUnits(text.split(lineBreakPattern).map((line) => line.trim()));
}

function buildRepeatedBoilerplateLines(inputs: ChunkInput[]) {
  const counts = new Map<string, { count: number; kind: "strong" | "keyword" }>();
  for (const input of inputs) {
    // Keys must be built from the SAME normalized text that removePageNoise
    // later compares against, or a ligature/soft-hyphen in a repeated header
    // ("Conﬁdential") would produce a mismatched key and survive filtering.
    const lines = splitPageLines(normalizeExtractedGlyphs(input.pageText));
    const edgeIndexes = runningHeaderFooterIndexes(lines);
    const pageLines = new Map<string, "strong" | "keyword">();
    lines.forEach((line, index) => {
      if (!edgeIndexes.has(index)) return;
      const kind = repeatingBoilerplateKind(line);
      const key = kind ? normalizeRepeatedLine(line) : "";
      if (kind && key && pageLines.get(key) !== "strong") pageLines.set(key, kind);
    });
    for (const [line, kind] of pageLines) {
      const current = counts.get(line);
      counts.set(line, {
        count: (current?.count ?? 0) + 1,
        kind: current?.kind === "strong" || kind === "strong" ? "strong" : "keyword",
      });
    }
  }
  // Chunker 1.3.3 (audit EXT-02): a line that only contains a word such as policy or procedure
  // ("Lithium policy") is often a real heading repeated on a couple of pages. Stripping it left
  // those pages under the previous section's heading. Such a line is now a running header only
  // when it repeats on at least three pages and at least half of the document's pages, or on
  // every page of a shorter document. It must still repeat at least twice, or a one-page
  // document would lose its only heading.
  const keywordMinimum = Math.max(2, Math.min(inputs.length, Math.max(3, Math.ceil(inputs.length / 2))));
  return new Set(
    [...counts.entries()]
      .filter(([, { count, kind }]) => count >= (kind === "strong" ? 2 : keywordMinimum))
      .map(([line]) => line),
  );
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
    trailingDigitPattern.test(previousLine) &&
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
  const lines = text.split(lineBreakPattern).map((line) => line.trim());
  let count = 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (isWrappedDoseUnitContinuation(lines[index - 1], lines[index])) count += 1;
  }
  return count;
}

// Audit 2026-10-20 ING-B-01: a bare number line is a page number only when it
// is the first or last content line and not part of a run of numbers (a rating
// scale column such as "0 / 1 / 2 / 3"). Other number lines are content.
// Audit 2026-10-24 EXT-01 (chunker 1.3.2): when the page is known, the edge number must also be
// one of that page's own page-number labels, so "Olanzapine / 20" at the foot of a page keeps its
// dose. Without a page (standalone text), the position rule alone still applies.
function isIsolatedEdgeNumberLine(lines: string[], index: number, keptIndexes: number[]) {
  if (!digitsOnlyLinePattern.test(lines[index])) return false;
  if (index !== keptIndexes[0] && index !== keptIndexes[keptIndexes.length - 1]) return false;
  const position = keptIndexes.indexOf(index);
  const neighbours = [keptIndexes[position - 1], keptIndexes[position + 1]];
  return !neighbours.some((neighbour) => neighbour !== undefined && digitsOnlyLinePattern.test(lines[neighbour]));
}

function contentLineIndexes(lines: string[], repeatedBoilerplateLines: Set<string>) {
  const edgeIndexes = repeatedBoilerplateLines.size > 0 ? runningHeaderFooterIndexes(lines) : new Set<number>();
  return lines.flatMap((line, index) => {
    if (line === "" || looksLikeMetadataNoise(line)) return [];
    // Audit 2026-10-20 ING-B-02: a repeated line is only removed where it sits
    // as a running header or footer, never from the body of the page.
    if (edgeIndexes.has(index) && repeatedBoilerplateLines.has(normalizeRepeatedLine(line))) return [];
    return [index];
  });
}

function isolatedEdgeNumbers(text: string, repeatedBoilerplateLines: Set<string>) {
  const lines = splitPageLines(text);
  const keptIndexes = contentLineIndexes(lines, repeatedBoilerplateLines);
  return keptIndexes
    .filter((index) => isIsolatedEdgeNumberLine(lines, index, keptIndexes))
    .map((index) => Number(lines[index]));
}

// A shifted printed numbering must show on at least this many pages. Two edge cells that happen to
// run in sequence across one page break ("1" on page 5, "2" on page 6) are table values, not pages.
const MIN_SHIFTED_PAGE_NUMBER_PAGES = 3;

// The bare numbers each page may print as its page number: its own number, or an edge number
// whose offset from the page number repeats on an adjacent page and across the document (front
// matter shifts printed numbering). Any other edge number is content.
function buildPageNumberLines(inputs: ChunkInput[], repeatedBoilerplateLines: Set<string>) {
  const edges = inputs.map((input) =>
    input.pageNumber == null
      ? []
      : isolatedEdgeNumbers(normalizeExtractedGlyphs(input.pageText), repeatedBoilerplateLines).map(
          (value) => value - (input.pageNumber as number),
        ),
  );
  const pagesWithOffset = new Map<number, number>();
  for (const offsets of edges) {
    for (const offset of new Set(offsets)) pagesWithOffset.set(offset, (pagesWithOffset.get(offset) ?? 0) + 1);
  }
  return inputs.map((input, index): ReadonlySet<string> | undefined => {
    if (input.pageNumber == null) return undefined;
    const labels = new Set([String(input.pageNumber)]);
    const neighbourOffsets = new Set([...(edges[index - 1] ?? []), ...(edges[index + 1] ?? [])]);
    for (const offset of edges[index]) {
      if (neighbourOffsets.has(offset) && (pagesWithOffset.get(offset) ?? 0) >= MIN_SHIFTED_PAGE_NUMBER_PAGES) {
        labels.add(String(input.pageNumber + offset));
      }
    }
    return labels;
  });
}

// `pageNumberLines` set: an edge number is dropped only when it is one of those labels (an empty
// set keeps every edge number, for text that was already cleaned). Unset: position rule only.
function removePageNoise(
  text: string,
  repeatedBoilerplateLines = new Set<string>(),
  pageNumberLines?: ReadonlySet<string>,
) {
  const lines = splitPageLines(text);
  const keptIndexes = contentLineIndexes(lines, repeatedBoilerplateLines);
  const firstContent = keptIndexes[0];
  const lastContent = keptIndexes[keptIndexes.length - 1];
  const isPageNumberLine = (index: number) =>
    isIsolatedEdgeNumberLine(lines, index, keptIndexes) &&
    (!pageNumberLines || pageNumberLines.has(String(Number(lines[index]))));
  const kept = new Set(
    keptIndexes.filter(
      (index) =>
        !isPageNumberLine(index) &&
        !(
          // A URL-only page (the address is both first and last line) is edge noise too.
          (index === firstContent || index === lastContent) && looksLikeEdgeUrlNotice(lines[index])
        ),
    ),
  );
  return lines
    .filter((line, index) => line === "" || kept.has(index))
    .join("\n")
    .replace(trailingHorizontalWhitespaceBeforeNewlinePattern, "\n")
    .replace(excessBlankLinesPattern, "\n\n")
    .trim();
}

function extractSectionHeadings(text: string) {
  return text
    .split(lineBreakPattern)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || line.length < 4) return false;
      if (looksLikeMetadataNoise(line)) return false;
      if (line.length < 90 && sectionHeadingTextPattern.test(line)) return true;
      if (numberedSectionHeadingPattern.test(line) && line.length < 110) return true;
      return false;
    });
}

function sectionAnchorId(heading: string | null) {
  if (!heading) return null;
  return (
    heading.toLowerCase().replace(nonAlphanumericRunPattern, "-").replace(edgeHyphenPattern, "").slice(0, 40) || null
  );
}

function headingLevel(heading: string | null, sectionPath: string[]) {
  if (!heading) return sectionPath.length > 0 ? Math.min(sectionPath.length, 6) : null;
  const numbered = heading.match(headingNumberPrefixPattern);
  if (numbered) return Math.min(numbered[1].split(".").length, 6);
  return sectionPath.includes(heading)
    ? Math.max(1, sectionPath.indexOf(heading) + 1)
    : Math.max(1, sectionPath.length);
}

function imageMatchScore(lookupText: string, sourceText: string) {
  if (!lookupText || !sourceText) return 0;
  const source = new Set(sourceText.split(whitespaceSplitPattern).filter(Boolean));
  const hits = lookupText
    .split(whitespaceSplitPattern)
    .filter(Boolean)
    .filter((token) => source.has(token)).length;
  return hits;
}

function dedupeChunkFingerprint(text: string) {
  return normalizeLookupText(text).replace(whitespaceRunPattern, " ").trim();
}

const imageDataTagPattern =
  /\[\[IMAGE_DATA_START\]\][\s\S]*?\[\[IMAGE_DATA_END\]\]|\[\[IMAGE_DATA_OMITTED\]\][\s\S]*?\[\[\/IMAGE_DATA_OMITTED\]\]/g;

function normalizeChunkKeyContent(content: string) {
  return content.replace(imageDataTagPattern, " ").replace(whitespaceRunPattern, " ").trim().toLowerCase();
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

export function chunkTextWithOverlap(
  text: string,
  chunkSize = env.CHUNK_SIZE,
  overlap = env.CHUNK_OVERLAP,
  pageNumberLines?: ReadonlySet<string>,
) {
  const clean = removePageNoise(normalizeExtractedGlyphs(text), undefined, pageNumberLines)
    .replace(trailingHorizontalWhitespaceBeforeNewlinePattern, "\n")
    .replace(horizontalWhitespaceRunPattern, " ")
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
        chunks.push(...chunkOversizedParagraph(paragraph, chunkSize, overlap));
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

  return chunkOversizedParagraph(clean, chunkSize, overlap);
}

// Audit 2026-10-20 ING-B-03: the PDF extractor joins a table's title, its
// markdown rows and any footnote with single newlines, so a table page is one
// paragraph that isTableBlock rejects. Split such a paragraph into its prose
// and table runs; each table run is chunked by rows with its header (and a
// "Table ..." title line directly above it) repeated on every chunk.
function chunkOversizedParagraph(paragraph: string, chunkSize: number, overlap: number) {
  const lines = paragraph.split(lineBreakPattern);
  const segments: Array<{ table: boolean; lines: string[] }> = [];
  for (const line of lines) {
    const table = tableRowPattern.test(line);
    const last = segments[segments.length - 1];
    if (last && last.table === table) last.lines.push(line);
    else segments.push({ table, lines: [line] });
  }
  if (!segments.some((segment) => segment.table && segment.lines.length >= 2)) {
    return chunkTextBySentence(paragraph, chunkSize, overlap);
  }

  const chunks: string[] = [];
  const pushProse = (proseLines: string[]) => {
    const prose = proseLines.join("\n").trim();
    if (!prose) return;
    chunks.push(...(prose.length > chunkSize ? chunkTextBySentence(prose, chunkSize, overlap) : [prose]));
  };
  const isTableSegment = (segment: (typeof segments)[number] | undefined) =>
    Boolean(segment?.table && segment.lines.length >= 2);
  // Footnote lines at the start of a prose run belong to the table before it.
  const footnoteCounts = segments.map((segment, index) =>
    !isTableSegment(segment) && isTableSegment(segments[index - 1]) ? tableFootnoteLineCount(segment.lines) : 0,
  );
  // A caption (or heading) at the end of a prose run belongs to the table after it.
  const captions = segments.map((segment, index) =>
    !isTableSegment(segment) && isTableSegment(segments[index + 1])
      ? tableCaption(segment.lines.slice(footnoteCounts[index]))
      : null,
  );
  segments.forEach((segment, index) => {
    if (!isTableSegment(segment)) {
      const body = segment.lines.slice(footnoteCounts[index]);
      const caption = captions[index];
      pushProse(caption ? body.slice(0, caption.start) : body);
      return;
    }
    const caption = captions[index - 1]?.caption ?? "";
    const next = segments[index + 1];
    const footnote =
      next && footnoteCounts[index + 1] > 0
        ? next.lines
            .slice(0, footnoteCounts[index + 1])
            .map((line) => line.trim())
            .join("\n")
        : "";
    chunks.push(...chunkTableBlock(segment.lines.join("\n"), chunkSize, caption, footnote));
  });
  return chunks;
}

function readableOverlapTail(text: string, overlap: number) {
  if (overlap <= 0 || !text) return "";
  if (text.length <= overlap) return text;
  const start = readableOverlapStart(text, text.length, overlap);
  return text.slice(start).trim();
}

const tableRowPattern = /^\s*\|.*\|\s*$/;
const tableCaptionLinePattern = /^table\b/i;
// Chunker 1.3.1: the caption search looks a little further back for a wrapped
// "Table ..." title, and a long title is truncated at a word boundary rather
// than dropped. When truncated, the full title also stays in the prose.
const maxTableCaptionLines = 6;
const maxTableCaptionLength = 300;
// A non-"Table" caption is the nearest preceding short heading-like line.
const maxHeadingCaptionLength = 160;
// A heading caption does not end like a sentence or a wrapped lead-in, and does not
// start lowercase (a wrapped sentence tail).
const headingCaptionEndPattern = /[^.!?:,;]$/;
const headingCaptionStartPattern = /^[\p{Lu}\p{N}]/u;
const sentenceEndLinePattern = /[.!?]$/;
// Owner ruling 21 Oct 2026: only symbol markers, "Note" and "Source" open a footnote, so a
// numbered or lettered dosing list after a table stays prose.
const tableFootnoteLinePattern = /^(?:[*†‡§]+|notes?\b|sources?\b)/i;
const maxTableFootnoteLines = 4;
const maxTableFootnoteLength = 400;
const maxRepeatedTableNoteLength = 200;

// Returns the caption carried onto every chunk of the following table and the
// index where it starts in `lines` (lines from `start` are moved out of prose).
function tableCaption(lines: string[]): { start: number; caption: string } | null {
  const trimmed = lines.map((line) => line.trim());
  const earliest = Math.max(0, trimmed.length - maxTableCaptionLines);
  for (let index = trimmed.length - 1; index >= earliest; index -= 1) {
    if (!tableCaptionLinePattern.test(trimmed[index] ?? "")) continue;
    const full = trimmed.slice(index).filter(Boolean).join("\n");
    if (full.length <= maxTableCaptionLength) return { start: index, caption: full };
    return {
      start: trimmed.length,
      caption: truncateAtWordBoundary(full.replace(whitespaceRunPattern, " "), maxTableCaptionLength),
    };
  }
  let last = trimmed.length - 1;
  while (last >= 0 && !trimmed[last]) last -= 1;
  const candidate = last >= 0 ? trimmed[last] : "";
  let before = last - 1;
  while (before >= 0 && !trimmed[before]) before -= 1;
  // The line above must end a sentence (or not exist, or be separated by a blank line),
  // so the candidate is not the tail of a sentence the extractor wrapped.
  const standsAlone = before < 0 || before < last - 1 || sentenceEndLinePattern.test(trimmed[before]);
  if (
    candidate &&
    candidate.length <= maxHeadingCaptionLength &&
    headingCaptionEndPattern.test(candidate) &&
    headingCaptionStartPattern.test(candidate) &&
    standsAlone
  ) {
    return { start: last, caption: candidate };
  }
  return null;
}

// How many lines at the start of a prose run read as the preceding table's
// footnotes ("* ...", "a) ...", "Note: ...", "Source: ...").
function tableFootnoteLineCount(lines: string[]) {
  let count = 0;
  let length = 0;
  for (const line of lines.slice(0, maxTableFootnoteLines)) {
    const text = line.trim();
    if (!text || !tableFootnoteLinePattern.test(text)) break;
    length += text.length + 1;
    if (length > maxTableFootnoteLength) return 0;
    count += 1;
  }
  return count;
}

function isTableBlock(block: string) {
  const lines = block.split(lineBreakPattern).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return false;
  return lines.every((line) => tableRowPattern.test(line));
}

function chunkTableBlock(block: string, chunkSize: number, caption = "", footnote = "") {
  const lines = block.split(lineBreakPattern).filter((line) => line.trim().length > 0);
  const captioned = [caption, block.trim(), footnote].filter(Boolean).join("\n");
  if (captioned.length <= chunkSize) return [captioned];

  const separatorIndex = lines.findIndex((line) => tableSeparatorRowPattern.test(line) && line.includes("-"));
  const headerLines = separatorIndex > 0 ? lines.slice(0, separatorIndex + 1) : lines.slice(0, 1);
  const bodyLines = lines.slice(headerLines.length);
  const header = [caption, ...headerLines].filter(Boolean).join("\n");
  // Chunker 1.3.3 (audit EXT-07): a short note such as "Note: not recommended in severe renal
  // impairment" is repeated on every piece of a split table, like the header, so the pieces that
  // hold most of the dose rows carry the warning. A longer note keeps the old placement below.
  // The note is repeated only when the header, one minimum-width row and the note all fit, so a
  // wide header never pushes a piece over the size cap.
  const minimumRowBudget = 40;
  const repeatedNote =
    footnote &&
    footnote.length <= maxRepeatedTableNoteLength &&
    header.length + 1 + minimumRowBudget + 1 + footnote.length <= chunkSize
      ? footnote
      : "";
  const groupSize = repeatedNote ? chunkSize - repeatedNote.length - 1 : chunkSize;
  // Chunker 1.3.1: a single row longer than the room left under the header is
  // split at word boundaries into pieces that each repeat the header.
  const rowBudget = Math.max(minimumRowBudget, groupSize - header.length - 1);

  const chunks: string[] = [];
  let current = header;
  for (const row of bodyLines.flatMap((line) => splitOversizedRow(line, rowBudget))) {
    const candidate = `${current}\n${row}`;
    if (candidate.length > groupSize && current !== header) {
      chunks.push(current.trim());
      current = `${header}\n${row}`;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  if (chunks.length === 0) return [captioned];
  if (repeatedNote) return chunks.map((chunk) => `${chunk}\n${repeatedNote}`);
  if (footnote) {
    // Keep the size cap: append to the last chunk only when it fits, otherwise emit the
    // footnote with the repeated header as its own chunk.
    const appended = `${chunks[chunks.length - 1]}\n${footnote}`;
    if (appended.length <= chunkSize) chunks[chunks.length - 1] = appended;
    else chunks.push(...footnoteChunks(header, footnote, chunkSize));
  }
  return chunks;
}

// The fallback footnote chunk must also respect the cap: repeat the header only when
// header + footnote fits, otherwise split the footnote at word boundaries on its own.
function footnoteChunks(header: string, footnote: string, chunkSize: number) {
  const withHeader = `${header}\n${footnote}`;
  if (withHeader.length <= chunkSize) return [withHeader];
  const pieces: string[] = [];
  let rest = footnote.trim();
  while (rest.length > chunkSize) {
    const cut = rest.slice(0, chunkSize).lastIndexOf(" ");
    const at = cut > chunkSize * 0.5 ? cut : chunkSize;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

const rowContinuationMarker = "(row continued) ";

function splitOversizedRow(row: string, budget: number) {
  if (row.length <= budget) return [row];
  const pieces: string[] = [];
  let rest = row.trim();
  // Continuation pieces carry the marker, so they get that much less room.
  while (rest.length > (pieces.length === 0 ? budget : budget - rowContinuationMarker.length)) {
    const room = Math.max(1, pieces.length === 0 ? budget : budget - rowContinuationMarker.length);
    const cut = rest.slice(0, room).lastIndexOf(" ");
    const at = cut > room * 0.5 ? cut : room;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) pieces.push(rest);
  return pieces.map((piece, index) => (index === 0 ? piece : `${rowContinuationMarker}${piece}`));
}

const clinicalProhibitionPattern =
  /\b(?:contraindicat(?:e|ed|ion|ions)|do not|does not|must not|should not|shall not|cannot|can't|never|avoid|withhold|cease|black box warning)\b/i;
const sentenceEndPattern = /(?<=[.!?])(?:\s+|$)/;

function readableOverlapStart(clean: string, end: number, overlap: number) {
  if (overlap <= 0) return end;
  let start = Math.max(0, end - overlap);

  while (
    start > 0 &&
    start < end &&
    nonWhitespaceCharPattern.test(clean[start - 1] ?? "") &&
    nonWhitespaceCharPattern.test(clean[start] ?? "")
  ) {
    start -= 1;
  }
  while (start < end && whitespaceCharPattern.test(clean[start] ?? "")) {
    start += 1;
  }

  // Keep the subject, condition and negation with the governing sentence, not just its keyword.
  let sentenceStart = start;
  while (
    sentenceStart > 0 &&
    !(
      sentenceTerminalPunctuationPattern.test(clean[sentenceStart - 1] ?? "") &&
      whitespaceCharPattern.test(clean[sentenceStart] ?? "")
    )
  ) {
    sentenceStart -= 1;
  }
  while (sentenceStart < end && whitespaceCharPattern.test(clean[sentenceStart] ?? "")) sentenceStart += 1;
  const sentenceWindow = clean.slice(sentenceStart, end);
  const boundary = sentenceEndPattern.exec(sentenceWindow);
  const governingSentence = sentenceWindow.slice(0, boundary?.index ?? sentenceWindow.length);
  if (clinicalProhibitionPattern.test(governingSentence)) start = sentenceStart;

  return start < end ? start : Math.max(0, end - overlap);
}

// No real clinical sentence runs to this many characters; a list without full stops does.
const unpunctuatedSpanMinimum = 2500;

function unpunctuatedBreak(clean: string, start: number, chunkSize: number, fallback: number) {
  const window = clean.slice(start, start + Math.floor(chunkSize * 1.35));
  const minimum = Math.floor(chunkSize * 0.5);
  const lineBreak = window.lastIndexOf("\n");
  if (lineBreak >= minimum) return start + lineBreak;
  const space = window.lastIndexOf(" ");
  return space >= minimum ? start + space : fallback;
}

// The opening line of an unpunctuated span ("Do not give with:") governs every row under it, so
// when it states a prohibition each later piece of the span repeats it (capped at this length).
const maxGoverningLeadLength = 200;

function governingLeadOf(clean: string, spanStart: number) {
  const lineEnd = clean.indexOf("\n", spanStart);
  const line = clean.slice(spanStart, lineEnd < 0 ? clean.length : lineEnd).trim();
  return line && line.length <= maxGoverningLeadLength && clinicalProhibitionPattern.test(line) ? line : "";
}

function chunkTextBySentence(clean: string, chunkSize: number, overlap: number) {
  const chunks: string[] = [];
  // Record actual offsets once; never scan the remaining document for every chunk.
  const sentenceEnds = Array.from(clean.matchAll(sentenceBoundaryGlobal), (match) => match.index);
  if (sentenceEnds.at(-1) !== clean.length) sentenceEnds.push(clean.length);
  let boundaryIndex = 0;
  let start = 0;
  let unpunctuatedUntil = -1;
  let governingLead = "";

  while (start < clean.length) {
    const nominalEnd = Math.min(start + chunkSize, clean.length);
    while (sentenceEnds[boundaryIndex] < nominalEnd) boundaryIndex += 1;
    const completingEnd = sentenceEnds[boundaryIndex];
    const precedingEnd = boundaryIndex > 0 ? sentenceEnds[boundaryIndex - 1] : 0;
    // Ordinary chunks retain the 35% elongation budget and end at a sentence boundary when one
    // falls inside it, because splitting a sentence could change a clinical assertion's scope.
    const sentenceEnd =
      completingEnd <= start + chunkSize * 1.35 || precedingEnd <= start ? completingEnd : precedingEnd;
    // Chunker 1.3.3 (audit EXT-05): text with no full stops, such as a borderless dosing list,
    // used to become one passage several times the intended size. A span far longer than any
    // plausible sentence now breaks at the last line break, or failing that the last space, inside
    // the budget. Shorter overlong sentences stay whole as before (CHK-01).
    if (sentenceEnd - start > Math.max(chunkSize * 2, unpunctuatedSpanMinimum) && sentenceEnd > unpunctuatedUntil) {
      unpunctuatedUntil = sentenceEnd;
      governingLead = governingLeadOf(clean, start);
    }
    const end =
      sentenceEnd <= unpunctuatedUntil && sentenceEnd - start > chunkSize * 1.35
        ? unpunctuatedBreak(clean, start, chunkSize, sentenceEnd)
        : sentenceEnd;

    const piece = clean.slice(start, end).trim();
    // A later piece of a prohibition-led span must not read as the bare rows without the negation.
    const chunk =
      piece && governingLead && end <= unpunctuatedUntil && !piece.startsWith(governingLead)
        ? `${governingLead}\n${piece}`
        : piece;
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
  const trimmed = window.slice(0, cut).replace(trailingClausePunctuationPattern, "").trim();
  return trimmed ? `${trimmed}...` : `${window.trim()}...`;
}

function compactImageText(value: string | null | undefined, limit = 420) {
  const text = String(value ?? "")
    .replace(whitespaceRunPattern, " ")
    .trim();
  if (!text) return "";
  return truncateAtWordBoundary(text, limit);
}

function compactSynopsisText(value: string | null | undefined, limit = 720) {
  const withoutImageTags = String(value ?? "")
    .replace(imageDataStartEndBlockPattern, " ")
    .replace(imageDataOmittedBlockPattern, " ");
  const sentences = withoutImageTags
    .split(sentenceOrLineSplitPattern)
    // Extraction glues the protective-marking header onto body sentences
    // ("OFFICIAL: OFFICIAL Lithium Therapy …"); shed the banner prefix so it
    // never enters the stored synopsis.
    .map((sentence) => stripClassificationBanner(sentence.replace(whitespaceRunPattern, " ").trim()).trim())
    .filter((sentence) => sentence.length >= 12 && !boilerplateSynopsisPattern.test(sentence));
  const highYieldSentences = sentences.filter((sentence) => highYieldSectionPattern.test(sentence));
  const selected = (highYieldSentences.length ? highYieldSentences : sentences).slice(0, 4).join(" ");
  const compact = selected.replace(whitespaceRunPattern, " ").trim();
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
    typeof cell === "string" && !invalidTableCellCharPattern.test(cell)
      ? cell.replace(whitespaceRunPattern, " ").trim()
      : null;
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
    if (checked.every((cell) => markdownTableAlignmentCellPattern.test(cell))) continue;
    dataRows.push(checked);
  }
  if (!dataRows.length) return null;
  return { columns: normalizedColumns as string[], rows: dataRows };
}

function narrativeTableBlocks(text: string) {
  let openMarker: string | null = null;
  for (const marker of text.matchAll(imageDataMarkerGlobalPattern)) {
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
  if (danglingImageDataMarkerPattern.test(narrative)) return null;
  const lines = narrative.split(lineBreakPattern).map((line) => line.trim());
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
          .map((cell) => cell.replace(whitespaceRunPattern, " ").trim()),
      );
      index += 1;
    }
    index -= 1;
    const [columns, ...remaining] = rows;
    if (columns.some((cell) => !cell)) return null;
    if (remaining[0]?.every((cell) => markdownTableAlignmentCellPattern.test(cell))) {
      if (remaining[0].length !== columns.length) return null;
      remaining.shift();
    }
    if (remaining.some((row) => row.length !== columns.length || row.some((cell) => !cell))) return null;
    if (remaining.some((row) => row.every((cell) => markdownTableAlignmentCellPattern.test(cell)))) return null;
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
  const hasRowIdentifier = table.rows.some((row) => {
    // First slice supports explicit labels, not a semantic classifier for plain words/units.
    if (!explicitRowIdentifierShapePattern.test(row[0]) || !uppercaseAsciiLetterPattern.test(row[0])) return false;
    const withoutNumbers = row[0].replace(numericLiteralGlobalPattern, " ");
    return withoutNumbers
      .split(nonUnicodeLetterSplitPattern)
      .some((word) => word && !tableIdentifierUnitPattern.test(word));
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
  const compactPage = pageText.replace(whitespaceRunPattern, " ").trim();
  if (!compactPage) return chunkExcerpt;

  const chunkWords = new Set(
    normalizeLookupText(chunkExcerpt)
      .split(whitespaceSplitPattern)
      .filter((word) => word.length >= 3),
  );
  if (chunkWords.size === 0) return compactPage;

  const candidates = compactPage
    .split(sentenceOrLineSplitPattern)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const words = normalizeLookupText(part).split(whitespaceSplitPattern).filter(Boolean);
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
      const imageText = [label, title, caption]
        .filter(Boolean)
        .flatMap((value) => value.split(whitespaceSplitPattern).filter(Boolean));
      const imageLookup = imageText.join(" ");
      const headerBoost = heading && imageText.some((token) => normalizeLookupText(heading).includes(token)) ? 1 : 0;
      const direct = imageMatchScore(caption, contentLookup) >= 1 || imageMatchScore(imageLookup, contentLookup) >= 2;
      const pathHit =
        sectionContext.some((candidate) =>
          normalizeLookupText(candidate)
            .split(whitespaceSplitPattern)
            .some((token) => imageLookup.includes(token)),
        ) && image.sourceKind !== "embedded";
      return direct || pathHit || (image.sourceKind === "table_crop" && headerBoost > 0) || headerBoost >= 1;
    })
    .map((image) => image.id);

  const excerpt = content.replace(imageDataStartEndBlockPattern, "").trim();
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
  const pageNumberLines = buildPageNumberLines(inputs, repeatedBoilerplateLines);
  let activeSectionPath: string[] = [];

  for (const [inputIndex, input] of inputs.entries()) {
    const pageImages = input.images ?? [];
    const imageContext = buildPageImageContext(pageImages);
    // Normalize glyph artifacts once so chunk content, the heading lookup, and the
    // source-span excerpt all derive from the same text. Otherwise the normalized
    // excerpt cannot be located in the raw page and span offsets drop to null.
    const normalizedPageText = normalizeExtractedGlyphs(input.pageText);
    const cleanedPageText = removePageNoise(normalizedPageText, repeatedBoilerplateLines, pageNumberLines[inputIndex]);
    const pageSectionPath = extractSectionHeadings(cleanedPageText);
    if (pageSectionPath.length > 0) activeSectionPath = pageSectionPath;
    const sectionPath = activeSectionPath;
    const pageText = [cleanedPageText, imageContext].filter(Boolean).join("\n\n");
    const pageLookupText = normalizeLookupText(normalizedPageText);
    const chunkProfile = adaptiveChunkProfile(cleanedPageText, sectionPath);
    // Already cleaned above: an empty page-number set keeps the edge numbers that survived.
    const pageChunks = chunkTextWithOverlap(pageText, chunkProfile.chunkSize, chunkProfile.overlap, new Set());

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

  const pageNumberLines = buildPageNumberLines(inputs, repeatedBoilerplateLines);
  const pages: DocumentPage[] = inputs.map((input, inputIndex) => {
    const normalizedText = normalizeExtractedGlyphs(input.pageText);
    const cleanedText = removePageNoise(normalizedText, repeatedBoilerplateLines, pageNumberLines[inputIndex]);
    return {
      pageNumber: input.pageNumber,
      normalizedText,
      cleanedText,
      images: input.images ?? [],
      metadata: input.metadata ?? {},
      sectionHeadings: extractSectionHeadings(cleanedText),
      wordSet: new Set(normalizeLookupText(cleanedText).split(whitespaceSplitPattern).filter(Boolean)),
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
    const sectionChunks = chunkTextWithOverlap(combinedText, chunkProfile.chunkSize, chunkProfile.overlap, new Set());

    sectionChunks.forEach((content, pageChunkIndex) => {
      const contentWords = new Set(
        normalizeLookupText(content.replace(imageDataTagPattern, " ")).split(whitespaceSplitPattern).filter(Boolean),
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
