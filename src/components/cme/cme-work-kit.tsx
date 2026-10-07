"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ModeBandAction, useModeBandHeading } from "@/components/mode-band/mode-band";
import { cn } from "@/components/ui-primitives";
import type { CmeCategory } from "@/lib/cme/types";

/**
 * CPD's small work-mode pieces (work-mode redesign, owner request 6 Oct 2026),
 * on top of the shared kit in `src/components/mode-kit/work.tsx`. Styles live in
 * `cme-work.css`. Every figure drawn as a shape (meters, split bars) is also
 * said in words for screen readers: the shape is `role="img"` with a sentence,
 * and a bar of several parts lists them in a visually hidden list. This is the
 * pattern the other work areas follow (idea 5, "rings, meters and toasts read
 * properly by screen readers").
 */

const perthClock = new Intl.DateTimeFormat("en-AU", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Australia/Perth",
});

/** "12:40", the Perth time records were loaded. */
export function cmeClock(at: Date): string {
  return perthClock.format(at);
}

/**
 * The band's small line above the title, saying where the records stand:
 * "Records loaded 12:40", "Sample record", or the reason none show. Never
 * "just now", and never a time when nothing loaded.
 */
export function cmeFreshnessEyebrow({
  demoMode,
  loadedAt,
  failed,
}: {
  readonly demoMode?: boolean;
  readonly loadedAt?: Date | null;
  readonly failed?: string | null;
}): string {
  if (demoMode) return "Sample record";
  if (failed) return failed;
  if (loadedAt) return `Records loaded ${cmeClock(loadedAt)}`;
  return "Not loaded";
}

/** The page's one round glass action in the band (Customise, Filter, Share). */
export function CmeBandAction({
  icon: Icon,
  label,
  href,
  onClick,
  testId,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly testId?: string;
} & ({ readonly href: string; readonly onClick?: never } | { readonly onClick: () => void; readonly href?: never })) {
  return (
    <ModeBandAction>
      {(underBand) => {
        if (!underBand) return null;
        const glyph = <Icon aria-hidden="true" className="size-icon-md" strokeWidth={2} />;
        return href !== undefined ? (
          <Link href={href} className="work-glass-button work-band__action" aria-label={label} data-testid={testId}>
            {glyph}
          </Link>
        ) : (
          <button
            type="button"
            className="work-glass-button work-band__action"
            aria-label={label}
            onClick={onClick}
            data-testid={testId}
          >
            {glyph}
          </button>
        );
      }}
    </ModeBandAction>
  );
}

/** A category dot. Colour only helps; the category name always sits beside it. */
export function CmeDot({ cat }: { readonly cat: CmeCategory | "fourth" | "unlinked" }) {
  return <span aria-hidden="true" className="cpd-dot" data-cat={cat} />;
}

export type CmeKvRow = { readonly label: ReactNode; readonly value: ReactNode; readonly testId?: string };

