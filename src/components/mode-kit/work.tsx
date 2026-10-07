"use client";

import { Check, ChevronRight, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, type ReactNode } from "react";

import { useOptionalToast } from "@/components/ui/toast";
import type { AppModeId } from "@/lib/app-modes";

/**
 * The work-mode kit (work-mode redesign, owner request 6 Oct 2026): the
 * mockup's shared pieces, for every work area's pages. Styles live in
 * `src/app/work-mode.css` and read the area palette from the nearest
 * `data-mode-identity` (the work frame sets it on every work page, and on
 * <body> for sheets and toasts).
 *
 * Every interactive piece takes a destination (`href`) or an action
 * (`onClick`), never neither, so a control cannot be drawn that does nothing
 * (AGENTS.md "Page and button wiring"). Tap targets are 48px; the drawn
 * shapes inside them are the mockup's sizes.
 */

export type WorkTone = "mode" | "green" | "amber" | "red" | "neutral";

/** A tap goes somewhere, does something, or the piece is plain. */
type WorkTap =
  | { readonly href: string; readonly onClick?: never }
  | { readonly onClick: () => void; readonly href?: never }
  | { readonly href?: undefined; readonly onClick?: undefined };

function toneAttr(tone: WorkTone | undefined): string | undefined {
  return tone && tone !== "mode" ? tone : undefined;
}

/* --------------------------------------------------------- section label */

export type WorkSectionLabelProps = {
  readonly children: ReactNode;
  /** A short count or note at the right ("2 waiting"). */
  readonly count?: ReactNode;
  /** A link at the right ("All 8"). */
  readonly action?: { readonly label: string } & ({ readonly href: string } | { readonly onClick: () => void });
  /** Heading level for the label; defaults to an h2. */
  readonly as?: "h2" | "h3" | "p";
  readonly id?: string;
};

