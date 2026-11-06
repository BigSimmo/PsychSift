import type { CmeEntry, CmeEntryVersion } from "@/lib/cme/types";

/** Matches cme_entry_edit_version; derived only from the record actually read. */
export function cmeEntryVersion(entry: CmeEntry): CmeEntryVersion {
  return {
    id: entry.id,
    date: entry.date,
    title: entry.title,
    reflection: entry.reflection,
    costCents: entry.costCents,
    routineId: entry.routineId,
    documentId: entry.documentId,
    sourceUrl: entry.sourceUrl ?? null,
    buckets: [...entry.buckets],
    formalPeerReviewHours: entry.formalPeerReviewHours ?? 0,
    transcribed: entry.transcribed,
    archived: Boolean(entry.archivedAt),
    allocations: [...entry.allocations].sort((a, b) => a.category.localeCompare(b.category)),
  };
}

/**
 * Drop the edit version from entries a page only displays. Each version repeats the entry's
 * content, so a display-only list (the Log, across all years) would send it twice. Edit and
 * amendment flows read the entry on their own route and keep the version.
 */
export function withoutCmeEntryVersions<T extends CmeEntry>(entries: readonly T[]): T[];
export function withoutCmeEntryVersions<T extends CmeEntry>(entries: readonly T[] | undefined): T[] | undefined;
export function withoutCmeEntryVersions<T extends CmeEntry>(entries: readonly T[] | undefined): T[] | undefined {
  return entries?.map((entry) => {
    if (!("version" in entry)) return entry;
    const rest = { ...entry };
    delete (rest as { version?: CmeEntryVersion }).version;
    return rest;
  });
}
