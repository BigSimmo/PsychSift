import { totalAllocatedHours } from "@/lib/cme/evaluate";
import type { CmeEntry } from "@/lib/cme/types";

/**
 * The CV that fills itself (#22): lines built only from records the doctor
 * already keeps in PsychSift. Nothing is written for them except the order:
 * the registration renewal date they recorded in Admin, terms from the
 * Teaching term tracker, teaching they gave and attended from Teaching,
 * registrars they supervise (Assessments), hours and outcome work from the
 * CPD log, and a personal statement only in their own words. Any line can be hidden; hidden lines stay on screen struck
 * through so they can be shown again, and are left out of every copy and print.
 */

export type CvSource = "admin" | "terms" | "teaching" | "assessments" | "cpd" | "you";
export const cvSourceLabels: Record<CvSource, string> = {
  admin: "Admin",
  terms: "Term tracker",
  teaching: "Teaching",
  assessments: "Assessments",
  cpd: "CPD",
  you: "Your words",
};

export type CvLine = {
  /** Stable across loads, so a hidden line stays hidden. */
  readonly id: string;
  readonly title: string;
  readonly sub: string | null;
  readonly source: CvSource;
};

export type CvSection = { readonly id: string; readonly title: string; readonly lines: readonly CvLine[] };

export type CvRange = "year" | "two" | "all";
export const cvRangeLabels: Record<CvRange, string> = { year: "This year", two: "2 years", all: "All years" };

