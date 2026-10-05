"use client";

import { ChevronRight, Copy, Phone, Plus, ShieldCheck, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { focusRing } from "@/components/card-recipes";
import { dashSurface } from "@/components/dashboard-kit/recipes";
import {
  MHA_TIMELINE_AWAITING_REVIEW,
  MHA_TIMELINE_NOT_CALCULABLE,
  MHA_TIMELINE_REFERENCE_NOTE,
} from "@/components/forms/mha-timeline-panel";
import { InformationPageBreadcrumbs, InformationPageShell } from "@/components/information-page-shell";
import {
  flatButton,
  flatLink,
  FlatLabel,
  FlatList,
  flatPanel,
  flatPanelPadded,
  FlatRow,
  FlatTag,
} from "@/components/psychiatry/psychiatry-flat";
import { cn } from "@/components/ui-primitives";
import { toAwstParts } from "@/lib/caring-contacts/clock";
import { mhaActMetadata } from "@/lib/mha-act-sections";
import { formatPerthDateTime, parsePerthDateTimeInput } from "@/lib/mha-timeline";
import { mhaTimers, type MhaTimerItem } from "@/lib/on-call/mha-timers";
import {
  addMhaClock,
  EMPTY_MHA_CLOCK_STATE,
  loadMhaClockState,
  MHA_CLOCK_LIMIT,
  removeMhaClock,
  restoreMhaClock,
  subscribeMhaClocks,
  type AddMhaClockResult,
  type MhaClock,
  type MhaClockState,
} from "@/lib/psychiatry-hub/mha-clocks";

/**
 * Psychiatry · MHA clock: every Mental Health Act form the reader is holding right now, on one
 * screen, with how long each has been running and each of its time limits.
 *
 * NOTHING CLINICAL IS WRITTEN HERE. Every limit, quote and countdown comes from `mhaTimers`, which
 * reads the governed timeframe data and shows an end time only for a limit signed off by a named
 * clinician while the owner's signed countdown switch is on. Everything else shows the owner-approved
 * "awaiting clinical review" or "not calculated" line from the form page, with the Act's own words.
 * A clock holds a form code and a time, never anything about the person, and is kept on this device
 * until the reader removes it or signs out (owner decisions, 5 October 2026).
 *
 * A passed limit is shown in red: the one place red is used, for a legal time limit that has gone by
 * (owner decision 6, 5 October 2026).
 */

export interface MhaClockForm {
  readonly code: string;
  readonly title: string;
  readonly slug: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** A weekday name alone is unambiguous only within this window. */
const WEEKDAY_WINDOW_MS = 6 * 24 * HOUR_MS;
/** How long the Undo bar stays after a clock is removed. */
const UNDO_MS = 8_000;

export const MHA_CLOCK_RETENTION_NOTE =
  "Only on this phone, not on your other devices. Kept until you remove it or sign out. A clock holds the form and the time only.";
export const MHA_CLOCK_UNREADABLE = "Clocks could not be read on this phone.";
export const MHA_CLOCK_HANDOVER_NOTE =
  "Copies the form and made-at time only. No names, and no running times, because those go out of date once pasted.";

function subscribeMinute(listener: () => void): () => void {
  const timer = window.setInterval(listener, 30_000);
  return () => window.clearInterval(timer);
}

/** Now to the minute in the browser; null on the server and while hydrating. */
function useNow(nowProp?: Date): Date | null {
  const minute = useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS,
    () => null,
  );
  if (nowProp) return nowProp;
  return minute === null ? null : new Date(minute);
}

function useClockState(): MhaClockState {
  return useSyncExternalStore(subscribeMhaClocks, loadMhaClockState, () => EMPTY_MHA_CLOCK_STATE);
}

function hhmm(instant: Date | number): string {
  const { hour, minute } = toAwstParts(new Date(instant));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const WEEKDAY = new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "Australia/Perth" });

/**
 * "Sun 23:40" within six days of now either way, so every time carries its day; further out the
 * full Perth date, because a weekday alone would be ambiguous.
 */
export function mhaClockWhen(instant: Date | number, nowMs: number): string {
  const ms = new Date(instant).getTime();
  if (Math.abs(ms - nowMs) > WEEKDAY_WINDOW_MS) return formatPerthDateTime(new Date(ms));
  return `${WEEKDAY.format(new Date(ms))} ${hhmm(ms)}`;
}

