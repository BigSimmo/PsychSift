import { getMedicationRecord } from "@/lib/medication-snapshot";
import type { MedicationRecord } from "@/lib/medications";
import { isRetainedBootstrapReleaseId } from "@/lib/site-content/site-content-health";

/**
 * Keep medicine pages on the corrected in-repo records while the served site-content release is
 * still the retained epoch-zero bootstrap.
 *
 * Why this exists
 * ---------------
 * The live release is the 2026-08-24 freeze (#HTZPQ8), and release rows are append-only, so the
 * 20 Oct 2026 clinical content audit corrections (#3692: phenytoin albumin units, methadone first
 * dose, buprenorphine paediatric warning and the rest) never reached it. Medicine pages paint the
 * bundled record first and then swap in the API result, so without this the reader saw the
 * corrected text replaced by the pre-correction text a moment later. Forms and services already
 * have the same gate (`preferBundledFormRecord`, `preferBundledServiceRecord`).
 *
 * Gate
 * ----
 * Applies ONLY while the active release is a retained bootstrap identity. Once a real release is
 * published and activated, its medication projections win and this is a no-op.
 *
 * Governance follows the content
 * ------------------------------
 * The canonical `validationStatus` describes the release payload being replaced, not the bundled
 * text, which is awaiting clinical sign-off. A swapped record is therefore served as `unverified`,
 * the conservative value, with source governance derived from the bundled record itself.
 */
type MedicationGovernance = { validationStatus?: string; [key: string]: unknown };
type MappedMedicationEntry = { record: MedicationRecord; governance?: MedicationGovernance };

function servingRetainedBootstrap(activeReleaseId: string | null | undefined) {
  return Boolean(activeReleaseId && isRetainedBootstrapReleaseId(activeReleaseId));
}

export function preferBundledMedicationRecord<T extends MappedMedicationEntry>(
  mapped: T,
  options: { activeReleaseId?: string | null; bundledGovernance: (record: MedicationRecord) => MedicationGovernance },
): T {
  if (!servingRetainedBootstrap(options.activeReleaseId)) return mapped;
  const bundled = getMedicationRecord(mapped.record.slug);
  if (!bundled) return mapped;
  return {
    ...mapped,
    record: bundled,
    governance: { ...mapped.governance, ...options.bundledGovernance(bundled), validationStatus: "unverified" },
  };
}

/** Render-only reads (universal search) carry bare records with no governance. */
export function preferBundledMedicationPayload(
  record: MedicationRecord,
  options: { activeReleaseId?: string | null },
): MedicationRecord {
  if (!servingRetainedBootstrap(options.activeReleaseId)) return record;
  return getMedicationRecord(record.slug) ?? record;
}
