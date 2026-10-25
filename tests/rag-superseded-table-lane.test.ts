/**
 * Owner rule #BFCTST: a superseded source is never used as evidence. The table-row lane used to
 * merge its rows without that check, so an outdated threshold row could reach Search and the
 * typeahead, and could satisfy the early-stop coverage gate before current guidance was looked for
 * (audit RET-N1, 24 Oct 2026). Offline: Supabase and OpenAI are mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type Status = "current" | "outdated";

const document = (status: Status) => ({
  id: "clozapine-doc",
  title: "Clozapine Prescribing Administration Monitoring",
  file_name: "CG.MHSP.ClozapinePresAdminMonitor.pdf",
  owner_id: null,
  status: "indexed",
  index_generation_id: null,
  metadata: { document_status: status, clinical_validation_status: "approved", extraction_quality: "good" },
});

const chunk = (status: Status) => ({
  id: "clozapine-table-chunk",
  document_id: "clozapine-doc",
  page_number: 11,
  chunk_index: 4,
  section_heading: "Blood monitoring thresholds",
  section_path: [],
  content:
    "ANC below 1.5 x10^9/L: withhold clozapine and repeat FBC daily. ANC 1.5 to 2.0: continue with twice weekly FBC.",
  image_ids: [],
  index_generation_id: null,
  documents: document(status),
});

const tableFact = {
  id: "fact-1",
  document_id: "clozapine-doc",
  source_chunk_id: "clozapine-table-chunk",
  source_image_id: null,
  page_number: 11,
  table_title: "Clozapine blood monitoring",
  row_label: "ANC below 1.5",
  clinical_parameter: "ANC",
  threshold_value: "< 1.5",
  action: "withhold clozapine",
  text_rank: 0.9,
};

async function searchWithTableRow(status: Status) {
  vi.resetModules();
  vi.stubEnv("RAG_PROVIDER_MODE", "offline");
  vi.stubEnv("RAG_SEARCH_CACHE_TTL_MS", "0");

  const rows: Record<string, unknown[]> = {
    document_chunks: [chunk(status)],
    documents: [document(status)],
  };
  class Query implements PromiseLike<{ data: unknown[]; error: null }> {
    constructor(private readonly table: string) {}
    select() {
      return this;
    }
    in() {
      return this;
    }
    eq() {
      return this;
    }
    neq() {
      return this;
    }
    range() {
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    is() {
      return this;
    }
    or() {
      return this;
    }
    abortSignal() {
      return this;
    }
    maybeSingle() {
      return this;
    }
    then<TResult1 = { data: unknown[]; error: null }>(
      onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    ): PromiseLike<TResult1> {
      return Promise.resolve({ data: rows[this.table] ?? [], error: null }).then(onfulfilled);
    }
  }
  const rpc = vi.fn(async (name: string) => {
    if (name.startsWith("match_document_table_facts_text")) return { data: [tableFact], error: null };
    return { data: [], error: null };
  });
  const client = { rpc, from: vi.fn((table: string) => new Query(table)) };
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
  vi.doMock("@/lib/openai", () => ({
    embedTextWithTelemetry: vi.fn(),
    generateStructuredTextResult: vi.fn(),
  }));

  const { searchChunksWithTelemetry } = await import("../src/lib/rag/rag");
  const search = await searchChunksWithTelemetry({
    query: "clozapine ANC threshold to withhold",
    ownerId: undefined,
    skipCache: true,
    lexicalOnly: true,
  });
  return { ids: search.results.map((result) => result.id), rpc };
}

afterEach(() => {
  vi.doUnmock("@/lib/supabase/admin");
  vi.doUnmock("@/lib/openai");
  vi.restoreAllMocks();
  (globalThis as { [key: symbol]: Map<string, unknown> | undefined })[Symbol.for("psychsift.ragAliasCache")]?.clear();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("table-row lane honours the superseded-source rule (RET-N1)", () => {
  it("returns a current document's table row (control: the lane is exercised)", async () => {
    const { ids, rpc } = await searchWithTableRow("current");
    expect(rpc.mock.calls.some(([name]) => String(name).startsWith("match_document_table_facts_text"))).toBe(true);
    expect(ids).toContain("clozapine-table-chunk");
  });

  it("never returns a superseded document's table row", async () => {
    const { ids } = await searchWithTableRow("outdated");
    expect(ids).not.toContain("clozapine-table-chunk");
  });
});
