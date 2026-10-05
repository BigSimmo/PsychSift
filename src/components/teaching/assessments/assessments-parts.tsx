"use client";

import { Check, ChevronLeft, ChevronRight, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { modePressable } from "@/components/mode-kit/recipes";
import { cn, fieldControlPlain } from "@/components/ui-primitives";
import {
  looksLikePatientDetails,
  type Pill as PillValue,
  type PillTone,
  type StepState,
} from "@/lib/teaching/assessments/model";

/*
 * The small parts every Assessments screen is built from, matched to mock-up v4:
 * a flat page, one bordered summary panel, and hairline lists without a card.
 * Type steps: 11px labels (text-2xs), 13px secondary (text-sm), 14px titles
 * (text-sm), 20px headings (text-xl).
 */

export const assessmentsPath = "/teaching/assessments";

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
  | "side";

/** The page's own address for a screen: one route, so the phone's Back button walks back through it. */
export function viewHref(view: AssessmentsView, params: Record<string, string> = {}): string {
  const search = new URLSearchParams(view === "home" ? params : { view, ...params });
  const query = search.toString();
  return query ? `${assessmentsPath}?${query}` : assessmentsPath;
}

export const secondaryText = "text-sm leading-snug text-[color:var(--text-muted)]";
export const titleText = "text-sm font-semibold leading-snug text-[color:var(--text-heading)]";
export const labelText = "text-2xs font-semibold uppercase tracking-label text-[color:var(--text-muted)]";
const hairlineRow = "border-t border-[color:var(--border)] first:border-t-0";

const PILL_TONES: Record<PillTone, string> = {
  neutral: "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
  accent:
    "border-[color:var(--mode-identity-border)] bg-[color:var(--mode-identity-soft)] text-[color:var(--mode-identity)]",
  warm: "border-transparent bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]",
  ok: "border-transparent bg-[color:var(--success-bg)] text-[color:var(--success-text)]",
  bad: "border-transparent bg-[color:var(--danger-bg)] text-[color:var(--danger-text)]",
};

/** A status tag: a word, never a colour alone. */
export function Pill({ pill }: { pill: PillValue }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-2xs leading-4 font-semibold tracking-label uppercase forced-colors:border",
        PILL_TONES[pill.tone],
      )}
    >
      {pill.label}
    </span>
  );
}

/** A section label with an optional link or note on the right. */
export function SectionLabel({ children, end, id }: { children: ReactNode; end?: ReactNode; id?: string }) {
  return (
    <div className="-mb-1 mt-2 flex min-h-7 items-center justify-between gap-2 px-1">
      <h2 id={id} className={labelText}>
        {children}
      </h2>
      {end}
    </div>
  );
}

export function SectionNote({ children }: { children: ReactNode }) {
  return <span className="text-2xs text-[color:var(--text-muted)]">{children}</span>;
}

