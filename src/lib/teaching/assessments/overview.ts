import { cmeCsvCell } from "@/lib/cme/export";
import { epasInTerm, stage, type AssessmentsState } from "@/lib/teaching/assessments/model";
import { SAMPLE_DOCTOR, SAMPLE_MIDTERM, SAMPLE_SUPERVISOR } from "@/lib/teaching/assessments/sample";
import { DEFAULT_EPA_TARGETS } from "@/lib/teaching/term-tracker";

/*
 * The term assessments overview (feature 4, mock-up nf_assess_dct): every doctor's mid-term, EPAs and
 * end-of-term for the term as status tags only, with a one-tap Remind to the supervisor and Undo.
 *
 * MADE-UP SAMPLE ONLY, in page memory. Status and counts only: ratings, comments and goals are never part
 * of this view, so they cannot leak from it. Dr Sam Lee's row follows the sample's own story; the other
 * doctors and supervisors are invented. A reminder here is pretend: nothing is sent to anyone.
 */

export type CellStatus = "done" | "due" | "overdue" | "not_yet";
export type DoctorBucket = "overdue" | "due" | "on_track";
export type OverviewFilter = "all" | DoctorBucket;
export type FormKind = "mid" | "end";

export const CELL_WORDS: Record<CellStatus, string> = {
  done: "Done",
  due: "Due",
  overdue: "Overdue",
  not_yet: "Not open yet",
};

export const OVERVIEW_FILTERS: readonly { id: OverviewFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "due", label: "Due" },
  { id: "on_track", label: "On track" },
];

export interface OverviewCell {
  readonly status: CellStatus;
  /** "Done Fri 2 Oct", "Due Fri 16 Oct", "Overdue since Fri 2 Oct", "1 of 2" */
  readonly detail: string;
}

export interface OverviewDoctor {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly grade: "PGY1" | "PGY2";
  readonly unit: string;
  readonly supervisor: string;
  readonly mid: OverviewCell;
  readonly epas: OverviewCell & { readonly count: number };
  readonly end: OverviewCell;
  readonly bucket: DoctorBucket;
}

const NAIR = SAMPLE_SUPERVISOR.name;
const AHMED = "Dr Omar Ahmed";
const ITO = "Dr Hana Ito";

type Fixed = {
  id: string;
  name: string;
  initials: string;
  grade: "PGY1" | "PGY2";
  unit: string;
  supervisor: string;
  /** Mid-term: done on a date, or due on a date that turns overdue once passed. */
  mid: { done: string } | { due: string; overdueFrom: number };
  epas: number;
};

/** Day -1 is Mon 5 Oct; window days 0 to 9 are Mon 26 Oct to Fri 6 Nov. Overdue from day 0 is "by the window". */
const FIXED: readonly Fixed[] = [
  {
    id: "ben",
    name: "Dr Ben Ortiz",
    initials: "BO",
    grade: "PGY2",
    unit: "Psychiatry",
    supervisor: NAIR,
    mid: { due: "Fri 16 Oct", overdueFrom: 0 },
    epas: 1,
  },
  {
    id: "mia",
    name: "Dr Mia Chen",
    initials: "MC",
    grade: "PGY2",
    unit: "Psychiatry",
    supervisor: NAIR,
    mid: { done: "Thu 1 Oct" },
    epas: 1,
  },
  {
    id: "ravi",
    name: "Dr Ravi Kaur",
    initials: "RK",
    grade: "PGY1",
    unit: "General medicine",
    supervisor: AHMED,
    mid: { due: "Fri 2 Oct", overdueFrom: -1 },
    epas: 0,
  },
  {
    id: "ella",
    name: "Dr Ella Okafor",
    initials: "EO",
    grade: "PGY1",
    unit: "General medicine",
    supervisor: AHMED,
    mid: { done: "Fri 2 Oct" },
    epas: 1,
  },
  {
    id: "tom",
    name: "Dr Tom Fraser",
    initials: "TF",
    grade: "PGY1",
    unit: "Emergency",
    supervisor: ITO,
    mid: { due: "Fri 2 Oct", overdueFrom: -1 },
    epas: 2,
  },
  {
    id: "lucy",
    name: "Dr Lucy Webb",
    initials: "LW",
    grade: "PGY2",
    unit: "Emergency",
    supervisor: ITO,
    mid: { due: "Fri 16 Oct", overdueFrom: 0 },
    epas: 2,
  },
  {
    id: "noah",
    name: "Dr Noah Singh",
    initials: "NS",
    grade: "PGY1",
    unit: "Surgery",
    supervisor: ITO,
    mid: { done: "Wed 30 Sep" },
    epas: 3,
  },
];

const TARGET = DEFAULT_EPA_TARGETS.perTerm;

function epaCell(count: number): OverviewCell & { count: number } {
  return { status: count >= TARGET ? "done" : "due", detail: `${count}\u00a0of\u00a0${TARGET}`, count };
}

/** End-of-term opens with the window on Mon 26 Oct and goes to the MEU by Fri 20 Nov. */
function endCell(now: number, signed: boolean): OverviewCell {
  if (signed) return { status: "done", detail: "Signed by both" };
  return now < 0 ? { status: "not_yet", detail: "Opens Mon 26 Oct" } : { status: "due", detail: "Due Fri 20 Nov" };
}

function bucketOf(cells: readonly OverviewCell[]): DoctorBucket {
  if (cells.some((c) => c.status === "overdue")) return "overdue";
  if (cells.some((c) => c.status === "due")) return "due";
  return "on_track";
}

