"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useRosterNow } from "@/components/roster/roster-format";
import { postRosterAction } from "@/components/roster/use-roster-team";
import { Button } from "@/components/ui/button";
import { formatHours, gapTimes, gradeLabel, hoursBetween, kindLabel } from "@/lib/open-shifts/model";
import {
  MAX_POST_DATES,
  POST_LEVELS,
  datesProblem,
  nextExtraDate,
  parsePostAgain,
  planDates,
  splitAttempts,
  type PostAgainPrefill,
  type PostAttempt,
  type PostKind,
  type PostLevel,
} from "@/lib/open-shifts/post-plan";
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
  formatDayShort,
  formatShiftTimes,
  postedShiftHref,
} from "./open-shifts-ui";
import { usePostedShifts } from "./use-posted-shifts";

type Kind = PostKind;
const LEVELS = POST_LEVELS;
type Level = PostLevel;

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

/** When a post was tried, read in the click handler (never during render). */
function attemptTime(): number {
  return Date.now();
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
  // Extra dates for the same shift. Each keeps its own id so removing one never moves another's input.
  const [extras, setExtras] = useState<{ id: number; date: string }[]>([]);
  const nextExtraId = useRef(0);
  // Posts that went live during this visit, by everything that was sent, so "Yes" after a partial
  // failure sends only the dates still missing and never posts the same shift twice.
  const [done, setDone] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  // Dates whose post got no answer (the connection dropped), with the team's shift ids known before that
  // attempt. Only these are checked against the team's list on a retry: one that went live is not sent again.
  const [unanswered, setUnanswered] = useState<
    Record<string, { readonly ids: readonly string[]; readonly at: number; readonly serviceId: string }>
  >({});
  const [copied, setCopied] = useState(false);
  // The last partial-failure report, kept on the page so closing the sheet never hides what went live.
  const [report, setReport] = useState<string | null>(null);

  function applyPrefill(prefill: PostAgainPrefill) {
    if (prefill.serviceId) setServiceId(prefill.serviceId);
    if (prefill.kind) {
      setKind(prefill.kind);
      setStart(DEFAULTS[prefill.kind].start);
      setEnd(DEFAULTS[prefill.kind].end);
      setCode(DEFAULTS[prefill.kind].code);
    }
    if (prefill.start && prefill.end) {
      setStart(prefill.start);
      setEnd(prefill.end);
    }
    if (prefill.code) setCode(prefill.code);
    if (prefill.level !== undefined) setLevel(prefill.level);
    if (prefill.siteId) setSiteId(prefill.siteId);
    if (prefill.urgent !== undefined) setUrgent(prefill.urgent);
    setCopied(true);
  }

  useEffect(() => {
    // "Post again" carries the shift in the address. Read once, on arrival, in the browser, so the server
    // and first paint agree; everything is checked before it is used, and the date is left for the manager.
    let prefill: PostAgainPrefill = {};
    try {
      prefill = parsePostAgain(window.location.search);
    } catch {
      prefill = {};
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Object.keys(prefill).length > 0) applyPrefill(prefill);
  }, []);

  const team = state.teams.find((row) => row.serviceId === serviceId) ?? state.teams[0] ?? null;
  // "Post again" from a team this manager no longer posts for: say which team it will go to instead.
  const copiedTeamMissing = copied && serviceId !== "" && team !== null && team.serviceId !== serviceId;
  // A site from the address (or another team) only counts if it is one of this team's sites.
  const site = team?.sites.some((row) => row.id === siteId) ? siteId : "";
  const dates = planDates(
    date,
    extras.map((extra) => extra.date),
  );
  const times = gapTimes(date, start, end);
  const hours = times ? hoursBetween(times.startsAt, times.endsAt) : 0;
  const problem = !times
    ? "Choose a date and times."
    : date < today
      ? "The date has passed."
      : !code.trim()
        ? "Give the shift a code."
        : datesProblem(dates, today);
  const siteName = team?.sites.find((row) => row.id === site)?.name ?? null;
  const signature = (on: string) =>
    JSON.stringify([team?.serviceId, on, start, end, code.trim(), kind, site, level, urgent]);
  /**
   * For a date whose earlier post got no answer: the open shift that post made, if it did go live. It must be
   * new since that attempt and match everything that was sent. A first post is never checked, so a manager can
   * still deliberately post a second opening for the same slot.
   */
  const lostAnswerMatch = (on: string) => {
    const before = unanswered[signature(on)]?.ids;
    const onTimes = gapTimes(on, start, end);
    if (!before || !onTimes || !team) return null;
    return (
      state.shifts.find(
        (row) =>
          !before.includes(row.id) &&
          // Only a shift this person posted, so another manager's identical opening is never taken for theirs.
          state.actorId !== null &&
          row.postedBy === state.actorId &&
          row.serviceId === team.serviceId &&
          row.status === "open" &&
          row.shiftCode === code.trim() &&
          row.kind === kind &&
          (row.siteId ?? "") === site &&
          (row.minGrade ?? "") === level &&
          row.urgent === urgent &&
          Date.parse(row.startsAt) === Date.parse(onTimes.startsAt) &&
          Date.parse(row.endsAt) === Date.parse(onTimes.endsAt),
      ) ?? null
    );
  };
  const alreadyPosted = dates.filter((on) => signature(on) in done);
  const toPost = dates.filter((on) => !(signature(on) in done));

  function addExtra() {
    if (dates.length >= MAX_POST_DATES) return;
    nextExtraId.current += 1;
    setExtras([...extras, { id: nextExtraId.current, date: nextExtraDate(dates, today) }]);
  }

  function chooseKind(next: Kind) {
    setKind(next);
    setStart(DEFAULTS[next].start);
    setEnd(DEFAULTS[next].end);
    setCode(DEFAULTS[next].code);
  }

  /**
   * One `open.post` per date, one after another, each the same shift. A date that fails doesn't stop the
   * rest; the answer names every date that went live and every one that didn't.
   */
  async function post(): Promise<string | null> {
    if (!team || !times) return "Choose a team, date and times.";
    // A post that got no answer for a team that couldn't be read just now: wait, rather than let the form
    // fall back to another team and post there instead.
    if (Object.values(unanswered).some((entry) => !state.teams.some((row) => row.serviceId === entry.serviceId))) {
      state.reload();
      return "Still checking whether an earlier post went live. Try again in a moment.";
    }
    const attempts: PostAttempt[] = [];
    const nowDone = { ...done };
    const nowUnanswered = { ...unanswered };
    for (const [index, on] of toPost.entries()) {
      setProgress({ current: index + 1, total: toPost.length });
      const onTimes = gapTimes(on, start, end);
      // A date whose earlier post got no answer waits for a fresh read of the team's shifts, so it is never sent
      // twice just because the list hadn't caught up yet.
      const pending = unanswered[signature(on)];
      if (pending && (!state.readAt || state.readAt.getTime() <= pending.at || state.refreshFailed)) {
        attempts.push({
          date: on,
          ok: false,
          message: "Still checking whether this one went live. Try again in a moment.",
        });
        continue;
      }
      const live = lostAnswerMatch(on);
      if (live) {
        attempts.push({ date: on, ok: true, openShiftId: live.id });
        nowDone[signature(on)] = live.id;
        continue;
      }
      if (!onTimes) {
        attempts.push({ date: on, ok: false, message: "The times couldn't be worked out for this date." });
        continue;
      }
      const result = await postRosterAction(team.serviceId, {
        action: "open.post",
        startsAt: onTimes.startsAt,
        endsAt: onTimes.endsAt,
        shiftCode: code.trim(),
        kind,
        siteId: site || null,
        minGrade: level || null,
        urgent,
      } as RosterAction);
      if (result.ok) {
        attempts.push({ date: on, ok: true, openShiftId: result.result.openShiftId ?? null });
        nowDone[signature(on)] = result.result.openShiftId ?? "";
      } else {
        attempts.push({ date: on, ok: false, message: result.message });
        // No answer at all: it may still have gone live, so a retry checks the team's list first.
        if (result.code === "roster_unavailable" && !(signature(on) in nowUnanswered)) {
          nowUnanswered[signature(on)] = {
            ids: state.shifts.map((row) => row.id),
            at: attemptTime(),
            serviceId: team.serviceId,
          };
        }
      }
    }
    setProgress(null);
    setDone(nowDone);
    setUnanswered(nowUnanswered);
    const { failed } = splitAttempts(attempts);
    // Read the team's shifts again, so a retry sees any date whose answer was lost but did go live.
    if (failed.length > 0) state.reload();
    if (failed.length === 0) {
      const only = dates.length === 1 ? nowDone[signature(dates[0]!)] : "";
      router.push(only ? postedShiftHref(team.serviceId, only) : `${OPEN_SHIFTS_HREF}/post`);
      return null;
    }
    if (dates.length === 1) {
      setReport(null);
      return `Not posted. ${failed[0]!.message}`;
    }
    const posted = dates.filter((on) => signature(on) in nowDone);
    const missing = failed.map((row) => formatDayShort(row.date)).join(", ");
    const reason = failed[0]!.message;
    if (posted.length === 0) {
      setReport(null);
      return `None of the ${dates.length} dates were posted. ${reason}`;
    }
    setReport(
      `Posted ${posted.length} of ${dates.length}: ${posted.map(formatDayShort).join(", ")}. Not posted: ${missing}.`,
    );
    return `Posted ${posted.length} of ${dates.length}: ${posted.map(formatDayShort).join(", ")}. Not posted: ${missing}. ${reason} "Yes" now sends only the dates not posted.`;
  }

  return (
    <div className="mx-auto w-full max-w-reading pb-10" data-mode-identity="open-shifts" data-page-width="reading">
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
          {copied ? (
            <p className="rounded-md bg-[color:var(--surface-subtle)] px-3 py-2 text-sm text-[color:var(--text)]">
              {copiedTeamMissing
                ? `Copied from a posted shift in a team you no longer post for, so this will post for ${team?.name}. Choose the date, then check the rest.`
                : "Copied from a posted shift. Choose the date, then check the rest."}
            </p>
          ) : null}
          {report && !confirming ? (
            <p
              role="status"
              className="rounded-md bg-[color:var(--surface-subtle)] px-3 py-2 text-sm text-[color:var(--text)]"
            >
              {`${report} Posting again sends only the dates not posted.`}
            </p>
          ) : null}

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
            hint="Sets the usual times and code. Change them below if needed."
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
            {extras.length > 0 ? <p className="pt-1 text-xs text-[color:var(--text-muted)]">Also on</p> : null}
            {extras.map((extra, index) => (
              <div key={extra.id} className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`${id}-date-${extra.id}`}>
                  {`Date ${index + 2}`}
                </label>
                <input
                  id={`${id}-date-${extra.id}`}
                  type="date"
                  className={field}
                  value={extra.date}
                  min={today}
                  onChange={(event) =>
                    setExtras(extras.map((row) => (row.id === extra.id ? { ...row, date: event.target.value } : row)))
                  }
                />
                <button
                  type="button"
                  aria-label={extra.date ? `Remove ${formatDayShort(extra.date)}` : `Remove date ${index + 2}`}
                  onClick={() => setExtras(extras.filter((row) => row.id !== extra.id))}
                  className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-md border border-[color:var(--border)] text-[color:var(--text-muted)] focus-visible:outline-2 focus-visible:outline-[color:var(--command)]"
                >
                  <X aria-hidden="true" strokeWidth={1.8} className="size-icon-sm" />
                </button>
              </div>
            ))}
            {dates.length < MAX_POST_DATES ? (
              <button
                type="button"
                onClick={addExtra}
                className="inline-flex min-h-12 items-center gap-2 self-start text-sm font-medium text-[color:var(--mode-identity)] focus-visible:outline-2 focus-visible:outline-[color:var(--command)]"
              >
                <Plus aria-hidden="true" strokeWidth={1.8} className="size-icon-sm" />
                Add another date
              </button>
            ) : (
              <p className="text-xs text-[color:var(--text-muted)]">{`Up to ${MAX_POST_DATES} dates at once.`}</p>
            )}
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
                value={site}
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

          {alreadyPosted.length > 0 ? (
            <p className="text-sm text-[color:var(--text-muted)]">
              {`Already posted: ${alreadyPosted.map(formatDayShort).join(", ")}. These won't be sent again.`}
            </p>
          ) : null}

          <FootAction note={problem ?? "You'll confirm before it goes live."}>
            <Button
              type="submit"
              variant="primary"
              block
              disabled={Boolean(problem) || state.offline || toPost.length === 0}
            >
              {state.offline
                ? "Offline: can't post"
                : dates.length > 1
                  ? `Review and post ${toPost.length} ${toPost.length === 1 ? "shift" : "shifts"}`
                  : "Review and post"}
            </Button>
          </FootAction>
        </form>
      )}

      {times && team ? (
        <ConfirmSheet
          open={confirming}
          // Posting can't be walked away from mid-way: the sheet stays until every date has an answer.
          onClose={() => {
            if (!progress) setConfirming(false);
          }}
          title={
            dates.length > 1
              ? `Post this shift on ${toPost.length} ${toPost.length === 1 ? "date" : "dates"}?`
              : "Post this shift?"
          }
          confirmLabel={
            dates.length > 1 ? `Yes, post ${toPost.length === 1 ? "it" : `all ${toPost.length}`}` : "Yes, post it"
          }
          busyLabel={progress && progress.total > 1 ? `Posting ${progress.current} of ${progress.total}` : "Posting"}
          onConfirm={post}
          testId="open-shifts-post-confirm"
        >
          <div className="rounded-md bg-[color:var(--surface-subtle)] px-4 py-3">
            <p className="font-semibold text-[color:var(--text-heading)]">{`${level ? gradeLabel(level) : "Any level"} · ${kindLabel(kind)}`}</p>
            {dates.length > 1 ? (
              <>
                <p className="nums">{`${formatShiftTimes(times.startsAt, times.endsAt)} · ${formatHours(hours)}`}</p>
                <p className="nums">{toPost.map(formatDayShort).join(", ")}</p>
              </>
            ) : (
              <p className="nums">{`${formatDayLong(date)}, ${formatShiftTimes(times.startsAt, times.endsAt)} · ${formatHours(hours)}`}</p>
            )}
            <p className="text-[color:var(--text-muted)]">{[siteName, team.name].filter(Boolean).join(" · ")}</p>
            {urgent ? <p className="font-medium text-[color:var(--mode-identity)]">Urgent</p> : null}
          </div>
          <p className="text-[color:var(--text-muted)]">
            {dates.length > 1
              ? `Each date goes live as its own shift, one after another, for members of ${team.name} at the right level. If one doesn't go through, you'll see which.`
              : `It goes live straight away for members of ${team.name} at the right level. You or another roster manager approves whoever asks.`}
          </p>
          {alreadyPosted.length > 0 ? (
            <p className="text-[color:var(--text-muted)]">{`Already posted, not sent again: ${alreadyPosted.map(formatDayShort).join(", ")}.`}</p>
          ) : null}
          <p aria-live="polite" className="sr-only">
            {progress && progress.total > 1 ? `Posting ${progress.current} of ${progress.total}` : ""}
          </p>
        </ConfirmSheet>
      ) : null}
    </div>
  );
}
