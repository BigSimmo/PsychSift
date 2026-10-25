import { describe, expect, it, vi } from "vitest";
import {
  activeScopeFilterCount,
  extractionQualityValues,
  resolveSearchScope,
  searchScopeFiltersSchema,
  sourceStatusValues,
  validationStatusValues,
} from "@/lib/search-scope";

type QueryCall = {
  table: string;
  selected?: string;
  range?: { from: number; to: number };
  filters: Array<{ column: string; value: unknown }>;
  inFilters: Array<{ column: string; values: unknown[] }>;
  orders: string[];
  /** The raw PostgREST `or=` strings. Previously discarded, which is precisely
      why a mangled enum clause could ship green — nothing asserted what was
      actually sent to the database. */
  orFilters: string[];
  abortSignals: AbortSignal[];
};

type QueryResult = { data: unknown[]; error: { message: string } | null };
type QueryResolver = (call: QueryCall) => QueryResult;

class QueryBuilder implements PromiseLike<QueryResult> {
  constructor(
    private readonly call: QueryCall,
    private readonly resolver: QueryResolver,
  ) {}

  select(selected: string) {
    this.call.selected = selected;
    return this;
  }

  eq(column: string, value: unknown) {
    this.call.filters.push({ column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.call.filters.push({ column, value });
    return this;
  }

  or(filter: string) {
    this.call.orFilters.push(filter);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.call.inFilters.push({ column, values });
    return this;
  }

  order(column: string) {
    this.call.orders.push(column);
    return this;
  }

  range(from: number, to: number) {
    this.call.range = { from, to };
    return this;
  }

  abortSignal(signal: AbortSignal) {
    this.call.abortSignals.push(signal);
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolver(this.call)).then(onfulfilled, onrejected);
  }
}

function supabaseMock(resolver: QueryResolver) {
  const calls: QueryCall[] = [];
  return {
    calls,
    from: vi.fn((table: string) => {
      const call: QueryCall = {
        table,
        filters: [],
        inFilters: [],
        orders: [],
        orFilters: [],
        abortSignals: [],
      };
      calls.push(call);
      return new QueryBuilder(call, resolver);
    }),
  };
}

describe("search scope filters", () => {
  it("paginates label enumeration beyond the PostgREST 1,000-row cap", async () => {
    const documentIds = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
    const documents = documentIds.map((id) => ({ id, metadata: {}, import_batch_id: null }));
    const labels = Array.from({ length: 1_001 }, (_, index) => ({
      id: String(index).padStart(4, "0"),
      document_id: index === 1_000 ? documentIds[1] : documentIds[0],
      label: index === 1_000 ? "target-service" : `other-service-${index}`,
      label_type: "service",
    }));
    const requestedRanges: Array<[string, number, number]> = [];
    const requestedOrders: Array<[string, string, boolean]> = [];

    const from = (table: string) => {
      let start = 0;
      let end = 999;
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        in: () => builder,
        or: () => builder,
        order: (column: string, options?: { ascending?: boolean }) => {
          requestedOrders.push([table, column, options?.ascending !== false]);
          return builder;
        },
        abortSignal: () => builder,
        range: (nextStart: number, nextEnd: number) => {
          start = nextStart;
          end = nextEnd;
          requestedRanges.push([table, start, end]);
          return builder;
        },
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
          const rows = table === "documents" ? documents : labels;
          return Promise.resolve(resolve({ data: rows.slice(start, end + 1), error: null }));
        },
      };
      return builder;
    };

    await expect(
      resolveSearchScope({
        supabase: { from } as never,
        accessScope: { includePublic: true },
        filters: { services: ["target-service"] },
      }),
    ).resolves.toMatchObject({ documentIds: [documentIds[1]], matchedDocumentCount: 1 });
    expect(requestedRanges.filter(([table]) => table === "document_labels")).toEqual([
      ["document_labels", 0, 999],
      ["document_labels", 1_000, 1_999],
    ]);
    // loadScopeLabels uses a stable composite order, then id, on every page.
    expect(requestedOrders.filter(([table]) => table === "document_labels")).toEqual([
      ["document_labels", "document_id", true],
      ["document_labels", "label_type", true],
      ["document_labels", "label", true],
      ["document_labels", "id", true],
      ["document_labels", "document_id", true],
      ["document_labels", "label_type", true],
      ["document_labels", "label", true],
      ["document_labels", "id", true],
    ]);
  });

