import { createHash } from "node:crypto";

/** Fixture adapter for suites that already model document reads, never a production fallback. */
export function mockRagScopeRevision(rows: unknown) {
  return `rag-cache-scope-v1:${createHash("md5").update(JSON.stringify(rows)).digest("hex")}`;
}

type MockQuery = PromiseLike<{ data: unknown; error: unknown }> & {
  select: (columns: string) => MockQuery;
  eq: (column: string, value: unknown) => MockQuery;
  is: (column: string, value: unknown) => MockQuery;
  or: (filter: string) => MockQuery;
  in: (column: string, value: unknown) => MockQuery;
  order: (column: string, options: unknown) => MockQuery;
  limit: (limit: number) => MockQuery;
  abortSignal?: (signal: AbortSignal) => MockQuery;
};

export function withMockRagScopeRevision<T extends object>(client: T, fixedRevision?: string) {
  const storage = client as T & { from: (table: string) => MockQuery; rpc?: (...args: unknown[]) => unknown };
  return {
    ...client,
    rpc(name: string, params: Record<string, unknown>) {
      if (name !== "rag_cache_scope_revision_v1") return storage.rpc?.(name, params);
      if (fixedRevision) {
        const response = {
          abortSignal: () => response,
          then(fulfilled?: (result: { data: string; error: null }) => unknown) {
            return Promise.resolve({ data: fixedRevision, error: null }).then(fulfilled);
          },
        };
        return response;
      }
      // These suites model one/current document. The dedicated F13 suite models
      // complete-scope DB revision semantics and matching owner/document filters.
      let query = storage
        .from("documents")
        .select("id,updated_at,metadata")
        .eq("status", "indexed")
        .order("updated_at", { ascending: false })
        .limit(1);
      const owner = params.p_owner_id;
      query = owner
        ? params.p_include_public
          ? query.or(`owner_id.eq.${owner},owner_id.is.null`)
          : query.eq("owner_id", owner)
        : query.is("owner_id", null);
      const ids = params.p_document_ids as string[] | null;
      if (ids?.length) query = query.in("id", ids);
      const response = {
        abortSignal(signal: AbortSignal) {
          query = query.abortSignal?.(signal) ?? query;
          return response;
        },
        then(
          fulfilled?: (result: { data: string | null; error: unknown }) => unknown,
          rejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(query)
            .then(({ data, error }) => ({ data: error ? null : mockRagScopeRevision(data), error }))
            .then(fulfilled, rejected);
        },
      };
      return response;
    },
  };
}
