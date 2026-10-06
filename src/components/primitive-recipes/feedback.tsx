import { Loader2, X, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn, controlDisabled, textMuted, toneDanger, toneInfo, toneNeutral, toneSuccess, toneWarning } from "./recipes";

const insetCard = "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-inset)]";
const iconTile =
  "grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]";

export type AsyncButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  busy: boolean;
  busyLabel: string;
  children: ReactNode;
  idleIcon?: ReactNode;
};

/**
 * Shared busy-state contract for async actions. Prefer `Button` with
 * `busy`/`busyLabel` for new call sites — this helper remains for existing
 * forms that pass a ReactNode idle icon. `type` is applied AFTER the spread so
 * a missing type cannot open a surrounding form, while an explicit
 * `type="submit"` still wins.
 */
export function AsyncButton({ busy, busyLabel, children, disabled, idleIcon, type, ...props }: AsyncButtonProps) {
  return (
    <button {...props} type={type ?? "button"} disabled={busy || disabled} aria-busy={busy || undefined}>
      {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : idleIcon}
      <span>{busy ? busyLabel : children}</span>
    </button>
  );
}

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  /**
   * Required accessible name. Icon-only buttons carry no visible text, so the
   * label is the only thing assistive tech can announce — making it a required
   * prop closes the "unlabeled icon button" hole structurally, rather than
   * relying on convention + a runtime axe scan that only reaches a few routes.
   */
  label: string;
  /** Lucide icon rendered decoratively (aria-hidden) inside the button. */
  icon: LucideIcon;
  /** Size utility for the icon glyph; defaults to the 16px `size-icon-md` step. */
  iconClassName?: string;
};

/**
 * Accessible icon-only button. Guarantees the accessible name (`aria-label`), an
 * `aria-hidden` icon glyph, a `--spacing-tap` hit area, and the shared focus ring. Pass a
 * recipe like `toolbarButton`/`floatingControl` via `className` for chrome; the
 * base stays colour-neutral so the glyph inherits `currentColor` from context.
 */
export function IconButton({ label, icon: Icon, className, iconClassName, type, ...props }: IconButtonProps) {
  return (
    <button
      {...props}
      type={type ?? "button"}
      aria-label={label}
      className={cn(
        "grid size-tap shrink-0 place-items-center rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
        controlDisabled,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn("size-icon-md", iconClassName)} />
    </button>
  );
}

export type NoticeTone = "success" | "warning" | "danger" | "info" | "neutral";

export type InlineNoticeProps = {
  tone: NoticeTone;
  children: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  animated?: boolean;
  className?: string;
};

function noticeToneClass(tone: NoticeTone) {
  if (tone === "success") return toneSuccess;
  if (tone === "danger") return toneDanger;
  if (tone === "info") return toneInfo;
  if (tone === "warning") return toneWarning;
  return toneNeutral;
}

/**
 * Shared inline feedback banner used across surfaces (auth panel, action
 * notices, upload) so success/warning/error feedback looks and announces the
 * same everywhere. Success/info announce politely (role=status); warning/danger
 * assert (role=alert). Pass onDismiss to render a dismiss control.
 */
export function InlineNotice({
  tone,
  children,
  onDismiss,
  dismissLabel = "Dismiss notification",
  animated = false,
  className,
}: InlineNoticeProps) {
  const assertive = tone === "danger" || tone === "warning";
  return (
    <div
      role={assertive ? "alert" : "status"}
      className={cn(
        "flex items-start justify-between gap-3 rounded-xl border p-3 text-sm font-medium",
        animated && "motion-safe:animate-fade-up",
        noticeToneClass(tone),
        className,
      )}
    >
      <span className="min-w-0">{children}</span>
      {onDismiss && (
        <IconButton icon={X} label={dismissLabel} onClick={onDismiss} className="-m-2.5 opacity-70 hover:opacity-100" />
      )}
    </div>
  );
}

type ToggleSwitchBase = {
  enabled: boolean;
  className?: string;
  disabled?: boolean;
};

export type ToggleSwitchProps = ToggleSwitchBase &
  (
    | {
        /** Operable switch — requires an accessible name. */
        onToggle: () => void;
        "aria-label": string;
      }
    | {
        /** Read-only presentational indicator (no interactive role). */
        onToggle?: undefined;
        "aria-label"?: string;
      }
  );

export function ToggleSwitch({
  enabled,
  className,
  onToggle,
  disabled = false,
  "aria-label": ariaLabel,
}: ToggleSwitchProps) {
  const track = cn(
    "relative inline-flex h-6 w-10 shrink-0 box-content rounded-full border shadow-[var(--shadow-inset)] transition",
    enabled
      ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)]"
      : "border-[color:var(--border-strong)] bg-[color:var(--surface-inset)]",
    className,
  );
  const knob = (
    <span
      aria-hidden
      className={cn(
        // Gate 9: the knob travels on `transform`, never on `left`/`right`. Track is w-10
        // (40px content box; `box-content` keeps the 1px border outside it) with a
        // 16px knob inset 4px each side, so the throw is 40-4-4-16 = 16px.
        "absolute top-1 left-1 h-4 w-4 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] shadow-sm",
        "transition-transform duration-[var(--duration-base)] motion-reduce:transition-none",
        enabled ? "translate-x-4" : "translate-x-0",
      )}
    />
  );

  if (onToggle) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "inline-grid min-h-tap min-w-tap shrink-0 place-items-center rounded-lg",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
          controlDisabled,
        )}
      >
        <span className={track}>{knob}</span>
      </button>
    );
  }

  // Read-only: expose the state as an image label so assistive tech announces
  // on/off without implying the control can be operated. Unlabeled indicators
  // are decorative — hide them from the accessibility tree.
  return (
    <span
      role={ariaLabel ? "img" : undefined}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel ? `${ariaLabel}: ${enabled ? "on" : "off"}` : undefined}
      className={track}
    >
      {knob}
    </span>
  );
}