  it("accepts smart document label filter groups", () => {
    const filters = searchScopeFiltersSchema.parse({
      services: ["mental-health"],
      settings: ["inpatient"],
      populations: ["youth"],
      risks: ["high-risk-medication"],
      clinicalActions: ["monitor"],
      carePhases: ["discharge-planning"],
      documentIntents: ["medication-instruction"],
      contentFeatures: ["contains-monitoring-schedule"],
    });

    expect(filters).toMatchObject({
      services: ["mental-health"],
      settings: ["inpatient"],
      populations: ["youth"],
      risks: ["high-risk-medication"],
      clinicalActions: ["monitor"],
      carePhases: ["discharge-planning"],
      documentIntents: ["medication-instruction"],
      contentFeatures: ["contains-monitoring-schedule"],
    });
    expect(activeScopeFilterCount(filters)).toBe(8);
  });

  it("accepts label-type-any filters used by mode-default scopes", () => {
    const filters = searchScopeFiltersSchema.parse({ labelTypesAny: ["service"] });

    expect(filters.labelTypesAny).toEqual(["service"]);
    expect(activeScopeFilterCount(filters)).toBe(1);
  });

  it("rejects unknown label types in labelTypesAny", () => {
    expect(() => searchScopeFiltersSchema.parse({ labelTypesAny: ["not-a-label-type"] })).toThrow();
  });

