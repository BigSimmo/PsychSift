import { showableSourceRecords, type MedicationSourceLink } from "@/lib/medication-source-links";
import type { SourceAcquisitionRecord } from "@/lib/sources/acquisition-ledger";
import { therapyCitedSourceIds, type TherapySourceLinkMap } from "@/lib/therapy-source-link-ids";

export type TherapySourceLink = MedicationSourceLink;

/**
 * The confirmed, current source links for one therapy page, resolved on the server.
 * Same rule as medication pages: anything not adopted and signed off by the owner as
 * it now stands, stale, or without a governed URL renders nothing.
 */
export function therapySourceLinks(
  slug: string,
  options: { links?: TherapySourceLinkMap; records?: readonly SourceAcquisitionRecord[] } = {},
): TherapySourceLink[] {
  return showableSourceRecords(therapyCitedSourceIds(slug, options.links), options.records).map(({ record, href }) => ({
    id: record.id,
    title: record.title,
    publisher: record.publisher,
    href,
  }));
}
