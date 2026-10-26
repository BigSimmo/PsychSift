import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertWorkerEmbeddingCompatibility, WORKER_EMBEDDING_CONTRACT } from "../worker/embedding-contract";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
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
});
