"use client";

import { ChevronRight, Clock, Smartphone } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { WorkButton, WorkCard, WorkIconCircle } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { useWorkTimeZoneControl } from "@/components/work-time/use-work-time-zone";
import { zonedTimeOf } from "@/lib/work-time/format";
import { deviceZoneLabel, formatWorkZoneValue, workZoneNote, zoneAbbreviationLine } from "@/lib/work-time/labels";
import { WORK_TIME_ZONES, workTimeZoneLabel } from "@/lib/work-time/zones";

type SyncState = ReturnType<typeof useWorkTimeZoneControl>["syncState"];

const SYNC_WORDS: Readonly<Record<SyncState, string>> = {
  synced: "Saved",
  syncing: "Saving",
  "local-only": "Saved on this phone",
  error: "Not saved, try again",
};

const MINUTE = 60_000;

/**
 * The work time zone, as a settings row (setup mockup, Settings frames).
 * Tapping opens a sheet with the Australian zones and the time in each now;
 * picking one saves it straight away. `work` draws it as a work card row;
 * `inline` draws the zone list itself with no row and no sheet (the setup
 * walkthrough's full page).
 */
export function WorkTimeZoneSetting({ variant = "work" }: { readonly variant?: "work" | "inline" }) {
  const { zone, deviceZone, differsFromDevice, setZone, syncState } = useWorkTimeZoneControl();
  const [open, setOpen] = useState(false);
  // For the row's abbreviation (AEST or AEDT), refreshed each time the sheet opens.
  const [now, setNow] = useState(() => Date.now());
  // The save line shows only after a change made here, never on arrival.
  const [changed, setChanged] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);

  const openSheet = useCallback(() => {
    setNow(Date.now());
    setOpen(true);
  }, []);

  const choose = useCallback(
    (next: string) => {
      setChanged(true);
      if (next !== zone) setZone(next);
    },
    [setZone, zone],
  );

  const syncLine = changed ? SYNC_WORDS[syncState] : null;
  const list = (
    <WorkTimeZoneList
      zone={zone}
      deviceZone={deviceZone}
      differsFromDevice={differsFromDevice}
      syncLine={syncLine}
      onChoose={choose}
    />
  );

  if (variant === "inline") return <div data-testid="work-time-zone-setting">{list}</div>;

  const showHint = differsFromDevice && deviceZone !== null;
  const noteText = workZoneNote(zone, deviceZone, differsFromDevice);
  const note = showHint ? (
    <span className="flex items-start gap-2 text-[color:var(--text)]">
      <Smartphone aria-hidden="true" className="mt-px size-icon-sm flex-none text-[color:var(--warning-text)]" />
      <span>{noteText}</span>
    </span>
  ) : (
    noteText
  );

  const row = (
    <>
      <button
        ref={rowRef}
        type="button"
        onClick={openSheet}
        aria-haspopup="dialog"
        data-testid="work-time-zone-row"
        className="work-row"
      >
        <WorkIconCircle icon={Clock} />
        <span className="work-row__title flex-1">Time zone</span>
        <span className="text-xs font-semibold whitespace-nowrap text-[color:var(--work-ink-muted)]">
          {formatWorkZoneValue(zone, now)}
        </span>
        <ChevronRight
          aria-hidden="true"
          strokeWidth={2}
          className="size-icon-sm flex-none text-[color:var(--decoration-soft)]"
        />
      </button>
      <div className="-mt-1 px-3 pb-3 pl-[3.25rem] text-xs leading-snug font-medium text-[color:var(--work-ink-muted)]">
        <p className="m-0" data-testid="work-time-zone-note">
          {note}
        </p>
        {syncLine && !open ? <p className="m-0 mt-1">{syncLine}</p> : null}
      </div>
    </>
  );

  return (
    <>
      <WorkCard testId="work-time-zone-setting">{row}</WorkCard>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Time zone"
        description="Roster and shift times use this"
        returnFocusRef={rowRef}
        testId="work-time-zone-sheet"
        contentClassName="work-more-sheet"
        headerClassName="work-more-sheet__header"
        titleClassName="work-more-sheet__title"
        closeButtonClassName="work-more-sheet__close"
        bodyClassName="work-more-sheet__body"
      >
        <div className="grid gap-3">
          {list}
          <WorkButton size="wide" onClick={() => setOpen(false)}>
            Done
          </WorkButton>
        </div>
      </Sheet>
    </>
  );
}

