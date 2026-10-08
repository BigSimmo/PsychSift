"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";

import { useSignedOut } from "@/components/mode-kit/use-signed-out-sample";
import { kindOf, useRosterNow } from "@/components/roster/roster-format";
import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { Button } from "@/components/ui/button";
import { formatHours, gapTimes, hoursBetween, kindLabel } from "@/lib/open-shifts/model";
import { parseOffer } from "@/lib/open-shifts/parse-offer";
import { rosterCheckFor } from "@/lib/open-shifts/roster-check";
import type { FatigueShift } from "@/lib/roster/fatigue-rules";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";
import { useOnlineStatus } from "@/lib/use-online-status";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";

import { SignInAction } from "./open-shifts-sign-in";
import { CheckLine, FootAction, OPEN_SHIFTS_HREF, SubHeader, formatShiftTimes } from "./open-shifts-ui";
import { zonedDateOf } from "@/lib/work-time/format";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";

const KINDS = ["day", "evening", "night", "on_call", "other"] as const;
type Kind = (typeof KINDS)[number];

const field =
  "min-h-12 w-full min-w-0 rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] px-3 text-base-minus text-[color:var(--text)] focus-visible:outline-2 focus-visible:outline-[color:var(--command)]";

/**
 * Log a shift offered to me: a shift offered by text or phone, outside any
 * Roster team, saved to the doctor's own roster as a hand-added shift so the
 * roster check and hours count include it. A pasted message is read on the
 * phone and never sent or saved.
 */
export function OpenShiftsLogPage() {
  const { zone } = useWorkTimeZone();
  const signedOut = useSignedOut();
  const shifts = useRosterShifts();
  const offline = !useOnlineStatus();
  const router = useRouter();
  const id = useId();
  const nowMs = useRosterNow().getTime();
  const today = zonedDateOf(nowMs, zone);
  const [message, setMessage] = useState("");
  const [readNote, setReadNote] = useState<string | null>(null);
  const [place, setPlace] = useState("");
  const [date, setDate] = useState(addDaysToDate(today, 1));
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("16:30");
  const [kind, setKind] = useState<Kind>("day");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const times = gapTimes(date, start, end);
  const roster = useMemo<FatigueShift[] | null>(
    () =>
      shifts.status === "ready"
        ? shifts.shifts.map((shift) => ({
            id: shift.id,
            startsAt: shift.startsAt,
            endsAt: shift.endsAt,
            kind: kindOf(shift),
          }))
        : null,
    [shifts.status, shifts.shifts],
  );
  const rosterStatus = shifts.status === "ready" ? "ready" : shifts.status === "loading" ? "loading" : "error";
  const check = times ? rosterCheckFor({ id: "logged", ...times, kind }, roster, rosterStatus, new Date(nowMs)) : null;

  function read(text: string) {
    setMessage(text);
    if (!text.trim()) {
      setReadNote(null);
      return;
    }
    const parsed = parseOffer(text, today);
    if (parsed.date) setDate(parsed.date);
    if (parsed.start) setStart(parsed.start);
    if (parsed.end) setEnd(parsed.end);
    setReadNote(
      parsed.date && parsed.start
        ? "Date and times filled in below; check each field."
        : parsed.date
          ? "Found the date; set the times yourself."
          : parsed.start
            ? "Found the times; set the date yourself."
            : "Couldn't find a date or time in the message. Fill them in below.",
    );
  }

  async function save() {
    if (!times) return;
    // The place is saved with the shift, so it gets the one patient-detail catch. Ward and hospital capitals are fine.
    const placeProblem = checkPatientDetail(place, { allowCapitals: true });
    if (placeProblem) {
      setError(`Not saved. Place: ${placeProblem.body}`);
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await shifts.addManual({
      shift: { ...times, title: "Extra shift", location: place.trim() || null, sourceUid: null, kind },
      repeatWeeks: 0,
    });
    if (failure) {
      setBusy(false);
      setError(`Not saved. ${failure}`);
      return;
    }
    router.push(`${OPEN_SHIFTS_HREF}/mine`);
  }

  return (
    <div className="mx-auto w-full max-w-reading pb-10" data-mode-identity="open-shifts">
      <SubHeader backHref={`${OPEN_SHIFTS_HREF}/mine`} backLabel="My requests" title="Log a shift" />
      <form
        className="flex flex-col gap-5 px-3 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-message`} className="text-sm font-medium text-[color:var(--text-heading)]">
            Paste the message (optional)
          </label>
          <textarea
            id={`${id}-message`}
            rows={3}
            value={message}
            onChange={(event) => read(event.target.value)}
            aria-describedby={`${id}-message-help`}
            className={`${field} py-2`}
          />
          <p id={`${id}-message-help`} className="text-xs text-[color:var(--text-muted)]">
            {`Don't paste patient details. The message stays on this phone and isn't saved.${readNote ? ` ${readNote}` : ""}`}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-place`} className="text-sm font-medium text-[color:var(--text-heading)]">
            Site and ward
          </label>
          <input
            id={`${id}-place`}
            className={field}
            value={place}
            maxLength={120}
            onChange={(event) => setPlace(event.target.value)}
          />
        </div>

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
              {`${formatShiftTimes(times.startsAt, times.endsAt)} · ${formatHours(hoursBetween(times.startsAt, times.endsAt))}`}
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-kind`} className="text-sm font-medium text-[color:var(--text-heading)]">
            Kind of shift
          </label>
          <select
            id={`${id}-kind`}
            className={field}
            value={kind}
            onChange={(event) => setKind(event.target.value as Kind)}
          >
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {kindLabel(value)}
              </option>
            ))}
          </select>
        </div>

        {check && !signedOut ? <CheckLine check={check} /> : null}
        {error ? (
          <p role="alert" className="text-sm font-medium text-[color:var(--danger-text)]">
            {error}
          </p>
        ) : null}

        {signedOut ? null : (
          <FootAction
            note={
              offline
                ? "You're offline, so nothing can be saved."
                : "Saved to your roster as a hand-added shift. Only you can see it."
            }
          >
            <Button type="submit" variant="primary" block busy={busy} busyLabel="Saving" disabled={!times || offline}>
              Save to my roster
            </Button>
          </FootAction>
        )}
      </form>
      {signedOut ? <SignInAction label="Sign in to log shifts" /> : null}
    </div>
  );
}
