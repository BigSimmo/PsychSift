"use client";

import { CalendarDays, CalendarPlus, ChevronRight, FileUp, Link2, type LucideIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { focusRing } from "@/components/card-recipes";
import { modeInsetHairline, modeModuleSurface, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { InlineNotice } from "@/components/primitive-recipes/feedback";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";
import { SHIFT_KIND_LABEL, SHIFT_KINDS, type ShiftKind } from "@/lib/roster/shift-kind";
import { ON_CALL_MANUAL_SHIFT_REPEAT_MAX_WEEKS, type OnCallManualShiftRequest } from "@/lib/roster/shifts/model";
import { addDaysToDate, perthWallToIso } from "@/lib/roster/shifts/perth-time";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";

/**
 * "+ Add": one sheet, three ways in. Add a shift (can repeat weekly), Import a
 * file (closes the sheet and opens the import flow), Add a calendar link.
 * "Dates I can't work" arrives in Release 2.
 */

export type RosterAddView = "menu" | "shift" | "link";

const fieldClass =
  "min-h-12 w-full min-w-0 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-raised)] px-3 text-base-minus text-[color:var(--text)]";
const labelClass = "grid gap-1 text-sm text-[color:var(--text-muted)]";

const DEFAULT_TIMES: Record<ShiftKind, { start: string; end: string }> = {
  day: { start: "08:00", end: "16:30" },
  evening: { start: "14:00", end: "22:30" },
  night: { start: "21:30", end: "08:00" },
  on_call: { start: "08:00", end: "08:00" },
  leave: { start: "08:00", end: "16:30" },
  other: { start: "09:00", end: "17:00" },
};

function MenuButton({
  icon: Icon,
  title,
  subtitle,
  onClick,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly subtitle: string;
  readonly onClick: () => void;
}) {
  return (
    <li className={modeInsetHairline}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          modeRowHeight.double,
          modePressable,
          focusRing,
          "flex w-full min-w-0 items-center gap-3 px-3 text-left",
        )}
      >
        <Icon aria-hidden="true" strokeWidth={1.5} className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
        <span className="grid min-w-0 flex-1 gap-0.5 py-1">
          <span className={cn(modeNameText, "text-base-minus leading-5 text-[color:var(--text-heading)]")}>
            {title}
          </span>
          <span className={cn(modeSecondaryText, "leading-5")}>{subtitle}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </button>
    </li>
  );
}

/** A shift from a Perth date and two wall times; an end at or before the start is the next day. */
export function manualShiftFrom(
  date: string,
  start: string,
  end: string,
  kind: ShiftKind,
  place: string,
): OnCallManualShiftRequest["shift"] | null {
  const startsAt = perthWallToIso(date, start);
  const endsAt = perthWallToIso(end > start ? date : addDaysToDate(date, 1), end);
  if (!startsAt || !endsAt) return null;
  return {
    startsAt,
    endsAt,
    title: SHIFT_KIND_LABEL[kind],
    location: place.trim() || null,
    sourceUid: null,
    kind,
  };
}

