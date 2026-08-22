/**
 * Deliberately free of any one snapshot's shape. Phase 1 kept this type inside
 * `ledger-snapshot.ts`, which made a second snapshot import ledger code to
 * describe its own age.
 */
export type Freshness = { contentAt: string | null; viewedAt: string; ageHours: number | null };

/**
 * `ageHours` is null for a missing OR unparseable content date. A NaN age would
 * reach `FreshnessStamp` and render "NaN hours old" — a confident-looking stamp
 * carrying no information, which is the failure that component exists to
 * prevent.
 */
export function resolveFreshnessFrom(contentAt: string | null, now: Date): Freshness {
  const viewedAt = now.toISOString();
  if (contentAt === null) return { contentAt, viewedAt, ageHours: null };
  const parsed = new Date(contentAt);
  if (Number.isNaN(parsed.getTime())) return { contentAt, viewedAt, ageHours: null };
  return { contentAt, viewedAt, ageHours: Math.round((now.getTime() - parsed.getTime()) / 3_600_000) };
}
