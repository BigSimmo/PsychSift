"use client";

import "./assess.css";

import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Phone,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { createElement, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ModeBandAction, useModeBandHeading, useModeBandShown } from "@/components/mode-band/mode-band";
import { WorkGlassButton } from "@/components/mode-kit/work";
import { universalHeaderLeadingSlotId } from "@/components/work-frame/work-frame-header";
import { useClaimWorkFrameBack } from "@/components/work-frame/work-frame-store";
import { RATING_LABELS, type Rating } from "@/lib/teaching/assessments/content";
import { looksLikePatientDetails } from "@/lib/teaching/assessments/model";
import { withUnit } from "@/components/teaching/teaching-number";

/*
 * Assessments' own pieces (work-mode redesign, owner request 6 Oct 2026), drawn
 * from the locked mockup's `assess-*` recipes. Shared frame pieces (cards,
 * rows, hero, tags, chips, dock) come from `@/components/mode-kit/work`; this
 * file adds only what the area needs beyond them. Styles: `assess.css`, tokens
 * only. Every control here is a real input or button with a 48px target.
 */

/* ------------------------------------------------------------ the header */

const subscribeNever = () => () => {};

export type AssessHeaderProps = {
  /** The small line over the band title ("Step 3 of 8"). */
  readonly eyebrow: string;
  /** The band title ("Sam's end-of-term"). Also the screen's own (hidden) heading. */
  readonly title: string;
  /** Where the round back button goes, and what it says. */
  readonly back?: { readonly href: string; readonly label: string };
  /** The round glass action at the right of the band (Save and close). */
  readonly action?: { readonly icon: LucideIcon; readonly label: string; readonly onClick: () => void };
};

/**
 * Names a screen in the work band (eyebrow and title), puts its back button in
 * the header's round left button and its one action in the band's glass slot.
 * Keeps a focusable heading for screen readers, which the page moves focus to
 * on every change of screen. With no band (a test, a hidden band), it draws
 * the same things inline.
 */
export function AssessHeader({ eyebrow, title, back, action }: AssessHeaderProps) {
  const shown = useModeBandShown();
  useModeBandHeading({ eyebrow, title });
  // A screen with its own way back takes the top bar's left button from the
  // frame's arrow to Teaching, so there is only ever one.
  useClaimWorkFrameBack(Boolean(back) && shown);
  const host = useSyncExternalStore(
    subscribeNever,
    () => document.getElementById(universalHeaderLeadingSlotId),
    () => null,
  );
  const heading = (
    <h2
      tabIndex={-1}
      data-screen-heading
      className={shown ? "sr-only" : "text-lg font-bold text-[color:var(--text-heading)] outline-none"}
    >
      {title}
    </h2>
  );
  const backLink = back ? (
    <Link
      href={back.href}
      className="universal-header-icon-control work-frame-back"
      aria-label={`Back to ${back.label}`}
      data-testid="assess-back"
    >
      <ChevronLeft aria-hidden="true" className="size-icon-lg" strokeWidth={2.25} />
    </Link>
  ) : null;
  if (!shown) {
    return (
      <div className="flex min-h-12 items-center gap-2">
        {backLink}
        <div className="grid min-w-0 flex-1">
          <span className="text-2xs font-semibold uppercase tracking-label text-[color:var(--text-muted)]">
            {eyebrow}
          </span>
          {heading}
        </div>
        {action ? <WorkGlassButton icon={action.icon} label={action.label} onClick={action.onClick} /> : null}
      </div>
    );
  }
  return (
    <>
      {heading}
      {backLink && host ? createPortal(backLink, host) : null}
      {action ? (
        <ModeBandAction>
          {() => (
            <WorkGlassButton
              icon={action.icon}
              label={action.label}
              onClick={action.onClick}
              className="work-band__action"
            />
          )}
        </ModeBandAction>
      ) : null}
    </>
  );
}

/** A close (X) action for the band. */
export const closeIcon = X;

/* ---------------------------------------------------------- small pieces */

export type SegOption<T extends string> = { readonly value: T; readonly label: string };

