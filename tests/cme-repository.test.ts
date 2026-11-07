import { describe, expect, it, vi } from "vitest";

import { PublicApiError } from "@/lib/http";
import {
  CME_MAX_ENTRIES,
  assertValidCmeLinkedIds,
  cmeEntryToRow,
  cmeRepositoryError,
  clearCmeEntryTranscribed,
  fetchOwnerCmeEntries,
  fetchOwnerCmeYear,
  fetchOwnerCmeYears,
  insertCmeEntry,
  rowToCmeEntry,
} from "@/lib/cme/repository";
import type { CmeEntry } from "@/lib/cme/types";
import { cmeEntryVersion, withoutCmeEntryVersions } from "@/lib/cme/entry-version";

describe("row mapping", () => {
  it("round-trips an entry with several allocations", () => {
    const entry = {
      id: "11111111-1111-4111-8111-111111111111",
      date: "2026-09-11",
      title: "Peer review group — September",
      allocations: [
        { category: "reviewing" as const, hours: 1 },
        { category: "measuring" as const, hours: 0.5 },
      ],
      reflection: "Brought two cases to the group.",
      costCents: null,
      transcribed: false,
      routineId: null,
      documentId: null,
      buckets: [],
    };
    const row = cmeEntryToRow(entry, "owner-1", "year-1");
    expect(row.activity_date).toBe("2026-09-11");
    expect(row.owner_id).toBe("owner-1");
    expect(
      rowToCmeEntry(
        { ...row, id: entry.id },
        entry.allocations.map((a) => ({ category: a.category, hours: a.hours })),
      ),
    ).toEqual({ ...entry, version: cmeEntryVersion(entry) });
  });

  it("drops edit versions from display-only lists and keeps every other field", () => {
    const entry = { ...baseEntry(), evidenceCount: 2 };
    const versioned = { ...entry, version: cmeEntryVersion(entry) };
    expect(withoutCmeEntryVersions([versioned, entry])).toEqual([entry, entry]);
    expect(withoutCmeEntryVersions(undefined)).toBeUndefined();
  });

  it("carries a cost through as whole cents, never a float", () => {
    const row = cmeEntryToRow({ ...baseEntry(), costCents: 124_000 }, "owner-1", "year-1");
    expect(row.cost_cents).toBe(124_000);
    expect(Number.isInteger(row.cost_cents)).toBe(true);
  });

  it("round-trips transcribed:true, a non-null cost, and a non-empty buckets array", () => {
    // The two tests above only ever exercise transcribed:false, costCents:null and
    // buckets:[] — the falsy/empty branch of every one of those fields. This proves the
    // other branch: cmeEntryToRow stamps a transcribed_at instant, and rowToCmeEntry reads
    // it, the cost and the buckets back out unchanged.
    const entry = {
      id: "44444444-4444-4444-8444-444444444444",
      date: "2026-09-18",
      title: "CPD conference",
      allocations: [{ category: "measuring" as const, hours: 3 }],
      reflection: "Attended remotely.",
      costCents: 4_500,
      transcribed: true,
      routineId: null,
      documentId: null,
      buckets: ["conference", "external"],
    };
    const row = cmeEntryToRow(entry, "owner-1", "year-1");
    expect(row.transcribed_at).not.toBeNull();
    expect(row.cost_cents).toBe(4_500);
    expect(row.buckets).toEqual(["conference", "external"]);

    const result = rowToCmeEntry(
      { ...row, id: entry.id },
      entry.allocations.map((a) => ({ category: a.category, hours: a.hours })),
    );
    expect(result).toEqual({ ...entry, version: cmeEntryVersion(entry) });
  });
});

function baseEntry() {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    date: "2026-08-22",
    title: "WA Branch training day",
    allocations: [{ category: "educational" as const, hours: 6 }],
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
  };
}

// --- fake client -----------------------------------------------------------
//
// A real supabase-js query builder is thenable: awaiting it after any chain of
// filter/modifier calls resolves to { data, error }. Each `.from(table)` call gets its
// own chain (mirroring the real client, which builds a fresh query per call) so a
// function that queries several tables — or the same table twice, such as
// insertCmeEntry's cleanup delete — can be driven with a distinct queued response per
// call while every filter call it made stays inspectable afterwards.

type FakeResponse = { data: unknown; error: { message: string } | null };

function makeChain(response: FakeResponse) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    single: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
      return Promise.resolve({ ...response, count: Array.isArray(response.data) ? response.data.length : null }).then(
        resolve,
        reject,
      );
    },
  };
  return chain;
}

