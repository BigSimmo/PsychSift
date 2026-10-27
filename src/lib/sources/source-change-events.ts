import { z } from "zod";

import sourceChangeRegister from "@/data/source-change-events.json";
import { strictSourceDate } from "@/lib/sources/source-date-policy";

/**
 * Confirmed changes to registered sources (src/data/source-acquisitions.json).
 *
 * The weekly source watch (`scripts/watch-source-changes.ts`) only reports that a
 * source's page or file looks different. A difference is not a change in guidance:
 * pages move, banners rotate and PDFs are re-saved. So nothing here is written by the
 * watch. An event is added only after the owner has looked at the change and confirmed
 * it, and then every record citing that source is due for review now
 * (`contentReviewSchedule`).
 *
 * Deliberately free of server-only imports so client components can work out a
 * record's review state from it.
 */
const isoDate = z.string().refine((value) => strictSourceDate(value) !== null, "expected a real yyyy-mm-dd date");

const sourceChangeEventSchema = z
  .object({
    /** The source-register record id the change applies to. */
    sourceId: z.string().trim().min(1).max(200),
    /** The date the publisher changed the source, or the date it was detected when the publisher states none. */
    changedOn: isoDate,
    /** What changed, in a sentence. */
    summary: z.string().trim().min(1).max(600),
    detectedBy: z.enum(["source-watch", "manual"]),
    /** The named person who confirmed the change. */
    confirmedBy: z.string().trim().min(1).max(120),
    confirmedOn: isoDate,
  })
  .strict();

const sourceChangeRegisterSchema = z
  .object({
    version: z.literal(1),
    note: z.string(),
    events: z.array(sourceChangeEventSchema).max(5_000),
  })
  .strict();

export type SourceChangeEvent = z.infer<typeof sourceChangeEventSchema>;

/**
 * Parsed once at load. A malformed register throws rather than silently dropping an
 * entry: a dropped entry is a guideline change no page would flag, which is the unsafe
 * direction. `tests/source-change-events.test.ts` keeps the committed file valid.
 */
export function parseSourceChangeRegister(input: unknown): readonly SourceChangeEvent[] {
  return sourceChangeRegisterSchema.parse(input).events;
}

export const sourceChangeEvents: readonly SourceChangeEvent[] = parseSourceChangeRegister(sourceChangeRegister);

/**
 * Confirmed changes to any of `sourceIds` made after `sinceIsoDate`, newest first.
 * With no known review date, every confirmed change to a cited source counts.
 */
export function confirmedSourceChangesAfter(
  sourceIds: readonly string[],
  sinceIsoDate: string | null,
  events: readonly SourceChangeEvent[] = sourceChangeEvents,
): SourceChangeEvent[] {
  if (!sourceIds.length || !events.length) return [];
  const cited = new Set(sourceIds);
  return events
    .filter((event) => cited.has(event.sourceId) && (sinceIsoDate === null || event.changedOn > sinceIsoDate))
    .sort((a, b) => b.changedOn.localeCompare(a.changedOn) || a.sourceId.localeCompare(b.sourceId));
}
