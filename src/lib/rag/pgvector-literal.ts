/**
 * Validated boundary adapter for passing numeric embedding vectors into
 * Supabase/PostgREST RPC parameters generated as `string` by `supabase gen types`.
 *
 * Runtime identity is preserved (`number[]`) so PostgREST serializes the JSON array
 * directly and unit-test RPC spies observe the original array reference.
 */
export function toPgVectorRpcParam(embedding: number[]): string {
  if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new TypeError("Invalid pgvector RPC embedding: expected an array of finite numbers.");
  }
  return embedding as unknown as string;
}
