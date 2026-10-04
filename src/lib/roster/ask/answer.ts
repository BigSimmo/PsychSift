import { fortnightFor, summariseHours, type HoursExtra } from "@/lib/roster/hours";
import type { AskAssignment, AskQuestion, AskResult } from "@/lib/roster/ask/parse";
import type { RosterDisplayShift as MyShift } from "@/lib/roster/team/team-view";
import { inferShiftKind, isWorkedKind } from "@/lib/roster/shift-kind";
import { addDaysToDate, formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/roster/shifts/perth-time";

export type AskRow = { readonly label: string; readonly detail?: string };
export type AskAnswer = { readonly lines: string[]; readonly rows?: AskRow[]; readonly source: string };
export type AskAnswerData = {
  readonly today: string;
  readonly shifts: readonly MyShift[];
  readonly assignments: readonly AskAssignment[];
  readonly actorId: string | null;
  readonly teamName?: string | null;
  readonly loadedRange?: { readonly from: string; readonly to: string } | null;
  readonly publication?: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly publishedAt: string;
  } | null;
  readonly payFortnightAnchor?: string | null;
  readonly rotationEndsOn?: string | null;
  readonly leave?: readonly { readonly startsOn: string; readonly endsOn: string; readonly status?: string }[];
  /** Saved extra time for the fortnight; Ask hours answers include these. */
  readonly extras?: readonly HoursExtra[];
};

/** Team publication answers and swap/leave handoffs wait for team reads; personal hours and nights do not. */
export function askNeedsTeamReady(result: AskResult): boolean {
  if (result.kind === "change") return true;
  if (result.kind !== "question") return false;
  return (
    result.q.kind === "who_on" ||
    result.q.kind === "with_me" ||
    result.q.kind === "next_day_off" ||
    result.q.kind === "next_weekend_off"
  );
}

function source(data: AskAnswerData, team = false): string {
  if (team && data.publication) {
    return `From the ${data.teamName ? `${data.teamName} ` : ""}roster published ${formatPerthDay(perthDateOf(data.publication.publishedAt))} ${perthTimeOf(data.publication.publishedAt)}`;
  }
  if (team) return "From loaded team shifts; publication details are unavailable";
  return "From your own shifts";
}

function publishedCovers(data: AskAnswerData, from: string, to = from): boolean {
  return Boolean(
    data.actorId &&
    data.publication &&
    data.loadedRange &&
    from >= data.publication.periodStart &&
    to <= data.publication.periodEnd &&
    from >= data.loadedRange.from &&
    to <= data.loadedRange.to,
  );
}

function myAssignments(data: AskAnswerData, from: string, to = from): AskAssignment[] {
  if (!data.actorId) return [];
  return data.assignments.filter(
    (assignment) =>
      assignment.userId === data.actorId &&
      perthDateOf(assignment.startsAt) >= from &&
      perthDateOf(assignment.startsAt) <= to,
  );
}

function myShifts(data: AskAnswerData, from: string, to = from): MyShift[] {
  return data.shifts.filter((shift) => perthDateOf(shift.startsAt) >= from && perthDateOf(shift.startsAt) <= to);
}

function lineForShift(shift: Pick<MyShift, "startsAt" | "endsAt" | "kind" | "title">): string {
  const kind = shift.kind ?? inferShiftKind(shift);
  return `${formatPerthDay(perthDateOf(shift.startsAt))} ${kind === "on_call" ? "on call" : kind} · ${perthTimeOf(shift.startsAt)}`;
}

function kindOf(shift: MyShift) {
  return shift.kind ?? inferShiftKind(shift);
}

function nextWeekend(today: string): string {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDaysToDate(today, (6 - day + 7) % 7);
}

