/**
 * Boot-time pre-warm for the catalogue search path.
 *
 * WHY. The live domain monitor (#2919) fails against an idle process because the first catalogue
 * read after idle pays ~1.3–1.8 s of connection setup and blows the 1200 ms search budget; the
 * per-kind cold retry in `catalogue-seed-fallback.ts` helps one domain, but `universal-search`
 * Promise.all's forms/services/medications and still triple-cold-starts. Populating the process
 * cache (and marking the connection warm) before the first request means no user-facing read is
 * ever the first. Failures are swallowed the same way as `warmEnabledRagAliasCache`: the first
 * real search still has the serialisation gate and the one-shot retry.
 *
 * KINDS ARE READ SERIALLY ON PURPOSE. Parallel warm would recreate the bug this exists to prevent.
 *
 * The search kinds are warmed in the SAME projection search reads (`renderOnly`, no `record`
 * column), or the warm would fill a cache key no search ever looks up. The full projection the
 * Services and Forms list routes read is warmed afterwards, as part of the list kinds, so those
 * pages keep the warm first load they had when search and list shared one full read.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { markCatalogueProcessConnectionWarmed } from "@/lib/site-content/catalogue-seed-fallback";
import { readCanonicalSiteContentRecords } from "@/lib/site-content/site-content-publication";

/** The three registry domains universal-search Promise.all's on a federated catalogue query. */
export const catalogueSearchWarmKinds = ["form", "service", "medication"] as const;

/**
 * The Differentials page's list reads share the same process cache (`differentials` route, list
 * scope), but nothing warmed them, so the first visitor after every restart paid both reads. The
 * server restarts on every merge, so that was many visitors a day. Warmed after the search kinds,
 * so the search path is never kept waiting behind them.
 *
 * `form` and `service` here are the FULL projection `/api/registry/records` reads for governance.
 * Search now reads its own slimmer projection, so these are no longer warmed as a side effect.
 */
export const catalogueListWarmKinds = ["differential", "presentation", "form", "service"] as const;

/**
 * Bound each boot warm read. Without a deadline a never-settling RPC is retained as a blocking
 * cache flight forever; later searches join it and cannot cancel it, so that kind stays on seeds
 * until process restart. Sized to the cache refresh ceiling — generous for boot, still finite.
 */
export const catalogueSearchWarmBudgetMs = 10_000;

export async function warmCanonicalCatalogueSearchCaches(
  supabase: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<void> {
  const plan = [
    ...catalogueSearchWarmKinds.map((kind) => ({ kind, renderOnly: true })),
    ...catalogueListWarmKinds.map((kind) => ({ kind, renderOnly: false })),
  ];
  for (const { kind, renderOnly } of plan) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        new DOMException(`Catalogue cache warm for ${kind} exceeded ${catalogueSearchWarmBudgetMs}ms.`, "TimeoutError"),
      );
    }, catalogueSearchWarmBudgetMs);
    (timer as { unref?: () => void }).unref?.();
    try {
      await readCanonicalSiteContentRecords({
        supabase,
        kind,
        slug: null,
        cache: true,
        renderOnly,
        // Seeds are unused on a successful RPC; an empty list is enough for warm-only.
        seeds: [],
        signal: controller.signal,
      });
      // First success opens the process-level cold gate for any concurrent first search.
      markCatalogueProcessConnectionWarmed();
    } catch (error) {
      console.warn("Canonical catalogue cache warmup failed; first search will retry.", {
        catalogue_kind: kind,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
