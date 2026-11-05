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