export function overviewDoctors(s: AssessmentsState): OverviewDoctor[] {
  const st = stage(s);
  const samEpas = epasInTerm(s, "t4").length;
  const sam = {
    id: "sam",
    name: SAMPLE_DOCTOR.name,
    initials: SAMPLE_DOCTOR.initials,
    grade: SAMPLE_DOCTOR.grade,
    unit: "Psychiatry",
    supervisor: NAIR,
    mid: { status: "done", detail: `Done ${SAMPLE_MIDTERM.date}` } as OverviewCell,
    epas: epaCell(samEpas),
    end: endCell(s.now, st === "doc-signed"),
  };
  const rows = [
    { ...sam, bucket: bucketOf([sam.mid, sam.epas, sam.end]) },
    ...FIXED.map((f) => {
      const mid: OverviewCell =
        "done" in f.mid
          ? { status: "done", detail: `Done ${f.mid.done}` }
          : s.now >= f.mid.overdueFrom
            ? { status: "overdue", detail: `Overdue since ${f.mid.due}` }
            : { status: "due", detail: `Due ${f.mid.due}` };
      const epas = epaCell(f.epas);
      const end = endCell(s.now, false);
      return {
        id: f.id,
        name: f.name,
        initials: f.initials,
        grade: f.grade,
        unit: f.unit,
        supervisor: f.supervisor,
        mid,
        epas,
        end,
        bucket: bucketOf([mid, epas, end]),
      };
    }),
  ];
  const order: Record<DoctorBucket, number> = { overdue: 0, due: 1, on_track: 2 };
  return rows.sort((a, b) => order[a.bucket] - order[b.bucket] || a.name.localeCompare(b.name));
}

export function filterOverview(rows: readonly OverviewDoctor[], filter: OverviewFilter): OverviewDoctor[] {
  return filter === "all" ? [...rows] : rows.filter((r) => r.bucket === filter);
}

export function overviewCounts(rows: readonly OverviewDoctor[]): Record<OverviewFilter, number> {
  return {
    all: rows.length,
    overdue: rows.filter((r) => r.bucket === "overdue").length,
    due: rows.filter((r) => r.bucket === "due").length,
    on_track: rows.filter((r) => r.bucket === "on_track").length,
  };
}

export interface MidTermSummary {
  readonly done: number;
  readonly due: number;
  readonly overdue: number;
  readonly total: number;
  /** The meter's words for a screen reader: "Mid-term: 4 done, 2 due, 2 overdue, of 8 doctors." */
  readonly label: string;
}

export function midTermSummary(rows: readonly OverviewDoctor[]): MidTermSummary {
  const done = rows.filter((r) => r.mid.status === "done").length;
  const due = rows.filter((r) => r.mid.status === "due").length;
  const overdue = rows.filter((r) => r.mid.status === "overdue").length;
  return {
    done,
    due,
    overdue,
    total: rows.length,
    label: `Mid-term: ${done} done, ${due} due, ${overdue} overdue, of ${rows.length} doctors.`,
  };
}

/** The forms a reminder can be about: a mid-term or end-of-term that is due or overdue. EPAs are the doctor's to ask for. */
export function remindableForms(row: OverviewDoctor): FormKind[] {
  const out: FormKind[] = [];
  if (row.mid.status === "due" || row.mid.status === "overdue") out.push("mid");
  if (row.end.status === "due" || row.end.status === "overdue") out.push("end");
  return out;
}

/** One reminder a day per form: the key carries the made-up day, so moving the date allows another. */
export function reminderKey(doctorId: string, form: FormKind, now: number): string {
  return `${doctorId}:${form}:${now}`;
}

export function formWord(form: FormKind): string {
  return form === "mid" ? "mid-term" : "end-of-term";
}

export interface SupervisorGroup {
  readonly name: string;
  readonly doctors: readonly OverviewDoctor[];
  readonly overdue: number;
  readonly due: number;
}

export function supervisorGroups(rows: readonly OverviewDoctor[]): SupervisorGroup[] {
  const map = new Map<string, OverviewDoctor[]>();
  for (const row of rows) map.set(row.supervisor, [...(map.get(row.supervisor) ?? []), row]);
  return [...map.entries()]
    .map(([name, doctors]) => ({
      name,
      doctors,
      overdue: doctors.filter((d) => d.mid.status === "overdue" || d.end.status === "overdue").length,
      due: doctors.filter((d) => d.mid.status === "due" || d.end.status === "due").length,
    }))
    .sort((a, b) => b.overdue - a.overdue || b.due - a.due || a.name.localeCompare(b.name));
}

export const OVERVIEW_PRIVACY_LINE = "Status only. Ratings and comments are never shown here.";

/** Status-only CSV of the overview: no ratings, comments or goals exist in it to export. */
export function overviewCsv(rows: readonly OverviewDoctor[], dateLabel: string): string {
  const lines = [
    ["Made-up example, not real doctors", dateLabel],
    ["Doctor", "Grade", "Unit", "Supervisor", "Mid-term", "EPAs this term", "End-of-term"],
    ...rows.map((r) => [r.name, r.grade, r.unit, r.supervisor, r.mid.detail, r.epas.detail, r.end.detail]),
  ];
  return lines.map((line) => line.map(cmeCsvCell).join(",")).join("\r\n") + "\r\n";
}

export const OVERVIEW_CSV_NAME = "made-up-term-assessments-status.csv";