export function TextLink({ href, onClick, children }: { href?: string; onClick?: () => void; children: ReactNode }) {
  const cls = cn(
    focusRing,
    "-my-3 inline-flex min-h-12 items-center text-sm font-medium text-[color:var(--mode-identity)] no-underline",
  );
  if (href)
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

/** The one bordered summary panel at the top of a screen. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      data-mode-identity="teaching"
      className={cn(
        "grid min-w-0 gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-4 forced-colors:border",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Eyebrow({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        "text-2xs font-semibold tracking-label uppercase",
        accent ? "text-[color:var(--mode-identity)]" : "text-[color:var(--text-muted)]",
      )}
    >
      {children}
    </span>
  );
}

/** A flat list: hairlines between rows, no card around them. */
export function List({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul role="list" aria-label={label} className="grid min-w-0">
      {children}
    </ul>
  );
}

/** A card that holds text (a quote, a chart), as opposed to a list of rows. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-2.5 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-3.5 forced-colors:border",
        className,
      )}
    >
      {children}
    </div>
  );
}

type RowAction = { href: string } | { onClick: () => void } | object;

function RowShell({
  action,
  className,
  label,
  children,
}: {
  action: RowAction;
  className: string;
  label?: string;
  children: ReactNode;
}) {
  const interactive = cn(className, modePressable, focusRing, "w-full text-left no-underline");
  if ("href" in action)
    return (
      <Link href={action.href} className={interactive} aria-label={label}>
        {children}
      </Link>
    );
  if ("onClick" in action)
    return (
      <button type="button" onClick={action.onClick} className={interactive} aria-label={label}>
        {children}
      </button>
    );
  return <div className={className}>{children}</div>;
}

const chevron = <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />;

/** One list row: an optional icon, a title, a line under it, an optional tag, and a chevron when it goes somewhere. */
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
  iconTone?: "muted" | "ok";
  avatar?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  tag?: ReactNode;
  end?: ReactNode;
  wrapSubtitle?: boolean;
} & ({ href?: string } | { onClick?: () => void })) {
  const goes = "href" in action ? !!action.href : "onClick" in action && !!action.onClick;
  return (
    <li className={hairlineRow}>
      <RowShell action={action} className="flex min-h-15 min-w-0 items-center gap-3 px-3.5 py-3">
        {avatar ? (
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-xs font-semibold text-[color:var(--text-heading)]"
          >
            {avatar}
          </span>
        ) : Icon ? (
          <Icon
            aria-hidden="true"
            strokeWidth={1.75}
            className={cn(
              "size-icon-md shrink-0",
              iconTone === "ok" ? "text-[color:var(--success-text)]" : "text-[color:var(--text-muted)]",
            )}
          />
        ) : null}
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={titleText}>{title}</span>
          {subtitle ? <span className={cn(secondaryText, wrapSubtitle ? "break-words" : "")}>{subtitle}</span> : null}
          {tag ? <span className="mt-1 flex flex-wrap gap-1.5">{tag}</span> : null}
        </span>
        {end ?? (goes ? chevron : null)}
      </RowShell>
    </li>
  );
}

const DOT: Record<StepState, string> = {
  ok: "border-[color:var(--success-text)] bg-[color:var(--success-text)] text-[color:var(--surface-raised)]",
  now: "border-[color:var(--mode-identity)]",
  lock: "border-dashed border-[color:var(--border-strong)]",
};

const STATE_WORD: Record<StepState, string> = { ok: "Done", now: "Now", lock: "Later" };

/** One step of a sequence: a done tick, a "now" ring or a dashed "later" ring, then the words. */
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
} & ({ href?: string } | { onClick?: () => void })) {
  const goes = "href" in action ? !!action.href : "onClick" in action && !!action.onClick;
  return (
    <li className={hairlineRow} data-mode-identity="teaching">
      <RowShell action={action} className="flex min-h-14 min-w-0 items-start gap-3 px-3.5 py-3">
        <span
          aria-hidden="true"
          className={cn(
            "mt-px grid size-6 shrink-0 place-items-center rounded-full border-2 forced-colors:border-[CanvasText]",
            DOT[state],
          )}
        >
          {state === "ok" ? <Check aria-hidden="true" strokeWidth={3} className="size-icon-xs" /> : null}
          {state === "now" ? <span className="size-2 rounded-full bg-[color:var(--mode-identity)]" /> : null}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="sr-only">{STATE_WORD[state]}: </span>
          <span className={cn(titleText, "font-semibold")}>{title}</span>
          {detail ? <span className={secondaryText}>{detail}</span> : null}
          {tag ? <span className="mt-1 flex flex-wrap gap-1.5">{tag}</span> : null}
        </span>
        {goes ? <span className="self-center">{chevron}</span> : null}
      </RowShell>
    </li>
  );
}

/** A tinted note inside a screen. `plain` is grey, `accent` the Teaching tint. */
export function Inset({
  tone = "accent",
  icon: Icon,
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
  const tones = {
    accent: "bg-[color:var(--mode-identity-soft)] text-[color:var(--text)]",
    plain: "border border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
    warm: "bg-[color:var(--warning-bg)] text-[color:var(--text)]",
    bad: "bg-[color:var(--danger-bg)] text-[color:var(--text)]",
    ok: "bg-[color:var(--success-bg)] text-[color:var(--text)]",
  } as const;
  const ink = {
    accent: "text-[color:var(--mode-identity)]",
    plain: "text-[color:var(--text-heading)]",
    warm: "text-[color:var(--warning-text)]",
    bad: "text-[color:var(--danger-text)]",
    ok: "text-[color:var(--success-text)]",
  } as const;
  const Glyph = Icon ?? (tone === "warm" || tone === "bad" ? TriangleAlert : Info);
  return (
    <div
      role={role}
      data-mode-identity="teaching"
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-xl px-3 py-2.5 text-sm forced-colors:border",
        tones[tone],
      )}
    >
      <Glyph
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn("mt-px size-icon-sm shrink-0", tone === "plain" ? "text-[color:var(--text-muted)]" : ink[tone])}
      />
      <div className="grid min-w-0 gap-0.5">
        {title ? <b className={cn("text-sm font-semibold", ink[tone])}>{title}</b> : null}
        {children ? <span className="break-words">{children}</span> : null}
      </div>
    </div>
  );
}

