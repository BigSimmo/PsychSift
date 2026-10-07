import { cmeCsvCell } from "@/lib/cme/export";
import { epa as epaInfo, supervisionLevelName } from "@/lib/teaching/assessments/content";
import { epaRecords, stage, type AssessmentsState } from "@/lib/teaching/assessments/model";
import { overviewCsv, overviewDoctors } from "@/lib/teaching/assessments/overview";
import { CURRENT_TERM, SAMPLE_DOCTOR, SAMPLE_MIDTERM, SAMPLE_TERMS } from "@/lib/teaching/assessments/sample";
import { exampleId, withoutExampleRecords } from "@/lib/work-screens/assessments/sample";

/*
 * Assessments › Export (`/teaching/assessments/export`, mock-ups assess_export and assess_pdf): the
 * supervisor's records as files. Spreadsheets are made on the page (EPAs, and every doctor's term
 * status, status only), and each signed form opens its printable copy to save as a PDF. Supervision
 * hours are not in this sample: they live, for real, in Supervision.
 *
 * MADE-UP SAMPLE ONLY. Every row built here is marked as an example record, and the files keep only
 * rows that pass `withoutExampleRecords`, so made-up rows are never saved to a file. Until Assessments
 * can keep real records, the page shows what the files will hold and says why Save is not offered.
 */

export type ExportPeriod = "term" | "year";
export const EXPORT_PERIODS: readonly { value: ExportPeriod; label: string }[] = [
  { value: "term", label: "This term" },
  { value: "year", label: "This year" },
];

export interface AssessmentsExportOptions {
  readonly forms: boolean;
  readonly epas: boolean;
  readonly status: boolean;
  /** "all", or one doctor's overview id ("sam", "ben"). */
  readonly doctor: string;
  readonly period: ExportPeriod;
}

export const DEFAULT_ASSESSMENTS_EXPORT: AssessmentsExportOptions = {
  forms: true,
  epas: true,
  status: true,
  doctor: "all",
  period: "term",
};

export interface ExportDoctor {
  readonly id: string;
  readonly name: string;
}

export function exportDoctors(s: AssessmentsState): ExportDoctor[] {
  return overviewDoctors(s)
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => Number(b.id === "sam") - Number(a.id === "sam") || a.name.localeCompare(b.name));
}

/** EPAs are recorded in this sample for the sample doctor only. */
function includesSam(options: AssessmentsExportOptions): boolean {
  return options.doctor === "all" || options.doctor === "sam";
}

export function epaExportRows(s: AssessmentsState, options: AssessmentsExportOptions) {
  if (!includesSam(options)) return [];
  return epaRecords(s)
    .filter((r) => options.period === "year" || r.term === CURRENT_TERM.id)
    .map((r, index) => {
      const term = SAMPLE_TERMS.find((t) => t.id === r.term)!;
      return {
        id: exampleId(`epa-${r.term}-${index}`),
        doctor: SAMPLE_DOCTOR.name,
        term: `Term ${term.n} · ${term.name}`,
        epa: `EPA ${r.epa}`,
        title: epaInfo(r.epa).title,
        level: supervisionLevelName(r.level),
        by: r.by,
        role: r.role,
      };
    });
}

export function epaCsv(s: AssessmentsState, options: AssessmentsExportOptions, dateLabel: string): string {
  const lines: string[][] = [
    ["EPAs", dateLabel],
    ["Doctor", "Term", "EPA", "Activity", "Supervision needed", "Recorded by", "Role"],
    ...withoutExampleRecords(epaExportRows(s, options)).map((r) => [
      r.doctor,
      r.term,
      r.epa,
      r.title,
      r.level,
      r.by,
      r.role,
    ]),
  ];
  if (lines.length === 2) lines.push(["None recorded for this choice"]);
  lines.push([], ["Supervision levels only. Feedback text is never exported here."]);
  return lines.map((line) => line.map(cmeCsvCell).join(",")).join("\r\n") + "\r\n";
}

