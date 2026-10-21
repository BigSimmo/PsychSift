// Issue #3730: image_caption_cache rows outlive the document they were captioned for. Since
// 20261021160000 the unique key includes cache_identity, so a deleted or reprocessed document
// leaves its rows behind for good. The worker now records the document id in each row's
// metadata (metadata.document_id), which lets the delete route and a reprocess remove them
// without a schema change. Rows written before that carry no document id and are not touched.
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
