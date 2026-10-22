// Issue #3730: image_caption_cache rows outlive the document they were captioned for. Since
// 20261021160000 the unique key includes cache_identity, so a deleted or reprocessed document
// leaves its rows behind for good. The worker now records the document id in each row's
// metadata (metadata.document_id), which lets the delete route and a reprocess remove them
// without a schema change. Rows written before that carry no document id and are not touched.
// A delete that fails in the route is caught later by sweepOrphanedImageCaptionCache, which
// `npm run cleanup:storage` runs, so a transient error never leaves a deleted document's
// captions behind for good.
import type { SupabaseClient } from "@supabase/supabase-js";

type CacheClient = Pick<SupabaseClient, "from">;

/** The PostgREST filter column for the document a cache row was written for. */
export const imageCaptionCacheDocumentColumn = "metadata->>document_id";

/**
 * Deletes this owner's caption-cache rows for one document, except the identities listed in
 * `keepIdentities` (a reprocess keeps the captions its own run can still reuse). Best effort:
 * returns the error message instead of throwing, because a leftover row only costs storage.
 */
export async function deleteImageCaptionCacheForDocument(
  client: CacheClient,
  args: {
    ownerId: string;
    documentId: string;
    keepIdentities?: readonly string[];
    signal?: AbortSignal;
  },
): Promise<string | null> {
  try {
    let query = client
      .from("image_caption_cache")
      .delete()
      .eq("owner_id", args.ownerId)
      .eq(imageCaptionCacheDocumentColumn, args.documentId);
    const keep = Array.from(new Set(args.keepIdentities ?? []));
    if (keep.length > 0) {
      query = query.not("cache_identity", "in", `(${keep.map((identity) => `"${identity}"`).join(",")})`);
    }
    if (args.signal) query = query.abortSignal(args.signal);
    const { error } = await query;
    return error ? error.message : null;
  } catch (error) {
    return error instanceof Error ? error.message : "Caption cache clean-up failed.";
  }
}

const SWEEP_PAGE = 1000;
const SWEEP_BATCH = 100;

/**
 * Deletes caption-cache rows whose recorded document no longer exists. It pages through every
 * row that carries a document id, unless `maxRows` caps it (tests only: a capped run would see
 * the same lowest ids each time). Throws on a read or delete error so the operator sees it;
 * `dryRun` counts the orphans without deleting them.
 */
export async function sweepOrphanedImageCaptionCache(
  client: CacheClient,
  options: { dryRun: boolean; maxRows?: number },
): Promise<{ scanned: number; orphaned: number; deleted: number }> {
  let scanned = 0;
  let orphaned = 0;
  let deleted = 0;
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  let afterId: string | null = null;
  while (scanned < maxRows) {
    let page = client
      .from("image_caption_cache")
      .select(`id,document_id:${imageCaptionCacheDocumentColumn}`)
      .not(imageCaptionCacheDocumentColumn, "is", null)
      .order("id", { ascending: true })
      .limit(Math.min(SWEEP_PAGE, maxRows - scanned));
    if (afterId) page = page.gt("id", afterId);
    const { data, error } = await page;
    if (error) throw new Error(`Caption cache sweep read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as { id: string; document_id: string }[];
    if (rows.length === 0) break;
    scanned += rows.length;
    afterId = rows[rows.length - 1].id;

    const documentIds = Array.from(new Set(rows.map((row) => row.document_id)));
    const live = new Set<string>();
    for (let start = 0; start < documentIds.length; start += SWEEP_BATCH) {
      const batch = documentIds.slice(start, start + SWEEP_BATCH);
      const { data: documents, error: documentError } = await client.from("documents").select("id").in("id", batch);
      if (documentError) throw new Error(`Caption cache sweep document read failed: ${documentError.message}`);
      for (const document of (documents ?? []) as { id: string }[]) live.add(document.id);
    }
    const orphanIds = rows.filter((row) => !live.has(row.document_id)).map((row) => row.id);
    orphaned += orphanIds.length;
    if (options.dryRun) continue;
    for (let start = 0; start < orphanIds.length; start += SWEEP_BATCH) {
      const batch = orphanIds.slice(start, start + SWEEP_BATCH);
      const { error: deleteError } = await client.from("image_caption_cache").delete().in("id", batch);
      if (deleteError) throw new Error(`Caption cache sweep delete failed: ${deleteError.message}`);
      deleted += batch.length;
    }
  }
  return { scanned, orphaned, deleted };
}
