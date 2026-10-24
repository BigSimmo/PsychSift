import { describe, expect, it } from "vitest";
import {
  batchEmbeddingInputs,
  EmbeddingRequestBudgetError,
  EMBEDDING_MAX_BATCH_UTF8_BYTES,
  hasKnownEmbeddingBudget,
} from "../src/lib/embedding-input-budget";

describe("embedding request budgets", () => {
  const model = "text-embedding-3-small";

  it("preserves order and exact contents at the request-byte boundary", () => {
    const inputs = ["a".repeat(100_000), "b".repeat(100_000), "c".repeat(100_000), "d"];
    expect(batchEmbeddingInputs(inputs, 256, model)).toEqual([inputs.slice(0, 3), inputs.slice(3)]);
  });

  it("counts UTF-8 bytes rather than characters", () => {
    const inputs = ["界".repeat(50_000), "語".repeat(50_000), "é"];
    const batches = batchEmbeddingInputs(inputs, 256, model);
    expect(batches).toEqual([inputs.slice(0, 2), inputs.slice(2)]);
    expect(Buffer.byteLength(batches[0].join(""), "utf8")).toBe(EMBEDDING_MAX_BATCH_UTF8_BYTES);
  });

  it("also respects the configured count limit", () => {
    expect(batchEmbeddingInputs(["a", "b", "c"], 2, model)).toEqual([["a", "b"], ["c"]]);
    expect(batchEmbeddingInputs([], 2, model)).toEqual([]);
    for (const size of [0, -1, 1.5, 2049]) expect(() => batchEmbeddingInputs(["a"], size, model)).toThrow();
  });

  it("refuses an indivisible input beyond the whole request budget without exposing text", () => {
    const input = "SYNTHETIC_PRIVATE_MARKER" + "a".repeat(EMBEDDING_MAX_BATCH_UTF8_BYTES);
    expect(() => batchEmbeddingInputs(["safe earlier input", input], 256, model)).toThrow(EmbeddingRequestBudgetError);
    let refusal: unknown;
    try {
      batchEmbeddingInputs([input], 256, model);
    } catch (error) {
      refusal = error;
    }
    // Asserting outside the catch keeps the leak check from being skipped if this stops throwing.
    expect(refusal).toBeInstanceOf(EmbeddingRequestBudgetError);
    expect(String(refusal)).not.toContain("SYNTHETIC_PRIVATE_MARKER");
  });

  it("keeps count-only behavior for an unknown model without claiming a byte-BPE bound", () => {
    const inputs = ["a".repeat(300_001), "b"];
    expect(hasKnownEmbeddingBudget("custom-embedding-model")).toBe(false);
    expect(batchEmbeddingInputs(inputs, 2, "custom-embedding-model")).toEqual([inputs]);
  });
});
