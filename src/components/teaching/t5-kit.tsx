"use client";

import { Check, ChevronRight, Info, ShieldCheck, TriangleAlert, WifiOff, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";

/*
 * Teaching's calm, flat pieces (mock-up v5, 5 Oct 2026): thin-ruled lists instead of a card per
 * group, one raised panel per screen for the thing that matters now, grey icons, and the Teaching
 * colour kept for meaning (the live dot, today, progress). Every value is a design token; the mode
 * colour resolves from the page's `data-mode-identity="teaching"`.
 */

const ink = "text-[color:var(--text-heading)]";
const sub = "text-[color:var(--text-muted)]";
const faint = "text-[color:var(--text-soft)]";
const rule = "border-[color:var(--border)]";
/** A link or switch keeps a 48px hit area without growing the line it sits in. */
const hitArea =
  "relative after:absolute after:top-1/2 after:left-1/2 after:h-12 after:w-[max(100%,3rem)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";

/** The page body: one column, nothing wider than the screen. */
export function T5Page({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div data-mode-identity="teaching" data-testid={testId} className="grid min-w-0 grid-cols-[minmax(0,1fr)] pb-6">
      {children}
    </div>
  );
}

/** A section label in small capitals with an optional link or note on the right. */
export function T5Section({
  label,
  right,
  id,
  className,
  children,
  testId,
}: {
  label: string;
  right?: ReactNode;
  id?: string;
  className?: string;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <section
      id={id}
      aria-label={label}
      data-testid={testId}
      className={cn("mt-5 grid min-w-0 scroll-mt-32", className)}
    >
      <div className="mb-0.5 flex min-h-6 items-center justify-between gap-2.5">
        <h2 className={cn("truncate text-2xs font-semibold tracking-label uppercase", faint)}>{label}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/** A smaller heading inside a section, such as "Goals from the start of term". */
export function T5Sub({ children }: { children: ReactNode }) {
  return <h3 className={cn("mt-3.5 text-xs font-semibold", sub)}>{children}</h3>;
}

/** A text link in the Teaching colour, with a 48px hit area. */
export function T5Link({
  href,
  onClick,
  children,
  quiet = false,
  external = false,
  label,
  testId,
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  quiet?: boolean;
  external?: boolean;
  label?: string;
  testId?: string;
}) {
  const className = cn(
    hitArea,
    "inline-flex shrink-0 items-center gap-1 rounded-sm text-sm-minus whitespace-nowrap",
    quiet ? cn("font-medium", sub) : "font-semibold text-[color:var(--mode-identity)]",
    focusRing,
  );
  if (href)
    return external ? (
      <a href={href} target="_blank" rel="noreferrer" className={className} aria-label={label} data-testid={testId}>
        {children}
      </a>
    ) : (
      <Link href={href} className={className} aria-label={label} data-testid={testId}>
        {children}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={className} aria-label={label} data-testid={testId}>
      {children}
    </button>
  );
}

/** A thin-ruled list. `ruled` draws the line above the first row too (under a section label). */
export function T5List({
  children,
  ruled = true,
  className,
  testId,
}: {
  children: ReactNode;
  ruled?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <ul
      role="list"
      data-testid={testId}
      className={cn("grid min-w-0 divide-y divide-[color:var(--border)]", rule, ruled && "border-t", className)}
    >
      {children}
    </ul>
  );
}

/** A grey icon in a 24px column at the start of a row. */
export function T5Icon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span aria-hidden="true" className={cn("grid w-6 shrink-0 place-items-center", sub)}>
      <Icon aria-hidden="true" className="size-icon-md" strokeWidth={1.6} />
    </span>
  );
}

/** A 24-hour start time at the start of a row. */
export function T5Time({ time, past = false }: { time: string; past?: boolean }) {
  return (
    <span data-row-time className={cn("nums min-w-10 shrink-0 text-sm-minus font-normal", past ? faint : ink)}>
      {time}
    </span>
  );
}

/** A day number over a short month, at the start of a row. */
export function T5Date({ day, month }: { day: string; month: string }) {
  return (
    <span aria-hidden="true" className={cn("grid min-w-8 shrink-0 justify-items-center leading-none", ink)}>
      <b className="nums text-base font-normal">{day}</b>
      <small className={cn("mt-1 text-2xs font-semibold tracking-label uppercase", faint)}>{month}</small>
    </span>
  );
}

/** A number at the end of a row. */
export function T5Figure({ children }: { children: ReactNode }) {
  return <span className={cn("nums shrink-0 text-sm-minus font-normal", ink)}>{children}</span>;
}

/** The small round ✓ that marks something done at the end of a row. */
export function T5Done({ label }: { label: string }) {
  return (
    <span className={cn("shrink-0", sub)}>
      <Check aria-hidden="true" className="size-icon-md" strokeWidth={2} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export type T5RowProps = {
  title: ReactNode;
  meta?: ReactNode;
  lead?: ReactNode;
  /** What sits at the end: a link, a figure, a ✓. A row with an href and no end gets a chevron. */
  end?: ReactNode;
  href?: string | null;
  external?: boolean;
  onClick?: () => void;
  /** Muted ink: a session that has passed, or a goal already met. */
  past?: boolean;
  below?: ReactNode;
  testId?: string;
  id?: string;
  /** A button row whose action is running: announced busy and not pressable again. */
  busy?: boolean;
};

/** One row: optional lead, a title with up to two lines of meta, and an end. 48px minimum. */
export function T5Row({ title, meta, lead, end, href, external, onClick, past, below, testId, id, busy }: T5RowProps) {
  const body = (
    <>
      {lead}
      <span data-row-body className="grid min-w-0 flex-1 gap-px">
        <span className={cn("text-sm leading-snug font-medium", past ? sub : ink)}>{title}</span>
        {meta ? <span className={cn("line-clamp-2 text-sm-minus leading-snug", sub)}>{meta}</span> : null}
        {below}
      </span>
      {end ??
        (href || onClick ? <ChevronRight aria-hidden="true" className={cn("size-icon-sm shrink-0", faint)} /> : null)}
    </>
  );
  const shape = "flex min-h-12 w-full min-w-0 items-center gap-3 py-2 text-left";
  if (href && !end)
    return (
      <li id={id} data-testid={testId} className="min-w-0">
        {external ? (
          <a href={href} target="_blank" rel="noreferrer" className={cn(shape, "rounded-sm", focusRing)}>
            {body}
          </a>
        ) : (
          <Link href={href} className={cn(shape, "rounded-sm", focusRing)}>
            {body}
          </Link>
        )}
      </li>
    );
  if (onClick && !end)
    return (
      <li id={id} data-testid={testId} className="min-w-0">
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          aria-busy={busy || undefined}
          className={cn(shape, "rounded-sm", focusRing)}
        >
          {body}
        </button>
      </li>
    );
  return (
    <li id={id} data-testid={testId} className={cn(shape, "relative")}>
      {body}
    </li>
  );
}

/** The one raised surface on a screen: the session on now, your next talk, your term. */
export function T5Panel({
  children,
  label,
  className,
  testId,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      aria-label={label}
      data-testid={testId}
      className={cn(
        "grid min-w-0 gap-2 rounded-lg border bg-[color:var(--surface-raised)] p-3.5 forced-colors:border-[CanvasText]",
        rule,
        className,
      )}
    >
      {children}
    </section>
  );
}

/** The small line above a panel's heading. */
export function T5Kicker({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <p className={cn("flex items-center text-xs font-semibold", sub)}>
      {live ? <T5LiveDot /> : null}
      {children}
    </p>
  );
}

/** A panel or page heading. `big` for a countdown figure. */
export function T5Heading({ children, big = false, level = 2 }: { children: ReactNode; big?: boolean; level?: 2 | 3 }) {
  const Tag = level === 2 ? "h2" : "h3";
  return <Tag className={cn("leading-snug font-semibold", big ? "text-xl" : "text-base", ink)}>{children}</Tag>;
}

/** A quiet sentence under a heading. */
export function T5Meta({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-sm-minus", sub, className)}>{children}</p>;
}

/** A label on the left and a value on the right. */
export function T5Pair({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-2.5 text-sm-minus", sub)}>
      <span>{label}</span>
      <b className={cn("font-semibold", ink)}>{value}</b>
    </div>
  );
}

/** A big figure with its unit in small text, e.g. "31 h of your 50 h target". */
export function T5BigFigure({ value, unit }: { value: ReactNode; unit?: ReactNode }) {
  return (
    <span className={cn("nums text-xl font-normal", ink)}>
      {value}
      {unit ? <small className={cn("ml-1 text-sm-minus font-normal", sub)}>{unit}</small> : null}
    </span>
  );
}

/** The 6px live dot in the Teaching colour. */
export function T5LiveDot({ tone = "teaching" }: { tone?: "teaching" | "on-call" }) {
  return (
    <span
      aria-hidden="true"
      data-mode-identity={tone === "on-call" ? "on-call" : undefined}
      className="mr-1.5 inline-block size-1.5 shrink-0 rounded-full bg-[color:var(--mode-identity)] forced-colors:bg-[CanvasText]"
    />
  );
}

/** A thin progress line. The value is clamped to 0–100. */
export function T5Meter({ percent, label, thin = false }: { percent: number; label?: string; thin?: boolean }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("block overflow-hidden rounded bg-[color:var(--surface-inset)]", thin ? "mt-1 h-[3px]" : "h-1")}
    >
      <span
        className="block h-full rounded bg-[color:var(--mode-identity)] forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none"
        style={{ width: `${value}%` }}
      />
    </span>
  );
}

/** A row of equal steps, `filled` of `total` in the Teaching colour (readiness, EPAs). */
export function T5Steps({ total, filled, label }: { total: number; filled: number; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="grid gap-[3px]"
      style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-1 rounded-sm",
            index < filled
              ? "bg-[color:var(--mode-identity)] forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none"
              : "bg-[color:var(--surface-inset)]",
          )}
        />
      ))}
    </span>
  );
}

