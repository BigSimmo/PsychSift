import { describe, expect, it, vi } from "vitest";
import { amendClosedCmeEntry, rowToCmeEntry, saveCmeEntry } from "@/lib/cme/repository";

const owner = "11111111-1111-4111-8111-111111111111";
const year = "22222222-2222-4222-8222-222222222222";
const initial = {
  id: "33333333-3333-4333-8333-333333333333",
  activity_date: "2026-05-01",
  title: "Synthetic learning activity",
  reflection: "Original reflection",
  cost_cents: null,
  routine_id: null,
  document_id: null,
  source_url: null,
  buckets: ["Ethical practice"],
  formal_peer_review_hours: 0,
  transcribed_at: null as string | null,
  archived_at: null as string | null,
  cme_allocations: [{ category: "educational" as const, hours: 2 }],
};

function storedVersion(row: typeof initial) {
  return {
    id: row.id,
    date: row.activity_date,
    title: row.title,
    reflection: row.reflection,
    costCents: row.cost_cents,
    routineId: row.routine_id,
    documentId: row.document_id,
    sourceUrl: row.source_url,
    buckets: row.buckets,
    formalPeerReviewHours: row.formal_peer_review_hours,
    transcribed: row.transcribed_at !== null,
    archived: row.archived_at !== null,
    allocations: [...row.cme_allocations].sort((a, b) => a.category.localeCompare(b.category)),
  };
}

// This fake distinguishes the vulnerable unversioned boundary from the new DB contract.
// Real PostgreSQL lock schedules are verified separately by the controller.
function actors() {
  let row = structuredClone(initial);
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const body = args.p_entry as Record<string, unknown>;
    if (args.p_owner_id !== owner) return { data: null, error: { message: "cme_entry_not_found" } };
    if (args.p_year_id !== undefined && args.p_year_id !== year)
      return { data: null, error: { message: "cme_year_not_confirmed" } };
    if (name.endsWith("_v2") && JSON.stringify(body.expectedVersion) !== JSON.stringify(storedVersion(row)))
      return { data: null, error: { message: "cme_entry_conflict" } };
    row = { ...row, title: body.title as string, reflection: body.reflection as string };
    return { data: structuredClone(row), error: null };
  });
  return {
    client: { rpc },
    read: () => rowToCmeEntry(structuredClone(row), row.cme_allocations),
    mutate: (change: Partial<typeof initial>) => {
      row = { ...row, ...change };
    },
    row: () => row,
  };
}

describe("CPD full-record edits use the version the editor loaded", () => {
  it("preserves the first actor's reflection when a second actor submits an older full record", async () => {
    const db = actors();
    const first = db.read();
    const second = db.read();
    await saveCmeEntry(db.client as never, owner, year, { ...first, reflection: "First actor's saved reflection" });
    await expect(
      saveCmeEntry(db.client as never, owner, year, { ...second, title: "Second actor's title" }),
    ).rejects.toMatchObject({ status: 409, details: { code: "cme_entry_conflict" } });
    expect(db.row()).toMatchObject({ title: initial.title, reflection: "First actor's saved reflection" });
  });

  it.each([
    { transcribed_at: "2026-05-02T00:00:00Z" },
    { archived_at: "2026-05-02T00:00:00Z" },
    { cme_allocations: [{ category: "educational" as const, hours: 3 }] },
    { activity_date: "2027-05-01" },
  ])("rejects a full editor after an alternate mutation: %j", async (change) => {
    const db = actors();
    const editor = db.read();
    db.mutate(change);
    await expect(
      saveCmeEntry(db.client as never, owner, year, { ...editor, title: "Stale replacement" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.row().title).toBe(initial.title);
  });

  it("rejects a stale amendment before adding another full replacement", async () => {
    const db = actors();
    const editor = db.read();
    db.mutate({ reflection: "A later recorded amendment" });
    await expect(
      amendClosedCmeEntry(db.client as never, owner, editor, "Synthetic correction reason"),
    ).rejects.toMatchObject({ status: 409, details: { code: "cme_entry_conflict" } });
    expect(db.row().reflection).toBe("A later recorded amendment");
  });

  it("requires a loaded version for edits and amendments before issuing writes", async () => {
    const db = actors();
    const withoutVersion = { ...db.read(), version: undefined };
    await expect(saveCmeEntry(db.client as never, owner, year, withoutVersion)).rejects.toMatchObject({ status: 409 });
    await expect(
      amendClosedCmeEntry(db.client as never, owner, withoutVersion, "Synthetic correction"),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.client.rpc).not.toHaveBeenCalled();
  });

  it.each(["save", "amend"])("fails closed when the %s migration is unavailable", async (operation) => {
    const db = actors();
    db.client.rpc.mockResolvedValue({ data: null, error: { message: "RPC missing", code: "PGRST202" } } as never);
    const promise =
      operation === "save"
        ? saveCmeEntry(db.client as never, owner, year, db.read())
        : amendClosedCmeEntry(db.client as never, owner, db.read(), "Synthetic correction");
    await expect(promise).rejects.toMatchObject({ status: 503 });
    expect(db.client.rpc).toHaveBeenCalledTimes(1);
    expect(db.client.rpc.mock.calls[0]?.[0]).toBe(
      operation === "save" ? "cme_save_entry_v2" : "cme_amend_closed_entry_v2",
    );
  });

  it("binds the current owner and target year independently of the content version", async () => {
    const db = actors();
    await expect(saveCmeEntry(db.client as never, "another-owner", year, db.read())).rejects.toMatchObject({
      status: 404,
    });
    await expect(saveCmeEntry(db.client as never, owner, "another-year", db.read())).rejects.toMatchObject({
      status: 400,
    });
    expect(db.row()).toEqual(initial);
  });
});
