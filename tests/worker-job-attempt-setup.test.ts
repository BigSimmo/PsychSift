import { rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import type { ExtractedDocument } from "../src/lib/types";
import type { ApprovedAdminSource } from "../worker/admin-source-runtime";
import type { IngestionStageContext } from "../worker/ingestion-stage-context";
import type { WorkerRuntimeOptions } from "../worker/main";
import type { JobRow } from "../worker/types";
import { initializeManagedAdminGeneration } from "../worker/job-attempt-setup";

const mocks = vi.hoisted(() => ({
  extract: vi.fn(),
  pages: vi.fn(),
  capture: vi.fn(),
  packet: vi.fn(),
  chunks: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ rm: vi.fn(async () => undefined) }));
vi.mock("../src/lib/env", () => ({ env: { MAX_UPLOAD_MB: 150 } }));
vi.mock("../src/lib/extractors/document", () => ({ extractDocument: mocks.extract }));
vi.mock("../worker/behavior", () => ({
  buildDocumentPageRowsForPersistence: mocks.pages,
  serializeDocumentPageRowsForCommit: (rows: unknown) => rows,
}));
vi.mock("../worker/generation-evidence", () => ({
  captureGenerationImages: mocks.capture,
  buildGenerationRetentionPacket: mocks.packet,
}));
vi.mock("../worker/managed-admin-text-terminal", () => ({ buildManagedAdminTextChunks: mocks.chunks }));
vi.mock("../worker/managed-provider-vectors", () => ({ deriveManagedProviderEmbeddingRequestContext: vi.fn() }));
vi.mock("../worker/provider-egress", () => ({ createWorkerProviderEgressContext: vi.fn() }));

function fixture(sourceFamily: "native_pdf" | "admin_text" = "native_pdf") {
  const original: ExtractedDocument = {
    pages: [{ pageNumber: 1, text: "Synthetic original", ocrUsed: false }],
    images: [],
    temporaryPaths: ["/tmp/synthetic-managed-extraction", "/tmp/synthetic-managed-extraction"],
  };
  const source = { sourceFamily, sourceSha256: `sha256:${"a".repeat(64)}` } as ApprovedAdminSource;
  const job = {
    document_id: "00000000-0000-4000-8000-000000000001",
    lease_write_generation_id: "00000000-0000-4000-8000-000000000002",
    documents: { file_name: "synthetic.pdf", file_type: "application/pdf", metadata: {} },
  } as JobRow;
  const check = vi.fn();
  const attempt = { check } as unknown as IngestionAttempt;
  const ctx = { mutation: vi.fn(async () => ({ ok: true })) } as unknown as IngestionStageContext;
  const hook = vi.fn<NonNullable<WorkerRuntimeOptions["initializeManagedAdminTextGeneration"]>>(
    async (_job, _attempt, context) => {
      await context.prepare(source, Buffer.from("synthetic bytes"));
    },
  );
  mocks.extract.mockResolvedValue(original);
  mocks.pages.mockReturnValue([]);
  mocks.capture.mockResolvedValue([]);
  mocks.packet.mockReturnValue({ artifacts: [], registration: {} });
  return { original, source, job, check, attempt, ctx, hook };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("managed preparation temporary ownership", () => {
  it.each(["check", "capture", "packet", "registration", "after_return"] as const)(
    "keeps root ownership across a %s failure without early or double deletion",
    async (stage) => {
      const f = fixture();
      const failure = new Error(`synthetic_${stage}`);
      let owned: ExtractedDocument | null = null;
      const fail = () => {
        expect(owned).toBe(f.original);
        throw failure;
      };
      if (stage === "check") f.check.mockImplementationOnce(fail);
      if (stage === "capture") mocks.capture.mockImplementationOnce(fail);
      if (stage === "packet") mocks.packet.mockImplementationOnce(fail);
      if (stage === "registration")
        f.hook.mockImplementationOnce(async (_job, _attempt, context) => {
          await context.prepare(f.source, Buffer.from("synthetic bytes"));
          fail();
        });
      const run = async () => {
        try {
          const result = await initializeManagedAdminGeneration(
            f.ctx,
            { initializeManagedAdminTextGeneration: f.hook },
            f.job,
            f.attempt,
            (original) => {
              owned = original;
            },
          );
          expect(result.pdf?.extracted).toBe(f.original);
          expect(rm).not.toHaveBeenCalled();
          fail(); // Models inventory/download failure before main's later extracted assignment.
        } finally {
          for (const temporaryPath of new Set((owned as ExtractedDocument | null)?.temporaryPaths ?? []))
            await rm(temporaryPath, { recursive: true, force: true });
        }
      };
      await expect(run()).rejects.toBe(failure);
      expect(rm).toHaveBeenCalledExactlyOnceWith("/tmp/synthetic-managed-extraction", { recursive: true, force: true });
    },
  );

  it.each(["check", "registration", "adoption"] as const)(
    "cleans locally when ownership has not transferred at %s failure",
    async (stage) => {
      const f = fixture();
      const failure = new Error("synthetic_local_failure");
      if (stage === "check")
        f.check.mockImplementationOnce(() => {
          throw failure;
        });
      if (stage === "registration")
        f.hook.mockImplementationOnce(async (_job, _attempt, context) => {
          await context.prepare(f.source, Buffer.from("synthetic bytes"));
          throw failure;
        });
      const adopt =
        stage === "adoption"
          ? () => {
              throw failure;
            }
          : undefined;
      await expect(
        initializeManagedAdminGeneration(
          f.ctx,
          { initializeManagedAdminTextGeneration: f.hook },
          f.job,
          f.attempt,
          adopt,
        ),
      ).rejects.toBe(failure);
      expect(rm).toHaveBeenCalledExactlyOnceWith("/tmp/synthetic-managed-extraction", { recursive: true, force: true });
    },
  );

  it("retains successful native preparations for the caller and cleans non-native preparations locally", async () => {
    const native = fixture();
    const result = await initializeManagedAdminGeneration(
      native.ctx,
      { initializeManagedAdminTextGeneration: native.hook },
      native.job,
      native.attempt,
    );
    expect(result.pdf?.extracted).toBe(native.original);
    expect(rm).not.toHaveBeenCalled();
    const text = fixture("admin_text");
    const adopt = vi.fn();
    const textResult = await initializeManagedAdminGeneration(
      text.ctx,
      { initializeManagedAdminTextGeneration: text.hook },
      text.job,
      text.attempt,
      adopt,
    );
    expect(textResult.pdf).toBeUndefined();
    expect(adopt).not.toHaveBeenCalled();
    expect(rm).toHaveBeenCalledTimes(1);
  });

  it("wires immediate native ownership into the production job's existing finally cleanup", () => {
    const source = readFileSync(new URL("../worker/main.ts", import.meta.url), "utf8");
    const start = source.indexOf("const managedPreparation = await initializeManagedAdminGeneration(");
    const beforeCheck = source.slice(start, source.indexOf("      attempt.check();", start));
    expect(beforeCheck).toContain("extracted = original;");
    expect(source.slice(start)).toContain("await cleanupExtractedTemporaryPaths(extracted);");
  });
});
