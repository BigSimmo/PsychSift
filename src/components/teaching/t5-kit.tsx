"use client";

import { Check, ChevronRight, Info, Loader2, ShieldCheck, TriangleAlert, WifiOff, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import type { ButtonProps, ButtonVariant } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";
import type { AppModeId } from "@/lib/app-modes";

/*
 * Teaching's pieces, restyled once for the work-mode redesign (owner request 6 Oct 2026). The
 * names and props are the v5 kit's, so every Teaching page takes the new look from here: white
 * cards with a hairline and ruled rows, flat tinted icon circles, small-caps section labels, the
 * mode-colour hero for the one surface that matters now, and flat buttons. Every value is a
 * design token; the colour resolves from the page's `data-mode-identity="teaching"`, and the
 * shapes come from the shared work kit (`work-*` classes in src/app/work-mode.css).
 */

const ink = "text-[color:var(--text-heading)]";
const sub = "text-[color:var(--text-muted)]";
const faint = "text-[color:var(--decoration-soft)]";
/** A link or switch keeps a 48px hit area without growing the line it sits in. */
const hitArea =
  "relative after:absolute after:top-1/2 after:left-1/2 after:h-12 after:w-[max(100%,3rem)] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";

/**
 * Inside the hero the kit's ink and muted colours follow the hero's own text colour (white on the
 * mode colour, light ink on the dark-theme hero), so a kicker, heading or meta reads on it unchanged.
 */
const heroInk =
  "[--text-heading:currentColor] [--text-muted:color-mix(in_srgb,currentColor_82%,transparent)] [--decoration-soft:color-mix(in_srgb,currentColor_70%,transparent)] [--border:color-mix(in_srgb,currentColor_22%,transparent)] [--surface-inset:color-mix(in_srgb,currentColor_18%,transparent)] [--surface-wash:color-mix(in_srgb,currentColor_14%,transparent)]";

/** The page body: one column, nothing wider than the screen, the mockup's 9px rhythm. */
export function T5Page({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div
      data-mode-identity="teaching"
      data-testid={testId}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-y-2.25 pb-8 text-[color:var(--text-heading)]"
    >
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
      className={cn("mt-1.5 grid min-w-0 scroll-mt-32 gap-y-2.25", className)}
    >
      <div className="work-label min-h-6 px-0.5">
        <h2 className="m-0 min-w-0 break-words">{label}</h2>
        {right === undefined || right === null ? null : typeof right === "string" ? (
          <em className="work-label__count">{right}</em>
        ) : (
          <span className="flex shrink-0 items-center gap-3 tracking-normal normal-case">{right}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/** A smaller heading inside a section, such as "Goals from the start of term". */
export function T5Sub({ children }: { children: ReactNode }) {
  return <h3 className={cn("mt-1.5 px-0.5 text-xs font-bold", ink)}>{children}</h3>;
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
  expanded,
  download,
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  quiet?: boolean;
  external?: boolean;
  label?: string;
  testId?: string;
  /** A button that shows or hides something below it. */
  expanded?: boolean;
  /** A file link (a built CSV): a plain anchor with this file name. */
  download?: string;
}) {
  const className = cn(
    hitArea,
    "inline-flex shrink-0 items-center gap-1 rounded-sm text-xs tracking-normal whitespace-nowrap normal-case",
    quiet ? cn("font-semibold", sub) : "font-bold text-[color:var(--mode-identity)] [[data-t5-hero]_&]:text-current",
    focusRing,
  );
  if (href && download !== undefined)
    return (
      <a href={href} download={download} className={className} aria-label={label} data-testid={testId}>
        {children}
      </a>
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
    <button
      type="button"
      onClick={onClick}
      className={className}
      aria-label={label}
      aria-expanded={expanded}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/**
 * A white card of ruled rows (the mockup's `.card` of `.row`s). `ruled` is kept for the v5 callers;
 * every list is now its own card.
 */
export function T5List({
  children,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ruled: _ruled = true,
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
      className={cn("work-card m-0 grid min-w-0 list-none divide-y divide-[color:var(--border)] p-0", className)}
    >
      {children}
    </ul>
  );
}

/**
 * The flat tinted icon circle at the start of a row: the mode's soft fill with the icon in the
 * colour of where a tap goes (`leadsTo` another area, or a status `tone`).
 */
export function T5Icon({
  icon: Icon,
  tone,
  leadsTo,
}: {
  icon: LucideIcon;
  tone?: "green" | "amber" | "red" | "neutral";
  leadsTo?: AppModeId;
}) {
  return (
    <span aria-hidden="true" className="work-ic" data-tone={tone} data-mode-identity={leadsTo}>
      <Icon aria-hidden="true" strokeWidth={2} />
    </span>
  );
}

/** A 24-hour start time at the start of a row, in the mockup's time column. */
export function T5Time({ time, past = false }: { time: string; past?: boolean }) {
  return (
    <span data-row-time className={cn("nums w-11 shrink-0 text-sm-minus font-bold", past ? sub : ink)}>
      {time}
    </span>
  );
}

/** A date tile at the start of a row: the short month in small capitals over the day. */
export function T5Date({ day, month }: { day: string; month: string }) {
  return (
    <span aria-hidden="true" className="work-date">
      <small className="work-date__month">{month}</small>
      <b className="work-date__day nums font-bold">{day}</b>
    </span>
  );
}

/** The small green tick that marks something done at the end of a row. */
export function T5Done({ label }: { label: string }) {
  return (
    <span className="work-ic size-5 shrink-0" data-tone="green">
      <Check aria-hidden="true" className="size-3" strokeWidth={3} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

type T5RowProps = {
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
  const main = (
    <>
      {lead}
      <span data-row-body className="grid min-w-0 flex-1 gap-px">
        <span className={cn("text-sm-minus leading-tight font-bold break-words", past ? sub : ink)}>{title}</span>
        {meta ? <span className={cn("text-xs leading-snug break-words", sub)}>{meta}</span> : null}
        {below}
      </span>
    </>
  );
  const body = (
    <>
      {main}
      {end ?? (href || onClick ? <ChevronRight aria-hidden="true" className={cn("size-3.5 shrink-0", faint)} /> : null)}
    </>
  );
  const shape = "flex min-h-12 w-full min-w-0 items-center gap-2.5 px-3 py-2.25 text-left";
  const press = "transition-colors active:bg-[color:var(--surface-wash)] motion-reduce:transition-none";
  // A row that opens something and also carries an end (a ✓, a figure, a link): the end sits beside
  // the link or button rather than inside it, so the row stays tappable and no control nests in another.
  if ((href || onClick) && end) {
    const inner = cn("flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-sm py-2.25 text-left", focusRing);
    return (
      <li id={id} data-testid={testId} className="flex min-w-0 items-center gap-2.5 px-3">
        {href ? (
          external ? (
            <a href={href} target="_blank" rel="noreferrer" className={inner}>
              {main}
            </a>
          ) : (
            <Link href={href} className={inner}>
              {main}
            </Link>
          )
        ) : (
          <button type="button" onClick={onClick} disabled={busy} aria-busy={busy || undefined} className={inner}>
            {main}
          </button>
        )}
        {end}
      </li>
    );
  }
  if (href && !end)
    return (
      <li id={id} data-testid={testId} className="min-w-0">
        {external ? (
          <a href={href} target="_blank" rel="noreferrer" className={cn(shape, press, focusRing)}>
            {body}
          </a>
        ) : (
          <Link href={href} className={cn(shape, press, focusRing)}>
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
          className={cn(shape, press, focusRing)}
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

/**
 * The one surface that matters now. A plain white card by default; `hero` makes it the screen's one
 * mode-colour card (flat: a gentle two-stop gradient, no glow), with every kit piece inside reading
 * in the hero's text colour.
 */
export function T5Panel({
  children,
  label,
  className,
  testId,
  id,
  hero = false,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  testId?: string;
  id?: string;
  hero?: boolean;
}) {
  return (
    <section
      id={id}
      aria-label={label}
      data-testid={testId}
      data-t5-hero={hero ? "" : undefined}
      className={cn(
        "grid min-w-0 scroll-mt-32 gap-1.5",
        hero ? cn("work-hero", heroInk) : "work-card work-card--pad",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** The small-caps line above a panel's heading. */
export function T5Kicker({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <p className={cn("flex items-center text-3xs font-bold tracking-label uppercase", sub)}>
      {live ? <T5LiveDot /> : null}
      {children}
    </p>
  );
}

/** A panel or page heading. `big` for a countdown figure. */
export function T5Heading({ children, big = false, level = 2 }: { children: ReactNode; big?: boolean; level?: 2 | 3 }) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag className={cn("leading-tight font-bold tracking-tight", big ? "text-2xl" : "text-lg-minus", ink)}>
      {children}
    </Tag>
  );
}

/** A quiet sentence under a heading. */
export function T5Meta({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs leading-snug", sub, className)}>{children}</p>;
}

/** A label on the left and a value on the right (the mockup's key and value line). */
export function T5Pair({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-2.5 text-sm-minus", sub)}>
      <span>{label}</span>
      <b className={cn("font-bold", ink)}>{value}</b>
    </div>
  );
}

/** A big figure with its unit in small text, e.g. "31 h of your 50 h target". */
export function T5BigFigure({ value, unit }: { value: ReactNode; unit?: ReactNode }) {
  return (
    <span className={cn("nums text-2xl leading-none font-bold tracking-tight", ink)}>
      {value}
      {unit ? <small className={cn("ml-1.5 text-xs font-semibold tracking-normal", sub)}>{unit}</small> : null}
    </span>
  );
}

/** The live dot: white on the hero, the mode colour on white, On Call teal for its items. */
export function T5LiveDot({ tone = "teaching" }: { tone?: "teaching" | "on-call" }) {
  return (
    <span
      aria-hidden="true"
      data-mode-identity={tone === "on-call" ? "on-call" : undefined}
      className="mr-1.5 inline-block size-1.75 shrink-0 rounded-full bg-[color:var(--mode-identity)] forced-colors:bg-[CanvasText] [[data-t5-hero]_&]:bg-current"
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
      className={cn(
        // On the hero the fill is the hero's text colour, so the track is that colour, faint.
        "block overflow-hidden rounded-full bg-[color:var(--surface-wash)] [[data-t5-hero]_&]:bg-current/25",
        thin ? "mt-1.25 h-0.75" : "h-1.5",
      )}
    >
      <span
        className="block h-full rounded-full bg-[color:var(--mode-identity)] forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none [[data-t5-hero]_&]:bg-current"
        style={{ width: `${value}%` }}
      />
    </span>
  );
}

/** A row of equal steps, `filled` of `total` in the Teaching colour (readiness, EPAs). */
export function T5Steps({ total, filled, label }: { total: number; filled: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-1.25 rounded-full",
            index < filled
              ? "bg-[color:var(--mode-identity)] forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none [[data-t5-hero]_&]:bg-current"
              : "bg-[color:var(--surface-wash)]",
          )}
        />
      ))}
    </span>
  );
}

const NOTE_ICONS = { info: Info, alert: TriangleAlert, offline: WifiOff, shield: ShieldCheck } as const;

/**
 * A short note. A plain note is the mockup's centred footnote (`teach-ft`); `notice` is the wash
 * message card (`teach-msg`), amber when it says the connection dropped; `warning` is the amber
 * message card for a real problem (a part that did not load). Amber is a word and an icon, never
 * colour alone.
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
  const warning = tone === "warning" || (tone === "notice" && icon === "offline");
  return (
    <div
      role={tone === "warning" ? "status" : undefined}
      data-testid={testId}
      className={cn(
        "flex gap-2 leading-snug",
        boxed
          ? cn(
              "items-start rounded-[var(--work-radius-card)] border px-3 py-2.5 text-xs text-[color:var(--text)] forced-colors:border-[CanvasText]",
              warning
                ? "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)]"
                : "border-transparent bg-[color:var(--surface-wash)]",
            )
          : cn("items-center justify-center px-2.5 text-center text-2xs font-semibold", sub),
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "shrink-0",
          boxed ? "mt-px size-4" : "size-3.25",
          warning ? "text-[color:var(--warning-text)]" : faint,
        )}
        strokeWidth={2}
      />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** A row of actions: at most one filled button, the rest text links. */
export function T5Actions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-x-4.5 gap-y-1", className)}>{children}</div>;
}

/**
 * The segmented control: a soft track with the chosen option on a white pill. Each option keeps a
 * 48px tap target; the drawn track is the mockup's 36px.
 */
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
    <div
      role="group"
      aria-label={label}
      data-no-tab-swipe=""
      className="relative isolate grid min-h-12 auto-cols-fr grid-flow-col px-0.75 before:absolute before:inset-x-0 before:inset-y-1.5 before:-z-10 before:rounded-full before:bg-[color:var(--surface-inset)] before:content-[''] forced-colors:before:border forced-colors:before:border-[ButtonBorder]"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cn("relative grid min-h-12 min-w-0 place-items-center rounded-full", focusRing)}
          >
            <span
              className={cn(
                "grid h-7.5 w-full place-items-center truncate rounded-full px-2 text-xs",
                on
                  ? cn(
                      "border border-[color:var(--border)] bg-[color:var(--surface-raised)] font-bold forced-colors:border-[Highlight]",
                      ink,
                    )
                  : cn("font-semibold", sub),
              )}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The quiet line for an empty section: what will appear here and when. */
export function T5Empty({ children }: { children: ReactNode }) {
  return <p className={cn("work-card work-card--pad text-xs leading-snug", sub)}>{children}</p>;
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
      <label className="flex min-h-12 cursor-pointer items-center gap-2.5 px-3 py-2.25 has-disabled:cursor-not-allowed">
        <span className="relative grid size-5 shrink-0 place-items-center">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            className={cn(
              "peer absolute inset-0 cursor-pointer appearance-none rounded-md border-[1.5px] border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] checked:border-[color:var(--mode-identity)] checked:bg-[color:var(--mode-identity)] disabled:cursor-not-allowed disabled:opacity-50 forced-colors:appearance-auto",
              focusRing,
            )}
          />
          <Check
            aria-hidden="true"
            strokeWidth={3}
            className="pointer-events-none relative size-3 text-[color:var(--mode-identity-contrast)] opacity-0 peer-checked:opacity-100 forced-colors:hidden"
          />
        </span>
        <span className="grid min-w-0 flex-1 gap-px">
          <span className={cn("text-sm-minus leading-tight font-bold", ink)}>{label}</span>
          {meta ? <span className={cn("text-xs", sub)}>{meta}</span> : null}
        </span>
        {end}
      </label>
    </li>
  );
}

/** The hours a session counts for, on a soft pill at the end of a check row. */
export function T5Hours({ children }: { children: ReactNode }) {
  return (
    <span
      className={cn(
        "nums shrink-0 rounded-full bg-[color:var(--surface-wash)] px-2.25 py-1 text-xs font-bold whitespace-nowrap",
        ink,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ buttons */

const T5_FACE: Record<ButtonVariant, "primary" | "secondary" | "quiet" | "amber"> = {
  primary: "primary",
  secondary: "secondary",
  toolbar: "quiet",
  ghost: "quiet",
  danger: "amber",
};

/**
 * The shared work-button face (`.work-button` in work-mode.css) as attributes, for a link or a file
 * label that must look like a button. `block` is the full-width `wide` size.
 */
export function t5ButtonFace({ variant = "secondary", block = false }: { variant?: ButtonVariant; block?: boolean }) {
  return {
    className: "work-button no-underline",
    "data-variant": T5_FACE[variant],
    "data-size": block ? "wide" : undefined,
  } as const;
}

/**
 * Teaching's form buttons on the shared flat work-button face (work-mode redesign, owner request 6
 * Oct 2026). It keeps the app Button's props (busy, block, icons, ref, aria) so a form swaps without
 * losing behaviour; only the face changes. Ghost becomes the quiet text button, danger the amber one.
 */
export function T5Button({
  variant = "secondary",
  // The work face has one height; the old size prop is accepted and dropped so it never reaches the DOM.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  size: _size,
  children,
  icon: Icon,
  trailingIcon: TrailingIcon,
  block = false,
  busy = false,
  busyLabel,
  className,
  disabled,
  type,
  ref,
  testId,
  ...props
}: ButtonProps) {
  const face = t5ButtonFace({ variant, block });
  return (
    <button
      {...props}
      ref={ref}
      data-testid={testId}
      type={type ?? "button"}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      className={cn(face.className, className)}
      data-variant={face["data-variant"]}
      data-size={face["data-size"]}
    >
      {busy ? (
        <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
      ) : Icon ? (
        <Icon aria-hidden="true" />
      ) : null}
      <span>{busy && busyLabel ? busyLabel : children}</span>
      {!busy && TrailingIcon ? <TrailingIcon aria-hidden="true" /> : null}
    </button>
  );
}