const NOTE_ICONS = { info: Info, alert: TriangleAlert, offline: WifiOff, shield: ShieldCheck } as const;

/**
 * A short note. Plain notes sit quietly under a list; `notice` puts it on its own bordered surface
 * (no connection); `warning` adds the amber edge, used only for a real problem.
 */
export function T5Note({
  children,
  icon = "info",
  tone = "plain",
  className,
  testId,
}: {
  children: ReactNode;
  icon?: keyof typeof NOTE_ICONS;
  tone?: "plain" | "notice" | "warning";
  className?: string;
  testId?: string;
}) {
  const Icon = NOTE_ICONS[icon];
  const boxed = tone !== "plain";
  return (
    <div
      role={tone === "warning" ? "status" : undefined}
      data-testid={testId}
      className={cn(
        "flex items-start gap-2 leading-normal",
        boxed
          ? cn(
              "mb-3 rounded-lg border bg-[color:var(--surface-raised)] px-3 py-2.5 text-sm-minus forced-colors:border-[CanvasText]",
              ink,
              tone === "warning" ? "border-[color:var(--warning-border)]" : rule,
            )
          : cn("mt-2.5 text-xs", sub),
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-px size-icon-sm shrink-0", tone === "warning" ? "text-[color:var(--warning-text)]" : faint)}
        strokeWidth={1.6}
      />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** A row of actions: at most one filled button, the rest text links. */
export function T5Actions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-1 mb-3 flex flex-wrap items-center gap-x-4.5 gap-y-1", className)}>{children}</div>;
}

/** Two options side by side; the chosen one sits raised. */
export function T5Segments<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="mt-2.5 flex rounded-md bg-[color:var(--surface-inset)] p-0.5">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cn(
              hitArea,
              "min-h-8.5 flex-1 rounded-md text-sm-minus",
              on
                ? cn(
                    "bg-[color:var(--surface-raised)] font-semibold shadow-[0_0_0_1px_var(--border)] forced-colors:border forced-colors:border-[Highlight]",
                    ink,
                  )
                : cn("font-medium", sub),
              focusRing,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** The quiet line under an empty section: what will appear here and when. */
export function T5Empty({ children }: { children: ReactNode }) {
  return <p className={cn("border-t pt-2.5 pb-0.5 text-sm-minus", rule, sub)}>{children}</p>;
}

/** A tick-box row: the whole line is the label, so the 48px row is the hit area. */
export function T5Check({
  label,
  meta,
  checked,
  onChange,
  disabled,
  end,
}: {
  label: string;
  meta?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** A figure at the end of the line, such as the hours a session counts for. */
  end?: ReactNode;
}) {
  return (
    <li className="min-w-0">
      <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2">
        <span className="relative grid size-5 shrink-0 place-items-center">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            className={cn(
              "peer absolute inset-0 cursor-pointer appearance-none rounded-sm border-[1.5px] border-[color:var(--text-soft)] bg-[color:var(--surface-raised)] checked:border-[color:var(--text-heading)] checked:bg-[color:var(--text-heading)] forced-colors:appearance-auto",
              focusRing,
            )}
          />
          <Check
            aria-hidden="true"
            strokeWidth={2.4}
            className="pointer-events-none relative size-icon-xs text-[color:var(--surface-raised)] opacity-0 peer-checked:opacity-100 forced-colors:hidden"
          />
        </span>
        <span className="grid min-w-0 flex-1 gap-px">
          <span className={cn("text-sm leading-snug font-medium", ink)}>{label}</span>
          {meta ? <span className={cn("text-sm-minus", sub)}>{meta}</span> : null}
        </span>
        {end}
      </label>
    </li>
  );
}
