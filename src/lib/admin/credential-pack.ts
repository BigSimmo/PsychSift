import { formatDateEcho, formatRecordedDate } from "@/lib/admin/renewal-dates";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import {
  complianceExpiresOn,
  entryNotForThisJob,
  partitionLogisticsEntries,
  sortComplianceEntries,
} from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

/**
 * The credential pack: the registration numbers and renewal dates a new
 * employer's medical workforce team asks for, gathered into one page the
 * doctor previews, trims and then saves as a PDF or shares from their own
 * device. Nothing here is uploaded: the numbers come from the wallet stored on
 * this device, the renewals from the doctor's own Admin records, and the page
 * is turned into a PDF by the browser's own print dialogue.
 *
 * Deliberately left out: the radiation licence (stored by the wallet but never
 * shown, and due to be removed), earlier expiry dates, and "where your proof
 * is" notes, which are private reminders rather than anything an employer
 * needs. Rows with nothing recorded are left out too, so the pack never shows
 * a blank number.
 */

/** The wallet fields the pack reads. A structural type, so the wallet's own type can drop fields freely. */
export type CredentialPackNumbers = {
  readonly ahpraNumber?: string;
  readonly prescriberNumber?: string;
  readonly wwccNumber?: string;
  readonly providerNumbers?: readonly { readonly id: string; readonly site: string; readonly number: string }[];
};

export type CredentialPackRow = {
  /** Stable across renders: the include toggles key on it. */
  readonly key: string;
  readonly title: string;
  readonly value: string;
  readonly lines: readonly string[];
};

export type CredentialPackSection = {
  readonly label: "Registration numbers" | "Renewals";
  readonly rows: readonly CredentialPackRow[];
};

export const CREDENTIAL_PACK_NOTE =
  "Prepared by the doctor from their own records. Not checked with AHPRA or any issuer.";

function trimmed(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberRows(numbers: CredentialPackNumbers): CredentialPackRow[] {
  const fixed: CredentialPackRow[] = [
    { key: "number-ahpra", title: "AHPRA registration", value: trimmed(numbers.ahpraNumber), lines: [] },
    { key: "number-prescriber", title: "Prescriber number", value: trimmed(numbers.prescriberNumber), lines: [] },
    { key: "number-wwcc", title: "Working with Children Check", value: trimmed(numbers.wwccNumber), lines: [] },
  ];
  const providers = (Array.isArray(numbers.providerNumbers) ? numbers.providerNumbers : []).map((entry) => ({
    key: `number-provider-${entry.id}`,
    title: trimmed(entry.site) ? `Medicare provider number · ${trimmed(entry.site)}` : "Medicare provider number",
    value: trimmed(entry.number),
    lines: [],
  }));
  return [...fixed, ...providers].filter((row) => row.value.length > 0);
}

function issuerOf(entry: OnCallEntry): string | null {
  const details = entry.details;
  const value =
    typeof details === "object" && details !== null ? (details as Record<string, unknown>).issuingBody : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function renewalRows(ownEntries: readonly OnCallEntry[]): CredentialPackRow[] {
  const { compliance } = partitionLogisticsEntries(ownEntries);
  return sortComplianceEntries(compliance.filter((entry) => !entryNotForThisJob(entry))).map((entry) => {
    const expiresOn = complianceExpiresOn(entry);
    const issuer = issuerOf(entry);
    return {
      key: `renewal-${entry.id}`,
      title: entry.title,
      value: expiresOn ? `Expires ${formatRecordedDate(expiresOn)}` : "No end date recorded",
      lines: issuer ? [`Issued by ${issuer}`] : [],
    };
  });
}

/** Both sections, empty ones left out. Own entries only: the caller passes `selectAdminOwnEntries`. */
export function buildCredentialPack(input: {
  readonly numbers: CredentialPackNumbers;
  readonly ownEntries: readonly OnCallEntry[];
}): CredentialPackSection[] {
  const sections: CredentialPackSection[] = [
    { label: "Registration numbers", rows: numberRows(input.numbers) },
    { label: "Renewals", rows: renewalRows(input.ownEntries) },
  ];
  return sections.filter((section) => section.rows.length > 0);
}

/** Only the rows the doctor kept ticked. Every row starts ticked; `excluded` holds the unticked keys. */
export function includedCredentialPack(
  sections: readonly CredentialPackSection[],
  excluded: ReadonlySet<string>,
): CredentialPackSection[] {
  return sections
    .map((section) => ({ ...section, rows: section.rows.filter((row) => !excluded.has(row.key)) }))
    .filter((section) => section.rows.length > 0);
}

/** The same rows as plain text, for Copy and the phone's share sheet. Empty when nothing is included. */
export function credentialPackText(sections: readonly CredentialPackSection[], now: Date): string {
  if (sections.length === 0) return "";
  const lines = [`Credential pack · ${formatDateEcho(perthCalendarDate(now))}`];
  for (const section of sections) {
    lines.push("", section.label);
    for (const row of section.rows) {
      lines.push(`${row.title}: ${row.value}`);
      for (const line of row.lines) lines.push(`  ${line}`);
    }
  }
  lines.push("", CREDENTIAL_PACK_NOTE);
  return lines.join("\n");
}