/** "5 h 20 min", "45 min", "26 h". */
export function mhaClockDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MINUTE_MS));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** The plain lines the handover copy puts on the clipboard. Exported for tests. */
export function mhaClockHandoverText(clocks: readonly MhaClock[], nowMs: number): string {
  return [
    `As at ${mhaClockWhen(nowMs, nowMs)}`,
    ...clocks.map((clock) => `Form ${clock.formCode} · made ${mhaClockWhen(clock.madeAt, nowMs)}`),
    MHA_TIMELINE_REFERENCE_NOTE,
  ].join("\n");
}

/** A `datetime-local` value for now, in Perth wall time. */
function perthInputValue(instant: Date): string {
  const { year, month, day, hour, minute } = toAwstParts(instant);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

const ADD_MESSAGE: Readonly<Record<Exclude<AddMhaClockResult, "added">, string>> = {
  full: `You are holding ${MHA_CLOCK_LIMIT} clocks, the most this page keeps. Remove one first.`,
  invalid: "Choose a form and enter when it was made.",
  "not-saved": "This browser would not save the clock. Check that site storage is allowed.",
};

const ADD_SECTION_ID = "mha-clock-start";

function AddClock({ forms, now }: { readonly forms: readonly MhaClockForm[]; readonly now: Date | null }) {
  const formId = useId();
  const timeId = useId();
  const messageId = useId();
  const [code, setCode] = useState("");
  const [madeAt, setMadeAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const start = parsePerthDateTimeInput(madeAt || (now ? perthInputValue(now) : ""));
    if (!code || !start) {
      setMessage(ADD_MESSAGE.invalid);
      return;
    }
    if (now && start.getTime() > now.getTime()) {
      setMessage("That time is later than now. Enter when the form was made.");
      return;
    }
    const result = addMhaClock(code, start);
    if (result === "added") {
      setCode("");
      setMadeAt("");
      setMessage(null);
    } else {
      setMessage(ADD_MESSAGE[result]);
    }
  };

  const field =
    "min-h-12 w-full min-w-0 rounded-lg border border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] px-3 text-sm text-[color:var(--dash-ink)] forced-colors:border";
  const label = "text-xs font-medium text-[color:var(--dash-muted)]";

  return (
    <section
      aria-labelledby={`${ADD_SECTION_ID}-title`}
      id={ADD_SECTION_ID}
      data-testid="mha-clock-add"
      className="grid gap-2 scroll-mt-24"
    >
      <FlatLabel id={`${ADD_SECTION_ID}-title`} title="Start a clock" />
      <form
        onSubmit={submit}
        className={cn(flatPanelPadded, "sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-end sm:gap-3")}
      >
        <div className="grid min-w-0 gap-1">
          <label htmlFor={formId} className={label}>
            Form
          </label>
          <select
            id={formId}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            data-testid="mha-clock-form"
            className={field}
          >
            <option value="">Choose a form</option>
            {forms.map((form) => (
              <option key={form.code} value={form.code}>
                {`Form ${form.code}: ${form.title}`}
              </option>
            ))}
          </select>
        </div>
        <div className="grid min-w-0 gap-1">
          <label htmlFor={timeId} className={label}>
            When was it made?
          </label>
          <input
            id={timeId}
            type="datetime-local"
            value={madeAt || (now ? perthInputValue(now) : "")}
            onChange={(event) => setMadeAt(event.target.value)}
            data-testid="mha-clock-time"
            aria-invalid={message?.startsWith("That time") ? true : undefined}
            aria-describedby={messageId}
            className={cn(field, message?.startsWith("That time") && "border-[color:var(--danger-text)]")}
          />
        </div>
        <p
          id={messageId}
          role="status"
          data-testid="mha-clock-message"
          className={cn(
            "flex min-h-4 items-start gap-1.5 text-xs sm:col-span-3 sm:row-start-2",
            message ? "font-medium text-[color:var(--danger-text)]" : "text-[color:var(--dash-muted)]",
          )}
        >
          {message ? <TriangleAlert aria-hidden="true" className="mt-px size-icon-xs shrink-0" /> : null}
          <span>{message ?? "Perth time. Only forms with time limits in the app are listed."}</span>
        </p>
        <button type="submit" data-testid="mha-clock-start" className={cn(flatButton, "w-full sm:w-auto")}>
          <Plus aria-hidden="true" className="size-icon-sm" />
          Start
        </button>
      </form>
    </section>
  );
}

/**
 * One lane per clock from when it was made to now, and a shared now line. Decorative: every figure
 * on it is also written in the list below.
 */
function ShiftBand({ clocks, now }: { readonly clocks: readonly MhaClock[]; readonly now: Date }) {
  const nowMs = now.getTime();
  const earliest = Math.max(Math.min(...clocks.map((clock) => clock.madeAt)), nowMs - 33 * HOUR_MS);
  const start = Math.floor(earliest / HOUR_MS) * HOUR_MS;
  const end = Math.max(Math.ceil((nowMs + HOUR_MS) / HOUR_MS) * HOUR_MS, start + 6 * HOUR_MS);
  const span = end - start;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / span) * 100));
  const step = span <= 12 * HOUR_MS ? 3 * HOUR_MS : span <= 24 * HOUR_MS ? 6 * HOUR_MS : 12 * HOUR_MS;
  const ticks: number[] = [];
  for (let tick = start; tick <= end; tick += step) ticks.push(tick);
  const LANE = 14;
  const GAP = 8;
  const lanesHeight = clocks.length * LANE + (clocks.length - 1) * GAP;
  const height = lanesHeight + 20;
  const nowX = `${pct(nowMs)}%`;

  // SVG with percentage coordinates, so positions need no inline styles.
  return (
    <div aria-hidden="true" className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 py-1" data-testid="mha-clock-band">
      <div className="grid content-start gap-2">
        {clocks.map((clock) => (
          <span
            key={clock.id}
            className="flex h-3.5 items-center justify-end text-xs font-semibold text-[color:var(--dash-ink)]"
          >
            {clock.formCode}
          </span>
        ))}
      </div>
      <svg width="100%" height={height} className="overflow-visible">
        {clocks.map((clock, index) => {
          const y = index * (LANE + GAP);
          const from = pct(clock.madeAt);
          return (
            <g key={clock.id}>
              <rect x="0" y={y} width="100%" height={LANE} rx={LANE / 2} className="fill-[color:var(--dash-card)]" />
              <rect
                x={`${from}%`}
                y={y}
                width={`${Math.max(0, pct(nowMs) - from)}%`}
                height={LANE}
                rx={LANE / 2}
                className="fill-[color:var(--dash-faint)] forced-colors:fill-[CanvasText]"
              />
            </g>
          );
        })}
        <line
          x1={nowX}
          x2={nowX}
          y1="-2"
          y2={lanesHeight + 2}
          strokeWidth="2"
          className="stroke-[color:var(--dash-ink)] forced-colors:stroke-[CanvasText]"
        />
        {ticks.map((tick, index) => (
          <text
            key={tick}
            x={`${pct(tick)}%`}
            y={height - 3}
            textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"}
            className="fill-[color:var(--dash-faint)] text-2xs nums"
          >
            {hhmm(tick)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function LimitRow({ item, nowMs }: { readonly item: MhaTimerItem; readonly nowMs: number }) {
  const { entry } = item;
  const quote =
    "border-l-2 border-[color:var(--dash-line-strong)] pl-3 text-sm italic leading-6 text-[color:var(--dash-ink)]";
  return (
    <li className="grid gap-1 border-t border-[color:var(--dash-line)] pt-3">
      <p className="text-sm leading-snug text-[color:var(--dash-ink)]">{entry.trigger}</p>
      {entry.condition ? (
        <p className="text-xs leading-snug text-[color:var(--dash-muted)]" data-testid="mha-clock-condition">
          {entry.condition}
        </p>
      ) : null}
      {item.kind === "countdown" ? (
        <div
          className={cn(
            "grid gap-0.5",
            item.expired ? "text-[color:var(--danger-text)]" : "text-[color:var(--dash-ink)]",
          )}
          data-testid="mha-clock-countdown"
          data-passed={item.expired ? "true" : undefined}
        >
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="font-semibold">{item.expired ? "Time limit passed" : "Time limit"}</span>
            <time
              dateTime={item.deadline.toISOString()}
              className="nums rounded-md border border-[color:var(--dash-line-strong)] px-1.5 text-xs text-[color:var(--dash-muted)] forced-colors:border"
            >
              {mhaClockWhen(item.deadline, nowMs)}
            </time>
          </p>
          <p className="nums text-base font-semibold">
            {item.expired
              ? `${mhaClockDuration(nowMs - item.deadline.getTime())} ago`
              : `${mhaClockDuration(item.deadline.getTime() - nowMs)} left`}
          </p>
          {item.repeatsEveryHours !== null ? (
            <p className="text-xs text-[color:var(--dash-muted)]">{`Repeats every ${item.repeatsEveryHours} hours while the order is in force.`}</p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-1.5" data-testid="mha-clock-quote-only">
          <p className="text-sm font-semibold text-[color:var(--dash-muted)]">
            {item.reason === "not-calculable" ? MHA_TIMELINE_NOT_CALCULABLE : MHA_TIMELINE_AWAITING_REVIEW}
          </p>
          <blockquote cite={mhaActMetadata.sourceUrl} className={quote}>
            {entry.leadIn ? `“${entry.leadIn} … ${entry.quote}”` : `“${entry.quote}”`}
          </blockquote>
          {entry.caveat ? (
            <blockquote cite={mhaActMetadata.sourceUrl} className={quote}>
              {`The Act also says (s ${entry.caveat.section}): “${entry.caveat.quote}”`}
            </blockquote>
          ) : null}
        </div>
      )}
      <p className="text-xs text-[color:var(--dash-muted)]">{`Section ${entry.section}. Counted from: ${entry.anchor}.`}</p>
    </li>
  );
}

function ClockItem({
  clock,
  form,
  items,
  nowMs,
  onRemove,
}: {
  readonly clock: MhaClock;
  readonly form: MhaClockForm | undefined;
  readonly items: readonly MhaTimerItem[];
  readonly nowMs: number;
  readonly onRemove: (clock: MhaClock) => void;
}) {
  const made = mhaClockWhen(clock.madeAt, nowMs);
  return (
    <li className="min-w-0 border-t border-[color:var(--dash-line)] first:border-t-0">
      <article
        aria-label={`Form ${clock.formCode}, made ${made}`}
        data-testid="mha-clock-card"
        className="grid gap-2 px-3.5 py-3"
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5">
          <span
            aria-hidden="true"
            className="nums grid h-7 min-w-9 place-items-center rounded-lg border border-[color:var(--dash-line-strong)] px-1.5 text-sm-minus font-semibold text-[color:var(--dash-ink)] forced-colors:border"
          >
            {clock.formCode}
          </span>
          <span className="grid min-w-0">
            <span className="text-sm font-semibold text-[color:var(--dash-ink)]">{`Form ${clock.formCode}`}</span>
            <span className="break-words text-xs text-[color:var(--dash-muted)]">
              {form?.title ?? "Form not in the catalogue"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onRemove(clock)}
            aria-label={`Remove the Form ${clock.formCode} clock made ${made}`}
            data-testid="mha-clock-remove"
            className={cn(
              focusRing,
              "-mr-2 grid size-12 place-items-center rounded-full text-[color:var(--dash-muted)] forced-colors:border",
            )}
          >
            <X aria-hidden="true" className="size-icon-sm" />
          </button>
        </div>
        <p className="nums text-xs text-[color:var(--dash-muted)]" data-testid="mha-clock-meta">
          {`Made ${made} · ${mhaClockDuration(nowMs - clock.madeAt)} running`}
        </p>
        {items.length > 0 ? (
          <ol className="grid gap-3">
            {items.map((item, index) => (
              <LimitRow key={`${item.entry.id}:${index}`} item={item} nowMs={nowMs} />
            ))}
          </ol>
        ) : (
          <p className="text-xs text-[color:var(--dash-muted)]">The app has no time limits for this form.</p>
        )}
        {form ? (
          <Link href={`/forms/${form.slug}`} className={cn(flatLink, "self-start")}>
            {`Open Form ${clock.formCode}`}
            <ChevronRight aria-hidden="true" className="size-icon-xs" />
          </Link>
        ) : null}
      </article>
    </li>
  );
}

function HandoverCopy({ clocks, nowMs }: { readonly clocks: readonly MhaClock[]; readonly nowMs: number }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const text = mhaClockHandoverText(clocks, nowMs);
  const lines = text.split("\n");
  const copy = () => {
    if (!navigator.clipboard?.writeText) {
      setStatus("failed");
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => setStatus("copied"),
      () => setStatus("failed"),
    );
  };
  return (
    <section aria-labelledby="mha-clock-handover-title" className="grid gap-2" data-testid="mha-clock-handover">
      <FlatLabel id="mha-clock-handover-title" title="For handover" />
      <div className={flatPanelPadded}>
        <div className="grid gap-0.5" data-testid="mha-clock-handover-lines">
          <p className="nums text-xs text-[color:var(--dash-muted)]">{lines[0]}</p>
          {lines.slice(1, -1).map((line, index) => (
            <p key={`${index}:${line}`} className="nums text-sm text-[color:var(--dash-ink)]">
              {line}
            </p>
          ))}
          <p className="text-xs text-[color:var(--dash-muted)]">{lines.at(-1)}</p>
        </div>
        <p className="text-xs text-[color:var(--dash-muted)]">{MHA_CLOCK_HANDOVER_NOTE}</p>
        <div className="flex flex-wrap items-center justify-end gap-x-3">
          <p
            role="status"
            className="min-w-0 flex-1 text-xs text-[color:var(--dash-muted)]"
            data-testid="mha-clock-handover-status"
          >
            {status === "copied"
              ? "Copied."
              : status === "failed"
                ? "This browser would not copy. Select the lines above and copy them yourself."
                : ""}
          </p>
          <button type="button" onClick={copy} data-testid="mha-clock-handover-copy" className={flatButton}>
            <Copy aria-hidden="true" className="size-icon-sm" />
            Copy
          </button>
        </div>
      </div>
    </section>
  );
}

function UndoBar({
  removed,
  onUndo,
  message,
}: {
  readonly removed: MhaClock | null;
  readonly onUndo: () => void;
  readonly message: string | null;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[var(--z-toast)] flex justify-center px-4"
    >
      {removed || message ? (
        <div
          data-testid="mha-clock-undo"
          className="pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-xl bg-[color:var(--dash-ink)] py-1 pr-1 pl-4 text-sm text-[color:var(--dash-page)] shadow-[var(--dash-shadow)] forced-colors:border"
        >
          <span className="nums min-w-0 py-2">{message ?? `Form ${removed?.formCode} clock removed`}</span>
          {removed ? (
            <button
              type="button"
              onClick={onUndo}
              data-testid="mha-clock-undo-button"
              className={cn(
                focusRing,
                "min-h-12 shrink-0 rounded-lg px-4 font-semibold underline-offset-2 hover:underline",
              )}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A recurring review shows only its next deadline here; the form page has the full timeline. */
function firstOfEach(items: readonly MhaTimerItem[]): MhaTimerItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.timerId}:${item.entry.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function useUndo() {
  const [removed, setRemoved] = useState<MhaClock | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const show = useCallback(
    (clock: MhaClock | null, text: string | null) => {
      clear();
      setRemoved(clock);
      setMessage(text);
      timer.current = window.setTimeout(() => {
        setRemoved(null);
        setMessage(null);
      }, UNDO_MS);
    },
    [clear],
  );
  useEffect(() => clear, [clear]);
  const remove = (clock: MhaClock) => {
    if (removeMhaClock(clock.id)) show(clock, null);
    else show(null, "This browser would not remove the clock. Check that site storage is allowed.");
  };
  const undo = () => {
    if (!removed) return;
    const result = restoreMhaClock(removed);
    show(null, result === "added" ? `Form ${removed.formCode} clock put back` : ADD_MESSAGE[result]);
  };
  return { removed, message, remove, undo };
}

export function MhaClockPage({
  forms,
  now: nowProp,
}: {
  readonly forms: readonly MhaClockForm[];
  readonly now?: Date;
}) {
  const now = useNow(nowProp);
  const { clocks, unreadable } = useClockState();
  const undo = useUndo();
  const formByCode = useMemo(() => new Map(forms.map((form) => [form.code, form])), [forms]);
  const result = useMemo(
    () =>
      now
        ? mhaTimers(
            clocks.map((clock) => ({ timerId: clock.id, formCode: clock.formCode, madeAt: new Date(clock.madeAt) })),
            now,
          )
        : null,
    [clocks, now],
  );
  const items = result ? firstOfEach(result.items) : [];
  const nowMs = now?.getTime() ?? 0;
  const passed = items.filter((item) => item.kind === "countdown" && item.expired).length;

  return (
    <InformationPageShell testId="mha-clock-page">
      <div className={cn("mx-auto grid w-full max-w-3xl gap-3", dashSurface)}>
        <InformationPageBreadcrumbs home={{ label: "Psychiatry", href: "/psychiatry" }} current="MHA clock" />
        <header className="grid min-w-0 gap-0.5">
          <p className="min-h-5 text-sm text-[color:var(--dash-muted)]">{now ? `${hhmm(now)} Perth time` : null}</p>
          <h1 className="font-dash-figure text-3xl-minus leading-tight tracking-tight text-[color:var(--dash-ink)]">
            MHA clock
          </h1>
        </header>

        {unreadable ? (
          <p
            role="alert"
            data-testid="mha-clock-unreadable"
            className="flex items-start gap-2.5 rounded-lg bg-[color:var(--dash-card)] px-3 py-2.5 text-sm text-[color:var(--dash-ink)] forced-colors:border"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--dash-muted)]" />
            <span className="font-semibold">{MHA_CLOCK_UNREADABLE}</span>
          </p>
        ) : null}

        <section aria-labelledby="mha-clock-running-title" className="grid gap-2" data-testid="mha-clock-running">
          <FlatLabel
            id="mha-clock-running-title"
            title="Running now"
            aside={
              clocks.length > 0 ? (
                <a href={`#${ADD_SECTION_ID}`} className={flatLink} data-testid="mha-clock-jump-start">
                  <Plus aria-hidden="true" className="size-icon-xs" />
                  Start a clock
                </a>
              ) : (
                <FlatTag>On this phone</FlatTag>
              )
            }
          />
          <div className={flatPanelPadded}>
            {clocks.length === 0 ? (
              unreadable ? null : (
                <p className="text-sm text-[color:var(--dash-muted)]" data-testid="mha-clock-empty">
                  No clocks yet. Start one below for each Mental Health Act form you are holding.
                </p>
              )
            ) : (
              <>
                <p className="flex flex-wrap items-baseline gap-x-1.5 text-[color:var(--dash-ink)]">
                  <span className="nums text-xl font-semibold" data-testid="mha-clock-count">
                    {clocks.length}
                  </span>{" "}
                  <span className="text-sm-minus font-medium">{clocks.length === 1 ? "clock" : "clocks"}</span>{" "}
                  {passed > 0 ? (
                    <span
                      className="text-xs font-semibold text-[color:var(--danger-text)]"
                      data-testid="mha-clock-passed-count"
                    >
                      {`· ${passed} time ${passed === 1 ? "limit" : "limits"} passed`}
                    </span>
                  ) : null}
                </p>
                {now ? <ShiftBand clocks={clocks} now={now} /> : null}
              </>
            )}
            <p className="text-xs text-[color:var(--dash-muted)]" data-testid="mha-clock-retention">
              {MHA_CLOCK_RETENTION_NOTE}
            </p>
          </div>
        </section>

        {clocks.length > 0 ? (
          <ul role="list" aria-label="Running clocks" className={cn(flatPanel, "grid")}>
            {clocks.map((clock) => (
              <ClockItem
                key={clock.id}
                clock={clock}
                form={formByCode.get(clock.formCode)}
                items={items.filter((item) => item.timerId === clock.id)}
                nowMs={nowMs}
                onRemove={undo.remove}
              />
            ))}
          </ul>
        ) : null}

        {clocks.length > 0 && now ? <HandoverCopy clocks={clocks} nowMs={nowMs} /> : null}

        <AddClock forms={forms} now={now} />

        <p className="mt-1 text-xs text-[color:var(--dash-muted)]" data-testid="mha-clock-reference">
          {MHA_TIMELINE_REFERENCE_NOTE}
        </p>
        <FlatList label="Related pages">
          <FlatRow href="/forms/act" icon={ShieldCheck} title="Form pages and the Act" />
          <FlatRow href="/on-call/call" icon={Phone} title="Handover" subtitle="On Call" />
        </FlatList>
      </div>
      <UndoBar removed={undo.removed} message={undo.message} onUndo={undo.undo} />
    </InformationPageShell>
  );
}
