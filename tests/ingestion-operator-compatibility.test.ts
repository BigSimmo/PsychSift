import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  allowRead: false,
  imports: [] as string[],
  reads: [] as string[],
  loadEnv: vi.fn(),
  effects: vi.fn(() => {
    throw new Error("unexpected mutation/provider");
  }),
}));
function dependency(name: string) {
  harness.imports.push(name);
  if (!harness.allowRead) throw new Error(`early operational import: ${name}`);
}
vi.mock("@next/env", () => ({ loadEnvConfig: harness.loadEnv }));
vi.mock("@/lib/env", () => {
  dependency("env");
  return { requireServerEnv: vi.fn(), requireOpenAIEnv: vi.fn() };
});
vi.mock("@/lib/openai", () => {
  dependency("openai");
  return { embedTexts: harness.effects };
});
vi.mock("@/lib/document-enrichment", () => {
  dependency("enrichment");
  return {
    ragEnrichmentVersion: "test",
    assertSourceAnchoredSummaryPreflight: harness.effects,
    upsertDocumentEnrichment: harness.effects,
  };
});
vi.mock("@/lib/deep-memory", () => {
  dependency("deep-memory");
  return { ragDeepMemoryVersion: "test", upsertDocumentDeepMemory: harness.effects };
});
vi.mock("@/lib/document-index-units", () => {
  dependency("index-units");
  return { documentIntelligenceVersion: "test" };
});
vi.mock("@/lib/supabase/health", () => {
  dependency("health");
  return {
    assertSupabaseHealthy: vi.fn(),
    probeSupabaseHealth: async () => {
      harness.reads.push("health");
      return {};
    },
  };
});
vi.mock("@/lib/supabase/admin", () => {
  dependency("admin");
  const query: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
  };
  for (const method of ["select", "eq", "order", "limit", "range", "not", "is", "or", "in"])
    query[method] = () => query;
  for (const method of ["insert", "update", "upsert", "delete"]) query[method] = harness.effects;
  return {
    createAdminClient: () => ({
      from: (table: string) => {
        harness.reads.push(table);
        return query;
      },
      rpc: harness.effects,
      storage: harness.effects,
      auth: harness.effects,
    }),
  };
});

beforeEach(() => {
  vi.resetModules();
  harness.allowRead = false;
  harness.imports.length = 0;
  harness.reads.length = 0;
  harness.effects.mockClear();
  harness.loadEnv.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("actual unleased operator entry points", () => {
  it("imports all commands without environment loading, logging, exit or operational imports", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("unexpected exit");
    });
    await import("../scripts/backfill-smart-index");
    await import("../scripts/enrich-documents");
    await import("../scripts/archive/backfill-enrichment");
    expect(harness.imports).toEqual([]);
    expect(harness.loadEnv).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
  it.each([[], ["--confirm"], ["--metadata-only"], ["--confirm", "--metadata-only"]].map((flags) => ({ flags })))(
    "refuses index write flags %j before effects",
    async ({ flags }) => {
      const { main } = await import("../scripts/backfill-smart-index");
      await expect(main(["--all-owners", "--write", ...flags])).rejects.toMatchObject({
        code: "ingestion_attempt_required",
      });
      expect(harness.imports).toEqual([]);
      expect(harness.reads).toEqual([]);
    },
  );
  it.each(["summaries-labels-images", "deep-memory", "metadata-stamp"])(
    "refuses enrichment mode %s before effects",
    async (mode) => {
      const { main } = await import("../scripts/enrich-documents");
      await expect(main(["--mode", mode, "--owner-email", "synthetic@example.invalid"])).rejects.toMatchObject({
        code: "ingestion_attempt_required",
      });
      expect(harness.imports).toEqual([]);
    },
  );
  it("refuses archived default before health or imports", async () => {
    const { main } = await import("../scripts/archive/backfill-enrichment");
    await expect(main([])).rejects.toMatchObject({ code: "ingestion_attempt_required" });
    expect(harness.imports).toEqual([]);
  });
  it("keeps actual index inspection read-only", async () => {
    harness.allowRead = true;
    const { main } = await import("../scripts/backfill-smart-index");
    await main(["--all-owners", "--metadata-only"]);
    expect(harness.reads).toEqual(["documents"]);
    expect(harness.effects).not.toHaveBeenCalled();
  });
  it("keeps actual archived explicit dry run read-only", async () => {
    harness.allowRead = true;
    const { main } = await import("../scripts/archive/backfill-enrichment");
    await main(["--dry-run"]);
    expect(harness.reads).toEqual(["health", "documents"]);
    expect(harness.effects).not.toHaveBeenCalled();
  });
});