type IconComponent = LucideIcon;

export type PanelHeadingProps = {
  icon?: IconComponent;
  title: string;
  description?: string;
};

export function PanelHeading({ icon: Icon, title, description }: PanelHeadingProps) {
  return (
    <div className="flex items-start gap-3">
      {Icon && (
        <span className={iconTile}>
          <Icon aria-hidden="true" className="size-icon-md sm:size-icon-lg" />
        </span>
      )}
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-[color:var(--text-heading)]">{title}</h2>
        {description && <p className={cn("mt-1 text-sm leading-6", textMuted)}>{description}</p>}
      </div>
    </div>
  );
}

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement> & { animationDelay?: string };

export function Skeleton({ className, animationDelay, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-md bg-[color:var(--surface-subtle)] bg-no-repeat",
        "bg-[length:200%_100%] bg-[linear-gradient(100deg,transparent_30%,color-mix(in_srgb,var(--surface-highlight)_72%,transparent)_50%,transparent_70%)]",
        "motion-safe:animate-shimmer",
        className,
      )}
      style={animationDelay ? { animationDelay } : undefined}
      {...props}
    />
  );
}

export type LoadingPanelProps = {
  label: string;
  variant?: "spinner" | "skeleton";
  lines?: number;
  layout?: "panel" | "centered";
};

export function LoadingPanel({ label, variant = "spinner", lines = 3, layout = "panel" }: LoadingPanelProps) {
  if (variant === "skeleton") {
    return (
      <div
        className={cn(insetCard, "mt-3 space-y-2.5 p-4", layout === "centered" ? "min-h-[280px]" : "min-h-28")}
        role="status"
        aria-label={label}
      >
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton key={index} aria-hidden className={cn("h-4", index === lines - 1 ? "w-2/3" : "w-full")} />
        ))}
        <span className="sr-only">{label}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        layout === "centered"
          ? "flex min-h-[280px] flex-col items-center justify-center gap-3 text-center text-sm font-medium text-[color:var(--text-muted)]"
          : `${insetCard} mt-3 grid min-h-28 place-items-center p-4 text-center text-sm font-semibold text-[color:var(--text-muted)]`,
      )}
      role="status"
    >
      <div className={cn(layout === "centered" && "flex flex-col items-center gap-3")}>
        <Loader2
          aria-hidden="true"
          className={cn(
            "animate-spin text-[color:var(--clinical-accent)] motion-reduce:animate-none",
            layout === "centered" ? "h-[34px] w-[34px]" : "mx-auto mb-2 h-4 w-4",
          )}
        />
        {label}
      </div>
    </div>
  );
}