/** Answers facts already loaded on the phone. Empty data is described as missing coverage. */
export function answerQuestion(q: AskQuestion, data: AskAnswerData): AskAnswer {
  const ownSource = source(data);
  const teamSource = source(data, true);
  if (q.kind === "next_nights") {
    const next = data.shifts
      .filter((shift) => kindOf(shift) === "night" && perthDateOf(shift.startsAt) >= data.today)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    return next
      ? {
          lines: [`Your next loaded night is ${lineForShift(next)}.`],
          source: next.source === "team" ? teamSource : ownSource,
        }
      : {
          lines: ["No later night appears in the shifts loaded here. More roster dates may not be available."],
          source: ownSource,
        };
  }
  if (q.kind === "next_leave") {
    const personal = data.shifts
      .filter((shift) => kindOf(shift) === "leave" && perthDateOf(shift.startsAt) >= data.today)
      .map((shift) => ({ date: perthDateOf(shift.startsAt), detail: "Rostered leave" }));
    const recorded = (data.leave ?? [])
      .filter((leave) => leave.endsOn >= data.today)
      .map((leave) => ({ date: leave.startsOn, detail: `${leave.status ?? "Recorded"} leave` }));
    const next = [...personal, ...recorded].sort((a, b) => a.date.localeCompare(b.date))[0];
    return next
      ? { lines: [`Next loaded leave: ${formatPerthDay(next.date)} (${next.detail}).`], source: ownSource }
      : {
          lines: [
            data.leave
              ? "No upcoming leave is in the information loaded here. This does not confirm that no leave is planned."
              : "The leave list is unavailable, and no upcoming leave appears in loaded shifts. I can't confirm your next leave.",
          ],
          source: ownSource,
        };
  }
  if (q.kind === "rotation_end")
    return {
      lines: [
        data.rotationEndsOn
          ? `Your team's recorded rotation end is ${formatPerthDay(data.rotationEndsOn)}.`
          : "Your rotation end is not recorded in the loaded team details.",
      ],
      source: data.rotationEndsOn ? teamSource : ownSource,
    };
  if (q.kind === "hours_fortnight") {
    const window = fortnightFor(data.today, data.payFortnightAnchor ?? null);
    const summary = summariseHours(
      data.shifts.map((shift) => ({ ...shift, kind: kindOf(shift) })),
      data.extras ?? [],
      window,
    );
    const lines = [
      `${summary.totalHours} rostered hours in ${formatPerthDay(window.start)}–${formatPerthDay(window.end)} from the loaded shifts. This is not a pay total.`,
    ];
    if (summary.extraHours > 0)
      lines.push(`${summary.extraHours} hours of saved extra time in the same fortnight.`);
    else lines.push("Missing shifts or extra time can change this figure.");
    return { lines, source: ownSource };
  }
  if (q.kind === "on_date") {
    const personal = myShifts(data, q.span.from, q.span.to);
    const team = myAssignments(data, q.span.from, q.span.to);
    const unique = personal.filter(
      (shift) => !shift.assignmentId || !team.some((assignment) => assignment.id === shift.assignmentId),
    );
    const rows = [
      ...team.map((assignment) => ({
        label: `${formatPerthDay(perthDateOf(assignment.startsAt))} ${assignment.shiftCode} · ${perthTimeOf(assignment.startsAt)}`,
        detail: data.teamName ?? "Team roster",
      })),
      ...unique.map((shift) => ({ label: lineForShift(shift), detail: shift.workplace ?? undefined })),
    ];
    if (rows.length)
      return { lines: ["These shifts are loaded for you:"], rows, source: team.length ? teamSource : ownSource };
    return {
      lines: [
        publishedCovers(data, q.span.from, q.span.to)
          ? "No team assignment is published for you on that date. Your personal shifts may be separate."
          : "That date is outside the published roster information loaded here, so I can't confirm whether you are off.",
      ],
      source: publishedCovers(data, q.span.from, q.span.to) ? teamSource : ownSource,
    };
  }
  if (q.kind === "who_on") {
    if (!publishedCovers(data, q.date))
      return { lines: ["That date is outside the published team roster loaded here."], source: teamSource };
    const rows = data.assignments
      .filter(
        (assignment) =>
          perthDateOf(assignment.startsAt) === q.date &&
          assignment.userId &&
          (!q.grade || assignment.grade === q.grade),
      )
      .map((assignment) => ({
        label: assignment.name ?? "Name unavailable",
        detail: `${assignment.grade ?? "Grade unknown"} · ${assignment.shiftCode} · ${perthTimeOf(assignment.startsAt)}`,
      }));
    return rows.length
      ? { lines: [`Published team assignments for ${formatPerthDay(q.date)}:`], rows, source: teamSource }
      : { lines: [`No matching published team assignment appears for ${formatPerthDay(q.date)}.`], source: teamSource };
  }
  if (q.kind === "with_me") {
    if (!publishedCovers(data, q.span.from, q.span.to))
      return { lines: ["That date is outside the published team roster loaded here."], source: teamSource };
    const mine = myAssignments(data, q.span.from, q.span.to);
    if (!mine.length) return { lines: ["No published team shift of yours appears on that date."], source: teamSource };
    const rows = data.assignments
      .filter(
        (assignment) =>
          assignment.userId &&
          assignment.userId !== data.actorId &&
          mine.some(
            (my) =>
              Date.parse(assignment.startsAt) < Date.parse(my.endsAt) &&
              Date.parse(assignment.endsAt) > Date.parse(my.startsAt),
          ),
      )
      .map((assignment) => ({
        label: assignment.name ?? "Name unavailable",
        detail: `${assignment.grade ?? "Grade unknown"} · ${assignment.shiftCode}`,
      }));
    return {
      lines: [
        rows.length
          ? "These people overlap your published shift:"
          : "No overlapping colleague is shown in this published window.",
      ],
      rows,
      source: teamSource,
    };
  }
  if (q.kind === "next_day_off" || q.kind === "next_weekend_off") {
    const first = q.kind === "next_weekend_off" ? nextWeekend(data.today) : data.today;
    const rows: AskRow[] = [];
    for (let index = 0; index < (q.kind === "next_weekend_off" ? 4 : 56); index += 1) {
      const from = addDaysToDate(first, index * (q.kind === "next_weekend_off" ? 7 : 1));
      const to = q.kind === "next_weekend_off" ? addDaysToDate(from, 1) : from;
      const covered = publishedCovers(data, from, to);
      const worked =
        [...myShifts(data, from, to)].some((shift) => isWorkedKind(kindOf(shift)) || kindOf(shift) === "on_call") ||
        myAssignments(data, from, to).some((assignment) => assignment.kind !== "leave");
      const detail = !covered ? "Coverage not loaded" : worked ? "Rostered work" : "No published team shift";
      if (q.kind === "next_weekend_off") rows.push({ label: `${formatPerthDay(from)}–${formatPerthDay(to)}`, detail });
      else if (covered && !worked)
        return {
          lines: [`Next date without a published team shift: ${formatPerthDay(from)}. Check personal shifts too.`],
          source: teamSource,
        };
    }
    if (q.kind === "next_weekend_off") {
      const firstOff = rows.find((row) => row.detail === "No published team shift");
      return {
        lines: [
          firstOff
            ? `Next weekend without a published team shift: ${firstOff.label}. Check personal shifts too.`
            : "No covered weekend without rostered work appears in the next four. Dates without coverage are unknown.",
        ],
        rows,
        source: teamSource,
      };
    }
    return {
      lines: [
        "No covered day without a published team shift appears in the loaded window. Dates without coverage are unknown.",
      ],
      source: teamSource,
    };
  }
  return { lines: ["That question cannot be answered from the loaded roster."], source: ownSource };
}
