import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function stubEmbeddingEnv(dimensions: number) {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small");
  vi.stubEnv("OPENAI_QUERY_CACHE_SIZE", "0");
  vi.stubEnv("EMBEDDING_DIMENSIONS", String(dimensions));
}

describe("embedTexts integrity (IDX-C1, IDX-C2)", () => {
  it("reassembles embeddings by item.index, not array position", async () => {
    stubEmbeddingEnv(2);

    // Return the items in REVERSED order. A position-based mapping would attach each
    // embedding to the wrong input; the index-based fix must restore the correct order.
    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        embeddings = {
          create: vi.fn(async ({ input }: { input: string[] }) => ({
            data: input.map((_text, index) => ({ index, embedding: [index, index] as number[] })).reverse(),
          })),
        };

        responses = { create: vi.fn() };
      },
    }));

    const { clearOpenAICaches, embedTexts } = await import("../src/lib/openai");
    clearOpenAICaches();

    const result = await embedTexts(["a", "b", "c"]);
    // Each text i must map back to embedding [i, i] despite the reversed response order.
    expect(result).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it("passes the configured dimensions to the embeddings API", async () => {
    stubEmbeddingEnv(2);
    let capturedDimensions: number | undefined;

    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        embeddings = {
          create: vi.fn(async ({ input, dimensions }: { input: string[]; dimensions?: number }) => {
            capturedDimensions = dimensions;
            return { data: input.map((_text, index) => ({ index, embedding: [0, 0] as number[] })) };
          }),
        };

        responses = { create: vi.fn() };
      },
    }));

    const { clearOpenAICaches, embedTexts } = await import("../src/lib/openai");
    clearOpenAICaches();

    await embedTexts(["only"]);
    expect(capturedDimensions).toBe(2);
  });

  it("forwards caller cancellation to every embeddings batch", async () => {
    stubEmbeddingEnv(2);
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;

    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        embeddings = {
          create: vi.fn(async (_body: unknown, options?: { signal?: AbortSignal }) => {
            capturedSignal = options?.signal;
            return { data: [{ index: 0, embedding: [0, 0] as number[] }] };
          }),
        };
        responses = { create: vi.fn() };
      },
    }));

    const { clearOpenAICaches, embedTexts } = await import("../src/lib/openai");
    clearOpenAICaches();
    await embedTexts(["only"], { signal: controller.signal });

    expect(capturedSignal).toBe(controller.signal);
  });

  it("throws when an embedding does not match EMBEDDING_DIMENSIONS", async () => {
    stubEmbeddingEnv(1536);

    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        embeddings = {
          create: vi.fn(async ({ input }: { input: string[] }) => ({
            // Wrong dimension (3 instead of 1536) — a misconfigured model.
            data: input.map((_text, index) => ({ index, embedding: [0, 0, 0] as number[] })),
          })),
        };

        responses = { create: vi.fn() };
      },
    }));

    const { clearOpenAICaches, embedTexts } = await import("../src/lib/openai");
    clearOpenAICaches();

    await expect(embedTexts(["x"])).rejects.toThrow(/dimensions; expected 1536/);
  });

  it("throws when the API returns fewer embeddings than inputs", async () => {
    stubEmbeddingEnv(2);

    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        embeddings = {
          create: vi.fn(async () => ({
            // Two inputs requested, one embedding returned.
            data: [{ index: 0, embedding: [0, 0] as number[] }],
          })),
        };

        responses = { create: vi.fn() };
      },
    }));

    const { clearOpenAICaches, embedTexts } = await import("../src/lib/openai");
    clearOpenAICaches();

    await expect(embedTexts(["a", "b"])).rejects.toThrow(/embeddings for/);
  });
});

describe("embedTexts batching (IDX-C3)", () => {
  it("splits larger atomic inputs by request bytes and preserves reversed-response and duplicate mapping", async () => {
    stubEmbeddingEnv(2);
    vi.stubEnv("OPENAI_EMBEDDING_BATCH_SIZE", "256");
    const inputs = Array.from({ length: 40 }, (_, index) => `t${String(index).padStart(2, "0")}:${"界".repeat(2729)}`);
    const calls: string[][] = [];
    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        embeddings = {
          create: vi.fn(async ({ input }: { input: string[] }) => {
            calls.push(input);
            return {
              data: input.map((text, index) => ({ index, embedding: [Number(text.slice(1, 3)), 0] })).reverse(),
            };
          }),
        };
        responses = { create: vi.fn() };
      },
    }));
    const { clearOpenAICaches, embedTexts } = await import("../src/lib/openai");
    clearOpenAICaches();
    const result = await embedTexts([...inputs, inputs[0]]);
    expect(calls.map((batch) => batch.length)).toEqual([36, 4]);
    for (const batch of calls) expect(Buffer.byteLength(batch.join(""), "utf8")).toBeLessThanOrEqual(300_000);
    expect(calls.flat()).toEqual(inputs);
    expect(result).toEqual([...inputs.map((_text, index) => [index, 0]), [0, 0]]);
  });

  it("rejects an unbatchable input before constructing a provider client", async () => {
    stubEmbeddingEnv(2);
    const constructed = vi.fn();
    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        constructor() {
          constructed();
        }
        embeddings = { create: vi.fn() };
        responses = { create: vi.fn() };
      },
    }));
    const { clearOpenAICaches, embedTexts } = await import("../src/lib/openai");
    clearOpenAICaches();
    await expect(embedTexts(["earlier input", "a".repeat(300_001)])).rejects.toMatchObject({
      code: "EMBEDDING_INPUT_EXCEEDS_REQUEST_BUDGET",
    });
    expect(constructed).not.toHaveBeenCalled();
  });

  function embeddingForText(text: string): number[] {
    // Encode the input's numeric suffix so a mis-mapped embedding is detectable.
    const n = Number(text.replace(/[^0-9]/g, ""));
    return [n, n];
  }

  it("splits large input into batches and reassembles by global index across batches", async () => {
    stubEmbeddingEnv(2);
    vi.stubEnv("OPENAI_EMBEDDING_BATCH_SIZE", "2");

    const inputsPerCall: number[] = [];
    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        embeddings = {
          create: vi.fn(async ({ input }: { input: string[] }) => {
            inputsPerCall.push(input.length);
            // Reverse within each batch so a naive position-based merge would corrupt order.
            return { data: input.map((text, index) => ({ index, embedding: embeddingForText(text) })).reverse() };
          }),
        };

        responses = { create: vi.fn() };
      },
    }));

    const { clearOpenAICaches, embedTexts } = await import("../src/lib/openai");
    clearOpenAICaches();

    const result = await embedTexts(["t0", "t1", "t2", "t3", "t4"]);

    // 5 inputs at batch size 2 -> three requests of 2, 2, 1.
    expect(inputsPerCall).toEqual([2, 2, 1]);
    // Every text maps back to its own embedding despite per-batch reversal and batch splits.
    expect(result).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
  });

  it("chunkIntoBatches partitions in order with a trailing remainder and rejects bad sizes", async () => {
    stubEmbeddingEnv(2);
    const { chunkIntoBatches } = await import("../src/lib/openai");

    expect(chunkIntoBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkIntoBatches([], 3)).toEqual([]);
    expect(chunkIntoBatches([1, 2], 10)).toEqual([[1, 2]]);
    expect(() => chunkIntoBatches([1], 0)).toThrow(/positive integer/);
  });
});
