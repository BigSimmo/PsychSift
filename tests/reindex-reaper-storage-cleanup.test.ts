import { describe, expect, it } from "vitest";
import {
  buildAbandonedGenerationStorageCleanupJobs,
  clampAbandonedCleanupLimit,
  filterReapableAbandonedGenerations,
  DEFAULT_ABANDONED_CLEANUP_LIMIT,
  MAX_ABANDONED_CLEANUP_LIMIT,
} from "../src/lib/reindex-pipeline";

describe("reindex reaper storage cleanup and safety guards (#RP00FZ)", () => {
  describe("clampAbandonedCleanupLimit", () => {
    it("returns default limit when input is undefined, null, NaN, or non-positive", () => {
      expect(clampAbandonedCleanupLimit(undefined)).toBe(DEFAULT_ABANDONED_CLEANUP_LIMIT);
      expect(clampAbandonedCleanupLimit(null)).toBe(DEFAULT_ABANDONED_CLEANUP_LIMIT);
      expect(clampAbandonedCleanupLimit("")).toBe(DEFAULT_ABANDONED_CLEANUP_LIMIT);
      expect(clampAbandonedCleanupLimit(0)).toBe(DEFAULT_ABANDONED_CLEANUP_LIMIT);
      expect(clampAbandonedCleanupLimit(-10)).toBe(DEFAULT_ABANDONED_CLEANUP_LIMIT);
      expect(clampAbandonedCleanupLimit("invalid")).toBe(DEFAULT_ABANDONED_CLEANUP_LIMIT);
    });

    it("respects valid numbers within the ceiling", () => {
      expect(clampAbandonedCleanupLimit(50)).toBe(50);
      expect(clampAbandonedCleanupLimit("250")).toBe(250);
      expect(clampAbandonedCleanupLimit(MAX_ABANDONED_CLEANUP_LIMIT)).toBe(MAX_ABANDONED_CLEANUP_LIMIT);
    });

    it("clamps values exceeding MAX_ABANDONED_CLEANUP_LIMIT", () => {
      expect(clampAbandonedCleanupLimit(501)).toBe(MAX_ABANDONED_CLEANUP_LIMIT);
      expect(clampAbandonedCleanupLimit(10000)).toBe(MAX_ABANDONED_CLEANUP_LIMIT);
      expect(clampAbandonedCleanupLimit("9999")).toBe(MAX_ABANDONED_CLEANUP_LIMIT);
    });

    it("supports a custom max ceiling parameter", () => {
      expect(clampAbandonedCleanupLimit(150, 75)).toBe(75);
    });
  });

  describe("filterReapableAbandonedGenerations", () => {
    it("skips legacy documents where metadata.index_generation_id is absent", () => {
      const candidates = [
        { generationId: "gen-1", createdAt: "2026-10-01T00:00:00Z" },
        { generationId: "gen-2", createdAt: "2026-10-02T00:00:00Z" },
      ];

      // Missing or empty metadata.index_generation_id
      expect(filterReapableAbandonedGenerations(candidates, { metadata: {} })).toEqual([]);
      expect(filterReapableAbandonedGenerations(candidates, { metadata: null })).toEqual([]);
      expect(filterReapableAbandonedGenerations(candidates, { committedGeneration: null })).toEqual([]);
      expect(
        filterReapableAbandonedGenerations({ metadata: { index_generation_id: "" }, generations: candidates }),
      ).toEqual([]);
    });

    it("preserves the committed generation and the newest non-committed generation", () => {
      const candidates = [
        { generationId: "gen-committed", createdAt: "2026-10-01T00:00:00Z" },
        { generationId: "gen-abandoned-1", createdAt: "2026-10-02T00:00:00Z" },
        { generationId: "gen-abandoned-2", createdAt: "2026-10-03T00:00:00Z" },
        { generationId: "gen-in-flight", createdAt: "2026-10-04T00:00:00Z" },
      ];

      const reapable = filterReapableAbandonedGenerations(candidates, {
        committedGeneration: "gen-committed",
      });

      // gen-committed is excluded
      // gen-in-flight (newest non-committed) is preserved
      // gen-abandoned-1 and gen-abandoned-2 are reapable
      expect(reapable).toHaveLength(2);
      expect(reapable.map((r) => r.generationId)).toEqual(["gen-abandoned-1", "gen-abandoned-2"]);
    });

    it("preserves single staged generation because it could be in flight or uncommitted", () => {
      const candidates = [
        { generationId: "gen-committed", createdAt: "2026-10-01T00:00:00Z" },
        { generationId: "gen-staged-single", createdAt: "2026-10-02T00:00:00Z" },
      ];

      const reapable = filterReapableAbandonedGenerations(candidates, {
        committedGeneration: "gen-committed",
      });

      expect(reapable).toEqual([]);
    });

    it("works with string array generations", () => {
      const reapable = filterReapableAbandonedGenerations({
        committedGeneration: "gen-1",
        generations: ["gen-1", "gen-2", "gen-3"],
      });
      // gen-3 is newest, gen-1 is committed -> gen-2 is reapable
      expect(reapable).toEqual(["gen-2"]);
    });
  });

  describe("buildAbandonedGenerationStorageCleanupJobs", () => {
    it("excludes legacy documents without metadata.index_generation_id", () => {
      const jobs = buildAbandonedGenerationStorageCleanupJobs({
        documentId: "doc-legacy",
        documentMetadata: {}, // no index_generation_id
        ownerId: "owner-1",
        imageRows: [
          { storage_path: "owner-1/images/img1.png", index_generation_id: "gen-1" },
          { storage_path: "owner-1/images/img2.png", index_generation_id: "gen-2" },
        ],
      });

      expect(jobs).toEqual([]);
    });

    it("enqueues orphaned storage objects for abandoned generations while never enqueueing objects belonging to committed or newest staged generation", () => {
      const imageRows = [
        // Committed generation image
        {
          storage_path: "owner-1/images/committed.png",
          index_generation_id: "gen-committed",
          created_at: "2026-10-01T00:00:00Z",
        },
        // Shared image between committed and abandoned (must NOT be deleted!)
        {
          storage_path: "owner-1/images/shared-with-committed.png",
          index_generation_id: "gen-committed",
          created_at: "2026-10-01T00:00:00Z",
        },
        {
          storage_path: "owner-1/images/shared-with-committed.png",
          index_generation_id: "gen-abandoned-old",
          created_at: "2026-10-02T00:00:00Z",
        },
        // Old abandoned generation image (eligible for cleanup)
        {
          storage_path: "owner-1/images/orphaned-1.png",
          index_generation_id: "gen-abandoned-old",
          created_at: "2026-10-02T00:00:00Z",
        },
        // Duplicate path in abandoned generation (must be deduplicated)
        {
          storage_path: "owner-1/images/orphaned-1.png",
          index_generation_id: "gen-abandoned-mid",
          created_at: "2026-10-03T00:00:00Z",
        },
        // Mid abandoned generation image (eligible for cleanup)
        {
          storage_path: "owner-1/images/orphaned-2.png",
          index_generation_id: "gen-abandoned-mid",
          created_at: "2026-10-03T00:00:00Z",
        },
        // Newest staged generation image (in flight/uncommitted — must be preserved!)
        {
          storage_path: "owner-1/images/in-flight.png",
          index_generation_id: "gen-newest-staged",
          created_at: "2026-10-04T00:00:00Z",
        },
        // Shared image between newest staged and abandoned (must NOT be deleted!)
        {
          storage_path: "owner-1/images/shared-with-in-flight.png",
          index_generation_id: "gen-abandoned-old",
          created_at: "2026-10-02T00:00:00Z",
        },
        {
          storage_path: "owner-1/images/shared-with-in-flight.png",
          index_generation_id: "gen-newest-staged",
          created_at: "2026-10-04T00:00:00Z",
        },
      ];

      const jobs = buildAbandonedGenerationStorageCleanupJobs({
        documentId: "doc-1",
        documentMetadata: { index_generation_id: "gen-committed" },
        ownerId: "owner-1",
        imageRows,
      });

      expect(jobs).toHaveLength(1);
      const job = jobs[0];

      // document_id is null so the live-document delete-abort guard does not skip it
      expect(job.document_id).toBe(null);
      expect(job.owner_id).toBe("owner-1");
      expect(job.status).toBe("pending");
      expect(job.image_bucket).toBe("clinical-images");
      expect(job.document_bucket).toBe("clinical-documents");

      // Verify exact paths:
      // - "orphaned-1.png" and "orphaned-2.png" are included and deduplicated.
      // - "committed.png" is excluded (committed generation).
      // - "shared-with-committed.png" is excluded (referenced by committed).
      // - "in-flight.png" is excluded (newest staged generation).
      // - "shared-with-in-flight.png" is excluded (referenced by newest staged).
      expect(job.image_paths).toEqual(["owner-1/images/orphaned-1.png", "owner-1/images/orphaned-2.png"]);

      expect(job.metadata).toMatchObject({
        operation: "abandoned_reindex_generation_storage_cleanup",
        document_id: "doc-1",
        abandoned_generations: ["gen-abandoned-mid", "gen-abandoned-old"],
        reaped_paths_count: 2,
      });
    });

    it("returns empty array when there is only one staged generation (preserved as in flight)", () => {
      const jobs = buildAbandonedGenerationStorageCleanupJobs({
        documentId: "doc-2",
        documentMetadata: { index_generation_id: "gen-committed" },
        ownerId: "owner-1",
        imageRows: [
          { storage_path: "owner-1/images/committed.png", index_generation_id: "gen-committed" },
          { storage_path: "owner-1/images/only-staged.png", index_generation_id: "gen-staged-1" },
        ],
      });

      expect(jobs).toEqual([]);
    });

    it("returns empty array when all abandoned paths are shared with committed or in-flight generation", () => {
      const jobs = buildAbandonedGenerationStorageCleanupJobs({
        documentId: "doc-3",
        documentMetadata: { index_generation_id: "gen-committed" },
        ownerId: "owner-1",
        imageRows: [
          { storage_path: "owner-1/images/shared.png", index_generation_id: "gen-committed" },
          { storage_path: "owner-1/images/shared.png", index_generation_id: "gen-abandoned" },
          { storage_path: "owner-1/images/staged.png", index_generation_id: "gen-staged" },
        ],
      });

      expect(jobs).toEqual([]);
    });
  });
});
