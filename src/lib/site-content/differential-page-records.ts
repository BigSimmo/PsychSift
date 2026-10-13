import "server-only";

import { connection } from "next/server";
import { cache } from "react";
import {
  differentialRecords,
  getDifferentialRecord,
  getPresentationWorkflow,
  presentationLookupSlugs,
  scopeDifferentialRecord,
  scopePresentationWorkflow,
} from "@/lib/differentials";
import { isDemoMode, isLocalNoAuthMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { readCanonicalSiteContentRecords } from "@/lib/site-content/site-content-publication";

/**
 * Canonical published payloads were seeded from the deliberately unlabelled
 * snapshot, so a live read returns records with no `clinicalHingeScope` and no
 * section `scope`. The UI defaults an absent scope to diagnosis-specific, which
 * would put the akathisia discriminator back under acute dystonia on exactly the
 * path real requests take. Every canonical record is relabelled on the way out.
 * See `scopeDifferentialRecord` in `@/lib/differentials`.
 */
export const readDifferentialCatalogueRecords = cache(async () => {
  if (isDemoMode() || isLocalNoAuthMode()) return differentialRecords;
  await connection();
  const { records } = await readCanonicalSiteContentRecords({
    supabase: createAdminClient(),
    kind: "differential",
    slug: null,
    seeds: differentialRecords,
    // A LIST read: it pulls the whole differential catalogue and filters in memory, so it is the
    // same shared, public, non-owner-scoped read search caches. The per-slug reads below stay
    // uncached on purpose, so an operator publishing a record sees it on its detail page at once.
    cache: true,
  });
  return records.map(scopeDifferentialRecord);
});

/** A page and its metadata read the same public publication within one request. */
export const readDifferentialPageRecord = cache(async (slug: string) => {
  const seed = getDifferentialRecord(slug);
  if (isDemoMode() || isLocalNoAuthMode()) return seed;
  await connection();
  const { records } = await readCanonicalSiteContentRecords({
    supabase: createAdminClient(),
    kind: "differential",
    slug,
    seeds: seed ? [seed] : [],
  });
  const record = records[0];
  return record ? scopeDifferentialRecord(record) : null;
});

export const readPresentationPageRecord = cache(async (slug: string) => {
  const seed = getPresentationWorkflow(slug);
  if (isDemoMode() || isLocalNoAuthMode()) return seed;
  await connection();
  const read = (lookupSlug: string) =>
    readCanonicalSiteContentRecords({
      supabase: createAdminClient(),
      kind: "presentation",
      slug: lookupSlug,
      seeds: seed ? [{ workflow: seed }] : [],
      mapRecord: ({ finalRenderPayload }) => ({
        workflow: finalRenderPayload as unknown as NonNullable<typeof seed>,
      }),
    });
  // Hosted publications seeded before the `presentation-` namespace may still carry the legacy slug.
  let workflow: NonNullable<typeof seed> | undefined;
  for (const lookupSlug of presentationLookupSlugs(slug)) {
    workflow = (await read(lookupSlug)).records[0]?.workflow;
    if (workflow) break;
  }
  return workflow ? scopePresentationWorkflow(workflow) : null;
});
