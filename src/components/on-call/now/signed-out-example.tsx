"use client";

import { Clock, MapPin, Phone, Shield } from "lucide-react";

import { onCallBadge, onCallLeadingIcon, onCallTrack, onCallTrackFill } from "@/components/on-call/kit/calm";
import { OnCallGroupedList, OnCallRow } from "@/components/on-call/kit/grouped-list";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { modeNameText, modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { cn, eyebrowText } from "@/components/ui-primitives";

/**
 * The made-up example a signed-out visitor sees on Now (owner decision,
 * 6 Oct 2026): the mock-up's Now layout, read-only, under the "Made-up
 * example" banner and the real public crisis lines, which `OnCallHome` draws
 * above this.
 *
 * Built from the constants below and nothing else: it reads nothing from the
 * server or the device and writes nothing. Every number is a `0000 000 0xx`
 * placeholder drawn as plain text, never a `tel:` link and never a button, so
 * nobody can ring one. There are no controls at all, so nothing here looks like
 * something to press.
 *
 * The names are the mock-up's own invented ones. Kept apart from the demo
 * corpus (`demo-entries.ts`), whose "Demo ..." rows feed the signed-in
 * preview and do not match the mock-up's Now screen.
 */
export const ON_CALL_NOW_EXAMPLE = {
  hospital: "Example Hospital",
  emergency: {
    title: "Medical emergency team",
    mobile: "0000 000 099",
    wardCode: "55",
  },
  rightNow: {
    role: "Psychiatry registrar",
    name: "Dr Alex Example",
    until: "Until Mon 08:00 · 10 h 20 min to go",
    number: "0000 000 002",
    numberLabel: "Mobile",
    start: "17:00",
    nowLabel: "Now 21:40",
    end: "08:00",
  },
  escalating: {
    started: "Escalating · started 21:32",
    title: "Registrar called 21:34",
    next: "Next step suggested at 21:49 · 9 min",
    stepsDone: 2,
    steps: 4,
  },
  pulse: {
    title: "Break 1 not taken yet",
    body: "Planned 20:00 · busiest 21:00 to 23:00 on your last 4 nights",
  },
  usual: ["Main line", "Ward 2", "ED", "Security"],
  alsoOn: [
    {
      badge: "CON",
      role: "Consultant on call",
      name: "Dr Priya Nair",
      detail: "At home · until Mon 08:00",
      number: "0000 000 003",
    },
    { badge: "NIC", role: "Nurse in charge", name: null, detail: "Until 23:00", number: "0000 000 004" },
  ],
  situations: ["Deteriorating patient", "Aggression", "Absconded patient", "Death on the ward", "Calling a consultant"],
} as const;

/**
 * The shift-pulse bars, 17:00 to 08:00, at the mock-up's heights, as literal
 * classes (no inline style; Tailwind reads them as written). The three
 * busiest hours carry the mode's teal.
 */
const PULSE_BARS: readonly { readonly height: string; readonly peak?: true }[] = [
  { height: "h-[30%]" },
  { height: "h-[55%]" },
  { height: "h-[35%]" },
  { height: "h-[15%]" },
  { height: "h-[80%]", peak: true },
  { height: "h-full", peak: true },
  { height: "h-[85%]", peak: true },
  { height: "h-[40%]" },
  { height: "h-[20%]" },
  { height: "h-[25%]" },
  { height: "h-[10%]" },
  { height: "h-[10%]" },
  { height: "h-[15%]" },
  { height: "h-[20%]" },
  { height: "h-[30%]" },
];

/** Every made-up number on the example, for the tests that pin them as text only. */
export const ON_CALL_NOW_EXAMPLE_NUMBERS: readonly string[] = [
  ON_CALL_NOW_EXAMPLE.emergency.mobile,
  ON_CALL_NOW_EXAMPLE.rightNow.number,
  ...ON_CALL_NOW_EXAMPLE.alsoOn.map((row) => row.number),
];

/** A made-up number, drawn as text: never a link, never a button. */
function ExampleNumber({ value }: { readonly value: string }) {
  return (
    <span className={cn(modeNumberText, "text-[color:var(--text-heading)]")} data-example-number="true">
      {value}
    </span>
  );
}

export default function OnCallNowSignedOutExample() {
  const example = ON_CALL_NOW_EXAMPLE;
  return (
    <section
      aria-labelledby="on-call-now-example-heading"
      className="grid min-w-0 gap-5"
      data-testid="on-call-now-example"
    >
      <div className="grid gap-1 px-3">
        <h2 id="on-call-now-example-heading" className={eyebrowText}>
          Made-up example from here down
        </h2>
        <p className={cn(modeSecondaryText, "flex min-h-12 items-center gap-2")}>
          <MapPin aria-hidden="true" strokeWidth={1.5} className={onCallLeadingIcon} />
          <span className={cn(modeNameText, "text-base-minus text-[color:var(--text-heading)]")}>
            {example.hospital}
          </span>
        </p>
      </div>

      <div className={cn(modeModuleSurface, "grid min-w-0 gap-2 p-3")} data-testid="on-call-now-example-emergency">
        <p className="flex min-w-0 items-center gap-2">
          <Shield aria-hidden="true" strokeWidth={1.5} className={onCallLeadingIcon} />
          <span className={cn(modeNameText, "text-base-minus font-semibold text-[color:var(--text-heading)]")}>
            {example.emergency.title}
          </span>
        </p>
        <p className="flex min-h-12 min-w-0 flex-wrap items-center gap-x-2">
          <Phone aria-hidden="true" strokeWidth={1.5} className={onCallLeadingIcon} />
          <ExampleNumber value={example.emergency.mobile} />
          <span className={modeSecondaryText}>from your mobile</span>
        </p>
        <p className="flex min-h-12 min-w-0 flex-wrap items-center gap-x-2">
          <Phone aria-hidden="true" strokeWidth={1.5} className={onCallLeadingIcon} />
          <span className={cn(modeNumberText, "text-[color:var(--text-heading)]")}>
            {`Dial ${example.emergency.wardCode}`}
          </span>
          <span className={modeSecondaryText}>from a ward phone</span>
        </p>
      </div>

      <section aria-labelledby="on-call-now-example-right-now" className="grid min-w-0 gap-2 px-3">
        <h2 id="on-call-now-example-right-now" className={eyebrowText}>
          Right now · after hours
        </h2>
        <div className="grid gap-0.5">
          <p className="text-xl font-semibold text-[color:var(--text-heading)]">{example.rightNow.role}</p>
          <p className={cn(modeSecondaryText, "flex items-center gap-1.5")}>
            <Clock aria-hidden="true" strokeWidth={1.5} className="size-icon-xs shrink-0" />
            {`${example.rightNow.name} · ${example.rightNow.until}`}
          </p>
        </div>
        <p className="grid min-h-12 content-center gap-0.5">
          <ExampleNumber value={example.rightNow.number} />
          <span className={modeSecondaryText}>{example.rightNow.numberLabel}</span>
        </p>
        <div className="grid gap-1" aria-hidden="true">
          <span className={onCallTrack}>
            {/* 21:40 is about 31% of the way through a 17:00 to 08:00 shift. */}
            <span className={cn(onCallTrackFill, "w-[31%]")} />
          </span>
          <span
            className={cn(modeNumberText, "flex justify-between text-2xs font-semibold text-[color:var(--text-muted)]")}
          >
            <span>{example.rightNow.start}</span>
            <span>{example.rightNow.nowLabel}</span>
            <span>{example.rightNow.end}</span>
          </span>
        </div>
      </section>

      <div className={cn(modeModuleSurface, "grid min-w-0 gap-2 p-3")} data-testid="on-call-now-example-escalating">
        <span className={eyebrowText}>{example.escalating.started}</span>
        <p className="text-base-minus font-semibold text-[color:var(--text-heading)]">{example.escalating.title}</p>
        <p className={modeSecondaryText}>{example.escalating.next}</p>
        <span className="flex gap-1" aria-hidden="true">
          {Array.from({ length: example.escalating.steps }, (_, index) => (
            <span
              key={index}
              className={cn(
                "h-1 flex-1 rounded-full",
                index < example.escalating.stepsDone ? "bg-[color:var(--mode-identity)]" : "bg-[color:var(--border)]",
              )}
            />
          ))}
        </span>
      </div>

      <div className="grid min-w-0 gap-2 px-3" data-testid="on-call-now-example-pulse">
        <span className={eyebrowText}>Shift pulse</span>
        <p className="text-base-minus font-semibold text-[color:var(--text-heading)]">{example.pulse.title}</p>
        <p className={modeSecondaryText}>{example.pulse.body}</p>
        <span className="grid gap-1" aria-hidden="true">
          <span className="flex h-8 items-end gap-0.5">
            {PULSE_BARS.map((bar, index) => (
              <span
                key={index}
                className={cn(
                  "min-h-1 flex-1 rounded-t-sm",
                  bar.height,
                  bar.peak ? "bg-[color:var(--mode-identity)]" : "bg-[color:var(--border-strong)]",
                )}
              />
            ))}
          </span>
          <span
            className={cn(modeNumberText, "flex justify-between text-2xs font-semibold text-[color:var(--text-muted)]")}
          >
            <span>17:00</span>
            <span>Last 4 nights · counts only</span>
            <span>08:00</span>
          </span>
        </span>
      </div>

      <OnCallGroupedList eyebrow="Your usual" testId="on-call-now-example-usual">
        {example.usual.map((label) => (
          <OnCallRow
            key={label}
            title={label}
            leading={<Phone aria-hidden="true" strokeWidth={1.5} className={onCallLeadingIcon} />}
          />
        ))}
      </OnCallGroupedList>

      <OnCallGroupedList eyebrow="Also on tonight" testId="on-call-now-example-also-on">
        {example.alsoOn.map((row) => (
          <OnCallRow
            key={row.role}
            title={row.name ? `${row.role} · ${row.name}` : row.role}
            subtitle={row.detail}
            leading={<span className={onCallBadge}>{row.badge}</span>}
            trailing={<ExampleNumber value={row.number} />}
            className="pr-3"
          />
        ))}
      </OnCallGroupedList>

      <OnCallGroupedList eyebrow="Who do I call now?" testId="on-call-now-example-situations">
        {example.situations.map((situation) => (
          <OnCallRow key={situation} title={situation} />
        ))}
      </OnCallGroupedList>
    </section>
  );
}