export type WorkTimeZoneListProps = {
  /** The work zone now chosen. */
  readonly zone: string;
  /** The phone's own zone, for the hint card. */
  readonly deviceZone: string | null;
  /** Whether the phone is on another wall clock, so the hint card shows. */
  readonly differsFromDevice: boolean;
  /** "Saved", "Saving" and so on, or null to say nothing. */
  readonly syncLine: string | null;
  readonly onChoose: (zone: string) => void;
};

/**
 * The zone list itself: the device hint card when the phone is on another
 * clock, a radio group of every Australian zone with its abbreviation and the
 * time there now (Geist Mono, moving on each minute while mounted), and a
 * quiet save line. The time zone sheet and the setup walkthrough both draw
 * this, so there is one list.
 */
export function WorkTimeZoneList({ zone, deviceZone, differsFromDevice, syncLine, onChoose }: WorkTimeZoneListProps) {
  const [now, setNow] = useState(() => Date.now());

  // Each zone's clock moves on at the turn of each minute, only while the list is mounted.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(
        () => {
          setNow(Date.now());
          schedule();
        },
        MINUTE - (Date.now() % MINUTE) + 50,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  const zoneLabel = workTimeZoneLabel(zone);
  const deviceLabel = deviceZone ? deviceZoneLabel(deviceZone) : null;
  const showHint = differsFromDevice && deviceLabel !== null;

  return (
    <div className="grid gap-3">
      {showHint ? (
        <div
          data-testid="work-time-zone-device-hint"
          className="flex items-center gap-2.5 rounded-[var(--work-radius-card)] border border-[color:var(--work-line,var(--border))] bg-[color:var(--surface-raised)] px-3 py-2.5"
        >
          <WorkIconCircle icon={Smartphone} tone="neutral" />
          <span className="grid min-w-0">
            <span className="text-sm-minus font-bold text-[color:var(--text-heading)]">
              This phone is on {deviceLabel} time
            </span>
            <span className="text-xs text-[color:var(--text)]">Shifts still show in {zoneLabel} time.</span>
          </span>
        </div>
      ) : null}
      <ZoneRadioGroup zone={zone} now={now} onChoose={onChoose} />
      <p role="status" className="m-0 min-h-4 text-center text-xs font-medium text-[color:var(--text-muted)]">
        {syncLine ?? ""}
      </p>
    </div>
  );
}

function ZoneRadioGroup({
  zone,
  now,
  onChoose,
}: {
  readonly zone: string;
  readonly now: number;
  readonly onChoose: (zone: string) => void;
}) {
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const selectedIndex = Math.max(
    0,
    WORK_TIME_ZONES.findIndex((option) => option.id === zone),
  );

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number) {
    const last = WORK_TIME_ZONES.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onChoose(WORK_TIME_ZONES[index]!.id);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    onChoose(WORK_TIME_ZONES[next]!.id);
    optionRefs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Time zone"
      className="overflow-hidden rounded-[var(--work-radius-card)] border border-[color:var(--work-line,var(--border))] bg-[color:var(--surface-raised)]"
    >
      {WORK_TIME_ZONES.map((option, index) => {
        const selected = index === selectedIndex;
        const time = zonedTimeOf(now, option.id);
        return (
          <div
            key={option.id}
            ref={(node) => {
              optionRefs.current[index] = node;
            }}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChoose(option.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            data-testid={`work-time-zone-option-${option.id}`}
            className={`flex min-h-12 cursor-pointer items-center gap-2.5 px-3 py-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--mode-identity)] ${
              index > 0 ? "border-t border-[color:var(--work-line,var(--border))]" : ""
            } ${selected ? "bg-[color:var(--mode-identity-soft)]" : ""}`}
          >
            <span
              aria-hidden="true"
              className={`grid size-5 flex-none place-items-center rounded-full border-2 bg-[color:var(--surface-raised)] forced-colors:border-[CanvasText] ${
                selected ? "border-[color:var(--mode-identity)]" : "border-[color:var(--border-strong)]"
              }`}
            >
              {selected ? (
                <span className="size-2.5 rounded-full bg-[color:var(--mode-identity)] forced-colors:bg-[CanvasText]" />
              ) : null}
            </span>
            <span className="grid min-w-0 flex-1">
              <span className="text-sm-minus font-bold text-[color:var(--text-heading)]">{option.label}</span>
              <span className="text-xs text-[color:var(--text-muted)]">{zoneAbbreviationLine(option.id, now)}</span>
            </span>
            <span
              className={`font-mono text-sm-minus font-semibold tabular-nums ${
                selected ? "text-[color:var(--text-heading)]" : "text-[color:var(--text)]"
              }`}
            >
              <span className="sr-only">Now </span>
              {time}
            </span>
          </div>
        );
      })}
    </div>
  );
}
