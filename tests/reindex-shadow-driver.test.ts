import { describe, expect, it, vi } from "vitest";
import { createShadowEvaluationSqlDependenciesV1 } from "../scripts/reindex-shadow";

type Client = Parameters<typeof createShadowEvaluationSqlDependenciesV1>[0];
type Context = Parameters<ReturnType<typeof createShadowEvaluationSqlDependenciesV1>["readTextChunks"]>[0];
const documentId = "10000000-0000-4000-8000-000000000001";
function context(operation: string, originalArguments: unknown): Context {
  // The adapter tests only the transport boundary; complete authority is proved by the session tests.
  return { call: { operation, originalArguments } } as Context;
}
function client(data: unknown, error: unknown = null) {
  const abortSignal = vi.fn(async (_signal: AbortSignal) => ({ data, error }));
  const rpc = vi.fn((_name: string, _args: unknown) => ({ abortSignal }));
  return { rpc, abortSignal, adapter: createShadowEvaluationSqlDependenciesV1({ rpc } as unknown as Client) };
}

describe("U04 fixed driver SQL transport", () => {
  it("preserves literal empty filters, complete context, and guarded empty envelopes", async () => {
    const returned = { result: [], fullNativeEnvelope: "retained" };
    const f = client(returned);
    const input = context("text_chunks", { query_text: "exact query", match_count: 8, document_filters: [] });
    expect(await f.adapter.readTextChunks(input)).toBe(returned);
    expect(f.rpc).toHaveBeenCalledWith("u04_eval_text_chunks_v1", { ...input.call.originalArguments, p_context: input });
    expect(f.abortSignal.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
  });
  it("retains exact admitted pgvector wire spelling", async () => {
    const f = client({ result: [] });
    const vector = Array.from({ length: 1536 }, (_, index) => index === 0 ? 0.25 : 0);
    const wireVector = JSON.stringify(vector);
    const input = context("vector_chunks", { query_embedding: wireVector, match_count: 8, min_similarity: 0.12, document_filter: documentId });
    await f.adapter.readVectorChunks(input);
    expect(f.rpc.mock.calls[0]).toEqual(["u04_eval_vector_chunks_v1", {
      ...input.call.originalArguments, query_embedding: JSON.stringify(vector), p_context: input,
    }]);
    expect(input.call.originalArguments).toEqual(expect.objectContaining({ query_embedding: wireVector }));
  });
  it("refuses a crossed operation before dispatch", async () => {
    const f = client(null);
    await expect(async () => f.adapter.readAliases(context("documents", { ids: [] }))).rejects.toThrow("operation mismatch");
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("refuses malformed arguments before dispatch", async () => {
    const f = client(null);
    await expect(async () => f.adapter.readTextChunks(context("text_chunks", { query_text: "x", match_count: "eight", document_filters: null }))).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("retains the original database error for the session failure evidence", async () => {
    const failure = { code: "synthetic_failure", message: "synthetic rejection" };
    const f = client(null, failure);
    await expect(f.adapter.readAliases(context("aliases", {}))).rejects.toBe(failure);
  });
});