export type EmptyStateProps = {
  icon?: IconComponent;
  iconNode?: ReactNode;
  title: string;
  /**
   * Render the title as a heading at this level instead of a paragraph.
   *
   * Deliberately opt-in and deliberately un-defaulted. Most adopted call sites
   * sit inside a card that already owns the heading for that region, so
   * promoting every title would insert a level into the document outline that
   * the surrounding page never declared. The states that DO own their region —
   * the main document-search empty state, `/dsm/search` — pass the level the
   * surrounding outline requires, and their heading is pinned by a test.
   */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** Supporting copy. `PanelHeading` calls the same slot `description`. */
  body?: string;
  /**
   * Deprecated alias for `body`, accepted because `PanelHeading` names this slot
   * `description` and passing `description` here used to render nothing at all —
   * silently, with no type error, because `body` was the only recognised name.
   * Prefer `body`; this alias exists so the mistake is impossible rather than
   * invisible, and will be removed once call sites converge.
   */
  description?: string;
  /** Optional controls stay within the shared state surface rather than becoming a second panel. */
  actions?: ReactNode;
  /** Announce a state transition only when the state is introduced dynamically. */
  live?: "off" | "polite" | "assertive";
  tone?: "neutral" | "info" | "danger";
  testId?: string;
  /** Centred presentation for full-panel no-result states; semantics stay identical. */
  align?: "start" | "center";
  /** Clinical-centred states retain a neutral panel with an accent icon and compact action offset. */
  centeredTreatment?: "neutral" | "clinical";
};

export function EmptyState({
  icon: Icon,
  title,
  headingLevel,
  body,
  description,
  actions,
  live = "off",
  tone = "neutral",
  testId,
  align = "start",
  iconNode,
  centeredTreatment = "neutral",
}: EmptyStateProps) {
  const Title = headingLevel ? (`h${headingLevel}` as "h2" | "h3" | "h4" | "h5" | "h6") : "p";
  return (
    <div
      data-testid={testId}
      role={live === "assertive" ? "alert" : live === "polite" ? "status" : undefined}
      className={cn(
        align === "center"
          ? "flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface)] px-6 py-12 text-center"
          : "rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-inset)] p-4 text-sm shadow-[var(--shadow-inset)] sm:p-5",
        tone === "info" && "border-[color:var(--info-border)] bg-[color:var(--info-soft)]",
        tone === "danger" && "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]",
      )}
    >
      <div className={cn(align === "center" ? "contents" : "flex items-start gap-3")}>
        {(Icon || iconNode) && (
          <span
            className={cn(
              "shrink-0",
              align === "center" ? "mb-0.5 h-13 w-13 rounded-xl" : "h-10 w-10 rounded-lg",
              align === "center" && centeredTreatment === "clinical"
                ? "inline-flex items-center justify-center bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                : cn(
                    "grid place-items-center",
                    "bg-[color:var(--surface)] text-[color:var(--text-muted)]",
                    tone === "info" && "bg-[color:var(--info-soft)] text-[color:var(--info)]",
                    tone === "danger" && "bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
                  ),
            )}
          >
            {Icon ? (
              <Icon
                aria-hidden="true"
                className={align === "center" ? "h-[26px] w-[26px]" : "size-icon-md sm:size-icon-lg"}
              />
            ) : (
              iconNode
            )}
          </span>
        )}
        <div className={cn("min-w-0", align === "center" && "contents")}>
          <Title
            className={cn(
              "font-semibold text-[color:var(--text)]",
              align === "center" && "text-lg-minus font-bold text-[color:var(--text-heading)]",
            )}
          >
            {title}
          </Title>
          {(body ?? description) ? (
            <p
              className={cn(
                "mt-1 leading-6",
                textMuted,
                align === "center" && "m-0 max-w-[44ch] text-sm-minus leading-normal",
              )}
            >
              {body ?? description}
            </p>
          ) : null}
          {actions ? (
            <div
              className={cn(
                align === "center" && centeredTreatment === "clinical" ? "mt-2" : "mt-3 flex flex-wrap gap-2",
              )}
            >
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
