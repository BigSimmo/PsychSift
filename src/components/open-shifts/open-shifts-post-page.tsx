"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";

import { useRosterNow } from "@/components/roster/roster-format";
import { postRosterAction } from "@/components/roster/use-roster-team";
import { Button } from "@/components/ui/button";
import { formatHours, gapTimes, gradeLabel, hoursBetween, kindLabel } from "@/lib/open-shifts/model";
import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { ROSTER_OPEN_SHIFT_KINDS, type RosterAction } from "@/lib/roster/team/model";

import { ConfirmSheet } from "./open-shifts-confirm";
import { SignInAction } from "./open-shifts-sign-in";
import { LoadFailed, NoTeam } from "./open-shifts-states";
import {
  FootAction,
  ListSkeleton,
  OPEN_SHIFTS_HREF,
  SubHeader,
  Switch,
  formatDayLong,
  formatShiftTimes,
  postedShiftHref,
} from "./open-shifts-ui";
import { usePostedShifts } from "./use-posted-shifts";

type Kind = (typeof ROSTER_OPEN_SHIFT_KINDS)[number];
const LEVELS = ["intern", "resident", "registrar", "fellow", "consultant"] as const;
type Level = (typeof LEVELS)[number];

const DEFAULTS: Record<Kind, { start: string; end: string; code: string }> = {
  day: { start: "08:00", end: "16:30", code: "D" },
  evening: { start: "14:00", end: "22:30", code: "E" },
  night: { start: "21:30", end: "08:00", code: "N" },
  on_call: { start: "08:00", end: "08:00", code: "OC" },
  other: { start: "09:00", end: "17:00", code: "X" },
};

const field =
  "min-h-12 w-full min-w-0 rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-3 text-base-minus text-[color:var(--text)] focus-visible:outline-2 focus-visible:outline-[color:var(--command)]";

function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-[color:var(--text-heading)]">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-[color:var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}

