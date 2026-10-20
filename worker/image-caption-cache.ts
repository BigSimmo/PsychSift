// Audit ING-B-10: reuse a caption the vision model already wrote for the SAME admitted
// source, so a retried or re-run ingestion does not pay up to 15 vision calls again.
//
// The earlier cache was switched off because its rows carried no admission or source
// identity. Rows written here bind the caption to the document, its admission event,
// its content hash and its authority digest (which changes whenever the document's
// owner, storage, licence, admission or authority facts change), plus the image hash
// and the caption context hash (prompt, policy, model and nearby-text versions). A row
// is reused only when that whole identity matches; anything else is a miss. Legacy rows
// have no identity and never match. It uses the existing image_caption_cache table
// unchanged: the identity and the classification live in its metadata column.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "../src/lib/env";
import type { ImageEvidenceCategory } from "../src/lib/types";
import {
  imageCaptionCacheVersion,
  imageEvidenceCategories,
  redactImageClassification,
  visionClassificationPromptVersion,
  type ImageClassification,
} from "./image-classification";
import { sanitizeJsonbRecord } from "./ingestion-sanitize";
import type { JobRow } from "./types";

export const imageCaptionCacheIdentityVersion = "image-caption-cache-identity-v1";

export type ImageCaptionCacheKey = Readonly<{
  ownerId: string;
  imageHash: string;
  model: string;
  identity: string;
}>;

type CacheClient = Pick<SupabaseClient, "from">;

/** The cache key for one image of this job's admitted source, or null when it cannot be bound. */
export function imageCaptionCacheKey(args: {
  job: JobRow;
  imageHash: string;
  contextHash: string;
  mimeType: string;
}): ImageCaptionCacheKey | null {
  const document = args.job.documents;
  const ownerId = document.owner_id;
  const contentHash = document.content_hash;
  const authorityDigest = args.job.lease_authority_digest;
  if (!ownerId || !contentHash || !authorityDigest || !args.imageHash || !args.contextHash) return null;
  const admissionEventId =
    typeof document.metadata?.admission_event_id === "string" ? document.metadata.admission_event_id : null;
  const model = env.OPENAI_VISION_MODEL;
  const identity = createHash("sha256")
    .update(
      JSON.stringify({
        version: imageCaptionCacheIdentityVersion,
        cacheVersion: imageCaptionCacheVersion,
        promptVersion: visionClassificationPromptVersion,
        model,
        documentId: args.job.document_id,
        ownerId,
        admissionEventId,
        contentHash,
        authorityDigest,
        imageHash: args.imageHash,
        contextHash: args.contextHash,
        mimeType: args.mimeType,
      }),
    )
    .digest("hex");
  return { ownerId, imageHash: args.imageHash, model, identity: `sha256:${identity}` };
}

const cachedClassificationSchema = z
  .object({
    image_type: z.string().refine((value) => imageEvidenceCategories.has(value as ImageEvidenceCategory)),
    searchable: z.boolean(),
    clinical_relevance_score: z.number().finite(),
    labels: z.array(z.string().max(200)).max(20),
    caption: z.string().trim().min(1).max(4000),
    skip_reason: z.string().max(2000).nullable(),
    clinical_use_class: z.enum([
      "clinical_evidence",
      "administrative",
      "reference",
      "decorative_or_empty",
      "ambiguous",
    ]),
    clinical_use_reason: z.string().max(2000),
    clinical_signal_score: z.number().finite(),
    admin_signal_score: z.number().finite(),
    structured_visual_profile: z.unknown(),
    structured_extraction_confidence: z.number().finite(),
  })
  .strict();

const cachedRowSchema = z.object({
  metadata: z.object({
    cache_identity_version: z.literal(imageCaptionCacheIdentityVersion),
    cache_identity: z.string(),
    classification: cachedClassificationSchema,
  }),
});

/** The cached classification when the stored identity matches exactly, else null. */
export function parseCachedImageClassification(row: unknown, key: ImageCaptionCacheKey): ImageClassification | null {
  const parsed = cachedRowSchema.safeParse(row);
  if (!parsed.success || parsed.data.metadata.cache_identity !== key.identity) return null;
  return parsed.data.metadata.classification as ImageClassification;
}

/** Best effort: a failed or missing read is a cache miss, never a job failure. */
export async function readCachedImageClassification(
  client: CacheClient,
  key: ImageCaptionCacheKey,
  signal: AbortSignal,
): Promise<ImageClassification | null> {
  try {
    const { data, error } = await client
      .from("image_caption_cache")
      .select("metadata")
      .eq("owner_id", key.ownerId)
      .eq("image_hash", key.imageHash)
      .eq("model", key.model)
      .abortSignal(signal)
      .maybeSingle();
    if (error || !data) return null;
    return parseCachedImageClassification(data, key);
  } catch {
    return null;
  }
}

/** Best effort: stores the redacted classification; a failed write only costs a later miss. */
export async function writeCachedImageClassification(
  client: CacheClient,
  key: ImageCaptionCacheKey,
  classification: ImageClassification,
  mimeType: string,
  signal: AbortSignal,
): Promise<void> {
  const redacted = redactImageClassification(classification);
  if (!cachedClassificationSchema.safeParse(redacted).success) return;
  try {
    await client
      .from("image_caption_cache")
      .upsert(
        {
          owner_id: key.ownerId,
          image_hash: key.imageHash,
          model: key.model,
          mime_type: mimeType,
          caption: redacted.caption,
          metadata: sanitizeJsonbRecord({
            extractor: "local-worker",
            cache_identity_version: imageCaptionCacheIdentityVersion,
            cache_identity: key.identity,
            classification: redacted,
          }),
        },
        { onConflict: "owner_id,image_hash,model" },
      )
      .abortSignal(signal);
  } catch {
    // The cache is an optimisation; the caption itself was already produced.
  }
}