/** The small-caps label above a section, with an optional count or link. */
export function WorkSectionLabel({ children, count, action, as: Tag = "h2", id }: WorkSectionLabelProps) {
  return (
    <div className="work-label">
      <Tag id={id} className="m-0 text-inherit font-inherit">
        {children}
      </Tag>
      {count !== undefined ? <em className="work-label__count">{count}</em> : null}
      {action ? (
        "href" in action ? (
          <Link href={action.href} className="work-label__link">
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className="work-label__link">
            {action.label}
          </button>
        )
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ card */

export type WorkCardProps = {
  readonly children: ReactNode;
  /** Inner padding for free content; rows bring their own. */
  readonly padded?: boolean;
  readonly className?: string;
  readonly as?: "div" | "section" | "ul" | "article";
  readonly "aria-label"?: string;
  readonly testId?: string;
};

/** A white content card with a hairline. Rows inside draw their own dividers. */
export function WorkCard({ children, padded, className, as: Tag = "div", testId, ...rest }: WorkCardProps) {
  return (
    <Tag
      className={["work-card", padded ? "work-card--pad" : "", Tag === "ul" ? "work-rows" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      aria-label={rest["aria-label"]}
      data-testid={testId}
    >
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------ icon circle */

export type WorkIconCircleProps = {
  readonly icon: LucideIcon;
  readonly tone?: WorkTone;
  /** Tints the circle with another area's colour, because the tap leads there. */
  readonly leadsTo?: AppModeId;
  readonly size?: "sm" | "md" | "lg";
};

/** A flat tinted circle with an icon in the colour of where a tap goes. */
export function WorkIconCircle({ icon: Icon, tone, leadsTo, size = "md" }: WorkIconCircleProps) {
  return (
    <span
      aria-hidden="true"
      className={`work-ic${size === "md" ? "" : ` work-ic--${size}`}`}
      data-tone={toneAttr(tone)}
      data-mode-identity={leadsTo}
    >
      <Icon aria-hidden="true" strokeWidth={2} />
    </span>
  );
}

/* ------------------------------------------------------------------ rows */

type WorkRowBase = {
  readonly title: ReactNode;
  readonly sub?: ReactNode;
  /** What sits at the row's end. Defaults to a chevron on a row that goes somewhere. */
  readonly end?: ReactNode;
  readonly testId?: string;
};

function WorkRowShell({
  lead,
  title,
  sub,
  end,
  href,
  onClick,
  testId,
}: WorkRowBase & WorkTap & { readonly lead: ReactNode }) {
  const tappable = Boolean(href || onClick);
  const content = (
    <>
      {lead}
      <span className="work-row__text">
        <span className="work-row__title">{title}</span>
        {sub ? <span className="work-row__sub">{sub}</span> : null}
      </span>
      {end !== undefined ? (
        <span className="work-row__end">{end}</span>
      ) : tappable ? (
        <ChevronRight aria-hidden="true" className="work-row__chev" strokeWidth={2} />
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="work-row" data-testid={testId}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="work-row" data-testid={testId}>
        {content}
      </button>
    );
  }
  return (
    <div className="work-row" data-testid={testId}>
      {content}
    </div>
  );
}

export type WorkIconRowProps = WorkRowBase &
  WorkTap & {
    readonly icon: LucideIcon;
    readonly tone?: WorkTone;
    readonly leadsTo?: AppModeId;
  };

/** The mockup's `ir`: an icon circle, a title over a short line, and an end. */
export function WorkIconRow({ icon, tone, leadsTo, ...row }: WorkIconRowProps) {
  return <WorkRowShell {...row} lead={<WorkIconCircle icon={icon} tone={tone} leadsTo={leadsTo} />} />;
}

export type WorkDateRowProps = WorkRowBase &
  WorkTap & {
    /** Short month in capitals' place, written normally ("Oct"); drawn in small caps. */
    readonly month: string;
    readonly day: string | number;
  };

/** The mockup's `dr`: a date tile (month over day), a title over a line, and an end. */
export function WorkDateRow({ month, day, ...row }: WorkDateRowProps) {
  return (
    <WorkRowShell
      {...row}
      lead={
        <span className="work-date">
          <span className="work-date__month">{month}</span>
          <span className="work-date__day">{day}</span>
        </span>
      }
    />
  );
}

/* ------------------------------------------------------------------ hero */

export type WorkHeroProps = {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly sub?: ReactNode;
  /** A `WorkRing` (or any figure) at the right. */
  readonly ring?: ReactNode;
  /** A row of actions or a meter under the text. */
  readonly footer?: ReactNode;
  readonly href?: string;
  readonly "aria-label"?: string;
  readonly testId?: string;
};

/**
 * The one mode-colour card a screen may have. Flat: a gentle gradient in the
 * area's colour, white text, no glow.
 */
export function WorkHero({ eyebrow, title, sub, ring, footer, href, testId, ...rest }: WorkHeroProps) {
  const body = (
    <>
      <div className="work-hero__layout">
        <div className="work-hero__text">
          {eyebrow ? <span className="work-hero__eyebrow">{eyebrow}</span> : null}
          <span className="work-hero__title">{title}</span>
          {sub ? <span className="work-hero__sub">{sub}</span> : null}
        </div>
        {ring}
      </div>
      {footer ? <div className="work-hero__foot">{footer}</div> : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="work-hero block" aria-label={rest["aria-label"]} data-testid={testId}>
        {body}
      </Link>
    );
  }
  return (
    <section className="work-hero" aria-label={rest["aria-label"]} data-testid={testId}>
      {body}
    </section>
  );
}

/* ----------------------------------------------------------------- rings */

function clampFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(1, Math.max(0, fraction));
}

export type WorkRingProps = {
  /** The figure in the middle ("32.5"). */
  readonly value: ReactNode;
  /** The small word under it ("of 50 h"). */
  readonly label?: ReactNode;
  /** How full, 0 to 1. */
  readonly fraction: number;
  /** Spoken in place of the drawing, for example "32.5 of 50 hours". */
  readonly accessibleLabel: string;
};

/** The hero's white progress ring (64px). */
export function WorkRing({ value, label, fraction, accessibleLabel }: WorkRingProps) {
  const circumference = 175.9;
  return (
    <span className="work-ring" role="img" aria-label={accessibleLabel}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="work-ring__track" cx="32" cy="32" r="28" fill="none" strokeWidth="4.5" />
        <circle
          className="work-ring__value"
          cx="32"
          cy="32"
          r="28"
          fill="none"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={(circumference * (1 - clampFraction(fraction))).toFixed(1)}
        />
      </svg>
      <span aria-hidden="true">
        <span className="work-ring__figure">{value}</span>
        {label ? <span className="work-ring__label">{label}</span> : null}
      </span>
    </span>
  );
}

export type WorkMiniRingProps = {
  readonly value: ReactNode;
  readonly fraction: number;
  readonly tone?: "mode" | "green" | "amber";
  readonly accessibleLabel: string;
};

/** A small ring on white (46px), in the mode colour or a status colour. */
export function WorkMiniRing({ value, fraction, tone, accessibleLabel }: WorkMiniRingProps) {
  const circumference = 119.4;
  return (
    <span className="work-mring" role="img" aria-label={accessibleLabel} data-tone={toneAttr(tone)}>
      <svg viewBox="0 0 46 46" aria-hidden="true">
        <circle className="work-mring__track" cx="23" cy="23" r="19" fill="none" strokeWidth="5" />
        <circle
          className="work-mring__value"
          cx="23"
          cy="23"
          r="19"
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={(circumference * (1 - clampFraction(fraction))).toFixed(1)}
        />
      </svg>
      <span aria-hidden="true" className="work-mring__figure">
        {value}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------- tag */

/** A small-caps status word on a flat tint. Always a word, never colour alone. */
export function WorkTag({ tone = "mode", children }: { readonly tone?: WorkTone; readonly children: ReactNode }) {
  return (
    <span className="work-tag" data-tone={toneAttr(tone)}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ chips */

export type WorkChipProps = {
  readonly children: ReactNode;
  readonly icon?: LucideIcon;
  /** A count beside the label that adds up with its neighbours. */
  readonly count?: number;
  readonly testId?: string;
} & (
  | { readonly selected: boolean; readonly onClick: () => void; readonly href?: never; readonly current?: never }
  | { readonly href: string; readonly current?: boolean; readonly selected?: never; readonly onClick?: never }
);

/** A filter or choice chip: a toggle (`selected` + `onClick`) or a link (`href`). */
export function WorkChip(props: WorkChipProps) {
  const { children, icon: Icon, count, testId } = props;
  const inner = (
    <>
      {Icon ? <Icon aria-hidden="true" strokeWidth={2.2} /> : null}
      {children}
      {count !== undefined ? (
        <span className="work-chip__count">
          <span className="sr-only"> </span>
          {count}
        </span>
      ) : null}
    </>
  );
  if (props.href !== undefined) {
    return (
      <Link
        href={props.href}
        className="work-chip"
        aria-current={props.current ? "page" : undefined}
        data-testid={testId}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="work-chip"
      aria-pressed={props.selected}
      onClick={props.onClick}
      data-testid={testId}
    >
      {inner}
    </button>
  );
}

/** A row of chips. `scroll` keeps them on one line and lets the row scroll sideways. */
export function WorkChips({
  children,
  scroll,
  label,
}: {
  readonly children: ReactNode;
  readonly scroll?: boolean;
  readonly label?: string;
}) {
  return (
    <div className="work-chips" data-scroll={scroll ? "" : undefined} role="group" aria-label={label}>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- buttons */

export type WorkButtonVariant = "primary" | "secondary" | "tinted" | "amber" | "quiet";

export type WorkButtonProps = {
  readonly children: ReactNode;
  readonly variant?: WorkButtonVariant;
  readonly size?: "md" | "wide";
  readonly icon?: LucideIcon;
  readonly testId?: string;
  readonly "aria-label"?: string;
} & (
  | { readonly href: string; readonly onClick?: never; readonly type?: never; readonly disabled?: never }
  | { readonly onClick: () => void; readonly href?: never; readonly type?: "button"; readonly disabled?: boolean }
  | { readonly type: "submit"; readonly href?: never; readonly onClick?: () => void; readonly disabled?: boolean }
);

/**
 * Flat buttons: primary (solid mode colour, one per screen), secondary (white
 * with a line), tinted (the mode's soft fill), amber (a warning action) and
 * quiet (text only, for "Later").
 */
export function WorkButton(props: WorkButtonProps) {
  const { children, variant = "primary", size = "md", icon: Icon, testId } = props;
  const inner = (
    <>
      {Icon ? <Icon aria-hidden="true" strokeWidth={2} /> : null}
      {children}
    </>
  );
  const shared = {
    className: "work-button",
    "data-variant": variant,
    "data-size": size === "md" ? undefined : size,
    "data-testid": testId,
    "aria-label": props["aria-label"],
  };
  if (props.href !== undefined) {
    return (
      <Link href={props.href} {...shared}>
        {inner}
      </Link>
    );
  }
  return (
    <button type={props.type ?? "button"} onClick={props.onClick} disabled={props.disabled} {...shared}>
      {inner}
    </button>
  );
}

export type WorkGlassButtonProps = {
  readonly icon: LucideIcon;
  /** The whole accessible name: the button is an icon only. */
  readonly label: string;
  readonly testId?: string;
  readonly className?: string;
} & ({ readonly href: string; readonly onClick?: never } | { readonly onClick: () => void; readonly href?: never });

/** A round glass button for a floating control (a page's corner action). */
export function WorkGlassButton({ icon: Icon, label, href, onClick, testId, className }: WorkGlassButtonProps) {
  const classes = className ? `work-glass-button ${className}` : "work-glass-button";
  const glyph = <Icon aria-hidden="true" className="size-icon-md" strokeWidth={2} />;
  if (href !== undefined) {
    return (
      <Link href={href} className={classes} aria-label={label} data-testid={testId}>
        {glyph}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} aria-label={label} onClick={onClick} data-testid={testId}>
      {glyph}
    </button>
  );
}

/* ------------------------------------------------------------------ dock */

export type WorkDockProps = {
  /** One or two `WorkButton`s: the primary action, then an optional quiet one. */
  readonly children: ReactNode;
  /** An optional round glass action beside the capsule. */
  readonly orb?: WorkGlassButtonProps;
  readonly "aria-label"?: string;
};

/**
 * The floating action dock: a glass capsule at the foot of the page. Sticky in
 * the page flow, so it needs no reserve, never covers the page's end and never
 * stacks with a search composer (work pages have none).
 */
export function WorkDock({ children, orb, ...rest }: WorkDockProps) {
  return (
    <div className="work-dock" role="group" aria-label={rest["aria-label"] ?? "Actions"}>
      <div className="work-dock__capsule">{children}</div>
      {orb ? <WorkGlassButton {...orb} className="work-dock__orb" /> : null}
    </div>
  );
}

/* ----------------------------------------------------------- empty state */

export type WorkEmptyProps = {
  readonly icon: LucideIcon;
  readonly title: ReactNode;
  readonly body?: ReactNode;
  /** One action, usually a `WorkButton`. */
  readonly action?: ReactNode;
  readonly testId?: string;
};

/** A calm empty state: a flat badge, one line, an optional sentence and action. */
export function WorkEmpty({ icon: Icon, title, body, action, testId }: WorkEmptyProps) {
  return (
    <div className="work-empty" data-testid={testId}>
      <span aria-hidden="true" className="work-empty__badge">
        <Icon aria-hidden="true" strokeWidth={2} />
      </span>
      <p className="work-empty__title">{title}</p>
      {body ? <p className="work-empty__body">{body}</p> : null}
      {action}
    </div>
  );
}

/* ------------------------------------------------------------ week strip */

/** Roster shift codes the strip can mark under a day. */
export type WorkShiftCode = "D" | "L" | "N" | "OC" | "AL" | "T";

export type WorkWeekDay = {
  readonly key: string;
  /** Short weekday in small caps ("Mon"). */
  readonly weekday: string;
  readonly day: number;
  readonly code?: WorkShiftCode;
  /** Spoken in full, for example "Tuesday 6 October, on call". */
  readonly accessibleLabel: string;
  readonly selected?: boolean;
  readonly today?: boolean;
  readonly href?: string;
};

export type WorkWeekStripProps = {
  readonly days: readonly WorkWeekDay[];
  readonly label: string;
  /** Called with a day's key when it is tapped (days without `href`). */
  readonly onSelect?: (key: string) => void;
};

/**
 * Seven day tiles with a shift mark under each. Today or the chosen day takes
 * a soft tint and a 1px line. Opts out of the tab swipe, so a sideways drag
 * here never changes the page.
 */
export function WorkWeekStrip({ days, label, onSelect }: WorkWeekStripProps) {
  return (
    <ul className="work-week" aria-label={label} data-no-tab-swipe="">
      {days.map((day) => {
        const marked = day.selected ? { "data-selected": "" } : {};
        const inner = (
          <>
            <span aria-hidden="true">{day.weekday.toUpperCase()}</span>
            <span aria-hidden="true" className="work-week__num">
              {day.day}
            </span>
            <span aria-hidden="true" className="work-week__mark" data-code={day.code} />
            <span className="sr-only">{day.accessibleLabel}</span>
          </>
        );
        return (
          <li key={day.key} className="min-w-0">
            {day.href ? (
              <Link
                href={day.href}
                className="work-week__day"
                aria-current={day.today ? "date" : undefined}
                {...marked}
              >
                {inner}
              </Link>
            ) : onSelect ? (
              <button
                type="button"
                className="work-week__day"
                aria-pressed={Boolean(day.selected)}
                aria-current={day.today ? "date" : undefined}
                onClick={() => onSelect(day.key)}
                {...marked}
              >
                {inner}
              </button>
            ) : (
              <span className="work-week__day" aria-current={day.today ? "date" : undefined} {...marked}>
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------ check rows */

export type WorkCheckRowProps = {
  readonly tone?: "ok" | "warn";
  readonly children: ReactNode;
  /** The checked value at the right ("39 h"). */
  readonly value?: ReactNode;
};

/** One agreement or rest check: a green tick or an amber flag, a line, a value. */
export function WorkCheckRow({ tone = "ok", children, value }: WorkCheckRowProps) {
  const Mark = tone === "warn" ? TriangleAlert : Check;
  return (
    <div className="work-check" data-tone={tone === "warn" ? "warn" : undefined}>
      <span className="work-check__mark" aria-hidden="true">
        <Mark aria-hidden="true" strokeWidth={2.6} />
      </span>
      <span className="work-check__text">
        <span className="sr-only">{tone === "warn" ? "Check: " : "Passed: "}</span>
        {children}
      </span>
      {value !== undefined ? <em className="work-check__value">{value}</em> : null}
    </div>
  );
}

/* -------------------------------------------------------------- page body */

/** The work page column: 12px gutters, 9px between blocks, centred on wide screens. */
export function WorkBody({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) {
  return (
    <div className="work-body" data-testid={testId}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ Undo toast */

/**
 * The Undo toast: "Leave form signed and sent · Undo". Uses the app's one
 * toast system (polite live region, one action), which the work frame draws
 * as the mockup's dark toast above any dock. Returns null outside a
 * ToastProvider, so callers fall back to their own confirmation.
 */
export function useWorkUndoToast(): ((message: string, onUndo?: () => void, durationMs?: number) => void) | null {
  const toast = useOptionalToast();
  const show = useCallback(
    (message: string, onUndo?: () => void, durationMs = 6000) => {
      toast?.push({
        tone: "success",
        title: message,
        duration: durationMs,
        action: onUndo ? { label: "Undo", onAction: onUndo } : undefined,
      });
    },
    [toast],
  );
  return toast ? show : null;
}