/** A two or three way switch drawn as the mockup's flat segmented control. */
export function AssessSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly SegOption<T>[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <div className="assess-seg-control-wrap" data-no-tab-swipe="">
      <div className="assess-seg-control" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A plain small line with an icon ("Leave out anything that could identify a patient."). */
export function AssessNote({
  icon,
  tone,
  center,
  children,
  id,
}: {
  readonly icon?: LucideIcon;
  readonly tone?: "amber";
  readonly center?: boolean;
  readonly children: ReactNode;
  readonly id?: string;
}) {
  return (
    <p id={id} className="assess-note" data-tone={tone} data-center={center ? "" : undefined}>
      {createElement(icon ?? (tone === "amber" ? TriangleAlert : Info), { "aria-hidden": true, strokeWidth: 2 })}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** A tinted card with an icon circle, a title and a line: the mockup's `sug`, `alert` and `pv`. */
export function AssessCallout({
  icon: Icon,
  tone,
  title,
  children,
  action,
  role,
  testId,
}: {
  readonly icon: LucideIcon;
  readonly tone?: "red" | "amber" | "neutral";
  readonly title: ReactNode;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
  readonly role?: "status" | "alert";
  readonly testId?: string;
}) {
  return (
    <div className="assess-callout" data-tone={tone} role={role} data-testid={testId}>
      <span
        aria-hidden="true"
        className="work-ic"
        data-tone={tone === "red" ? "red" : tone === "amber" ? "amber" : tone === "neutral" ? "neutral" : undefined}
      >
        <Icon aria-hidden="true" strokeWidth={2} />
      </span>
      <div className="assess-callout__text">
        <span className="assess-callout__title">{title}</span>
        {children ? <span className="assess-callout__body">{children}</span> : null}
      </div>
      {action}
    </div>
  );
}

/** A label and a value on one line, with a hairline above. */
export function AssessKeyValue({
  k,
  v,
  tone,
}: {
  readonly k: ReactNode;
  readonly v: ReactNode;
  readonly tone?: "red" | "amber";
}) {
  return (
    <div className="assess-kv">
      <span>{k}</span>
      <b data-tone={tone}>{v}</b>
    </div>
  );
}

/** A doctor's initials in a flat tint. */
export function AssessAvatar({ initials }: { readonly initials: string }) {
  return (
    <span aria-hidden="true" className="assess-av">
      {initials}
    </span>
  );
}

/** A thin meter. Decorative: the words beside it carry the value. */
export function AssessMeter({ fraction, tone }: { readonly fraction: number; readonly tone?: "amber" }) {
  const width = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return (
    <span aria-hidden="true" className="assess-meter" data-tone={tone}>
      <i style={{ width: `${Math.max(width * 100, width > 0 ? 3 : 0)}%` }} />
    </span>
  );
}

export type MeterLineProps = {
  readonly label: string;
  readonly value: string;
  readonly fraction: number;
  readonly tone?: "amber";
};

/** "EPAs ▭▭▭ 1 of 2": a label, a meter and the figure. */
export function AssessMeterLine({ label, value, fraction, tone }: MeterLineProps) {
  return (
    <div className="assess-ln">
      <span className="assess-ln__label">{label}</span>
      <AssessMeter fraction={fraction} tone={tone} />
      <b>
        <span className="sr-only">{label}: </span>
        {value}
      </b>
    </div>
  );
}

/** One doctor: avatar, name, a status tag, then meter lines and any extra lines. */
export function AssessPair({
  initials,
  name,
  sub,
  tag,
  end,
  href,
  lines,
  children,
}: {
  readonly initials: string;
  readonly name: ReactNode;
  readonly sub?: ReactNode;
  readonly tag?: ReactNode;
  readonly end?: ReactNode;
  readonly href?: string;
  readonly lines?: readonly MeterLineProps[];
  readonly children?: ReactNode;
}) {
  const top = (
    <>
      <AssessAvatar initials={initials} />
      <span className="work-row__text">
        <span className="work-row__title">{name}</span>
        {sub ? <span className="work-row__sub">{sub}</span> : null}
      </span>
      {tag}
      {href ? <ChevronRight aria-hidden="true" className="work-row__chev" strokeWidth={2} /> : null}
    </>
  );
  return (
    <div className="assess-pair">
      {href ? (
        <Link href={href} className="assess-pair__top">
          {top}
        </Link>
      ) : (
        <div className="assess-pair__top">
          {top}
          {end}
        </div>
      )}
      {lines?.map((line) => (
        <AssessMeterLine key={line.label} {...line} />
      ))}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------- the form */

/** Segments for the form's steps: done ones in the mode colour, the current one hatched. */
export function StepBar({ total, current }: { readonly total: number; readonly current: number }) {
  return (
    <div
      className="assess-stepbar"
      role="progressbar"
      aria-label="Form progress"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current + 1}
      aria-valuetext={`Step ${withUnit(current + 1, "of")} ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <i key={i} data-state={i < current ? "done" : i === current ? "now" : undefined} />
      ))}
    </div>
  );
}

/** Under the step bar: where you are, and whether it is kept. */
export function StepHeader({
  left,
  right,
  warn,
}: {
  readonly left: ReactNode;
  readonly right: ReactNode;
  readonly warn?: boolean;
}) {
  return (
    <div className="assess-stephead">
      <span>{left}</span>
      <b data-warn={warn ? "" : undefined}>{right}</b>
    </div>
  );
}

/** The domain's kicker, title and line, in one card. */
export function DomainCard({
  kicker,
  title,
  sub,
  headingProps,
}: {
  readonly kicker: string;
  readonly title: string;
  readonly sub?: string;
  readonly headingProps?: Record<string, unknown>;
}) {
  return (
    <div className="work-card assess-dom">
      <div className="assess-dom__kicker">{kicker}</div>
      <h3 className="assess-dom__title outline-none" {...headingProps}>
        {title}
      </h3>
      {sub ? <p className="assess-dom__sub">{sub}</p> : null}
    </div>
  );
}

/** One outcome: a tick box, its number and its words. The whole row is the checkbox's label. */
export function OutcomeRow({
  number,
  title,
  detail,
  checked,
  onToggle,
  disabled,
}: {
  readonly number?: string;
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly checked: boolean;
  readonly onToggle: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <label className="assess-ob">
      <input type="checkbox" className="sr-only" checked={checked} onChange={onToggle} disabled={disabled} />
      <span aria-hidden="true" className="assess-cb" data-on={checked ? "" : undefined}>
        {checked ? <Check aria-hidden="true" strokeWidth={3} /> : null}
      </span>
      {number ? <em className="assess-ob__num">{number}</em> : null}
      <span className="assess-ob__text">
        <span>{title}</span>
        {detail ? <span className="assess-ob__detail">{detail}</span> : null}
      </span>
    </label>
  );
}

/**
 * The five-point scale: a radio group of five cells, a big numeral over its
 * words. A chosen 1 or 2 turns red for a supervisor (`lowIsRed`) only.
 */
export function RatingScale({
  name,
  legend,
  value,
  onChange,
  lowIsRed,
  disabled,
}: {
  readonly name: string;
  readonly legend: string;
  readonly value: Rating | null;
  readonly onChange: (rating: Rating) => void;
  readonly lowIsRed?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <fieldset className="assess-rate" data-locked={disabled ? "" : undefined} disabled={disabled}>
      <legend className="sr-only">{legend}</legend>
      {RATING_LABELS.map((label, i) => {
        const rating = (i + 1) as Rating;
        return (
          <label key={label} data-low={lowIsRed && rating <= 2 ? "" : undefined}>
            <input
              type="radio"
              className="sr-only"
              name={name}
              checked={value === rating}
              onChange={() => onChange(rating)}
            />
            <b aria-hidden="true">{rating}</b>
            <small aria-hidden="true">{label}</small>
            <span className="sr-only">
              {rating}, {label}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** Radio rows inside one card (supervision level, global rating). */
export function OptionCard<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  disabled,
}: {
  readonly name: string;
  readonly legend: string;
  readonly value: T | null;
  readonly options: readonly {
    readonly id: T;
    readonly title: string;
    readonly detail?: string;
    readonly tag?: ReactNode;
  }[];
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
}) {
  return (
    <fieldset className="work-card m-0 p-0" disabled={disabled}>
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label key={option.id} className="assess-opt">
          <input
            type="radio"
            className="sr-only"
            name={name}
            checked={value === option.id}
            onChange={() => onChange(option.id)}
          />
          <span aria-hidden="true" className="assess-rd" />
          <span className="assess-opt__text">
            <b>{option.title}</b>
            {option.detail ? <small>{option.detail}</small> : null}
            {option.tag ? <span className="mt-1">{option.tag}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** A switch row: a real checkbox drawn as the mockup's toggle. */
export function ToggleRow({
  title,
  sub,
  checked,
  onChange,
  disabled,
}: {
  readonly title: ReactNode;
  readonly sub?: ReactNode;
  readonly checked: boolean;
  readonly onChange: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <label className="assess-tg">
      <span className="assess-tg__text">
        <b>{title}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="sr-only"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span aria-hidden="true" className="assess-sw" />
    </label>
  );
}

/**
 * A free-text box with the patient-details reminder under it. The reminder
 * turns amber when the text looks like a URN, a date, a title and a name, or a
 * bed number, and says it catches only some.
 */
export function AssessTextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
  readOnly,
  single,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly readOnly?: boolean;
  readonly single?: boolean;
}) {
  const hit = looksLikePatientDetails(value);
  const noteId = `${id}-privacy`;
  const missing = required && !value.trim();
  const shared = {
    id,
    value,
    readOnly,
    placeholder,
    "aria-describedby": noteId,
    "aria-required": required || undefined,
    "data-err": missing ? "" : undefined,
    className: "assess-txt",
  };
  return (
    <div className="assess-field">
      <label htmlFor={id} className="assess-field__label">
        <span>{label}</span>
        {required ? <em>Required</em> : null}
      </label>
      {single ? (
        <input type="text" {...shared} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <textarea rows={3} {...shared} onChange={(event) => onChange(event.target.value)} />
      )}
      <AssessNote id={noteId} tone={hit ? "amber" : undefined}>
        {hit
          ? "This may be patient details (it looks like a URN, a date, a title and name, or a bed number). Please check and remove it."
          : "Leave out anything that could identify a patient. This check only catches some."}
      </AssessNote>
      <span className="sr-only" aria-live="polite">
        {hit ? "This may be patient details. Please check and remove it." : ""}
      </span>
    </div>
  );
}

/* ------------------------------------------------------ side by side */

/**
 * One domain on a 1 to 5 line: a filled dot for you (the supervisor), a ring
 * for the doctor, a grey bar between when they differ. Neutral: never green
 * for agreeing, never red for differing.
 */
export function CompareRow({
  title,
  you,
  them,
  youName,
  themName,
  message,
}: {
  readonly title: string;
  readonly you: number;
  readonly them: number | null;
  readonly youName: string;
  readonly themName: string;
  readonly message: string;
}) {
  return (
    <div className="assess-cr">
      <div className="assess-cr__top">
        <span>{title}</span>
        <em>{message}</em>
      </div>
      <div
        className="assess-sc"
        role="img"
        aria-label={`${youName}: ${you}. ${themName}: ${them ?? "none"}. Out of 5.`}
        style={
          {
            "--assess-you": you,
            "--assess-them": them ?? you,
            "--assess-lo": Math.min(you, them ?? you),
            "--assess-hi": Math.max(you, them ?? you),
          } as CSSProperties
        }
      >
        {them !== null && them !== you ? <s /> : null}
        {them !== null ? <i data-who="them" /> : null}
        <i data-who="you" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ your times */

export type SlotState = "on" | "off" | "booked" | "idle";

/** One day of the window: the day, a note, and six time chips to offer or take back. */
export function SlotDay({
  day,
  note,
  slots,
  onToggle,
}: {
  readonly day: string;
  readonly note: string;
  readonly slots: readonly { readonly time: string; readonly state: SlotState; readonly label?: string }[];
  readonly onToggle: (time: string) => void;
}) {
  return (
    <div className="assess-day">
      <div className="assess-day__head">
        <span>{day}</span>
        <em>{note}</em>
      </div>
      <div className="assess-slot" role="group" aria-label={`Times on ${day}`} data-no-tab-swipe="">
        {slots.map((slot) =>
          slot.state === "off" ? (
            <span key={slot.time} data-off="">
              <span aria-hidden="true">{slot.time}</span>
              <span className="sr-only">{`${slot.time}, not available`}</span>
            </span>
          ) : (
            <button
              key={slot.time}
              type="button"
              aria-pressed={slot.state === "on" || slot.state === "booked"}
              aria-disabled={slot.state === "booked" || undefined}
              data-booked={slot.state === "booked" ? "" : undefined}
              aria-label={slot.label}
              onClick={() => {
                if (slot.state !== "booked") onToggle(slot.time);
              }}
            >
              {slot.time}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- kinds strip */

export type KindState = "done" | "now" | "todo";

/** The four kinds of experience, A to D: done tinted, current outlined. */
export function KindsStrip({
  kinds,
}: {
  readonly kinds: readonly {
    readonly letter: string;
    readonly name: string;
    readonly state: KindState;
    readonly note: string;
  }[];
}) {
  return (
    <ul className="assess-kinds" aria-label="Kinds of experience">
      {kinds.map((kind) => (
        <li key={kind.letter} data-state={kind.state === "todo" ? undefined : kind.state}>
          <b aria-hidden="true">{kind.letter}</b>
          <small aria-hidden="true">{kind.name}</small>
          <span className="sr-only">{`${kind.letter}, ${kind.name}: ${kind.note}`}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------ correction diff */

/** "Recorded 60 min" beside "Proposed 90 min". */
export function CorrectionDiff({ was, now }: { readonly was: ReactNode; readonly now: ReactNode }) {
  return (
    <div className="assess-diff">
      <div className="assess-diff__was">
        <small>Recorded</small>
        <b>{was}</b>
      </div>
      <ArrowRight aria-hidden="true" strokeWidth={2} />
      <div className="assess-diff__now">
        <small>Proposed</small>
        <b>{now}</b>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- call strip */

/** 000 first, as the mockup draws it. Only numbers already in the app. */
export function CallStrip({ sub }: { readonly sub: ReactNode }) {
  return (
    <div className="assess-call">
      <span aria-hidden="true" className="work-ic" data-tone="red">
        <Phone aria-hidden="true" strokeWidth={2} />
      </span>
      <div className="assess-call__text">
        <b>In danger now? Call 000</b>
        <small>{sub}</small>
      </div>
      <a href="tel:000" className="assess-call__button">
        Call<span className="sr-only"> 000</span>
      </a>
    </div>
  );
}

/* -------------------------------------------------------------- skeleton */

function SkelRow() {
  return (
    <div className="assess-skel__row">
      <b />
      <div>
        <i />
        <i />
      </div>
    </div>
  );
}

/** The loading shape of the To do tab: a hero, then two cards of rows. */
export function AssessSkeleton({ label = "Loading assessments" }: { readonly label?: string }) {
  return (
    <div className="grid gap-2" role="status" aria-label={label} aria-busy="true">
      <div className="work-card assess-skel min-h-36 content-center">
        <SkelRow />
        <i />
        <i />
      </div>
      <div className="work-card assess-skel">
        <SkelRow />
        <SkelRow />
        <SkelRow />
      </div>
      <div className="work-card assess-skel">
        <SkelRow />
        <SkelRow />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- undo bar */

/**
 * The held-send toast: "Sending in 10 s · Undo", with a thin bar that empties
 * over the hold. Fixed above the page, a polite live region. The drain stops
 * under reduced motion; the words still say how long.
 */
export function AssessUndoBar({
  children,
  srText,
  onUndo,
  icon: Icon,
  testId,
}: {
  readonly children: ReactNode;
  readonly srText?: string;
  readonly onUndo: () => void;
  readonly icon?: LucideIcon;
  readonly testId?: string;
}) {
  return (
    <div role="status" data-testid={testId} className="assess-undo fixed">
      {Icon ? <Icon aria-hidden="true" strokeWidth={2} /> : null}
      <span className="assess-undo__text">
        {children}
        {srText ? <span className="sr-only"> {srText}</span> : null}
      </span>
      <button type="button" className="assess-undo__button" onClick={onUndo}>
        Undo
      </button>
      <span aria-hidden="true" className="assess-undo__drain">
        <i />
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- button */

/**
 * The kit's flat button for a tap that stays on the page, with what the kit
 * button cannot carry: a line that explains why it is greyed out.
 */
export function AssessButton({
  children,
  variant = "primary",
  block,
  icon: Icon,
  disabled,
  describedBy,
  onClick,
}: {
  readonly children: ReactNode;
  readonly variant?: "primary" | "secondary" | "tinted" | "quiet";
  readonly block?: boolean;
  readonly icon?: LucideIcon;
  readonly disabled?: boolean;
  readonly describedBy?: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="work-button"
      data-variant={variant}
      data-size={block ? "wide" : undefined}
      disabled={disabled}
      aria-describedby={describedBy}
      onClick={onClick}
    >
      {Icon ? <Icon aria-hidden="true" strokeWidth={2} /> : null}
      {children}
    </button>
  );
}