/** The back row and title of a screen inside the page. */
export function ScreenHeader({
  back,
  backLabel,
  title,
  subtitle,
  end,
}: {
  back: string;
  backLabel: string;
  title: string;
  subtitle?: string;
  end?: ReactNode;
}) {
  return (
    <div className="grid min-h-12 grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-1">
      <Link
        href={back}
        aria-label={`Back to ${backLabel}`}
        className={cn(
          focusRing,
          "grid size-12 place-items-center rounded-full text-[color:var(--text-heading)] hover:bg-[color:var(--surface-wash)]",
        )}
      >
        <ChevronLeft aria-hidden="true" className="size-icon-md" />
      </Link>
      <div className="grid min-w-0 text-center">
        <h2 className="truncate text-base font-semibold text-[color:var(--text-heading)]">{title}</h2>
        {subtitle ? <p className="truncate text-xs text-[color:var(--text-muted)]">{subtitle}</p> : null}
      </div>
      <div className="flex justify-end">{end}</div>
    </div>
  );
}

/** A plain key-value line. */
export function KeyValue({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
      <span className="text-[color:var(--text-muted)]">{k}</span>
      <b className="text-right font-semibold text-[color:var(--text-heading)]">{v}</b>
    </div>
  );
}

export function SmallPrint({ children, center }: { children: ReactNode; center?: boolean }) {
  return <p className={cn("px-1 text-xs text-[color:var(--text-muted)]", center && "text-center")}>{children}</p>;
}

/** Why a primary button is not available yet, said next to it. */
export function WhyNot({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="px-1 text-center text-sm text-[color:var(--warning-text)]">
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
    <li className={hairlineRow}>
      <label
        className={cn(
          modePressable,
          "flex min-h-13 cursor-pointer items-center gap-3 px-3.5 py-2.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--focus)]",
        )}
      >
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={onChange} />
        <span
          aria-hidden="true"
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-md border-2 forced-colors:border-[CanvasText]",
            checked
              ? "border-[color:var(--command)] bg-[color:var(--command)] text-[color:var(--command-contrast)]"
              : "border-[color:var(--border-strong)]",
          )}
        >
          {checked ? <Check aria-hidden="true" strokeWidth={3} className="size-icon-xs" /> : null}
        </span>
        <span className="grid min-w-0 gap-0.5">
          <span className="text-sm text-[color:var(--text-heading)]">{children}</span>
          {detail ? <span className={secondaryText}>{detail}</span> : null}
        </span>
      </label>
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  readOnly?: boolean;
}) {
  const hit = looksLikePatientDetails(value);
  const noteId = `${id}-privacy`;
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="px-1 text-sm font-semibold text-[color:var(--text-heading)]">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        aria-describedby={noteId}
        onChange={(event) => onChange(event.target.value)}
        className={cn(fieldControlPlain, "h-auto min-h-24 resize-y py-2 leading-6")}
      />
      <p
        id={noteId}
        className={cn(
          "flex items-start gap-1.5 px-1 text-xs",
          hit ? "font-semibold text-[color:var(--warning-text)]" : "text-[color:var(--text-muted)]",
        )}
      >
        <TriangleAlert aria-hidden="true" className="mt-px size-icon-xs shrink-0" />
        <span>
          {hit
            ? "This may be patient details (it looks like a URN, a date, a title and name, or a bed number). Please check and remove it."
            : "Leave out anything that could identify a patient: names, initials, URNs, dates of birth, bed numbers. This check only catches some of these."}
        </span>
      </p>
      <span className="sr-only" aria-live="polite">
        {hit ? "This may be patient details. Please check and remove it." : ""}
      </span>
    </div>
  );
}
