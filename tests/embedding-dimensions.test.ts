import { describe, expect, it, vi } from "vitest";

describe("strict embedding dimension guard", () => {
  it("derives EXPECTED_EMBED_DIM from EMBEDDING_DIMENSIONS at module load time", async () => {
    vi.resetModules();
    vi.stubEnv("EMBEDDING_DIMENSIONS", "3");
    const mod = await import("../src/lib/embedding-dimensions");
    const vector = [0.1, 0.2];

    expect(mod.EXPECTED_EMBED_DIM).toBe(3);
    expect(() => mod.assertEmbeddingDim(vector, "test_vector")).toThrow(/2 dimensions; expected 3/);
  });

  it("accepts only finite vectors of the configured dimension", async () => {
    const { EXPECTED_EMBED_DIM, assertEmbeddingDim } = await import("../src/lib/embedding-dimensions");
    const vector = Array.from({ length: EXPECTED_EMBED_DIM }, () => 0.01);

    expect(assertEmbeddingDim(vector, "test_vector")).toBe(vector);
  });

  it("rejects non-arrays, wrong dimensions, and non-finite values", async () => {
    const { EXPECTED_EMBED_DIM, assertEmbeddingDim } = await import("../src/lib/embedding-dimensions");

    expect(() => assertEmbeddingDim("not-a-vector", "test_vector")).toThrow(/must be an array/);
    expect(() => assertEmbeddingDim([0.1, 0.2], "test_vector")).toThrow(
      new RegExp(`2 dimensions; expected ${EXPECTED_EMBED_DIM}`),
    );
    expect(() =>
      assertEmbeddingDim([...Array.from({ length: EXPECTED_EMBED_DIM - 1 }, () => 0), Infinity], "test_vector"),
    ).toThrow(new RegExp(`non-finite value at index ${EXPECTED_EMBED_DIM - 1}`));
  });
});

describe("embedTexts malformed response evidence", () => {
  it.each([
    ["non-array", "not-a-vector", "openai_embedding_dimension_mismatch", "not-a-vector"],
    ["non-finite", [Infinity], "openai_embedding_invalid_value",
      [{ type: "unrepresentable_number", value: "Infinity" }]],
    ["negative zero", [-0], "openai_embedding_invalid_value",
      [{ type: "unrepresentable_number", value: "-0" }]],
    ["unsafe integer", [Number.MAX_SAFE_INTEGER + 1], "openai_embedding_invalid_value",
      [{ type: "unrepresentable_number", value: String(Number.MAX_SAFE_INTEGER + 1) }]],
  ] as const)("rejects %s before reassembly and retains the complete native response",
    async (_case, embedding, expectedCode, expectedEmbedding) => {
      vi.resetModules();
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      vi.stubEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small");
      vi.stubEnv("OPENAI_QUERY_CACHE_SIZE", "0");
      vi.stubEnv("EMBEDDING_DIMENSIONS", "1");
      const nativeResponse = {
        data: [{ index: 0, embedding }],
        provider_extension: { retained: "complete" },
      };
      vi.doMock("openai", () => ({
        default: class MockOpenAI {
          embeddings = { create: vi.fn(async () => nativeResponse) };
          responses = { create: vi.fn() };
        },
      }));

      try {
        const { clearOpenAICaches, embedTexts } = await import("../src/lib/openai");
        clearOpenAICaches();
        const error = await embedTexts(["only"]).then(
          () => null,
          (reason: unknown) => reason,
        );

        expect(error).toMatchObject({
          details: { code: expectedCode },
          nativeResponse: {
            data: [{ index: 0, embedding: expectedEmbedding }],
            provider_extension: { retained: "complete" },
          },
        });
      } finally {
        vi.doUnmock("openai");
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    });
});

describe("schema vector dimension guard (IDX-C2 fail-fast)", () => {
  it("parses distinct vector(N) dimensions from schema SQL", async () => {
    const { parseSchemaVectorDimensions } = await import("../src/lib/embedding-dimensions");
    const sql =
      "create table a (e vector(1536)); create table b (f VECTOR(1536)); create index on c using hnsw (g vector(1536));";
    expect(parseSchemaVectorDimensions(sql)).toEqual([1536]);
    expect(parseSchemaVectorDimensions("no vectors here")).toEqual([]);
    expect(parseSchemaVectorDimensions("vector(768) and vector(1536)")).toEqual([768, 1536]);
  });

  it("passes when the configured dimension matches a single consistent schema dimension", async () => {
    const { describeSchemaDimensionMismatch } = await import("../src/lib/embedding-dimensions");
    expect(describeSchemaDimensionMismatch(1536, "e vector(1536), f vector(1536)")).toBeNull();
  });

  it("flags a config/schema mismatch, inconsistent schema dims, and a missing vector column", async () => {
    const { describeSchemaDimensionMismatch } = await import("../src/lib/embedding-dimensions");
    expect(describeSchemaDimensionMismatch(3072, "e vector(1536)")).toMatch(
      /EMBEDDING_DIMENSIONS=3072 does not match schema vector\(1536\)/,
    );
    expect(describeSchemaDimensionMismatch(1536, "e vector(1536), f vector(3072)")).toMatch(
      /inconsistent vector dimensions/,
    );
    expect(describeSchemaDimensionMismatch(1536, "no vectors")).toMatch(/No vector\(N\) columns/);
  });
});