export type CvTerm = {
  readonly id: string;
  readonly number: number | null;
  readonly unit: string;
  readonly site: string;
  readonly startsOn: string;
  readonly endsOn: string;
};
export type CvTalk = { readonly occurrenceId: string; readonly title: string; readonly startsAt: string };
/** A teaching session the doctor's attendance was recorded at (Teaching logbook). */
export type CvAttended = { readonly occurrenceId: string; readonly startsAt: string };
/** A supervision pairing where the doctor is the supervisor. Never the registrar's name. */
export type CvSupervising = { readonly pairingId: string; readonly startsOn: string; readonly endsOn: string };
/** The medical registration renewal date the doctor recorded in Admin. */
export type CvRegistration = { readonly expiresOn: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const OUTCOME_LINE_LIMIT = 6;

function dayMonthYear(on: string): string {
  const [year, month, day] = on.split("-").map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function formatHours(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded} h`;
}

/** The first year a range keeps, given the current year. */
export function cvFirstYear(range: CvRange, thisYear: number): number {
  if (range === "year") return thisYear;
  if (range === "two") return thisYear - 1;
  return 1900;
}

function perthDateOfInstant(instant: string): string {
  return new Date(Date.parse(instant) + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function buildCv(input: {
  readonly entries: readonly CmeEntry[];
  readonly terms: readonly CvTerm[];
  readonly talks: readonly CvTalk[];
  readonly attended?: readonly CvAttended[];
  readonly supervising?: readonly CvSupervising[];
  readonly registration?: CvRegistration | null;
  readonly statement: string;
  readonly range: CvRange;
  readonly today: string;
}): CvSection[] {
  const thisYear = Number(input.today.slice(0, 4));
  const firstYear = cvFirstYear(input.range, thisYear);
  const inRange = (on: string) => Number(on.slice(0, 4)) >= firstYear && on <= `${thisYear}-12-31`;
  const sections: CvSection[] = [];

  // Only a date still to come: a passed renewal date is something to fix in Admin, not a CV line.
  const registration = input.registration;
  if (registration && /^\d{4}-\d{2}-\d{2}$/.test(registration.expiresOn) && registration.expiresOn >= input.today)
    sections.push({
      id: "registration",
      title: "Registration",
      lines: [
        {
          id: "admin:registration",
          title: "Medical registration",
          sub: `Renewal date you recorded: ${dayMonthYear(registration.expiresOn)}`,
          source: "admin",
        },
      ],
    });

  const terms = input.terms
    .filter((term) => inRange(term.endsOn) || inRange(term.startsOn))
    .filter((term) => term.startsOn <= input.today)
    .sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  if (terms.length)
    sections.push({
      id: "terms",
      title: "Terms",
      lines: terms.map((term) => ({
        id: `term:${term.id}`,
        title: [term.unit, term.site].filter(Boolean).join(", ") || (term.number ? `Term ${term.number}` : "Term"),
        sub: `${term.number ? `Term ${term.number} · ` : ""}${dayMonthYear(term.startsOn)} to ${dayMonthYear(term.endsOn)}`,
        source: "terms" as const,
      })),
    });

  const talks = input.talks
    .map((talk) => ({ ...talk, on: perthDateOfInstant(talk.startsAt) }))
    .filter((talk) => talk.on <= input.today && inRange(talk.on))
    .sort((a, b) => b.on.localeCompare(a.on));
  const teachingLines: CvLine[] = talks.map((talk) => ({
    id: `talk:${talk.occurrenceId}`,
    title: talk.title,
    sub: dayMonthYear(talk.on),
    source: "teaching" as const,
  }));
  const attendedDays = [
    ...new Map(
      (input.attended ?? [])
        .map((session) => ({ ...session, on: perthDateOfInstant(session.startsAt) }))
        .filter((session) => session.on <= input.today && inRange(session.on))
        .map((session) => [session.occurrenceId, session.on] as const),
    ).values(),
  ];
  const attendedYears = [...new Set(attendedDays.map((on) => Number(on.slice(0, 4))))].sort((a, b) => b - a);
  for (const year of attendedYears) {
    const count = attendedDays.filter((on) => on.startsWith(`${year}-`)).length;
    teachingLines.push({
      id: `attended:${year}`,
      title: "Teaching sessions attended",
      sub: `${count} ${count === 1 ? "session" : "sessions"} recorded in ${year}`,
      source: "teaching",
    });
  }
  const supervising = (input.supervising ?? []).filter(
    (pairing) => pairing.startsOn <= input.today && (inRange(pairing.startsOn) || inRange(pairing.endsOn)),
  );
  if (supervising.length) {
    const years = supervising.flatMap((pairing) => [
      Math.max(Number(pairing.startsOn.slice(0, 4)), firstYear),
      Math.min(Number(pairing.endsOn.slice(0, 4)), thisYear),
    ]);
    const from = Math.min(...years);
    const to = Math.max(...years);
    teachingLines.push({
      id: "supervising",
      title: `Supervisor to ${supervising.length} ${supervising.length === 1 ? "registrar" : "registrars"}`,
      sub: from === to ? String(from) : `${from} to ${to}`,
      source: "assessments",
    });
  }
  if (teachingLines.length) sections.push({ id: "teaching", title: "Teaching", lines: teachingLines });

  const active = input.entries.filter((entry) => !entry.archivedAt && inRange(entry.date) && entry.date <= input.today);
  const years = [...new Set(active.map((entry) => Number(entry.date.slice(0, 4))))].sort((a, b) => b - a);
  const cpdLines: CvLine[] = [];
  for (const year of years) {
    const yearEntries = active.filter((entry) => entry.date.startsWith(`${year}-`));
    const byCategory = (category: string) =>
      yearEntries
        .flatMap((entry) => entry.allocations)
        .filter((allocation) => allocation.category === category)
        .reduce((sum, allocation) => sum + allocation.hours, 0);
    const parts = [
      ["Educational", byCategory("educational")],
      ["Reviewing", byCategory("reviewing")],
      ["Outcomes", byCategory("measuring")],
    ] as const;
    cpdLines.push({
      id: `cpd:${year}:total`,
      title: `${year}: ${formatHours(totalAllocatedHours(yearEntries))} logged, ${yearEntries.length} ${yearEntries.length === 1 ? "activity" : "activities"}`,
      sub:
        parts
          .filter(([, hours]) => hours > 0)
          .map(([label, hours]) => `${label} ${formatHours(hours)}`)
          .join(" · ") || null,
      source: "cpd",
    });
    const outcomeWork = yearEntries
      .filter((entry) =>
        entry.allocations.some((allocation) => allocation.category === "measuring" && allocation.hours > 0),
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, OUTCOME_LINE_LIMIT);
    for (const entry of outcomeWork)
      cpdLines.push({
        id: `cpd:entry:${entry.id}`,
        title: entry.title.trim(),
        sub: `Measuring outcomes · ${year}`,
        source: "cpd",
      });
  }
  if (cpdLines.length) sections.push({ id: "cpd", title: "CPD", lines: cpdLines });

  const statement = input.statement.trim();
  if (statement)
    sections.push({
      id: "statement",
      title: "In your own words",
      lines: [{ id: "statement", title: statement, sub: null, source: "you" }],
    });
  return sections;
}

export function cvLineCount(sections: readonly CvSection[]): number {
  return sections.reduce((sum, section) => sum + section.lines.length, 0);
}

/** Plain text for pasting, hidden lines left out. Sections left empty by hiding are dropped too. */
export function cvPlainText(
  sections: readonly CvSection[],
  hidden: ReadonlySet<string>,
): { text: string; hiddenCount: number; shownCount: number } {
  let hiddenCount = 0;
  let shownCount = 0;
  const blocks: string[] = [];
  for (const section of sections) {
    const lines = section.lines.filter((line) => {
      if (hidden.has(line.id)) {
        hiddenCount += 1;
        return false;
      }
      shownCount += 1;
      return true;
    });
    if (!lines.length) continue;
    blocks.push(
      [section.title, ...lines.map((line) => `- ${line.title}${line.sub ? ` (${line.sub})` : ""}`)].join("\n"),
    );
  }
  return { text: blocks.join("\n\n"), hiddenCount, shownCount };
}

export function toggleHiddenLine(hidden: readonly string[], id: string): string[] {
  return hidden.includes(id) ? hidden.filter((line) => line !== id) : [...hidden, id].slice(-300);
}