function ShiftForm({
  today,
  onSubmit,
}: {
  readonly today: string;
  readonly onSubmit: (request: OnCallManualShiftRequest) => Promise<string | null>;
}) {
  const id = useId();
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<ShiftKind>("day");
  const [start, setStart] = useState(DEFAULT_TIMES.day.start);
  const [end, setEnd] = useState(DEFAULT_TIMES.day.end);
  const [place, setPlace] = useState("");
  const [repeatWeeks, setRepeatWeeks] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const shift = manualShiftFrom(date, start, end, kind, place);
    if (!shift) {
      setError("Check the date and times.");
      return;
    }
    // The place is saved with the shift, so it gets the one patient-detail catch. Ward and hospital capitals are fine.
    const placeProblem = checkPatientDetail(place, { allowCapitals: true });
    if (placeProblem) {
      setError(`Place: ${placeProblem.body}`);
      return;
    }
    setSaving(true);
    const failure = await onSubmit({ shift, repeatWeeks });
    setSaving(false);
    setError(failure);
  }

  return (
    <form className="grid gap-3" onSubmit={(event) => void submit(event)} data-testid="roster-add-shift-form">
      <label className={labelClass} htmlFor={`${id}-date`}>
        Date
        <input
          id={`${id}-date`}
          type="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className={labelClass} htmlFor={`${id}-kind`}>
        Shift
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(event) => {
            const next = event.target.value as ShiftKind;
            setKind(next);
            setStart(DEFAULT_TIMES[next].start);
            setEnd(DEFAULT_TIMES[next].end);
          }}
          className={fieldClass}
        >
          {SHIFT_KINDS.map((option) => (
            <option key={option} value={option}>
              {SHIFT_KIND_LABEL[option]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass} htmlFor={`${id}-start`}>
          Starts
          <input
            id={`${id}-start`}
            type="time"
            required
            value={start}
            onChange={(event) => setStart(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className={labelClass} htmlFor={`${id}-end`}>
          Ends
          <input
            id={`${id}-end`}
            type="time"
            required
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            className={fieldClass}
          />
        </label>
      </div>
      <label className={labelClass} htmlFor={`${id}-place`}>
        Place
        <input
          id={`${id}-place`}
          type="text"
          maxLength={200}
          value={place}
          onChange={(event) => setPlace(event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className={labelClass} htmlFor={`${id}-repeat`}>
        Repeat weekly
        <select
          id={`${id}-repeat`}
          value={repeatWeeks}
          onChange={(event) => setRepeatWeeks(Number(event.target.value))}
          className={fieldClass}
        >
          <option value={0}>Does not repeat</option>
          {Array.from({ length: ON_CALL_MANUAL_SHIFT_REPEAT_MAX_WEEKS }, (_, index) => index + 1).map((weeks) => (
            <option key={weeks} value={weeks}>
              For {weeks} more {weeks === 1 ? "week" : "weeks"}
            </option>
          ))}
        </select>
      </label>
      {error ? <InlineNotice tone="warning">{error}</InlineNotice> : null}
      <Button type="submit" variant="primary" busy={saving} busyLabel="Saving…">
        Save shift
      </Button>
    </form>
  );
}

function LinkForm({
  workplaces,
  onSubmit,
}: {
  readonly workplaces: readonly string[];
  readonly onSubmit: (url: string, workplace: string | null) => Promise<string | null>;
}) {
  const id = useId();
  const [url, setUrl] = useState("");
  const [workplace, setWorkplace] = useState(workplaces[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const workplaceProblem = checkPatientDetail(workplace, { allowCapitals: true });
    if (workplaceProblem) {
      setError(`Workplace: ${workplaceProblem.body}`);
      return;
    }
    setSaving(true);
    const failure = await onSubmit(url.trim(), workplace.trim() || null);
    setSaving(false);
    setError(failure);
  }

  return (
    <form className="grid gap-3" onSubmit={(event) => void submit(event)} data-testid="roster-add-link-form">
      <label className={labelClass} htmlFor={`${id}-url`}>
        Calendar link
        <input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          required
          maxLength={2000}
          autoComplete="off"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className={labelClass} htmlFor={`${id}-workplace`}>
        Workplace
        <input
          id={`${id}-workplace`}
          type="text"
          maxLength={80}
          list={`${id}-workplaces`}
          value={workplace}
          onChange={(event) => setWorkplace(event.target.value)}
          className={fieldClass}
        />
        <datalist id={`${id}-workplaces`}>
          {workplaces.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      {error ? <InlineNotice tone="warning">{error}</InlineNotice> : null}
      <Button type="submit" variant="primary" busy={saving} busyLabel="Adding…">
        Add link
      </Button>
    </form>
  );
}

export function RosterAddSheet({
  open,
  view,
  onViewChange,
  onClose,
  today,
  workplaces,
  onImportFile,
  onAddShift,
  onAddLink,
  hasTeam = false,
  onDates,
}: {
  readonly open: boolean;
  readonly view: RosterAddView;
  readonly onViewChange: (view: RosterAddView) => void;
  readonly onClose: () => void;
  /** Perth date the shift form starts on. */
  readonly today: string;
  readonly workplaces: readonly string[];
  readonly onImportFile: () => void;
  readonly onAddShift: (request: OnCallManualShiftRequest) => Promise<string | null>;
  readonly onAddLink: (url: string, workplace: string | null) => Promise<string | null>;
  readonly hasTeam?: boolean;
  readonly onDates?: () => void;
}) {
  const title = view === "shift" ? "Add a shift" : view === "link" ? "Add a calendar link" : "Add to Roster";
  return (
    <Sheet open={open} onClose={onClose} title={title} mobilePlacement="bottom" testId="roster-add-sheet">
      {view === "menu" ? (
        <ul role="list" className={modeModuleSurface}>
          <MenuButton
            icon={CalendarPlus}
            title="Add a shift"
            subtitle="Can repeat weekly"
            onClick={() => onViewChange("shift")}
          />
          <MenuButton
            icon={FileUp}
            title="Import a file"
            subtitle="PDF, Excel, CSV or calendar file"
            onClick={onImportFile}
          />
          <MenuButton
            icon={Link2}
            title="Add a calendar link"
            subtitle="Keeps itself up to date"
            onClick={() => onViewChange("link")}
          />
          {hasTeam && onDates ? (
            <MenuButton
              icon={CalendarDays}
              title="Dates I can't work"
              subtitle="For the next roster"
              onClick={onDates}
            />
          ) : null}
        </ul>
      ) : view === "shift" ? (
        <ShiftForm today={today} onSubmit={onAddShift} />
      ) : (
        <LinkForm workplaces={workplaces} onSubmit={onAddLink} />
      )}
    </Sheet>
  );
}