export function OpenShiftsPostPage() {
  const state = usePostedShifts();
  const router = useRouter();
  const id = useId();
  const today = perthDateOf(useRosterNow());
  const [serviceId, setServiceId] = useState<string>("");
  const [date, setDate] = useState(addDaysToDate(today, 1));
  const [kind, setKind] = useState<Kind>("day");
  const [start, setStart] = useState(DEFAULTS.day.start);
  const [end, setEnd] = useState(DEFAULTS.day.end);
  const [code, setCode] = useState(DEFAULTS.day.code);
  const [siteId, setSiteId] = useState<string>("");
  const [level, setLevel] = useState<Level | "">("registrar");
  const [urgent, setUrgent] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const team = state.teams.find((row) => row.serviceId === serviceId) ?? state.teams[0] ?? null;
  const times = gapTimes(date, start, end);
  const hours = times ? hoursBetween(times.startsAt, times.endsAt) : 0;
  const problem = !times
    ? "Choose a date and times."
    : date < today
      ? "The date has passed."
      : !code.trim()
        ? "Give the shift a code."
        : null;
  const siteName = team?.sites.find((site) => site.id === siteId)?.name ?? null;

  function chooseKind(next: Kind) {
    setKind(next);
    setStart(DEFAULTS[next].start);
    setEnd(DEFAULTS[next].end);
    setCode(DEFAULTS[next].code);
  }

  async function post(): Promise<string | null> {
    if (!team || !times) return "Choose a team, date and times.";
    const result = await postRosterAction(team.serviceId, {
      action: "open.post",
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      shiftCode: code.trim(),
      kind,
      siteId: siteId || null,
      minGrade: level || null,
      urgent,
    } as RosterAction);
    if (!result.ok) return `Not posted. ${result.message}`;
    router.push(
      result.result.openShiftId
        ? postedShiftHref(team.serviceId, result.result.openShiftId)
        : `${OPEN_SHIFTS_HREF}/post`,
    );
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-reading pb-10" data-mode-identity="open-shifts">
      <SubHeader backHref={`${OPEN_SHIFTS_HREF}/post`} backLabel="Post" title="Post a shift" />
      {state.status === "loading" ? (
        <ListSkeleton rows={5} />
      ) : state.status === "error" ? (
        <LoadFailed what="Your teams" message={state.message} onRetry={state.reload} />
      ) : state.status === "signed-out" ? (
        <SignInAction label="Sign in to post shifts" />
      ) : state.status === "no-team" ? (
        <NoTeam />
      ) : state.status !== "ready" ? (
        <p className="px-3 py-8 text-sm text-[color:var(--text-muted)]">
          Only a team&apos;s roster managers can post shifts.
        </p>
      ) : (
        <form
          className="flex flex-col gap-5 px-3 pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!problem) setConfirming(true);
          }}
        >
          {state.teams.length > 1 ? (
            <Field label="Team" htmlFor={`${id}-team`}>
              <select
                id={`${id}-team`}
                className={field}
                value={team?.serviceId ?? ""}
                onChange={(event) => {
                  setServiceId(event.target.value);
                  // Sites belong to a team, so a site picked in another team can't carry over.
                  setSiteId("");
                }}
              >
                {state.teams.map((row) => (
                  <option key={row.serviceId} value={row.serviceId}>
                    {row.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field
            label="Kind of shift"
            htmlFor={`${id}-kind`}
            hint="Sets the usual times and code; change them below if needed."
          >
            <select
              id={`${id}-kind`}
              className={field}
              value={kind}
              onChange={(event) => chooseKind(event.target.value as Kind)}
            >
              {ROSTER_OPEN_SHIFT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {kindLabel(value)}
                </option>
              ))}
            </select>
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="pb-1 text-sm font-medium text-[color:var(--text-heading)]">Date and time</legend>
            <label className="sr-only" htmlFor={`${id}-date`}>
              Date
            </label>
            <input
              id={`${id}-date`}
              type="date"
              className={field}
              value={date}
              min={today}
              onChange={(event) => setDate(event.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-start`} className="text-xs text-[color:var(--text-muted)]">
                  Starts
                </label>
                <input
                  id={`${id}-start`}
                  type="time"
                  className={field}
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-end`} className="text-xs text-[color:var(--text-muted)]">
                  Ends
                </label>
                <input
                  id={`${id}-end`}
                  type="time"
                  className={field}
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </div>
            </div>
            {times ? (
              <p className="text-xs nums text-[color:var(--text-muted)]">
                {`${formatShiftTimes(times.startsAt, times.endsAt)} · ${formatHours(hours)}`}
              </p>
            ) : null}
          </fieldset>

          {team && team.sites.length > 0 ? (
            <Field label="Site" htmlFor={`${id}-site`}>
              <select
                id={`${id}-site`}
                className={field}
                value={siteId}
                onChange={(event) => setSiteId(event.target.value)}
              >
                <option value="">No site given</option>
                {team.sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label="Level" htmlFor={`${id}-level`} hint="Doctors at this level and above can ask for it.">
            <select
              id={`${id}-level`}
              className={field}
              value={level}
              onChange={(event) => setLevel(event.target.value as Level | "")}
            >
              <option value="">Any level</option>
              {LEVELS.map((value) => (
                <option key={value} value={value}>
                  {gradeLabel(value)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Shift code" htmlFor={`${id}-code`} hint="As it appears on the roster, up to 12 characters.">
            <input
              id={`${id}-code`}
              className={field}
              value={code}
              maxLength={12}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>

          <div className="flex items-start gap-3 border-t border-[color:var(--border)] pt-3">
            <div className="min-w-0 flex-1">
              <p className="text-base-minus font-medium text-[color:var(--text-heading)]">Urgent</p>
              <p id={`${id}-urgent-help`} className="text-sm text-[color:var(--text-muted)]">
                Marked urgent on the doctors&apos; list.
              </p>
            </div>
            <Switch checked={urgent} onChange={setUrgent} label="Urgent" describedBy={`${id}-urgent-help`} />
          </div>

          <FootAction note={problem ?? "You'll confirm before it goes live."}>
            <Button type="submit" variant="primary" block disabled={Boolean(problem) || state.offline}>
              {state.offline ? "Offline: can't post" : "Review and post"}
            </Button>
          </FootAction>
        </form>
      )}

      {times && team ? (
        <ConfirmSheet
          open={confirming}
          onClose={() => setConfirming(false)}
          title="Post this shift?"
          confirmLabel="Yes, post it"
          busyLabel="Posting"
          onConfirm={post}
          testId="open-shifts-post-confirm"
        >
          <div className="rounded-md bg-[color:var(--surface-subtle)] px-4 py-3">
            <p className="font-semibold text-[color:var(--text-heading)]">{`${level ? gradeLabel(level) : "Any level"} · ${kindLabel(kind)}`}</p>
            <p className="nums">{`${formatDayLong(date)}, ${formatShiftTimes(times.startsAt, times.endsAt)} · ${formatHours(hours)}`}</p>
            <p className="text-[color:var(--text-muted)]">{[siteName, team.name].filter(Boolean).join(" · ")}</p>
            {urgent ? <p className="font-medium text-[color:var(--mode-identity)]">Urgent</p> : null}
          </div>
          <p className="text-[color:var(--text-muted)]">
            {`It goes live straight away for members of ${team.name} at the right level. You or another roster manager approves whoever asks.`}
          </p>
        </ConfirmSheet>
      ) : null}
    </div>
  );
}
