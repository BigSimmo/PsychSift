import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The search projection must carry everything search uses.
 *
 * Since 2026-10-06 all three registry search domains read `read_site_content_public_records` with
 * `.select("initialized,render_payload,snapshot")`, dropping the `record` column. Measured live
 * that day, `record` was 1.23 MB of the 2.63 MB service read and 0.40 MB of the 0.99 MB form read,
 * and the full reads were what kept missing the 1200 ms search budget from Railway.
 *
 * That is only safe because search never reads `record` when a render payload is present: the
 * full read without a governance mapper uses `render_payload ?? record`, and every production row
 * carries a render payload (0 of 611 rows without one, same day). These cases pin that, using the
 * REAL bundled catalogues as the render payloads, so a ranker or result field that ever starts
 * depending on `record` fails here instead of quietly vanishing from live search.
 */

type SearchSupabase = Parameters<typeof import("../src/lib/universal-search").runUniversalSearch>[0]["supabase"];

const projectedColumns = "initialized,render_payload,snapshot";
const snapshot = { state: "current", changeEpoch: "12", releaseId: "22222222-2222-5222-8222-222222222222" };

async function bundledCatalogues() {
  const [{ formRecords }, { serviceRecords }, { defaultMedicationRecords }] = await Promise.all([
    import("@/lib/forms"),
    import("@/lib/services"),
    import("@/lib/medication-seed"),
  ]);
  return {
    form: formRecords as unknown as Array<Record<string, unknown>>,
    service: serviceRecords as unknown as Array<Record<string, unknown>>,
    medication: defaultMedicationRecords() as unknown as Array<Record<string, unknown>>,
  } as Record<string, Array<Record<string, unknown>>>;
}

/**
 * Full rows as the RPC returns them. `record` is deliberately NOT the render payload: it carries
 * only governance-shaped fields, so anything that read from it would produce visibly different
 * results from the projected read.
 */
function fullRows(renderPayloads: Array<Record<string, unknown>>) {
  return renderPayloads.map((payload) => ({
    initialized: true,
    record: { slug: payload.slug, sourceStatus: "current", validationStatus: "approved", reviewerId: "private" },
    render_payload: payload,
    snapshot,
  }));
}

/**
 * `projected: false` stands in for the payload search read before this change: whatever columns
 * are asked for, the full row comes back. `projected: true` honours the projection, as PostgREST
 * does, and returns only the three columns.
 */
function fakeSupabase(catalogues: Record<string, Array<Record<string, unknown>>>, projected: boolean) {
  const columnsRequested: Array<string | undefined> = [];
  const supabase = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name !== "read_site_content_public_records") return Promise.resolve({ data: [], error: null });
      const rows = fullRows(catalogues[String(args.p_kind)] ?? []);
      const full = Promise.resolve({ data: rows, error: null });
      return Object.assign(full, {
        select: (columns: string) => {
          columnsRequested.push(columns);
          if (!projected) return full;
          const keep = columns.split(",");
          return Promise.resolve({
            data: rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => keep.includes(key)))),
            error: null,
          });
        },
      });
    },
  } as unknown as SearchSupabase;
  return { supabase, columnsRequested };
}

async function freshModules() {
  const { clearSiteContentRecordCache } = await import("@/lib/site-content/site-content-record-cache");
  const { clearCatalogueSeedFallbackCooldown } = await import("@/lib/site-content/catalogue-seed-fallback");
  clearSiteContentRecordCache();
  clearCatalogueSeedFallbackCooldown();
}

afterEach(async () => {
  await freshModules();
  vi.restoreAllMocks();
});

describe("the render-only search projection", () => {
  it.each(["form", "service", "medication"])(
    "returns exactly the %s records the full read does",
    async (kind) => {
      const { readCanonicalSiteContentRecords } = await import("@/lib/site-content/site-content-publication");
      const catalogues = await bundledCatalogues();
      expect(catalogues[kind]!.length).toBeGreaterThan(10);

      await freshModules();
      const full = await readCanonicalSiteContentRecords({
        supabase: { rpc: () => Promise.resolve({ data: fullRows(catalogues[kind]!), error: null }) },
        kind,
        slug: null,
        seeds: [],
        cache: true,
      });
      await freshModules();
      const { supabase, columnsRequested } = fakeSupabase(catalogues, true);
      const projected = await readCanonicalSiteContentRecords({
        supabase,
        kind,
        slug: null,
        seeds: [],
        cache: true,
        renderOnly: true,
      });

      expect(columnsRequested).toEqual([projectedColumns]);
      expect(projected.source).toBe("canonical_public");
      expect(projected.snapshot).toEqual(full.snapshot);
      expect(projected.records).toEqual(full.records);
    },
    20_000,
  );

  // Every result field a reader sees (title, subtitle, link, badge, rank) comes out identical,
  // for queries that hit each domain, so no ranker or renderer depends on the dropped column.
  it("ranks and renders search results identically to the full read", async () => {
    const catalogues = await bundledCatalogues();
    const queries = ["referral", "counselling", "sertraline", "lithium monitoring", "crisis", "clozapine", "carer"];

    const run = async (projected: boolean) => {
      await freshModules();
      vi.resetModules();
      const { runUniversalSearch } = await import("../src/lib/universal-search");
      const { supabase, columnsRequested } = fakeSupabase(catalogues, projected);
      const responses = [];
      for (const query of queries) {
        const response = await runUniversalSearch({
          query,
          limitPerDomain: 8,
          domains: ["forms", "services", "medications"],
          demo: false,
          supabase,
        });
        responses.push(
          response.groups.map((group) => ({
            kind: group.kind,
            total: group.total,
            degraded: group.degraded,
            error: group.error,
            items: group.items,
          })),
        );
      }
      return { responses, columnsRequested };
    };

    const full = await run(false);
    const projected = await run(true);

    expect(new Set(projected.columnsRequested)).toEqual(new Set([projectedColumns]));
    expect(projected.responses).toEqual(full.responses);
    // Not vacuous: the queries really do return results in every domain, canonically.
    const groups = projected.responses.flat();
    for (const kind of ["forms", "services", "medications"]) {
      expect(groups.filter((group) => group.kind === kind).some((group) => group.items.length > 0)).toBe(true);
    }
    expect(groups.every((group) => group.degraded === undefined && group.error === undefined)).toBe(true);
  }, 60_000);

  // The guard that makes the projection safe to rely on: a published row with no render payload
  // must fail visibly into the seed fallback, never be silently dropped from search.
  it.each(["form", "service"])("refuses a published %s row with no render payload", async (kind) => {
    const { readCanonicalSiteContentRecords } = await import("@/lib/site-content/site-content-publication");
    await freshModules();
    const supabase = {
      rpc: () => ({
        select: () => Promise.resolve({ data: [{ initialized: true, render_payload: null, snapshot }], error: null }),
      }),
    };
    await expect(
      readCanonicalSiteContentRecords({ supabase, kind, slug: null, seeds: [], cache: true, renderOnly: true }),
    ).rejects.toThrow(`Canonical ${kind} search read failed: missing or invalid render payload.`);
  });
});
