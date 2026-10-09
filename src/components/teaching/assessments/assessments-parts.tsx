"use client";

import { ArrowRight, Check, ChevronRight, Clock, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { WorkTag, type WorkTone } from "@/components/mode-kit/work";
import {
  AssessAvatar,
  AssessCallout,
  AssessHeader,
  AssessTextField,
  OutcomeRow,
} from "@/components/teaching/assessments/assess-kit";
import type { AssessRole } from "@/components/teaching/assessments/assess-memory";
import { cn } from "@/components/ui-primitives";
import type { Pill as PillValue, PillTone, StepState } from "@/lib/teaching/assessments/model";

/*
 * The small parts every Assessments screen is built from, redrawn on the
 * work-mode kit (work-mode redesign, owner request 6 Oct 2026): white cards
 * with hairline rows, flat tint icon circles, small-caps labels and tags.
 * The names and props are the ones every screen already uses, so the screens
 * keep their wiring and only their look changes.
 */

const assessmentsPath = "/teaching/assessments";

export type AssessmentsView =
  | "home"
  | "hub"
  | "reqs"
  | "term"
  | "all"
  | "form"
  | "request"
  | "book"
  | "report"
  | "sign"
  | "pdf"
  | "help"
  | "times"
  | "side"
  | "progress"
  | "record"
  | "words"
  | "inbox"
  | "overview"
  | "dctsign"
  | "plan"
  | "epaform";

/** The page's own address for a screen: one route, so the phone's Back button walks back through it. */
export function viewHref(view: AssessmentsView, params: Record<string, string> = {}): string {
  const search = new URLSearchParams(view === "home" ? params : { view, ...params });
  const query = search.toString();
  return query ? `${assessmentsPath}?${query}` : assessmentsPath;
}

/**
 * One doctor's page: requests, supervision to confirm, corrections. It keeps the caller's side (their `as`),
 * so following it, and its back arrow, never switches a reader to another side (site audit M4). The
 * supervisor's own screens only ever run on the supervisor's side, so that is the side when none is given.
 */
export function traineeHref(doctorId: string, side: AssessRole = "supervisor"): string {
  return `${assessmentsPath}/trainee/${encodeURIComponent(doctorId)}?as=${side}`;
}

export const secondaryText = "text-xs leading-snug text-[color:var(--text-muted)]";
export const titleText = "text-sm font-bold leading-snug text-[color:var(--text-heading)]";
export const labelText = "text-2xs font-bold uppercase tracking-label text-[color:var(--text-muted)]";

const PILL_TONES: Record<PillTone, WorkTone> = {
  neutral: "neutral",
  accent: "mode",
  warm: "amber",
  ok: "green",
  bad: "red",
};

/** A status tag: a word, never a colour alone. */
export function Pill({ pill }: { pill: PillValue }) {
  return <WorkTag tone={PILL_TONES[pill.tone]}>{pill.label}</WorkTag>;
}

/** A section label with an optional link or note on the right. */
export function SectionLabel({ children, end, id }: { children: ReactNode; end?: ReactNode; id?: string }) {
  return (
    <div className="work-label mt-1.5">
      <h2 id={id} className="m-0 text-inherit font-inherit">
        {children}
      </h2>
      {end}
    </div>
  );
}

export function SectionNote({ children }: { children: ReactNode }) {
  return <em className="work-label__count">{children}</em>;
}

export function TextLink({ href, onClick, children }: { href?: string; onClick?: () => void; children: ReactNode }) {
  if (href)
    return (
      <Link href={href} className="work-label__link">
        {children}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className="work-label__link">
      {children}
    </button>
  );
}

/** The one summary card at the top of a screen. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("work-card work-card--pad grid min-w-0 gap-2.5", className)}>{children}</section>;
}

export function Eyebrow({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        "text-2xs font-bold tracking-label uppercase",
        accent ? "text-[color:var(--mode-identity)]" : "text-[color:var(--text-muted)]",
      )}
    >
      {children}
    </span>
  );
}

/** A card of rows with hairlines between them. */
export function List({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul role="list" aria-label={label} className="work-card work-rows min-w-0">
      {children}
    </ul>
  );
}

/** A card that holds text (a quote, a chart), as opposed to a list of rows. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("work-card work-card--pad grid min-w-0 gap-2", className)}>{children}</div>;
}

type RowAction = { href?: string } | { onClick?: () => void };

function RowShell({ action, label, children }: { action: RowAction; label?: string; children: ReactNode }) {
  if ("href" in action && action.href)
    return (
      <Link href={action.href} className="work-row" aria-label={label}>
        {children}
      </Link>
    );
  if ("onClick" in action && action.onClick)
    return (
      <button type="button" onClick={action.onClick} className="work-row" aria-label={label}>
        {children}
      </button>
    );
  return <div className="work-row">{children}</div>;
}

const chevron = <ChevronRight aria-hidden="true" className="work-row__chev" strokeWidth={2} />;

/** One row: an icon circle or initials, a title, a line under it, a tag, and a chevron when it goes somewhere. */
export function Row({
  icon: Icon,
  iconTone = "muted",
  avatar,
  title,
  subtitle,
  tag,
  end,
  wrapSubtitle = true,
  ...action
}: {
  icon?: LucideIcon;
  iconTone?: "muted" | "ok" | "mode" | "amber" | "red";
  avatar?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  tag?: ReactNode;
  end?: ReactNode;
  wrapSubtitle?: boolean;
} & RowAction) {
  const goes = ("href" in action && !!action.href) || ("onClick" in action && !!action.onClick);
  const tone: WorkTone =
    iconTone === "ok"
      ? "green"
      : iconTone === "amber"
        ? "amber"
        : iconTone === "red"
          ? "red"
          : iconTone === "mode" || goes
            ? "mode"
            : "neutral";
  return (
    <li className="min-w-0">
      <RowShell action={action}>
        {avatar ? (
          <AssessAvatar initials={avatar} />
        ) : Icon ? (
          <span aria-hidden="true" className="work-ic" data-tone={tone === "mode" ? undefined : tone}>
            <Icon aria-hidden="true" strokeWidth={2} />
          </span>
        ) : null}
        <span className="work-row__text">
          <span className="work-row__title">{title}</span>
          {subtitle ? <span className={cn("work-row__sub", wrapSubtitle ? "break-words" : "")}>{subtitle}</span> : null}
        </span>
        {end !== undefined || tag ? (
          <span className="work-row__end">
            {tag}
            {end}
          </span>
        ) : null}
        {goes ? chevron : null}
      </RowShell>
    </li>
  );
}

const STATE_WORD: Record<StepState, string> = { ok: "Done", now: "Now", lock: "Later" };

/** One step of a sequence: a done tick, a solid "now" circle or a pale "later" clock, then the words. */
export function StepRow({
  state,
  title,
  detail,
  tag,
  ...action
}: {
  state: StepState;
  title: ReactNode;
  detail?: ReactNode;
  tag?: ReactNode;
} & RowAction) {
  const goes = ("href" in action && !!action.href) || ("onClick" in action && !!action.onClick);
  const Glyph = state === "ok" ? Check : state === "now" ? ArrowRight : Clock;
  return (
    <li className={cn("min-w-0", state === "lock" && "[&_.work-row__text]:opacity-60")}>
      <RowShell action={action}>
        <span
          aria-hidden="true"
          className={cn(
            "work-ic",
            state === "now" && "!bg-[color:var(--mode-identity)] !text-[color:var(--mode-identity-contrast)]",
          )}
          data-tone={state === "lock" ? "neutral" : undefined}
        >
          <Glyph aria-hidden="true" strokeWidth={2.4} />
        </span>
        <span className="work-row__text">
          <span className="sr-only">{STATE_WORD[state]}: </span>
          <span className="work-row__title">{title}</span>
          {detail ? <span className="work-row__sub">{detail}</span> : null}
        </span>
        {tag ? <span className="work-row__end">{tag}</span> : null}
        {goes ? chevron : null}
      </RowShell>
    </li>
  );
}

/** A tinted note inside a screen. `plain` is a white card, `accent` the Teaching tint. */
export function Inset({
  tone = "accent",
  icon,
  title,
  children,
  role,
}: {
  tone?: "accent" | "plain" | "warm" | "bad" | "ok";
  icon?: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  role?: "status" | "alert";
}) {
  const Glyph = icon ?? (tone === "warm" || tone === "bad" ? TriangleAlert : tone === "ok" ? Check : Info);
  const callTone = tone === "warm" ? "amber" : tone === "bad" ? "red" : tone === "accent" ? undefined : "neutral";
  return (
    <AssessCallout icon={Glyph} tone={callTone} title={title ?? children} role={role}>
      {title ? children : null}
    </AssessCallout>
  );
}

/**
 * A screen's name and way back: drawn in the work band (eyebrow over title,
 * the round back button), with a focusable heading kept for screen readers.
 */
export function ScreenHeader({
  back,
  backLabel,
  title,
  subtitle,
}: {
  /** No back arrow when the screen is a tab. */
  back: string | undefined;
  backLabel: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <AssessHeader
      eyebrow={subtitle ?? "Assessments"}
      title={title}
      back={back ? { href: back, label: backLabel } : undefined}
    />
  );
}

/** A plain key-value line. */
export function KeyValue({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
      <span className="text-[color:var(--text-muted)]">{k}</span>
      <b className="text-right font-bold text-[color:var(--text-heading)]">{v}</b>
    </div>
  );
}

export function SmallPrint({ children, center }: { children: ReactNode; center?: boolean }) {
  return (
    <p className="assess-note" data-center={center ? "" : undefined}>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Why a primary button is not available yet, said next to it. */
export function WhyNot({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="assess-why">
      {children}
    </p>
  );
}

/** A tap-to-tick row (a real checkbox underneath), used for share choices and reminders. */
export function TickRow({
  checked,
  onChange,
  children,
  detail,
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <li className="min-w-0">
      <OutcomeRow checked={checked} onToggle={onChange} title={children} detail={detail} />
    </li>
  );
}

/**
 * A free-text box with the patient-details reminder under it. The reminder turns
 * amber when the text looks like a URN, a date, a title and name, or a bed number;
 * it says it catches only some of these, because it does.
 */
export function NoteField({
  id,
  label,
  value,
  onChange,
  placeholder,
  readOnly,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  readOnly?: boolean;
  required?: boolean;
}) {
  return (
    <AssessTextField
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={readOnly}
      required={required}
    />
  );
}