  /**
   * The owner predicate itself had no test at all, in 469 lines. That matters more here than the
   * usual missing-coverage complaint, because this predicate is safe only by REFERENCE to
   * something outside the file: a null owner is admitted as public without also testing the
   * `public_corpus` marker, and the only reason that is not a tenancy hole is the database
   * constraint `documents_ownerless_requires_publication_marker` plus the `status = 'indexed'`
   * filter, which together make the two definitions equivalent.
   *
   * Nothing said so, in the code or in a test. Someone dropping the status filter as a tidy-up,
   * or reusing this resolver over a table without the constraint, re-opened it silently. These
   * cases pin both halves of that argument to the query the resolver actually sends.
   *
   * Written 2026-09-17 while verifying an external audit, which reported the predicate
   * divergence as a live tenancy defect. It is not -- the database closed it on 2026-09-02 -- but
   * the absence of any test was real.
   */
  describe("owner predicate", () => {
    /** Runs the resolver with one filter, so it reaches the database rather than short-circuiting. */
    async function documentsQueryFor(accessScope: { ownerId?: string; includePublic: boolean }) {
      const supabase = supabaseMock(() => ({ data: [], error: null }));
      await resolveSearchScope({
        supabase: supabase as never,
        accessScope,
        filters: { sourceStatuses: ["current"] },
      });
      const call = supabase.calls.find((entry) => entry.table === "documents");
      expect(call).toBeDefined();
      return call!;
    }

    it("restricts an anonymous reader to ownerless rows", async () => {
      const call = await documentsQueryFor({ includePublic: true });
      expect(call.filters).toContainEqual({ column: "owner_id", value: null });
      expect(call.orFilters.join(" ")).not.toContain("owner_id.eq.");
    });

    it("only ever asks for indexed rows, which is half of why the null-owner test is safe", async () => {
      // The database permits an ownerless row with no publication marker in exactly one state:
      // `status = 'failed'` quarantine. This filter is what excludes it. Drop it and the
      // predicate above stops being equivalent to the two-signal one in public-api-access.ts.
      for (const scope of [
        { includePublic: true },
        { ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", includePublic: true },
        { ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", includePublic: false },
      ]) {
        const call = await documentsQueryFor(scope);
        expect(call.filters).toContainEqual({ column: "status", value: "indexed" });
      }
    });

    it("gives a signed-in reader their own rows and the public ones, and no others", async () => {
      const call = await documentsQueryFor({ ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", includePublic: true });
      expect(call.orFilters).toContain(`owner_id.eq.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa,owner_id.is.null`);
    });

    it("withholds public rows from an owner-scoped reader who did not ask for them", async () => {
      const call = await documentsQueryFor({ ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", includePublic: false });
      expect(call.filters).toContainEqual({ column: "owner_id", value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      expect(call.filters).not.toContainEqual({ column: "owner_id", value: null });
      expect(call.orFilters.join(" ")).not.toContain("owner_id.is.null");
    });

    it("resolves the empty scope to nothing rather than to the whole corpus", async () => {
      // `{ includePublic: false }` with no owner is the shape `retrievalAccessScopeKey` calls
      // "empty". It used to satisfy `publicOnly` and return the entire public corpus -- the exact
      // opposite of what it asks for. Latent, because `resolveRetrievalAccessScope` always sets
      // includePublic, but the fix had to be an explicit refusal: the branch chain has no final
      // `else`, so a scope that merely stopped being `publicOnly` would have gone to the database
      // with NO owner predicate at all and returned every tenant's documents.
      const from = () => {
        throw new Error("an empty access scope must never reach the database");
      };
      await expect(
        resolveSearchScope({ supabase: { from } as never, accessScope: { includePublic: false } }),
      ).resolves.toMatchObject({ documentIds: [], matchedDocumentCount: 0, summary: "No matching documents" });
    });

    it("refuses the empty scope even when filters and explicit ids are supplied", async () => {
      // The refusal is ahead of every other branch on purpose: an empty scope carrying explicit
      // document ids must not be able to buy its way past it.
      const from = () => {
        throw new Error("an empty access scope must never reach the database");
      };
      await expect(
        resolveSearchScope({
          supabase: { from } as never,
          accessScope: { includePublic: false },
          documentIds: ["11111111-1111-4111-8111-111111111111"],
          filters: { sourceStatuses: ["current"] },
        }),
      ).resolves.toMatchObject({ documentIds: [], matchedDocumentCount: 0 });
    });
  });

  it("keeps interstate health services out of the Local filter", async () => {
    const documents = [
      { id: "wa-north", metadata: { publisher: "North Metropolitan Health Service" }, import_batch_id: null },
      { id: "wa-cahs", metadata: { publisher: "Child and Adolescent Health Service" }, import_batch_id: null },
      {
        id: "qld-metro-north",
        metadata: { publisher: "Metro North Hospital and Health Service" },
        import_batch_id: null,
      },
      {
        id: "nsw-hunter",
        metadata: { publisher: "Hunter New England Local Health District Health Service", jurisdiction: "NSW" },
        import_batch_id: null,
      },
    ];
    const scopeFor = async (locality: "local" | "non_local") => {
      const supabase = supabaseMock((call) => ({ data: call.table === "documents" ? documents : [], error: null }));
      const scope = await resolveSearchScope({
        supabase: supabase as never,
        accessScope: { includePublic: true },
        filters: { locality },
      });
      return [...(scope.documentIds ?? [])].sort();
    };
    expect(await scopeFor("local")).toEqual(["wa-cahs", "wa-north"]);
    expect(await scopeFor("non_local")).toEqual(["nsw-hunter", "qld-metro-north"]);
  });

  it("does not enumerate every public document when no filters are requested", async () => {
    const from = () => {
      throw new Error("public all-document scope should be enforced by the retrieval owner sentinel");
    };

    await expect(
      resolveSearchScope({
        supabase: { from } as never,
        accessScope: { includePublic: true },
      }),
    ).resolves.toMatchObject({
      documentIds: undefined,
      activeFilterCount: 0,
      matchedDocumentCount: null,
      summary: "All public documents",
    });
  });

  it("paginates label rows so later-page label matches are not silently dropped", async () => {
    const wantedDocumentId = "22222222-2222-4222-8222-222222222222";
    const supabase = supabaseMock((call) => {
      if (call.table === "documents") {
        return {
          data: [
            { id: "11111111-1111-4111-8111-111111111111", metadata: {}, import_batch_id: null },
            { id: wantedDocumentId, metadata: {}, import_batch_id: null },
          ],
          error: null,
        };
      }
      if (call.table === "document_labels") {
        // Reproduce the Supabase 1,000-row response cap: page 0 is full, page 1 holds the match.
        if (call.range?.from === 0) {
          return {
            data: Array.from({ length: 1000 }, (_, index) => ({
              id: `label-${index.toString().padStart(4, "0")}`,
              document_id: "11111111-1111-4111-8111-111111111111",
              label: "other topic",
              label_type: "topic",
            })),
            error: null,
          };
        }
        return {
          data: [
            {
              id: "label-wanted",
              document_id: wantedDocumentId,
              label: "clozapine",
              label_type: "topic",
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });

    await expect(
      resolveSearchScope({
        supabase: supabase as never,
        accessScope: { ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", includePublic: false },
        filters: { topics: ["clozapine"] },
      }),
    ).resolves.toMatchObject({
      documentIds: [wantedDocumentId],
      matchedDocumentCount: 1,
    });

    const labelCalls = supabase.calls.filter((call) => call.table === "document_labels");
    expect(labelCalls.map((call) => call.range)).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ]);
    expect(labelCalls.every((call) => call.orders.includes("id"))).toBe(true);
    expect(labelCalls.every((call) => call.selected?.includes("id"))).toBe(true);
  });

  it("enumerates more than 1,000 distinct labels across pages without truncation", async () => {
    const documentIds = Array.from({ length: 3 }, (_, index) => `doc-${index.toString().padStart(4, "0")}`);
    const allLabels = Array.from({ length: 1001 }, (_, index) => ({
      id: `label-${index.toString().padStart(4, "0")}`,
      document_id: documentIds[index % documentIds.length]!,
      label: `topic-${index.toString().padStart(4, "0")}`,
      label_type: "topic" as const,
    }));
    const wantedLabel = allLabels[1000]!;

    const supabase = supabaseMock((call) => {
      if (call.table === "documents") {
        return {
          data: documentIds.map((id) => ({ id, metadata: {}, import_batch_id: null })),
          error: null,
        };
      }
      if (call.table === "document_labels") {
        const from = call.range?.from ?? 0;
        const to = call.range?.to ?? from;
        return {
          data: allLabels.slice(from, to + 1),
          error: null,
        };
      }
      return { data: [], error: null };
    });

    await expect(
      resolveSearchScope({
        supabase: supabase as never,
        accessScope: { ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", includePublic: false },
        filters: { topics: [wantedLabel.label] },
      }),
    ).resolves.toMatchObject({
      documentIds: [wantedLabel.document_id],
      matchedDocumentCount: 1,
    });

    const labelCalls = supabase.calls.filter((call) => call.table === "document_labels");
    expect(labelCalls).toHaveLength(2);
    expect(labelCalls.map((call) => call.range)).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ]);
  });

  it("propagates caller cancellation to label scope queries", async () => {
    const controller = new AbortController();
    const supabase = supabaseMock((call) => {
      if (call.table === "documents") {
        return {
          data: [{ id: "11111111-1111-4111-8111-111111111111", metadata: {}, import_batch_id: null }],
          error: null,
        };
      }
      return { data: [], error: null };
    });

    await resolveSearchScope({
      supabase: supabase as never,
      accessScope: { ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", includePublic: false },
      filters: { labelTypesAny: ["topic"] },
      signal: controller.signal,
    });

    const labelCall = supabase.calls.find((call) => call.table === "document_labels");
    expect(labelCall?.abortSignals).toContain(controller.signal);
  });

  it("fails closed when label pagination exceeds the bounded page budget", async () => {
    const supabase = supabaseMock((call) => {
      if (call.table === "documents") {
        return {
          data: [{ id: "11111111-1111-4111-8111-111111111111", metadata: {}, import_batch_id: null }],
          error: null,
        };
      }
      if (call.table === "document_labels") {
        // Always-full pages simulate a stuck API that would otherwise loop forever.
        return {
          data: Array.from({ length: 1000 }, (_, index) => ({
            id: `label-${(call.range?.from ?? 0) + index}`,
            document_id: "11111111-1111-4111-8111-111111111111",
            label: "topic",
            label_type: "topic",
          })),
          error: null,
        };
      }
      return { data: [], error: null };
    });

    await expect(
      resolveSearchScope({
        supabase: supabase as never,
        accessScope: { ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", includePublic: false },
        filters: { topics: ["topic"] },
      }),
    ).rejects.toThrow(/exceeded .* rows for a 1-document batch/i);
  });
});

/**
 * The gate that was missing.
 *
 * `sourceStatuses`/`validationStatuses`/`extractionQualities` are closed enums
 * validated against the exact strings stored in `documents.metadata`. They were
 * passed through `normalizeFilterText` on the way into the SQL clause, which
 * rewrites `[_-]+` to a space — so `review_due` was validated as `review_due`
 * and then matched as `"review due"`, which matches nothing. The catch-all
 * branch could not save those rows either: its `not.in.(…)` list is built from
 * the raw values, so they were excluded there too.
 *
 * On the live corpus that hid 514 `review_due` and ~2,489 `locally_reviewed`
 * documents behind filters that returned a confident, silent zero.
 *
 * These iterate the exported value lists rather than a hand-copied set, so a
 * future value — `pending_review`, `awaiting_sign_off`, anything with a
 * separator — fails here, offline, instead of in front of a clinician.
 */
describe("scope enum filters reach SQL verbatim", () => {
  const emptyDocuments = () => supabaseMock(() => ({ data: [], error: null }));

  async function orClausesFor(filters: Record<string, unknown>) {
    const supabase = emptyDocuments();
    await resolveSearchScope({
      supabase: supabase as never,
      accessScope: { includePublic: true },
      filters: searchScopeFiltersSchema.parse(filters),
    });
    return supabase.calls.filter((call) => call.table === "documents").flatMap((call) => call.orFilters);
  }

  it.each(sourceStatusValues)("sends the source status %s unchanged", async (value) => {
    const clauses = await orClausesFor({ sourceStatuses: [value] });
    expect(clauses.join(" | ")).toContain(`metadata->>document_status.eq.${value}`);
  });

  it.each(validationStatusValues)("sends the validation status %s unchanged", async (value) => {
    const clauses = await orClausesFor({ validationStatuses: [value] });
    expect(clauses.join(" | ")).toContain(`metadata->>clinical_validation_status.eq.${value}`);
  });

  it.each(extractionQualityValues)("sends the extraction quality %s unchanged", async (value) => {
    const clauses = await orClausesFor({ extractionQualities: [value] });
    expect(clauses.join(" | ")).toContain(`metadata->>extraction_quality.eq.${value}`);
  });

  it("never emits a separator-mangled variant of any enum value", async () => {
    const cases = [
      ["sourceStatuses", sourceStatusValues],
      ["validationStatuses", validationStatusValues],
      ["extractionQualities", extractionQualityValues],
    ] as const;
    for (const [key, values] of cases) {
      for (const value of values) {
        if (!/[_-]/.test(value)) continue;
        const clauses = (await orClausesFor({ [key]: [value] })).join(" | ");
        expect(clauses).not.toContain(value.replace(/[_-]+/g, " "));
      }
    }
  });

  it("keeps the fallback branch consistent with the values it excludes", async () => {
    // "unknown"/"unverified" mean "null, or anything outside the known set", so
    // the not.in list must name exactly the values the eq clauses can match. A
    // value spelled one way in the eq clause and another in not.in falls
    // through both — the original defect.
    const clauses = (await orClausesFor({ sourceStatuses: ["unknown"] })).join(" | ");
    expect(clauses).toContain("metadata->>document_status.is.null");
    expect(clauses).toContain(`metadata->>document_status.not.in.(${sourceStatusValues.join(",")})`);
  });

  it("still normalizes free-text label filters, which are prose rather than enums", async () => {
    const supabase = supabaseMock((call) =>
      call.table === "documents"
        ? { data: [{ id: "11111111-1111-4111-8111-111111111111", metadata: {}, import_batch_id: null }], error: null }
        : { data: [], error: null },
    );
    const scope = await resolveSearchScope({
      supabase: supabase as never,
      accessScope: { includePublic: true },
      filters: searchScopeFiltersSchema.parse({ topics: ["Alcohol_Withdrawal"] }),
    });
    // Label values are compared in application code with both sides normalized,
    // so the separator handling there is correct and must not be "fixed" too.
    expect(scope.activeFilterCount).toBe(1);
  });
});
