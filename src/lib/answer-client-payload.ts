import type { RagAnswer, SearchResult } from "@/lib/types";

// Route-boundary trim of the answer payload. The retrieval pipeline carries
// full chunk text plus server-only context on every source (adjacent_context
// for generation packing, memory cards, table facts, index-unit matches,
// document summaries), but the client renders only a snippet
// (retrieval_synopsis ?? content) plus identity, scoring, governance, and
// label fields. Trimming at the route boundary — never inside rag.ts — keeps
// caches, generation inputs, and eval behavior byte-identical while cutting
// the final SSE/JSON event the user waits on after the prose has streamed.
//
// Ordering contract: source-governance/safety derivation and diagnostics consume
// the FULL answer and must run before this trim (both routes do). The browser
// receives only the same bounded snippet the source UI renders; explicit
// server-derived safetyWarnings preserve findings beyond that display window.

const clientSourceSnippetMaxChars = 900;

const sourceFieldPolicy = {
  id: "client",
  document_id: "client",
  title: "client",
  file_name: "client",
  page_number: "client",
  chunk_index: "client",
  section_heading: "client",
  section_path: "client",
  heading_level: "client",
  parent_heading: "client",
  anchor_id: "client",
  content: "client",
  retrieval_synopsis: "client",
  image_ids: "client",
  similarity: "client",
  similarity_origin: "client",
  text_rank: "client",
  hybrid_score: "client",
  lexical_score: "client",
  rrf_score: "client",
  score_explanation: "client",
  source_strength: "client",
  source_metadata: "client",
  document_labels: "client",
  document_summary: "server",
  adjacent_context: "server",
  memory_cards: "server",
  memory_score: "client",
  relevance: "client",
  match_explanation: "client",
  table_facts: "server",
  index_unit: "server",
  indexing_quality: "client",
  images: "server",
} as const satisfies Record<keyof SearchResult, "client" | "server">;

/** Exported for the verified evidence preview (#100), which must cross the route
 * boundary through the exact same trim as the final payload — never a copy of it. */
export function trimSourceForClient(source: SearchResult): SearchResult {
  const trimmed = Object.fromEntries(
    (Object.keys(sourceFieldPolicy) as Array<keyof SearchResult>)
      .filter((key) => sourceFieldPolicy[key] === "client" && key in source)
      .map((key) => [key, source[key]]),
  ) as SearchResult;
  const renderedSnippet = (source.retrieval_synopsis ?? source.content ?? "").trim();
  trimmed.content =
    renderedSnippet.length <= clientSourceSnippetMaxChars
      ? renderedSnippet
      : `${renderedSnippet.slice(0, clientSourceSnippetMaxChars - 1).trimEnd()}…`;
  if (source.retrieval_synopsis != null) trimmed.retrieval_synopsis = trimmed.content;
  // Full image/table objects remain available to generation and diagnostics,
  // but the answer UI resolves source media from the bounded image_ids list.
  trimmed.images = [];
  return trimmed;
}

export function toClientAnswerPayload<T extends Pick<RagAnswer, "sources">>(answer: T): T {
  // Programme diagnostics belong to the two server-side telemetry owners. Keep
  // them out of JSON/SSE payloads without changing legacy answer identity when
  // the diagnostic attachment is absent.
  const clientAnswer =
    "programmeDiagnostics" in answer
      ? (({ programmeDiagnostics: _programmeDiagnostics, ...rest }) => rest)(
          answer as T & Pick<RagAnswer, "programmeDiagnostics">,
        )
      : answer;
  if (!clientAnswer.sources?.length) return clientAnswer as T;
  return { ...clientAnswer, sources: clientAnswer.sources.map(trimSourceForClient) } as T;
}
