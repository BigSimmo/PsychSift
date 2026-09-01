export type CoverageChunk = {
  id: string;
  page_number: number | null;
  chunk_index: number;
  section_heading: string | null;
  content: string;
};

export type CoverageImage = {
  id: string;
  page_number: number | null;
  caption: string | null;
};

const highYieldCoveragePattern =
  /\b(?:must|should|required|urgent|immediate|escalat\w*|risk|red flag|monitor\w*|dose|mg|mcg|mmol|anc|fbc|wbc|threshold|withhold|cease|stop|contraindicat\w*|workflow|refer|review|follow[- ]?up|responsib\w*)\b/i;

function compactText(value: string, limit: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

function spreadPick<T>(items: T[], count: number) {
  if (items.length <= count) return [...items];
  if (count <= 1) return [items[0]];
  return Array.from({ length: count }, (_, index) => items[Math.round((index * (items.length - 1)) / (count - 1))]);
}

function chunkScore(chunk: CoverageChunk) {
  let score = 0;
  if (chunk.section_heading) score += 2;
  if (highYieldCoveragePattern.test(chunk.content)) score += 4;
  if (/\|.+\|/.test(chunk.content) || /\[\[IMAGE_DATA_START\]\]/.test(chunk.content)) score += 3;
  if (/\d/.test(chunk.content)) score += 1;
  return score;
}

export function buildIndexingCoverageProfile(args: {
  pageCount?: number | null;
  chunks: CoverageChunk[];
  images?: CoverageImage[];
}) {
  const sortedChunks = [...args.chunks].sort((a, b) => a.chunk_index - b.chunk_index);
  const pagesWithChunks = Array.from(
    new Set(sortedChunks.map((chunk) => chunk.page_number).filter((page): page is number => Number.isFinite(page))),
  ).sort((a, b) => a - b);
  const expectedPages = Array.from({ length: Math.max(0, Number(args.pageCount ?? 0)) }, (_, index) => index + 1);
  const missingPages = expectedPages.length > 0 ? expectedPages.filter((page) => !pagesWithChunks.includes(page)) : [];
  const contentCharacters = sortedChunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  const sectionHeadings = Array.from(new Set(sortedChunks.map((chunk) => chunk.section_heading).filter(Boolean)));

  return {
    chunk_count: sortedChunks.length,
    image_count: args.images?.length ?? 0,
    content_character_count: contentCharacters,
    pages_with_chunks: pagesWithChunks,
    page_coverage_count: pagesWithChunks.length,
    expected_page_count: expectedPages.length || null,
    missing_page_numbers: missingPages,
    has_complete_page_chunk_coverage: expectedPages.length === 0 || missingPages.length === 0,
    section_heading_count: sectionHeadings.length,
    section_headings_sample: sectionHeadings.slice(0, 40),
  };
}

export function selectCoverageAwarePromptChunks(chunks: CoverageChunk[], maxChunks = 36) {
  const sorted = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index || a.id.localeCompare(b.id));
  if (sorted.length <= maxChunks) return { chunks: sorted, strategy: "all_chunks" };

  const byHeading = uniqueById(
    sorted.filter((chunk) => chunk.section_heading || /^\d{1,2}\.?\s+[A-Z]/.test(chunk.content.trim())),
  ).slice(0, Math.ceil(maxChunks * 0.25));
  const highYield = uniqueById(
    sorted
      .map((chunk) => ({ chunk, score: chunkScore(chunk) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.chunk_index - b.chunk.chunk_index || a.chunk.id.localeCompare(b.chunk.id))
      .map((item) => item.chunk),
  ).slice(0, Math.ceil(maxChunks * 0.45));
  const spread = spreadPick(sorted, Math.max(6, maxChunks - byHeading.length - highYield.length));
  const selected = uniqueById([...spread, ...byHeading, ...highYield])
    .sort((a, b) => a.chunk_index - b.chunk_index || a.id.localeCompare(b.id))
    .slice(0, maxChunks);

  return { chunks: selected, strategy: "coverage_spread_high_yield_headings" };
}

export function buildCoveragePromptNote(args: {
  profile: ReturnType<typeof buildIndexingCoverageProfile>;
  selectedChunkIds: string[];
}) {
  const omitted = Math.max(0, args.profile.chunk_count - args.selectedChunkIds.length);
  return [
    `Coverage: ${args.profile.chunk_count} indexed chunks across ${args.profile.page_coverage_count} page(s); ${args.profile.image_count} searchable image/table item(s).`,
    args.profile.has_complete_page_chunk_coverage
      ? "Page-to-chunk coverage is complete for the indexed document page count."
      : `Missing page chunk coverage: ${args.profile.missing_page_numbers.slice(0, 30).join(", ")}.`,
    omitted > 0
      ? `Prompt excerpts are coverage-selected from the full stored index; ${omitted} chunk(s) remain indexed and retrievable through search/citations.`
      : "All indexed chunks are included in this enrichment prompt.",
  ].join("\n");
}

export function compactPromptChunk(content: string) {
  return compactText(content, 1400);
}