export function statusCsv(s: AssessmentsState, options: AssessmentsExportOptions, dateLabel: string): string {
  return overviewCsv(withoutExampleRecords(statusExportRows(s, options)), dateLabel);
}

/** Every doctor's term status for the choice, each marked as an example record (the sample's doctors). */
export function statusExportRows(s: AssessmentsState, options: AssessmentsExportOptions) {
  return overviewDoctors(s)
    .filter((r) => options.doctor === "all" || r.id === options.doctor)
    .map((r) => ({ ...r, id: exampleId(r.id) }));
}

/** What the chosen files would hold, and how much of it may be saved (made-up rows never are). */
export function exportPreview(s: AssessmentsState, options: AssessmentsExportOptions) {
  const epas = options.epas ? epaExportRows(s, options) : [];
  const status = options.status ? statusExportRows(s, options) : [];
  return {
    epaRows: epas.length,
    statusRows: status.length,
    saveable: withoutExampleRecords(epas).length + withoutExampleRecords(status).length,
  };
}

export const EXAMPLE_NOT_SAVED =
  "Made-up records are never saved to a file. Your own records will save here once Assessments can keep them.";

export interface SignedForm {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly href: string;
}

/** The signed forms there are to save, newest first. The sample holds forms for its own doctor only. */
export function signedForms(s: AssessmentsState, options: AssessmentsExportOptions): SignedForm[] {
  if (!includesSam(options)) return [];
  const out: SignedForm[] = [];
  if (stage(s) === "doc-signed")
    out.push({
      id: "t4-eot",
      title: "End-of-term · Psychiatry",
      detail: "Signed by you both",
      href: pdfHref({ of: "eot" }),
    });
  out.push({
    id: "t4-mid",
    title: "Mid-term · Psychiatry",
    detail: `Both signed ${SAMPLE_MIDTERM.date}`,
    href: pdfHref({ of: "mid" }),
  });
  if (options.period === "year")
    for (const term of SAMPLE_TERMS.filter((t) => t.status === "done").reverse()) {
      if (term.signed)
        out.push({
          id: `${term.id}-eot`,
          title: `End-of-term · ${term.name}`,
          detail: `Signed ${term.signed}`,
          href: pdfHref({ of: "past", kind: "eot", term: term.id }),
        });
      if (term.midSigned)
        out.push({
          id: `${term.id}-mid`,
          title: `Mid-term · ${term.name}`,
          detail: `Signed ${term.midSigned}`,
          href: pdfHref({ of: "past", kind: "mid", term: term.id }),
        });
    }
  return out;
}

export interface ExportFile {
  readonly id: "epas" | "status";
  readonly name: string;
}

export function exportFiles(options: AssessmentsExportOptions): ExportFile[] {
  const suffix = options.doctor === "all" ? "all-doctors" : options.doctor;
  const files: ExportFile[] = [];
  if (options.epas) files.push({ id: "epas", name: `epas-${options.period}-${suffix}.csv` });
  if (options.status) files.push({ id: "status", name: `term-status-${suffix}.csv` });
  return files;
}

/** Why the Save button cannot run, in plain words, or null. */
export function exportBlocker(s: AssessmentsState, options: AssessmentsExportOptions): string | null {
  if (!options.epas && !options.status)
    return options.forms ? "Open each form below to see its printable copy." : "Choose what to include.";
  if (exportPreview(s, options).saveable === 0) return EXAMPLE_NOT_SAVED;
  return null;
}

/** "Save 2 spreadsheets", "Save 1 spreadsheet". */
export function exportButtonLabel(options: AssessmentsExportOptions): string {
  const n = exportFiles(options).length;
  return n === 1 ? "Save 1 spreadsheet" : `Save ${n} spreadsheets`;
}

/** The signed-form PDF view inside the Assessments page, as the supervisor sees it. */
export function pdfHref(params: Record<string, string>): string {
  return `/teaching/assessments?${new URLSearchParams({ view: "pdf", ...params, as: "supervisor" }).toString()}`;
}
