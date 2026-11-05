import { describe, expect, it, vi } from "vitest";
import {
  IngestionMaintenanceConflict,
  patchMaintenanceDocument,
  replaceMaintenanceArtifacts,
  commitMaintenanceDeepMemory,
  type MaintenanceDocument,
} from "@/lib/ingestion-maintenance";

function fixture() {
  let row = {
    id: "doc",
    owner_id: "owner",
    updated_at: "A",
    metadata: { index_generation_id: "gen-A", worker_key: "A" },
    image_count: 4,
  };
  const client = {
    from: () => {
      const filters: Array<[string, unknown]> = [];
      let patch: Record<string, unknown> = {};
      const query = {
        update(value: Record<string, unknown>) {
          patch = value;
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return query;
        },
        is(key: string, value: unknown) {
          filters.push([key, value]);
          return query;
        },
        select() {
          return query;
        },
        async maybeSingle() {
          const current = { ...row, index_generation_id: row.metadata.index_generation_id };
          if (!filters.every(([key, value]) => current[key as keyof typeof current] === value))
            return { data: null, error: null };
          row = { ...row, ...patch, updated_at: `${row.updated_at}+` } as typeof row;
          return { data: { updated_at: row.updated_at, metadata: row.metadata }, error: null };
        },
      };
      return query;
    },
  };
  const snapshot = structuredClone(row) as MaintenanceDocument;
  return {
    client: client as never,
    snapshot,
    read: () => row,
    replace: (patch: Partial<typeof row>) => {
      row = { ...row, ...patch };
    },
  };
}

describe("maintenance document snapshot fence", () => {
  it("rejects a worker B commit without rewinding generation, metadata or counts", async () => {
    const f = fixture();
    f.replace({ updated_at: "B", metadata: { index_generation_id: "gen-B", worker_key: "B" }, image_count: 12 });
    await expect(
      patchMaintenanceDocument({
        supabase: f.client,
        document: f.snapshot,
        patch: { enrichment_status: "completed" },
        imageCount: 1,
      }),
    ).rejects.toBeInstanceOf(IngestionMaintenanceConflict);
    expect(f.read()).toMatchObject({
      updated_at: "B",
      image_count: 12,
      metadata: { index_generation_id: "gen-B", worker_key: "B" },
    });
    expect(f.snapshot.updated_at).toBe("A");
  });
  it("rejects same-generation competing metadata and owner changes", async () => {
    for (const patch of [{ updated_at: "A2" }, { owner_id: "other" }]) {
      const f = fixture();
      f.replace(patch);
      await expect(
        patchMaintenanceDocument({ supabase: f.client, document: f.snapshot, patch: { enrichment_status: "failed" } }),
      ).rejects.toBeInstanceOf(IngestionMaintenanceConflict);
      expect(f.read().metadata).not.toHaveProperty("enrichment_status");
    }
  });
  it("advances only its own returned snapshot for subsequent progress/completion writes", async () => {
    const f = fixture();
    for (const stage of ["processing", "completed"])
      await patchMaintenanceDocument({ supabase: f.client, document: f.snapshot, patch: { enrichment_status: stage } });
    expect(f.snapshot.updated_at).toBe("A++");
    expect(f.read().metadata).toMatchObject({
      index_generation_id: "gen-A",
      worker_key: "A",
      enrichment_status: "completed",
    });
  });
  it("refuses generation mutation and snapshots missing their original version", async () => {
    const f = fixture();
    await expect(
      patchMaintenanceDocument({ supabase: f.client, document: f.snapshot, patch: { index_generation_id: "bad" } }),
    ).rejects.toThrow("cannot change");
    f.snapshot.updated_at = "";
    await expect(
      patchMaintenanceDocument({ supabase: f.client, document: f.snapshot, patch: {} }),
    ).rejects.toBeInstanceOf(IngestionMaintenanceConflict);
  });
});

describe("maintenance artifact transaction dispatch", () => {
  it("submits the original identity and snapshot in one RPC, then advances only its own returned snapshot", async () => {
    const f = fixture();
    const rpc = vi.fn().mockResolvedValue({
      data: { updated_at: "A+", metadata: { ...(f.snapshot.metadata as object), own_key: true } },
      error: null,
    });
    await replaceMaintenanceArtifacts({
      supabase: { rpc } as never,
      document: f.snapshot,
      operation: "labels",
      payload: { labels: [] },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("replace_document_maintenance_artifacts", {
      p_document_id: "doc",
      p_owner_id: "owner",
      p_expected_updated_at: "A",
      p_expected_generation_id: "gen-A",
      p_operation: "labels",
      p_payload: { labels: [] },
    });
    expect(f.snapshot.updated_at).toBe("A+");
  });
  it("does not refresh a rejected or uncertain snapshot and never attempts compensation", async () => {
    for (const result of [
      { data: null, error: { message: "maintenance_snapshot_conflict" } },
      { data: null, error: null },
    ]) {
      const f = fixture();
      const rpc = vi.fn().mockResolvedValue(result);
      await expect(
        replaceMaintenanceArtifacts({
          supabase: { rpc } as never,
          document: f.snapshot,
          operation: "visual",
          payload: {},
        }),
      ).rejects.toThrow();
      expect(f.snapshot.updated_at).toBe("A");
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });
  it("refuses managed evidence before dispatching either legacy mutation", async () => {
    const f = fixture();
    f.snapshot.metadata = { admission_event_id: "managed", index_generation_id: "gen-A" };
    const rpc = vi.fn();
    await expect(
      replaceMaintenanceArtifacts({
        supabase: { rpc } as never,
        document: f.snapshot,
        operation: "labels",
        payload: {},
      }),
    ).rejects.toThrow("fenced worker");
    await expect(
      commitMaintenanceDeepMemory({ supabase: { rpc } as never, document: f.snapshot, payload: {} }),
    ).rejects.toThrow("fenced worker");
    expect(rpc).not.toHaveBeenCalled();
  });
});