/** A card of label and value pairs ("Year · 1 Jan to 31 Dec"). */
export function CmeKvCard({
  rows,
  testId,
  label,
}: {
  readonly rows: readonly CmeKvRow[];
  readonly testId?: string;
  readonly label?: string;
}) {
  return (
    <dl className="work-card m-0" data-testid={testId} aria-label={label}>
      {rows.map((row, index) => (
        <div key={index} className="cpd-kv" data-testid={row.testId}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The quiet grey sentence under a block. */
export function CmeHint({
  children,
  className,
  testId,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <p className={cn("cpd-hint", className)} data-testid={testId}>
      {children}
    </p>
  );
}

/** The centred privacy line ("Private to you. Nothing is sent to RANZCP."). */
export function CmePrivacyLine({
  icon: Icon,
  children,
  testId,
}: {
  readonly icon: LucideIcon;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <p className="cpd-priv" data-testid={testId}>
      <Icon aria-hidden="true" strokeWidth={2} />
      {children}
    </p>
  );
}

/** A note line with an amber shield, for patient details. */
export function CmeNoteLine({ icon: Icon, children }: { readonly icon: LucideIcon; readonly children: ReactNode }) {
  return (
    <p className="cpd-note">
      <Icon aria-hidden="true" strokeWidth={2} />
      {children}
    </p>
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * A 48px meter at a row's end. Drawn for sight only when the row already says
 * the figure ("16.5 of 25 h"); otherwise give it `accessibleLabel`.
 */
export function CmeMiniMeter({
  fraction,
  accessibleLabel,
}: {
  readonly fraction: number;
  readonly accessibleLabel?: string;
}) {
  const width = `${Math.round(clamp01(fraction) * 100)}%`;
  return accessibleLabel ? (
    <span className="cpd-mini" role="img" aria-label={accessibleLabel}>
      <i style={{ width }} />
    </span>
  ) : (
    <span className="cpd-mini" aria-hidden="true">
      <i style={{ width }} />
    </span>
  );
}

export type CmeSplitPart = {
  readonly key: string;
  readonly cat: CmeCategory | "fourth" | "unlinked";
  readonly value: number;
  /** Said for the part ("Educational, 16 hours"). */
  readonly spoken: string;
};

/**
 * A bar split by category or goal. The drawing is hidden from screen readers;
 * the parts are read from a visually hidden list instead.
 */
export function CmeSplitBar({
  parts,
  label,
  testId,
  className,
}: {
  readonly parts: readonly CmeSplitPart[];
  readonly label: string;
  readonly testId?: string;
  readonly className?: string;
}) {
  const shown = parts.filter((part) => part.value > 0);
  return (
    <div className={className} data-testid={testId}>
      <div className="cpd-split" aria-hidden="true">
        {shown.map((part) => (
          <i key={part.key} style={{ flex: part.value }} data-cat={part.cat} />
        ))}
      </div>
      <ul className="sr-only" aria-label={label}>
        {parts.map((part) => (
          <li key={part.key}>{part.spoken}</li>
        ))}
      </ul>
    </div>
  );
}

/** The suggestion strip ("3 not marked copied · Copy next"). */
export function CmeSuggestion({
  icon: Icon,
  title,
  sub,
  end,
  testId,
}: {
  readonly icon: LucideIcon;
  readonly title: ReactNode;
  readonly sub?: ReactNode;
  readonly end?: ReactNode;
  readonly testId?: string;
}) {
  return (
    <div className="cpd-sug" data-testid={testId}>
      <span aria-hidden="true" className="work-ic">
        <Icon aria-hidden="true" strokeWidth={2} />
      </span>
      <span className="work-row__text">
        <span className="work-row__title nums">{title}</span>
        {sub ? <span className="work-row__sub">{sub}</span> : null}
      </span>
      {end}
    </div>
  );
}

/** A plain banner (offline, sample): grey wash, an icon, a line, an optional action. */
export function CmeBanner({
  icon: Icon,
  children,
  action,
  testId,
  role,
}: {
  readonly icon: LucideIcon;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly testId?: string;
  readonly role?: "status";
}) {
  return (
    <div className="cpd-ban" data-testid={testId} role={role}>
      <Icon aria-hidden="true" strokeWidth={2} />
      <span>{children}</span>
      {action}
    </div>
  );
}

/** A toggle row: a label and a switch, the whole row the 48px control. */
export function CmeToggleRow({
  label,
  sub,
  checked,
  onChange,
  testId,
  disabled,
}: {
  readonly label: ReactNode;
  readonly sub?: ReactNode;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly testId?: string;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      data-testid={testId}
      className="work-row min-h-tap"
    >
      <span className="work-row__text">
        <span className="work-row__title">{label}</span>
        {sub ? <span className="work-row__sub">{sub}</span> : null}
      </span>
      <span aria-hidden="true" className="cpd-switch" />
    </button>
  );
}

/**
 * Sets the band's eyebrow and title from a server-rendered page. Renders
 * nothing; a client page calls `useModeBandHeading` directly.
 */
export function CmeBandHeading({ eyebrow, title }: { readonly eyebrow: string; readonly title: string }) {
  useModeBandHeading({ eyebrow, title });
  return null;
}
