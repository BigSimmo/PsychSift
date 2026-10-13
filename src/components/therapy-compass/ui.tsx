import type { ReactNode } from "react";
import { ShieldCheck, TriangleAlert, type LucideIcon } from "lucide-react";

import { Chip, type ChipAppearance, type ChipSize } from "@/components/ui/chip";
import { missingValuePhrase } from "@/components/ui/missing-value";
import { cn, EmptyState as SharedEmptyState, LoadingPanel } from "@/components/ui-primitives";

import { reviewStatusMeta } from "./data/select";

// ---- tag pill -----------------------------------------------------------

type Tone = "neutral" | "purple" | "info" | "success" | "warning" | "accent";

/** Text colour only, for the borderless transparent eyebrow. */
const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-[color:var(--text-muted)]",
  purple: "text-[color:var(--type-source)]",
  info: "text-[color:var(--info)]",
  success: "text-[color:var(--success)]",
  warning: "text-[color:var(--warning)]",
  accent: "text-[color:var(--clinical-accent-hover)]",
};

export function tagTone(tag: string): Tone {
  const t = tag.toLowerCase();
  if (/(cbt|act|dbt|behavioural)/.test(t)) return "purple";
  if (/(crisis|risk|trauma|psychosis)/.test(t)) return "info";
  if (/(handout|sheet|reviewed)/.test(t)) return "success";
  if (/(single|micro|5-min|multi-session)/.test(t)) return "neutral";
  return "neutral";
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  const appearance: ChipAppearance =
    tone === "purple"
      ? { kind: "category", tone: "source" }
      : tone === "accent"
        ? { kind: "information", tone: "accent" }
        : tone === "success" || tone === "warning" || tone === "info"
          ? { kind: "status", tone }
          : { kind: "information", tone: "inset" };
  return (
    <Chip size="compact" appearance={appearance} className="whitespace-nowrap">
      {children}
    </Chip>
  );
}

export function TagRow({
  tags,
  max = 5,
  /** Search cards keep one row; detail may still wrap a longer set. */
  wrap = true,
}: {
  tags: string[];
  max?: number;
  wrap?: boolean;
}) {
  const shown = tags.slice(0, max);
  const extra = tags.length - shown.length;
  const pills = shown.map((tag) => (
    <Tag key={tag} tone={tagTone(tag)}>
      {tag}
    </Tag>
  ));
  const overflow = extra > 0 ? <Tag tone="neutral">+{extra}</Tag> : null;

  // Single-row cards: keep `+N` as a non-shrinking sibling so overflow-hidden
  // clips long tags, not the indicator that more tags exist.
  if (!wrap) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-nowrap gap-2 overflow-hidden">{pills}</div>
        {overflow ? <span className="shrink-0">{overflow}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {pills}
      {overflow}
    </div>
  );
}

// ---- review status badge ------------------------------------------------

export function StatusBadge({ status, size = "standard" }: { status: string; size?: ChipSize }) {
  const meta = reviewStatusMeta(status);
  const tone = meta.tone === "success" ? "success" : meta.tone === "warning" ? "warning" : "neutral";
  const Icon = meta.tone === "success" ? ShieldCheck : TriangleAlert;
  return (
    <Chip size={size} appearance={{ kind: "status", tone }} icon={Icon}>
      {meta.label}
    </Chip>
  );
}

// ---- icon tile ----------------------------------------------------------

export function IconTile({
  icon: Icon,
  size = 44,
  variant = "accent",
}: {
  icon: LucideIcon;
  size?: number;
  variant?: "accent" | "soft";
}) {
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center justify-center rounded-lg",
        size === 44 ? "h-tap w-tap" : "h-[38px] w-[38px]",
        variant === "accent"
          ? "bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
          : "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
      )}
    >
      <Icon size={Math.round(size * 0.5)} aria-hidden="true" />
    </span>
  );
}

// ---- loading / empty ----------------------------------------------------

export function LoadingState({ label = "Loading therapy library…" }: { label?: string }) {
  return <LoadingPanel label={label} layout="centered" />;
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <SharedEmptyState
      title={title}
      body={body}
      actions={action}
      iconNode={<Icon size={26} aria-hidden="true" />}
      align="center"
      live="polite"
      centeredTreatment="clinical"
    />
  );
}

// ---- small building blocks ---------------------------------------------

export function Eyebrow({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={cn("text-2xs font-bold uppercase tracking-eyebrow", TONE_TEXT[tone])}>{children}</span>;
}

/**
 * The three completeness bands the fill colour encodes.
 *
 * Naming them is what stops the meter being a colour-only status indicator
 * (GATES.md gate 4). The percentage alone does not carry it: a reader can see
 * "62%" and still not know the review threshold it is measured against, which
 * is the whole point of the hue changing at 80 and 50.
 *
 * A `StatusMark` is deliberately not used. Its own contract limits shape marks
 * to surfaces where a reader looks at one thing — "in a dense table, use the
 * label alone" — and the review queue renders three meters per row across
 * twenty-four rows.
 */
function completenessBand(v: number) {
  if (v >= 80) return { fill: "bg-[color:var(--success)]", label: "complete" } as const;
  if (v >= 50) return { fill: "bg-[color:var(--clinical-accent)]", label: "partial" } as const;
  return { fill: "bg-[color:var(--warning)]", label: "below review threshold" } as const;
}

/** A completeness meter (0–100) used on cards and the detail rail. */
export function Meter({ value, label }: { value: number | null; label: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const band = completenessBand(v);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-[color:var(--text-muted)]">{label}</span>
        {/* A record whose completeness the generator could not produce: the metric exists, this
            record does not carry a figure for it, so `Unknown` — never `Not recorded`, which would
            assert an omission from the record itself. The dash read as 0% beside a meter whose
            track is empty in exactly that case (SPEC §11). Rendered at the row's own `text-2xs`
            via the primitive's string form; `MissingValue`'s smallest density is `text-xs`. */}
        <span className="text-2xs font-semibold text-[color:var(--text-muted)]">
          {value == null ? missingValuePhrase("unknown") : `${v}%`}
        </span>
      </div>
      <span
        role={value == null ? undefined : "meter"}
        // The band rides in the accessible name, so the threshold the hue marks
        // is announced rather than only seen.
        aria-label={value == null ? undefined : `${label} — ${band.label}`}
        aria-valuemin={value == null ? undefined : 0}
        aria-valuemax={value == null ? undefined : 100}
        aria-valuenow={value == null ? undefined : v}
        aria-valuetext={value == null ? undefined : `${v}% — ${band.label}`}
        className="block h-1.5 overflow-hidden rounded-xs bg-[color:var(--surface-inset)]"
      >
        <span
          className={cn("block h-full rounded-xs", band.fill)}
          style={{ width: `${v}%` }}
          title={value == null ? undefined : band.label}
        />
      </span>
    </div>
  );
}
