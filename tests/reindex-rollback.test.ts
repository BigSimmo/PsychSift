import { describe, expect, it, vi } from "vitest";

import {
  applyRollbackPlans,
  collectCommittedGenerations,
  planReindexRollback,
  parseRollbackArgs,
  ROLLBACK_APPLY_ACK_FLAG,
  runReindexRollback,
  type CommittedGeneration,
  type RollbackScope,
  type RollbackStore,
} from "../src/lib/reindex-rollback";

const DOC_A = "00000000-0000-4000-8000-00000000000a";
const DOC_B = "00000000-0000-4000-8000-00000000000b";
const DOC_C = "00000000-0000-4000-8000-00000000000c";

type MemoryDocument = {
  current: string | null;
  generations: CommittedGeneration[];
  chunks: Record<string, number>;
  chunkerVersions?: Record<string, string[]>;
};

function memoryStore(documents: Record<string, MemoryDocument>) {
  const repoint = vi.fn(async (documentId: string, expected: string, target: string) => {
    const document = documents[documentId];
    if (!document || document.current !== expected) return { ok: false, reason: "pointer_moved" };
    document.current = target;
    return { ok: true };
  });
  const store: RollbackStore = {
    async *candidateDocumentIds(scope: RollbackScope) {
      yield* scope.kind === "documents" ? scope.documentIds : Object.keys(documents);
    },
    async currentGeneration(documentId) {
      return documents[documentId]?.current ?? null;
    },
    async committedGenerations(documentId) {
      return documents[documentId]?.generations ?? [];
    },
    async chunkCount(documentId, generationId) {
      return documents[documentId]?.chunks[generationId] ?? 0;
    },
    async chunkerVersions(documentId, generationId) {
      return documents[documentId]?.chunkerVersions?.[generationId] ?? [];
    },
    repoint,
  };
  return { store, repoint, documents };
}

const twoGenerations = (): MemoryDocument => ({
  current: "gen-new",
  generations: [
    { generationId: "gen-old", committedAt: "2026-10-01T00:00:00.000Z" },
    { generationId: "gen-new", committedAt: "2026-10-21T06:00:00.000Z" },
  ],
  chunks: { "gen-old": 12, "gen-new": 15 },
  chunkerVersions: { "gen-new": ["1.3.1-page"], "gen-old": ["1.3.0-page"] },
});

describe("reindex rollback", () => {
  it("is a dry run by default and reports current vs previous generation with chunk counts", async () => {
    const { store, repoint, documents } = memoryStore({ [DOC_A]: twoGenerations() });
    const [outcome] = await runReindexRollback(store, { kind: "documents", documentIds: [DOC_A] });
    expect(repoint).not.toHaveBeenCalled();
    expect(documents[DOC_A].current).toBe("gen-new");
    expect(outcome).toMatchObject({
      currentGeneration: "gen-new",
      currentChunks: 15,
      previousGeneration: "gen-old",
      previousChunks: 12,
      refusal: null,
      applied: false,
    });
  });

  it("repoints to the previous generation only with apply", async () => {
    const { store, repoint, documents } = memoryStore({ [DOC_A]: twoGenerations() });
    const [outcome] = await runReindexRollback(store, { kind: "documents", documentIds: [DOC_A] }, { apply: true });
    expect(repoint).toHaveBeenCalledWith(DOC_A, "gen-new", "gen-old");
    expect(outcome.applied).toBe(true);
    expect(documents[DOC_A].current).toBe("gen-old");
  });

  it("refuses when there is no previous committed generation", async () => {
    const { store, repoint } = memoryStore({
      [DOC_A]: {
        current: "gen-new",
        generations: [{ generationId: "gen-new", committedAt: "2026-10-21T06:00:00.000Z" }],
        chunks: { "gen-new": 15 },
      },
    });
    const [outcome] = await runReindexRollback(store, { kind: "documents", documentIds: [DOC_A] }, { apply: true });
    expect(outcome.refusal).toBe("no_previous_generation");
    expect(repoint).not.toHaveBeenCalled();
  });

  it("refuses when the previous generation has no chunks", async () => {
    const document = twoGenerations();
    document.chunks["gen-old"] = 0;
    const { store, repoint } = memoryStore({ [DOC_A]: document });
    const [outcome] = await runReindexRollback(store, { kind: "documents", documentIds: [DOC_A] }, { apply: true });
    expect(outcome.refusal).toBe("previous_generation_has_no_chunks");
    expect(repoint).not.toHaveBeenCalled();
  });

  it("reports an RPC refusal as a failed apply", async () => {
    const { store, repoint } = memoryStore({ [DOC_A]: twoGenerations() });
    repoint.mockResolvedValueOnce({ ok: false, reason: "ingestion_in_progress" });
    const [outcome] = await runReindexRollback(store, { kind: "documents", documentIds: [DOC_A] }, { apply: true });
    expect(outcome).toMatchObject({ applied: false, applyError: "ingestion_in_progress" });
  });

  it("scopes by committed-after on the current generation's commit time", async () => {
    const older = twoGenerations();
    older.generations[1].committedAt = "2026-10-10T00:00:00.000Z";
    const { store } = memoryStore({ [DOC_A]: twoGenerations(), [DOC_B]: older });
    const outcomes = await runReindexRollback(store, { kind: "committed-after", after: "2026-10-20T00:00:00.000Z" });
    expect(outcomes.map((outcome) => outcome.documentId)).toEqual([DOC_A]);
  });

  it("scopes by the current generation's chunker version", async () => {
    const other = twoGenerations();
    other.chunkerVersions = { "gen-new": ["1.3.0-page"] };
    const { store, repoint } = memoryStore({ [DOC_A]: twoGenerations(), [DOC_C]: other });
    const outcomes = await runReindexRollback(
      store,
      { kind: "chunker-version", chunkerVersion: "1.3.1-page" },
      { apply: true },
    );
    expect(outcomes.map((outcome) => outcome.documentId)).toEqual([DOC_A]);
    expect(repoint).toHaveBeenCalledTimes(1);
  });

  it("scopes by document IDs and respects the limit", async () => {
    const { store } = memoryStore({ [DOC_A]: twoGenerations(), [DOC_B]: twoGenerations() });
    const outcomes = await runReindexRollback(store, { kind: "documents", documentIds: [DOC_A, DOC_B] }, { limit: 1 });
    expect(outcomes.map((outcome) => outcome.documentId)).toEqual([DOC_A]);
  });
});

