import { describe, expect, it } from "vitest";
import { nonNullDocumentIds, partitionStorageCleanupJobs, withoutReferencedPaths } from "@/lib/storage-cleanup-safety";

describe("withoutReferencedPaths (audit F-09)", () => {
  it("never returns a path a live image row still points at", () => {
    const referenced = new Set(["doc/lease/g2/live.png"]);
    expect(withoutReferencedPaths(["doc/lease/g1/old.png", "doc/lease/g2/live.png"], referenced)).toEqual([
      "doc/lease/g1/old.png",
    ]);
  });

  it("drops empty and duplicate paths", () => {
    expect(withoutReferencedPaths(["a.png", "", "a.png", "b.png"], new Set())).toEqual(["a.png", "b.png"]);
  });

  it("returns nothing when every queued path is still referenced", () => {
    expect(withoutReferencedPaths(["a.png"], new Set(["a.png"]))).toEqual([]);
  });
});

describe("partitionStorageCleanupJobs (audit R11)", () => {
  const job = (id: string, document_id: string | null) => ({ id, document_id });

  it("skips ledger rows whose document still exists (aborted delete)", () => {
    const jobs = [job("j1", "doc-alive"), job("j2", "doc-gone"), job("j3", null)];
    const live = new Set(["doc-alive"]);
    const { safe, skipped } = partitionStorageCleanupJobs(jobs, live);
    expect(skipped.map((j) => j.id)).toEqual(["j1"]);
    expect(safe.map((j) => j.id)).toEqual(["j2", "j3"]);
  });

  it("treats a null document_id as a genuinely-deleted document (safe to process)", () => {
    const { safe, skipped } = partitionStorageCleanupJobs([job("j1", null)], new Set(["anything"]));
    expect(skipped).toHaveLength(0);
    expect(safe.map((j) => j.id)).toEqual(["j1"]);
  });

  it("processes rows whose document_id no longer resolves (FK should have nulled it, but be permissive)", () => {
    const { safe } = partitionStorageCleanupJobs([job("j1", "doc-gone")], new Set());
    expect(safe.map((j) => j.id)).toEqual(["j1"]);
  });

  it("collects distinct non-null document ids for the liveness probe", () => {
    const ids = nonNullDocumentIds([job("j1", "a"), job("j2", "a"), job("j3", null), job("j4", "b")]);
    expect(ids.sort()).toEqual(["a", "b"]);
  });
});