function fakeClient(responsesByTable: Record<string, FakeResponse[]>) {
  const calls: Array<{ table: string; chain: ReturnType<typeof makeChain> }> = [];
  const queues = new Map(Object.entries(responsesByTable).map(([table, rows]) => [table, [...rows]]));
  const from = vi.fn((table: string) => {
    const queue = queues.get(table);
    if (!queue || queue.length === 0) {
      throw new Error(`fakeClient: no queued response left for table "${table}"`);
    }
    const chain = makeChain(queue.shift()!);
    calls.push({ table, chain });
    return chain;
  });
  return { from, calls };
}

const YEAR_ROW = {
  id: "year-1",
  owner_id: "owner-1",
  year: 2026,
  total_hours: 50,
  confirmed_on: "2026-01-01",
  confirmed_source: "college handbook",
  closed_at: null,
  shortfall_note: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("undo a copied CPD entry", () => {
  const savedRow = {
    id: "22222222-2222-4222-8222-222222222222",
    activity_date: "2026-09-15",
    title: "Journal club",
    reflection: "A useful discussion.",
    cost_cents: null,
    transcribed_at: "2026-09-15T12:00:00.000Z",
    routine_id: null,
    document_id: null,
    buckets: [],
    cme_allocations: [{ category: "educational", hours: 1 }],
  };
  const confirmedRequirement = {
    id: "minimum",
    label: "Minimum CPD",
    source: "national",
    spec: { shape: "task" },
    completed_on: null,
    sort_order: 0,
  };

  it("clears only the copied time on owner-scoped entry queries", async () => {
    const client = fakeClient({
      cme_entries: [
        { data: savedRow, error: null },
        { data: { ...savedRow, transcribed_at: null }, error: null },
      ],
      cme_years: [{ data: YEAR_ROW, error: null }],
      cme_requirements: [{ data: [confirmedRequirement], error: null }],
    });
    const entry = await clearCmeEntryTranscribed(client as never, "owner-1", savedRow.id);
    expect(entry.transcribed).toBe(false);
    expect(entry.title).toBe(savedRow.title);
    for (const query of client.calls.filter(({ table }) => table === "cme_entries")) {
      expect(query.chain.eq).toHaveBeenCalledWith("id", savedRow.id);
      expect(query.chain.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    }
    expect(client.calls.at(-1)?.chain.update).toHaveBeenCalledWith({ transcribed_at: null });
  });

  it("returns the same not-found result for a missing or other-owner entry without updating", async () => {
    const client = fakeClient({ cme_entries: [{ data: null, error: null }] });
    await expect(clearCmeEntryTranscribed(client as never, "owner-1", savedRow.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(client.calls[0].chain.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(client.calls[0].chain.update).not.toHaveBeenCalled();
  });

  it("refuses to clear a copied time without an owner", async () => {
    const client = fakeClient({});
    await expect(clearCmeEntryTranscribed(client as never, "", savedRow.id)).rejects.toThrow(/ownerId/);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("fetchOwnerCmeYear", () => {
  it("filters cme_years by owner_id and year on the same chain as from()", async () => {
    // The owner predicate rides the same chain as .from() — the only thing
    // npm run check:owner-scope can prove, and the only real protection RLS leaves in
    // application code for these tables. Asserting the mock was called with it, not just
    // that a result came back, is the point of this test.
    const client = fakeClient({
      cme_years: [{ data: YEAR_ROW, error: null }],
      cme_requirements: [{ data: [], error: null }],
    });
    await fetchOwnerCmeYear(client as never, "owner-1", 2026);
    expect(client.calls[0].table).toBe("cme_years");
    expect(client.calls[0].chain.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(client.calls[0].chain.eq).toHaveBeenCalledWith("year", 2026);
  });

  it("filters the cme_requirements read by owner_id and year_id on the same chain as from()", async () => {
    const client = fakeClient({
      cme_years: [{ data: YEAR_ROW, error: null }],
      cme_requirements: [{ data: [], error: null }],
    });
    await fetchOwnerCmeYear(client as never, "owner-1", 2026);
    expect(client.calls[1].table).toBe("cme_requirements");
    expect(client.calls[1].chain.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(client.calls[1].chain.eq).toHaveBeenCalledWith("year_id", YEAR_ROW.id);
  });

  it("applies CME_MAX_ENTRIES as a .limit() on the requirements read", async () => {
    const client = fakeClient({
      cme_years: [{ data: YEAR_ROW, error: null }],
      cme_requirements: [{ data: [], error: null }],
    });
    await fetchOwnerCmeYear(client as never, "owner-1", 2026);
    expect(client.calls[1].chain.limit).toHaveBeenCalledWith(CME_MAX_ENTRIES);
  });

  it("refuses to run without an owner rather than returning another tenant's year", async () => {
    const client = fakeClient({});
    await expect(fetchOwnerCmeYear(client as never, "", 2026)).rejects.toThrow(/owner/i);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("returns null and never queries cme_requirements when no year row exists yet", async () => {
    const client = fakeClient({
      cme_years: [{ data: null, error: null }],
    });
    const result = await fetchOwnerCmeYear(client as never, "owner-1", 2026);
    expect(result).toBeNull();
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].table).toBe("cme_years");
  });
});

describe("fetchOwnerCmeYears", () => {
  it("returns only owner-scoped years in descending order", async () => {
    const client = fakeClient({
      cme_years: [{ data: [{ id: "year-2026", year: 2026 }], error: null }],
    });
    await expect(fetchOwnerCmeYears(client as never, "owner-1")).resolves.toEqual([{ id: "year-2026", year: 2026 }]);
    expect(client.calls[0].chain.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(client.calls[0].chain.order).toHaveBeenCalledWith("year", { ascending: false });
    expect(client.calls[0].chain.limit).toHaveBeenCalledWith(102);
  });

  it("refuses to query years without an owner", async () => {
    const client = fakeClient({});
    await expect(fetchOwnerCmeYears(client as never, "")).rejects.toThrow(/ownerId/);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("fetchOwnerCmeEntries", () => {
  it("filters by owner_id and year_id on the same chain as from()", async () => {
    const client = fakeClient({ cme_entries: [{ data: [], error: null }] });
    await fetchOwnerCmeEntries(client as never, "owner-1", "year-1");
    expect(client.calls[0].table).toBe("cme_entries");
    expect(client.calls[0].chain.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(client.calls[0].chain.eq).toHaveBeenCalledWith("year_id", "year-1");
  });

  it("applies CME_MAX_ENTRIES as a .limit()", async () => {
    const client = fakeClient({ cme_entries: [{ data: [], error: null }] });
    await fetchOwnerCmeEntries(client as never, "owner-1", "year-1");
    expect(client.calls[0].chain.limit).toHaveBeenCalledWith(CME_MAX_ENTRIES + 1);
  });

  it("refuses to run without an owner rather than returning another tenant's entries", async () => {
    const client = fakeClient({});
    await expect(fetchOwnerCmeEntries(client as never, "", "year-1")).rejects.toThrow(/owner/i);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("maps each row's joined cme_allocations onto the returned entry", async () => {
    const client = fakeClient({
      cme_entries: [
        {
          data: [
            {
              id: "e1",
              activity_date: "2026-09-01",
              title: "Grand round",
              reflection: "",
              cost_cents: null,
              transcribed_at: null,
              routine_id: null,
              document_id: null,
              buckets: [],
              cme_allocations: [{ category: "educational", hours: 2 }],
            },
          ],
          error: null,
        },
      ],
    });
    const entries = await fetchOwnerCmeEntries(client as never, "owner-1", "year-1");
    expect(entries).toHaveLength(1);
    expect(entries[0].allocations).toEqual([{ category: "educational", hours: 2 }]);
  });
});

describe("insertCmeEntry", () => {
  const ENTRY: CmeEntry = {
    id: "33333333-3333-4333-8333-333333333333",
    date: "2026-09-15",
    title: "Journal club",
    allocations: [
      { category: "educational", hours: 2 },
      { category: "reviewing", hours: 1 },
    ],
    reflection: "Discussed a new RCT.",
    costCents: 5_000,
    transcribed: true,
    routineId: null,
    documentId: null,
    buckets: ["journal-club"],
  };

  function entryRowResponse(overrides: Record<string, unknown> = {}): FakeResponse {
    return {
      data: {
        id: ENTRY.id,
        owner_id: "owner-1",
        year_id: "year-1",
        activity_date: ENTRY.date,
        title: ENTRY.title,
        reflection: ENTRY.reflection,
        cost_cents: ENTRY.costCents,
        transcribed_at: "2026-09-15T00:00:00.000Z",
        routine_id: null,
        document_id: null,
        buckets: ENTRY.buckets,
        ...overrides,
      },
      error: null,
    };
  }

  it("refuses to run without an owner rather than writing another tenant's record", async () => {
    const client = fakeClient({});
    await expect(insertCmeEntry(client as never, "", "year-1", ENTRY)).rejects.toThrow(/owner/i);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects zero allocations before touching the database", async () => {
    const client = fakeClient({});
    const entry = { ...ENTRY, allocations: [] };
    const promise = insertCmeEntry(client as never, "owner-1", "year-1", entry);
    await expect(promise).rejects.toThrow(PublicApiError);
    await expect(promise).rejects.toMatchObject({ status: 400 });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects two allocations sharing a category before touching the database", async () => {
    const client = fakeClient({});
    const entry = {
      ...ENTRY,
      allocations: [
        { category: "educational" as const, hours: 1 },
        { category: "educational" as const, hours: 2 },
      ],
    };
    const promise = insertCmeEntry(client as never, "owner-1", "year-1", entry);
    await expect(promise).rejects.toThrow(PublicApiError);
    await expect(promise).rejects.toMatchObject({ status: 400 });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("sends one owner-scoped transaction for entry and allocations", async () => {
    const response = entryRowResponse({ cme_allocations: ENTRY.allocations });
    const client = { rpc: vi.fn().mockResolvedValue(response), from: vi.fn() };
    const result = await insertCmeEntry(client as never, "owner-1", "year-1", ENTRY, "request-1");
    expect(client.rpc).toHaveBeenCalledWith(
      "cme_save_entry_v2",
      expect.objectContaining({
        p_owner_id: "owner-1",
        p_year_id: "year-1",
        p_entry_id: ENTRY.id,
        p_create: true,
        p_request_id: "request-1",
        p_entry: expect.objectContaining({ allocations: ENTRY.allocations }),
      }),
    );
    expect(client.from).not.toHaveBeenCalled();
    expect(result.allocations).toEqual(ENTRY.allocations);
  });
  it("rejects transaction failure without issuing compensating writes", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "allocation insert failed" } }),
      from: vi.fn(),
    };
    await expect(insertCmeEntry(client as never, "owner-1", "year-1", ENTRY)).rejects.toThrow(
      "CME storage operation failed.",
    );
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalled();
  });
  it("maps retry conflicts safely and retains the same request identity", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "cme_retry_conflict" } }) };
    await expect(insertCmeEntry(client as never, "owner-1", "year-1", ENTRY, "same-request")).rejects.toMatchObject({
      status: 409,
    });
    expect(client.rpc.mock.calls[0][1].p_request_id).toBe("same-request");
  });
});

describe("assertValidCmeLinkedIds", () => {
  const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
  const ROUTINE_ID = "55555555-5555-4555-8555-555555555555";

  it("does not query when nothing is linked", async () => {
    const client = fakeClient({});
    await assertValidCmeLinkedIds(client as never, "owner-1", { routineId: null, documentId: null });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("refuses to run without an owner", async () => {
    const client = fakeClient({});
    await expect(
      assertValidCmeLinkedIds(client as never, "", { routineId: ROUTINE_ID, documentId: DOCUMENT_ID }),
    ).rejects.toThrow(/owner/i);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("accepts a document and routine the caller owns, filtering both lookups by owner", async () => {
    const client = fakeClient({
      documents: [{ data: { id: DOCUMENT_ID }, error: null }],
      cme_routines: [{ data: { id: ROUTINE_ID }, error: null }],
    });
    await assertValidCmeLinkedIds(client as never, "owner-1", { routineId: ROUTINE_ID, documentId: DOCUMENT_ID });
    for (const call of client.calls) {
      expect(call.chain.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    }
    expect(client.calls.map((call) => call.table)).toEqual(["documents", "cme_routines"]);
  });

  it("rejects another owner's document with a 400 validation error, the same as a missing one", async () => {
    // The owner-filtered lookup finds nothing for a foreign id, exactly as for a missing id,
    // so the response cannot be used to learn whether another owner's document exists.
    const client = fakeClient({ documents: [{ data: null, error: null }] });
    const promise = assertValidCmeLinkedIds(client as never, "owner-1", { routineId: null, documentId: DOCUMENT_ID });
    await expect(promise).rejects.toThrow(PublicApiError);
    await expect(promise).rejects.toMatchObject({ status: 400 });
    expect(client.calls[0].chain.eq).toHaveBeenCalledWith("owner_id", "owner-1");
  });

  it("rejects another owner's routine with a 400 validation error", async () => {
    const client = fakeClient({ cme_routines: [{ data: null, error: null }] });
    const promise = assertValidCmeLinkedIds(client as never, "owner-1", { routineId: ROUTINE_ID, documentId: null });
    await expect(promise).rejects.toThrow(PublicApiError);
    await expect(promise).rejects.toMatchObject({ status: 400 });
    expect(client.calls[0].chain.eq).toHaveBeenCalledWith("owner_id", "owner-1");
  });

  it("maps the database's own link refusal to the same 400 validation error", () => {
    // cme_save_entry re-checks both links inside its transaction and raises cme_invalid_link,
    // closing the gap between this pre-check and the write.
    const error = cmeRepositoryError({ message: "cme_invalid_link" });
    expect(error).toBeInstanceOf(PublicApiError);
    expect(error).toMatchObject({ status: 400 });
  });
});