describe("parseRollbackArgs", () => {
  it("defaults to dry run and accepts comma-separated document IDs", () => {
    const args = parseRollbackArgs(["--document-id", `${DOC_A},${DOC_B}`]);
    expect(args.apply).toBe(false);
    expect(args.scope).toEqual({ kind: "documents", documentIds: [DOC_A, DOC_B] });
  });

  it("needs exactly one valid scope", () => {
    expect(() => parseRollbackArgs([])).toThrow(/exactly one scope/);
    expect(() => parseRollbackArgs(["--document-id", DOC_A, "--chunker-version", "1.3.1-page"])).toThrow(
      /exactly one scope/,
    );
    expect(() => parseRollbackArgs(["--document-id", "not-a-uuid"])).toThrow(/Not a document UUID/);
    expect(() => parseRollbackArgs(["--committed-after", "yesterday"])).toThrow(/Not a timestamp/);
  });

  it("refuses --apply without the metadata-not-restored acknowledgement", () => {
    expect(() => parseRollbackArgs(["--document-id", DOC_A, "--apply"])).toThrow(
      /documents\.metadata and document_index_quality.*#3732/,
    );
    expect(() => parseRollbackArgs(["--document-id", DOC_A, "--apply", "--yes"])).toThrow(/Refusing --apply/);
  });

  it("allows --apply with the acknowledgement flag", () => {
    const args = parseRollbackArgs(["--document-id", DOC_A, "--apply", ROLLBACK_APPLY_ACK_FLAG]);
    expect(args.apply).toBe(true);
  });

  it("does not need the acknowledgement for a dry run", () => {
    expect(parseRollbackArgs(["--document-id", DOC_A]).apply).toBe(false);
  });

  it("parses committed-after and apply", () => {
    const args = parseRollbackArgs(["--committed-after=2026-10-21T00:00:00Z", "--apply", ROLLBACK_APPLY_ACK_FLAG, "--yes"]);
    expect(args).toMatchObject({
      apply: true,
      yes: true,
      scope: { kind: "committed-after", after: "2026-10-21T00:00:00.000Z" },
    });
  });

  it("applies the document limit after the exact scope filter", async () => {
    const outOfScope = (): MemoryDocument => ({
      ...twoGenerations(),
      chunkerVersions: { "gen-new": ["1.3.0-page"], "gen-old": ["1.3.1-page"] },
    });
    const { store } = memoryStore({ [DOC_A]: outOfScope(), [DOC_B]: outOfScope(), [DOC_C]: twoGenerations() });
    const plans = await planReindexRollback(store, { kind: "chunker-version", chunkerVersion: "1.3.1-page" }, 1);
    expect(plans.map((plan) => plan.documentId)).toEqual([DOC_C]);
  });

  it("stops pulling candidates once the limit of in-scope documents is reached", async () => {
    const { store } = memoryStore({ [DOC_A]: twoGenerations(), [DOC_B]: twoGenerations(), [DOC_C]: twoGenerations() });
    const plans = await planReindexRollback(store, { kind: "chunker-version", chunkerVersion: "1.3.1-page" }, 2);
    expect(plans.map((plan) => plan.documentId)).toEqual([DOC_A, DOC_B]);
  });

  it("collects committed generations across every page of rows", async () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => ({
        index_generation_id: "gen-new",
        created_at: `2026-10-21T06:00:0${i}.000Z`,
      })),
      { index_generation_id: null, created_at: "2026-10-02T00:00:00.000Z" },
      { index_generation_id: "gen-old", created_at: "2026-10-01T00:00:00.000Z" },
    ];
    const loadPage = vi.fn(async (from: number, to: number) => rows.slice(from, to + 1));
    const generations = await collectCommittedGenerations(loadPage, 2);
    expect(loadPage).toHaveBeenCalledTimes(4);
    expect(generations).toEqual([
      { generationId: "gen-new", committedAt: "2026-10-21T06:00:00.000Z" },
      { generationId: "gen-old", committedAt: "2026-10-01T00:00:00.000Z" },
    ]);
  });

  it("applies the previewed plan and fails closed when the pointer moved after preview", async () => {
    const { store, repoint, documents } = memoryStore({ [DOC_A]: twoGenerations() });
    const preview = await runReindexRollback(store, { kind: "documents", documentIds: [DOC_A] });
    // A newer generation commits while the operator reads the prompt.
    documents[DOC_A].current = "gen-newer";
    documents[DOC_A].generations.push({ generationId: "gen-newer", committedAt: "2026-10-21T07:00:00.000Z" });
    documents[DOC_A].chunks["gen-newer"] = 9;
    const [outcome] = await applyRollbackPlans(store, preview);
    expect(repoint).toHaveBeenCalledWith(DOC_A, "gen-new", "gen-old");
    expect(outcome).toMatchObject({ applied: false, applyError: "pointer_moved" });
    expect(documents[DOC_A].current).toBe("gen-newer");
  });
});
