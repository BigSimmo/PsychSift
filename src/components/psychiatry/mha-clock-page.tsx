"use client";

import { ExternalLink, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";

import { focusRing } from "@/components/card-recipes";
import { DashCard } from "@/components/dashboard-kit/dash-card";
import { DashTag } from "@/components/dashboard-kit/icon-chip";
import { dashFigure, dashLink, dashMuted, dashSurface } from "@/components/dashboard-kit/recipes";
import {
  MHA_TIMELINE_AWAITING_REVIEW,
  MHA_TIMELINE_NOT_CALCULABLE,
  MHA_TIMELINE_REFERENCE_NOTE,
} from "@/components/forms/mha-timeline-panel";
import { InformationPageBreadcrumbs, InformationPageShell } from "@/components/information-page-shell";
import { cn } from "@/components/ui-primitives";
import { toAwstParts } from "@/lib/caring-contacts/clock";
import { mhaActMetadata } from "@/lib/mha-act-sections";
import { formatPerthDateTime, parsePerthDateTimeInput } from "@/lib/mha-timeline";
import { mhaTimers, type MhaTimerItem } from "@/lib/on-call/mha-timers";
import {
  addMhaClock,
  EMPTY_MHA_CLOCKS,
  loadMhaClocks,
  MHA_CLOCK_LIMIT,
  removeMhaClock,
  subscribeMhaClocks,
  type AddMhaClockResult,
  type MhaClock,
} from "@/lib/psychiatry-hub/mha-clocks";

/**
 * Psychiatry · MHA clock: every Mental Health Act form the reader is holding right now, on one
 * screen, with how long each has been running and each of its time limits.
 *
 * NOTHING CLINICAL IS WRITTEN HERE. Every limit, quote and countdown comes from `mhaTimers`, which
 * reads the governed timeframe data and shows an end time only for a limit signed off by a named
 * clinician while the owner's signed countdown switch is on. Everything else shows the owner-approved
 * "awaiting clinical review" or "not calculated" line from the form page, with the Act's own words.
 * A clock holds a form code and a time, never anything about the person.
 */

export interface MhaClockForm {
  readonly code: string;
  readonly title: string;
  readonly slug: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

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

function useClocks(): readonly MhaClock[] {
  return useSyncExternalStore(subscribeMhaClocks, loadMhaClocks, () => EMPTY_MHA_CLOCKS);
}

function hhmm(instant: Date | number): string {
  const { hour, minute } = toAwstParts(new Date(instant));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "0:45", "26:05": hours and minutes, for elapsed time. */
function hoursMinutes(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MINUTE_MS));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "5 h 20 min", "45 min". */
function spoken(ms: number): string {
  const total = Math.max(0, Math.round(ms / MINUTE_MS));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
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

function AddClockCard({ forms, now }: { readonly forms: readonly MhaClockForm[]; readonly now: Date | null }) {
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
    "min-h-12 w-full rounded-xl border border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] px-3 text-sm text-[color:var(--dash-ink)] forced-colors:border";

  return (
    <DashCard title="Start a clock" testId="mha-clock-add">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="grid min-w-0 gap-1">
          <label htmlFor={formId} className="text-sm font-dash-title text-[color:var(--dash-ink)]">
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
          <label htmlFor={timeId} className="text-sm font-dash-title text-[color:var(--dash-ink)]">
            When was it made?
          </label>
          <input
            id={timeId}
            type="datetime-local"
            value={madeAt || (now ? perthInputValue(now) : "")}
            onChange={(event) => setMadeAt(event.target.value)}
            data-testid="mha-clock-time"
            className={field}
          />
        </div>
        <button
          type="submit"
          data-testid="mha-clock-start"
          aria-describedby={message ? messageId : undefined}
          className={cn(
            focusRing,
            "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl bg-[color:var(--dash-blue)] px-4 text-sm font-dash-title text-[color:var(--dash-hero-ink)] forced-colors:border",
          )}
        >
          <Plus aria-hidden="true" className="size-icon-sm" />
          Start
        </button>
      </form>
      <p id={messageId} role="status" className={cn(dashMuted, "min-h-4")} data-testid="mha-clock-message">
        {message ?? "Perth time. Only forms with time limits in the app are listed."}
      </p>
    </DashCard>
  );
}

/**
 * One lane per clock from when it was made to now, with a dot at each limit's end time when one
 * may be shown, and a shared now line. Decorative: every figure on it is also written in the cards.
 */
function ShiftBand({
  clocks,
  items,
  now,
}: {
  readonly clocks: readonly MhaClock[];
  readonly items: readonly MhaTimerItem[];
  readonly now: Date;
}) {
  const nowMs = now.getTime();
  const earliest = Math.max(Math.min(...clocks.map((clock) => clock.madeAt)), nowMs - 24 * HOUR_MS);
  const start = Math.floor(earliest / HOUR_MS) * HOUR_MS;
  const firstDeadlines = items.flatMap((item) =>
    item.kind === "countdown" && item.occurrence === 1 && !item.expired ? [item.deadline.getTime()] : [],
  );
  const latest = Math.min(Math.max(nowMs + HOUR_MS, ...firstDeadlines), start + 36 * HOUR_MS);
  const end = Math.max(Math.ceil(latest / HOUR_MS) * HOUR_MS, start + 6 * HOUR_MS);
  const span = end - start;
  const at = (ms: number) => `${Math.min(100, Math.max(0, ((ms - start) / span) * 100))}%`;
  const step = span <= 12 * HOUR_MS ? 3 * HOUR_MS : 6 * HOUR_MS;
  const ticks: number[] = [];
  for (let tick = start; tick <= end; tick += step) ticks.push(tick);

  return (
    <div aria-hidden="true" className="grid gap-2" data-testid="mha-clock-band">
      <div className="relative grid gap-2 py-1">
        {clocks.map((clock) => {
          const dots = items.filter(
            (item) =>
              item.timerId === clock.id &&
              item.kind === "countdown" &&
              item.occurrence === 1 &&
              item.deadline.getTime() <= end,
          );
          return (
            <div key={clock.id} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-2">
              <span className="truncate text-right text-xs font-dash-title text-[color:var(--dash-ink)]">
                {clock.formCode}
              </span>
              <div className="relative h-5 rounded-full bg-[color:var(--dash-line)]">
                <span
                  className="absolute inset-y-0 rounded-full bg-[color:var(--dash-blue)] forced-colors:bg-[CanvasText]"
                  style={{ left: at(clock.madeAt), width: `calc(${at(nowMs)} - ${at(clock.madeAt)})` }}
                />
                {dots.map((item) =>
                  item.kind === "countdown" ? (
                    <span
                      key={item.entry.id}
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[color:var(--dash-blue)] bg-[color:var(--dash-raised)]"
                      style={{ left: at(item.deadline.getTime()) }}
                    />
                  ) : null,
                )}
              </div>
            </div>
          );
        })}
        <span
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-[color:var(--dash-ink)]"
          style={{ left: `calc(3.25rem + (100% - 3.25rem) * ${(nowMs - start) / span})` }}
        />
      </div>
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2">
        <span />
        <div className="relative h-4">
          {ticks.map((tick, index) => (
            <span
              key={tick}
              className={cn(
                "absolute top-0 text-3xs nums text-[color:var(--dash-faint)]",
                index === 0 ? "" : index === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: at(tick) }}
            >
              {hhmm(tick)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function LimitRow({ item, nowMs }: { readonly item: MhaTimerItem; readonly nowMs: number }) {
  const { entry } = item;
  return (
    <li className="grid gap-1.5 border-t border-[color:var(--dash-line)] pt-3 first:border-t-0 first:pt-0">
      <p className="text-sm font-dash-title leading-snug text-[color:var(--dash-ink)]">{entry.trigger}</p>
      {entry.condition ? (
        <p className="text-xs leading-snug text-[color:var(--dash-muted)]" data-testid="mha-clock-condition">
          {entry.condition}
        </p>
      ) : null}
      {item.kind === "countdown" ? (
        <div className="grid gap-0.5" data-testid="mha-clock-countdown">
          <p className="text-sm text-[color:var(--dash-ink)]">
            <span className="font-dash-title">{item.expired ? "Time limit passed " : "Time limit "}</span>
            <time dateTime={item.deadline.toISOString()}>{formatPerthDateTime(item.deadline)}</time>
          </p>
          <p className={cn(dashFigure, "text-lg text-[color:var(--dash-blue)]")}>
            {item.expired
              ? `${spoken(nowMs - item.deadline.getTime())} ago`
              : `${spoken(item.deadline.getTime() - nowMs)} left`}
          </p>
          {item.repeatsEveryHours !== null ? (
            <p className={dashMuted}>{`Repeats every ${item.repeatsEveryHours} hours while the order is in force.`}</p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-1" data-testid="mha-clock-quote-only">
          <p className="text-sm font-dash-title text-[color:var(--dash-muted)]">
            {item.reason === "not-calculable" ? MHA_TIMELINE_NOT_CALCULABLE : MHA_TIMELINE_AWAITING_REVIEW}
          </p>
          <blockquote
            cite={mhaActMetadata.sourceUrl}
            className="border-l-2 border-[color:var(--dash-line-strong)] pl-3 text-sm italic leading-6 text-[color:var(--dash-ink)]"
          >
            {entry.leadIn ? `“${entry.leadIn} … ${entry.quote}”` : `“${entry.quote}”`}
          </blockquote>
          {entry.caveat ? (
            <blockquote
              cite={mhaActMetadata.sourceUrl}
              className="border-l-2 border-[color:var(--dash-line-strong)] pl-3 text-sm italic leading-6 text-[color:var(--dash-ink)]"
            >
              {`The Act also says (s ${entry.caveat.section}): “${entry.caveat.quote}”`}
            </blockquote>
          ) : null}
        </div>
      )}
      <p className={dashMuted}>{`Section ${entry.section}. Counted from: ${entry.anchor}.`}</p>
    </li>
  );
}

function ClockCard({
  clock,
  form,
  items,
  nowMs,
}: {
  readonly clock: MhaClock;
  readonly form: MhaClockForm | undefined;
  readonly items: readonly MhaTimerItem[];
  readonly nowMs: number;
}) {
  const title = form?.title ?? "Form not in the catalogue";
  return (
    <li className="min-w-0">
      <article
        aria-label={`Form ${clock.formCode}, made at ${hhmm(clock.madeAt)}`}
        data-testid="mha-clock-card"
        className="grid gap-3 rounded-2xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] p-3.5 forced-colors:border"
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 place-items-center rounded-full bg-[color:var(--dash-blue-tint)] font-dash-figure text-base text-[color:var(--dash-blue)] forced-colors:border"
          >
            {clock.formCode}
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span className="break-words font-dash-title text-base-minus leading-tight text-[color:var(--dash-ink)]">
              {title}
            </span>
            <span
              className={dashMuted}
            >{`Made ${hhmm(clock.madeAt)} · running ${hoursMinutes(nowMs - clock.madeAt)}`}</span>
          </span>
          <button
            type="button"
            onClick={() => removeMhaClock(clock.id)}
            aria-label={`Remove the Form ${clock.formCode} clock made at ${hhmm(clock.madeAt)}`}
            data-testid="mha-clock-remove"
            className={cn(
              focusRing,
              "grid size-12 place-items-center rounded-full text-[color:var(--dash-muted)] forced-colors:border",
            )}
          >
            <Trash2 aria-hidden="true" className="size-icon-sm" />
          </button>
        </div>
        {items.length > 0 ? (
          <ol className="grid gap-3">
            {items.map((item, index) => (
              <LimitRow key={`${item.entry.id}:${index}`} item={item} nowMs={nowMs} />
            ))}
          </ol>
        ) : (
          <p className={dashMuted}>The app has no time limits for this form.</p>
        )}
        {form ? (
          <Link
            href={`/forms/${form.slug}`}
            className={cn(focusRing, dashLink, "inline-flex min-h-12 items-center self-start rounded-full")}
          >
            {`Open Form ${clock.formCode}`}
          </Link>
        ) : null}
      </article>
    </li>
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

export function MhaClockPage({
  forms,
  now: nowProp,
}: {
  readonly forms: readonly MhaClockForm[];
  readonly now?: Date;
}) {
  const now = useNow(nowProp);
  const clocks = useClocks();
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

  return (
    <InformationPageShell testId="mha-clock-page">
      <div className={cn("mx-auto grid w-full max-w-3xl gap-4 sm:gap-5", dashSurface)}>
        <InformationPageBreadcrumbs home={{ label: "Psychiatry", href: "/psychiatry" }} current="MHA clock" />
        <header className="grid min-w-0 gap-0.5">
          <p className="min-h-5 text-sm text-[color:var(--dash-muted)]">{now ? `${hhmm(now)} Perth time` : null}</p>
          <h1 className="font-dash-figure text-3xl-minus leading-tight tracking-tight text-[color:var(--dash-ink)]">
            MHA clock
          </h1>
        </header>

        <DashCard title="Running now" testId="mha-clock-running" aside={<DashTag tint="blue">On this device</DashTag>}>
          {clocks.length === 0 ? (
            <p className={dashMuted} data-testid="mha-clock-empty">
              No clocks yet. Start one below for each Mental Health Act form you are holding.
            </p>
          ) : (
            <>
              <p className="flex items-baseline gap-2 text-[color:var(--dash-ink)]">
                <span className={cn(dashFigure, "text-3xl-minus")} data-testid="mha-clock-count">
                  {clocks.length}
                </span>
                <span className="text-sm font-dash-title">{clocks.length === 1 ? "clock" : "clocks"}</span>
              </p>
              {now ? <ShiftBand clocks={clocks} items={items} now={now} /> : null}
            </>
          )}
          <p className={dashMuted}>
            Cleared at the end of your shift and when you sign out. A clock holds the form and the time only.
          </p>
        </DashCard>

        {clocks.length > 0 ? (
          <ul role="list" aria-label="Running clocks" className="grid gap-3">
            {clocks.map((clock) => (
              <ClockCard
                key={clock.id}
                clock={clock}
                form={formByCode.get(clock.formCode)}
                items={items.filter((item) => item.timerId === clock.id)}
                nowMs={nowMs}
              />
            ))}
          </ul>
        ) : null}

        <AddClockCard forms={forms} now={now} />

        <div className="grid gap-1">
          <p className="text-sm font-dash-title text-[color:var(--dash-ink)]" data-testid="mha-clock-reference">
            {MHA_TIMELINE_REFERENCE_NOTE}
          </p>
          <div className="flex flex-wrap gap-x-3">
            <Link
              href="/forms/act"
              className={cn(focusRing, dashLink, "inline-flex min-h-12 items-center rounded-full")}
            >
              The Act and Standards
            </Link>
            <a
              href={mhaActMetadata.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(focusRing, dashLink, "inline-flex min-h-12 items-center gap-1 rounded-full")}
            >
              Mental Health Act 2014 (WA)
              <ExternalLink aria-hidden="true" className="size-icon-sm" />
            </a>
          </div>
        </div>
      </div>
    </InformationPageShell>
  );
}
