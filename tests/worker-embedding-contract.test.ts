import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertWorkerEmbeddingCompatibility, WORKER_EMBEDDING_CONTRACT } from "../worker/embedding-contract";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("@/lib/supabase/admin");
  vi.doUnmock("../worker/admin-source-runtime");
  vi.doUnmock("../worker/observability");
  vi.doUnmock("../worker/run-loop");
});

describe("offline worker embedding compatibility", () => {
  it("pins the build's vector dimension to every canonical schema vector column", async () => {
    const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
    const dimensions = [...new Set([...schema.matchAll(/\bvector\((\d+)\)/gi)].map((match) => Number(match[1])))];
    expect(dimensions).toEqual([WORKER_EMBEDDING_CONTRACT.dimensions]);
    expect(WORKER_EMBEDDING_CONTRACT).toEqual({ model: "text-embedding-3-small", dimensions: 1536 });
  });

  it("accepts the existing corpus model and schema dimension without a provider probe", () => {
    expect(() =>
      assertWorkerEmbeddingCompatibility({ model: "text-embedding-3-small", dimensions: 1536 }),
    ).not.toThrow();
  });

  it.each([
    { model: "text-embedding-3-large", dimensions: 1536 },
    { model: "text-embedding-3-small", dimensions: 3072 },
    { model: "text-embedding-3-small", dimensions: 0 },
    { model: "", dimensions: 1536 },
  ])("refuses incompatible model/dimension $model/$dimensions", (configuration) => {
    expect(() => assertWorkerEmbeddingCompatibility(configuration)).toThrow("worker_embedding_contract_mismatch");
  });

  it("refuses incompatible startup before touching the supplied client or claiming work", async () => {
    vi.stubEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-large");
    vi.stubEnv("EMBEDDING_DIMENSIONS", "1536");
    const touched = vi.fn();
    const client = new Proxy(
      {},
      {
        get: () => {
          touched();
          throw new Error("client must stay untouched");
        },
      },
    );
    const { createWorkerRuntime } = await import("../worker/main");
    expect(() => createWorkerRuntime({ client: client as SupabaseClient })).toThrow(
      "worker_embedding_contract_mismatch",
    );
    expect(touched).not.toHaveBeenCalled();
  });

  it.each([
    { model: "text-embedding-3-large", dimensions: "1536" },
    { model: "text-embedding-3-small", dimensions: "3072" },
  ])(
    "alerts and exits for incompatible startup $model/$dimensions before external work",
    async ({ model, dimensions }) => {
      vi.stubEnv("OPENAI_EMBEDDING_MODEL", model);
      vi.stubEnv("EMBEDDING_DIMENSIONS", dimensions);
      vi.stubEnv("WORKER_FAILURE_WEBHOOK_URL", "https://hooks.invalid/synthetic-embedding-startup");
      const client = vi.fn(() => {
        throw new Error("Client creation must not run");
      });
      const loadModule = vi.fn(async () => {
        throw new Error("Runtime module must not load");
      });
      const claims = vi.fn(async () => {
        throw new Error("Claim loop must not run");
      });
      const capture = vi.fn();
      const flush = vi.fn(async () => undefined);
      vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: client }));
      vi.doMock("../worker/admin-source-runtime", () => ({
        loadAdminSourceRuntimeOptions: loadModule,
        adminSourceRuntimeStartupWarning: vi.fn(() => null),
      }));
      vi.doMock("../worker/run-loop", () => ({ runWorkerLoop: claims }));
      vi.doMock("../worker/observability", () => ({
        captureWorkerException: capture,
        flushWorkerErrorTracking: flush,
      }));
      const post = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
      vi.stubGlobal("fetch", post);
      const boundedSignal = new AbortController().signal;
      const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(boundedSignal);
      const printed = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      const { runWorkerMain } = await import("../worker/main");

      await expect(runWorkerMain()).resolves.toBeUndefined();

      expect(client).not.toHaveBeenCalled();
      expect(loadModule).not.toHaveBeenCalled();
      expect(claims).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(post).toHaveBeenCalledExactlyOnceWith(
        "https://hooks.invalid/synthetic-embedding-startup",
        expect.objectContaining({ method: "POST", signal: boundedSignal }),
      );
      expect(timeout).toHaveBeenCalledWith(5_000);
      const sent = String(post.mock.calls[0]?.[1]?.body);
      expect(sent).toContain("errorCode=worker_embedding_contract_mismatch");
      expect(sent).toContain("stage=embedding_contract");
      expect(sent).not.toContain(model);
      expect(sent).not.toContain(dimensions);
      expect(JSON.stringify(printed.mock.calls)).toContain('"stage":"embedding_contract"');
      expect(capture).toHaveBeenCalledWith(
        expect.objectContaining({ code: "worker_embedding_contract_mismatch" }),
        "fatal",
      );
      expect(flush).toHaveBeenCalledTimes(1);
      expect(flush.mock.invocationCallOrder[0]).toBeGreaterThan(post.mock.invocationCallOrder[0]!);
      expect(exit.mock.invocationCallOrder[0]).toBeGreaterThan(flush.mock.invocationCallOrder[0]!);
    },
  );
});
