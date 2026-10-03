import medicationSourceLinkMap from "@/data/medication-source-links.json";
import {
  acquisitionAttestedContentSha256,
  acquisitionReference,
  sourceAcquisitionRecords,
  type SourceAcquisitionRecord,
} from "@/lib/sources/acquisition-ledger";
import { isCurrentActiveSourceReference } from "@/lib/sources/catalogue-core";
import type { ClinicalSourceReferenceInput } from "@/lib/sources/catalogue-types";
import { safeCanonicalSourceUrl } from "@/lib/sources/source-url-policy";

/** A source link a medication page may show: one the owner has signed off as it now stands. */
export type MedicationSourceLink = {
  id: string;
  title: string;
  publisher: string;
  href: string;
};

/** Medication slug → source-acquisition record ids (ledger #05WXHX step 2). */
export type MedicationSourceLinkMap = Readonly<Record<string, readonly string[]>>;

export const medicationSourceLinkIds: MedicationSourceLinkMap = medicationSourceLinkMap;

/**
 * True only when the owner's sign-off still covers the record exactly as it now
 * stands: adopted (a candidate is still awaiting its adoption decision, and a
 * rejected record is never shown), reviewed or approved, all three attestation
 * fields written, and the attested digest equal to the record's current content
 * digest. A record corrected after sign-off fails the digest and drops back out.
 */
export function isConfirmedAcquisitionRecord(record: SourceAcquisitionRecord): boolean {
  if (record.disposition !== "adopted") return false;
  if (record.validationStatus !== "locally_reviewed" && record.validationStatus !== "approved") return false;
  if (!record.attestedBy?.trim() || !record.attestedAt?.trim()) return false;
  const attested = record.attestedAgainstSha256?.trim();
  return Boolean(attested) && attested === acquisitionAttestedContentSha256(record);
}

type ResolveOptions = { links?: MedicationSourceLinkMap; records?: readonly SourceAcquisitionRecord[] };

/**
 * A record a medication page may show: confirmed (above) and, by the source
 * catalogue's own currency verdict, still current — not review_due, outdated,
 * past its expiry date or superseded. A signed record that has since gone stale
 * drops out rather than rendering as an unqualified link.
 */
export function isShowableMedicationSourceRecord(record: SourceAcquisitionRecord): boolean {
  return isConfirmedAcquisitionRecord(record) && isCurrentActiveSourceReference(acquisitionReference(record));
}

function showableRecords(
  slug: string,
  { links = medicationSourceLinkIds, records = sourceAcquisitionRecords }: ResolveOptions,
) {
  const ids = Object.hasOwn(links, slug) ? links[slug] : [];
  if (!ids?.length) return [];
  const byId = new Map(records.map((record) => [record.id, record]));

  return ids.flatMap((id) => {
    const record = byId.get(id);
    if (!record || !isShowableMedicationSourceRecord(record)) return [];
    const href = safeCanonicalSourceUrl(record.canonicalUrl);
    return href ? [{ record, href }] : [];
  });
}

/**
 * The confirmed, current source links for one medication page. Anything
 * unconfirmed, not adopted, stale, out of date, missing from the register or
 * without a governed URL renders nothing, so the page is unchanged until the
 * owner signs the record off.
 */
export function medicationSourceLinks(slug: string, options: ResolveOptions = {}): MedicationSourceLink[] {
  return showableRecords(slug, options).map(({ record, href }) => ({
    id: record.id,
    title: record.title,
    publisher: record.publisher,
    href,
  }));
}

/**
 * Source-catalogue references for every link a medication page actually shows,
 * each carrying the medication as its usage, so /sources and
 * `check:source-catalogue` trace the source to the page that cites it. Metadata
 * is the ledger record's own, so each merges into the record's catalogue entry.
 */
export function medicationSourceLinkReferences(
  medications: readonly { slug: string; name: string }[],
  options: ResolveOptions = {},
): ClinicalSourceReferenceInput[] {
  return medications.flatMap((medication) =>
    showableRecords(medication.slug, options).map(({ record }) =>
      acquisitionReference(record, {
        modeId: "prescribing",
        recordId: medication.slug,
        recordLabel: medication.name,
        field: "sourceLinks",
      }),
    ),
  );
}
