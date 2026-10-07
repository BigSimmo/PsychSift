import { withoutExampleRecords } from "@/lib/example-data/guards";
import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import { complianceExpiresOn, isComplianceEntry } from "@/lib/on-call/compliance";
import { isOnCallHttpUrl, type OnCallEntry } from "@/lib/on-call/entry-model";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";
import { DOCUMENT_FOLDERS, type AdminDocument, type DocumentFolder } from "@/lib/work-screens/admin/paperwork-model";

/**
 * Admin · Documents: where the doctor's own work documents are (contract,
 * registration, certificates, training, payslips). PsychSift keeps the list,
 * never the file: the app's upload path indexes a document and sends it to a
 * provider, and a registration certificate is identity data that has no
 * business there (`logisticsDetails.evidenceUrl`). So each entry says where the
 * file is kept, with an optional link the doctor owns.
 *
 * Renewals rows that already carry a proof link or note are shown beside the
 * list, read only, so nothing is typed twice.
 */

export const DOCUMENT_FOLDER_WORDS: Record<DocumentFolder, string> = {
  contracts: "Contracts",
  registration: "Registration",
  certificates: "Cards and certificates",
  training: "Training",
  pay: "Payslips",
  other: "Other",
};

/** Within this many days of its end date a document reads "Ends soon". */
export const DOCUMENT_ENDS_SOON_DAYS = 60;

export type DocumentState = "current" | "ends-soon" | "date-passed" | "no-end-date";

export function documentState(document: Pick<AdminDocument, "expiresOn">, today: string): DocumentState {
  if (!document.expiresOn) return "no-end-date";
  if (document.expiresOn < today) return "date-passed";
  if (document.expiresOn <= addDaysToDate(today, DOCUMENT_ENDS_SOON_DAYS)) return "ends-soon";
  return "current";
}

export const DOCUMENT_STATE_WORDS: Record<DocumentState, string> = {
  current: "Current",
  "ends-soon": "Ends soon",
  "date-passed": "Date passed",
  "no-end-date": "No end date",
};

export function documentLine(document: AdminDocument): string {
  const parts: string[] = [];
  if (document.expiresOn) parts.push(`Ends ${formatRecordedDate(document.expiresOn)}`);
  else if (document.issuedOn) parts.push(`Issued ${formatRecordedDate(document.issuedOn)}`);
  parts.push(document.keptAt ? `Kept in ${document.keptAt}` : "Where it is kept not added");
  return parts.join(" · ");
}

export interface RenewalProof {
  readonly id: string;
  readonly title: string;
  readonly line: string;
  readonly url: string | null;
  readonly href: string;
}

function detail(entry: OnCallEntry, key: string): string | null {
  const details = entry.details;
  const value = details && typeof details === "object" ? (details as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Renewals rows with proof recorded, and the count of rows with none. */
export function renewalProofs(own: readonly OnCallEntry[]): { withProof: RenewalProof[]; missing: number } {
  const compliance = own.filter(isComplianceEntry);
  const withProof: RenewalProof[] = [];
  let missing = 0;
  for (const entry of compliance) {
    const note = detail(entry, "proofNote");
    const link = detail(entry, "evidenceUrl");
    const url = link && isOnCallHttpUrl(link) ? link : null;
    if (!note && !url) {
      missing += 1;
      continue;
    }
    const expires = complianceExpiresOn(entry);
    withProof.push({
      id: entry.id,
      title: entry.title,
      line: [note, expires ? `Ends ${formatRecordedDate(expires)}` : null].filter(Boolean).join(" · ") || "Link saved",
      url,
      href: `/admin/renewals?item=${entry.id}`,
    });
  }
  withProof.sort((a, b) => a.title.localeCompare(b.title));
  return { withProof, missing };
}

export interface DocumentFolderView {
  readonly folder: DocumentFolder;
  readonly label: string;
  readonly documents: readonly AdminDocument[];
}

/** Folders that hold something, in a fixed order, each soonest end first. */
export function documentFolders(documents: readonly AdminDocument[], query = ""): DocumentFolderView[] {
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? documents.filter((document) =>
        [document.title, document.keptAt, document.note, DOCUMENT_FOLDER_WORDS[document.folder]]
          .filter(Boolean)
          .some((text) => text!.toLowerCase().includes(needle)),
      )
    : documents;
  return DOCUMENT_FOLDERS.flatMap((folder) => {
    const inFolder = matching
      .filter((document) => document.folder === folder)
      .sort((a, b) => ((a.expiresOn ?? "9999") < (b.expiresOn ?? "9999") ? -1 : a.title.localeCompare(b.title)));
    return inFolder.length ? [{ folder, label: DOCUMENT_FOLDER_WORDS[folder], documents: inFolder }] : [];
  });
}

export function documentCounts(documents: readonly AdminDocument[], today: string) {
  const states = documents.map((document) => documentState(document, today));
  return {
    total: documents.length,
    endsSoon: states.filter((state) => state === "ends-soon").length,
    datePassed: states.filter((state) => state === "date-passed").length,
  };
}

export interface DocumentDraft {
  readonly title: string;
  readonly folder: DocumentFolder;
  readonly issuedOn: string;
  readonly expiresOn: string;
  readonly keptAt: string;
  readonly url: string;
  readonly note: string;
}

export function validateDocumentDraft(draft: DocumentDraft): { title?: string; url?: string; expiresOn?: string } {
  const errors: { title?: string; url?: string; expiresOn?: string } = {};
  if (!draft.title.trim()) errors.title = "Name the document.";
  const url = draft.url.trim();
  if (url && !isOnCallHttpUrl(url)) errors.url = "Use a link that starts with https://";
  if (draft.issuedOn && draft.expiresOn && draft.expiresOn < draft.issuedOn)
    errors.expiresOn = "The end date is before it was issued.";
  return errors;
}

export function documentFromDraft(draft: DocumentDraft, id: string, addedOn: string): AdminDocument {
  const optional = (value: string) => (value.trim() ? value.trim() : undefined);
  const document: AdminDocument = {
    id,
    title: draft.title.trim(),
    folder: draft.folder,
    addedOn,
    issuedOn: optional(draft.issuedOn),
    expiresOn: optional(draft.expiresOn),
    keptAt: optional(draft.keptAt),
    url: optional(draft.url),
    note: optional(draft.note),
  };
  return Object.fromEntries(Object.entries(document).filter(([, value]) => value !== undefined)) as AdminDocument;
}

/** A plain list of where everything is, for the doctor's own records. */
export function documentsListText(documents: readonly AdminDocument[], today: string): string {
  const lines = [`My work documents, as I recorded them, ${formatRecordedDate(today)}`, ""];
  for (const view of documentFolders(withoutExampleRecords(documents))) {
    lines.push(view.label);
    for (const document of view.documents) {
      lines.push(`- ${document.title}: ${documentLine(document)}${document.url ? ` · ${document.url}` : ""}`);
    }
    lines.push("");
  }
  lines.push("Kept by me. Not checked with any issuer.");
  return lines.join("\n");
}
