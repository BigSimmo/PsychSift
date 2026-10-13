import Link from "next/link";
import { type ReactNode } from "react";
import { type LucideIcon, ArrowRight } from "lucide-react";

import { DesktopComposerPortalSlot } from "@/components/desktop-composer-portal-slot";
import { cn, EmptyState, eyebrowText } from "@/components/ui-primitives";
import { modeHomeComposerReservePendingValue } from "@/lib/mode-home-composer";

export type ModeHomeAction = {
  title: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
};

export type ModeHomePill = {
  label: string;
  shortLabel?: string;
  href?: string;
  onClick?: () => void;
  icon?: LucideIcon;
  tone?: "danger" | "info" | "success" | "neutral" | "primary" | "purple" | "indigo" | "rose" | "slate";
};

type ModeHomeTemplateProps = {
  testId?: string;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  actions: ModeHomeAction[];
  actionsLabel: string;
  desktopComposerSlotId?: string;
  pillsTitle?: string;
  pills?: ModeHomePill[];
  pillsAction?: ReactNode;
  footer?: ReactNode;
  className?: string;
  headingLevel?: 1 | 2;
  stabilizePhoneCopy?: boolean;
  /** Optional control between the hero copy and the composer (e.g. Show all). */
  heroAction?: ReactNode;
  /**
   * Optional start list under everything else (Continue, Favourites, Browse).
   * It hangs below the home rather than joining its flow, so the centred hero
   * and composer keep exactly the place they have without it.
   */
  startList?: ReactNode;
};

const pillToneClass: Record<NonNullable<ModeHomePill["tone"]>, string> = {
  danger: "bg-[color:var(--danger)]",
  info: "bg-[color:var(--info)]",
  neutral: "bg-[color:var(--text-muted)]",
  primary: "bg-[color:var(--clinical-accent)]",
  purple: "bg-[color:var(--tone-purple)]",
  indigo: "bg-[color:var(--tone-indigo)]",
  rose: "bg-[color:var(--tone-rose)]",
  slate: "bg-[color:var(--tone-slate)]",
  success: "bg-[color:var(--success)]",
};

export function ModeHomeHero({
  testId,
  title,
  subtitle,
  icon: Icon,
  headingLevel = 1,
  stabilizePhoneCopy = false,
}: {
  testId?: string;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  headingLevel?: 1 | 2;
  stabilizePhoneCopy?: boolean;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";

  // Sizing is a single mobile-first system: the icon and gaps step up sm→lg,
  // and the display heading scales continuously via the fluid `text-hero` token
  // (globals.css) so it never jumps at a breakpoint. The compact-only mobile
  // tightening that short mode homes relied on is now the base treatment, so the
  // hero still fits a phone viewport without scrolling.
  return (
    <section
      className="grid justify-items-center gap-3 px-4 sm:px-0 lg:gap-4"
      aria-labelledby={`${testId ?? "mode-home"}-title`}
    >
      <span className="mode-home-icon grid size-hero-medallion place-items-center rounded-2xl border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]">
        {/* 1.75 rather than lucide's default 2: the medallion glyph is the
            largest on the surface, and a flat stroke width makes absolute
            weight swing with the box (2.33px at the old lg 28px against
            1.17px on a 14px glyph elsewhere in the header). */}
        <Icon className="size-icon-xl" strokeWidth={1.75} aria-hidden="true" />
      </span>
      {/* The phone copy reserve belongs to the pair, not to each half of it —
          see --mode-home-copy-reserve in globals.css. Reserved per element it
          collected its slack between the title and the subtitle. */}
      <div
        className={cn(
          "grid gap-1 sm:gap-1.5",
          stabilizePhoneCopy && "max-sm:min-h-[var(--mode-home-copy-reserve)] max-sm:content-center",
        )}
      >
        <Heading
          id={`${testId ?? "mode-home"}-title`}
          className="text-balance text-hero font-semibold leading-display tracking-normal text-[color:var(--text-heading)]"
        >
          {title}
        </Heading>
        {subtitle ? (
          <p
            className={cn(
              "mx-auto max-w-2xl text-pretty text-sm font-medium leading-5 text-[color:var(--text-muted)] sm:text-base-minus sm:leading-5 lg:text-base lg:leading-6",
              stabilizePhoneCopy && "max-sm:grid max-sm:min-h-[2lh] max-sm:place-items-center",
            )}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Vertical alignment for standalone mode-home shells.
 *
 * Introduced as always-`justify-center` flex in 39d14a51 (edge-to-edge mobile
 * shell). That works for short empty homes, but centering a child taller than
 * the phone scrollport clips the top — unreachable at scrollTop 0.
 *
 * Prefer this prop over className `justify-*` overrides: `cn()` used to
 * concatenate without resolving Tailwind conflicts, so dual justify utilities
 * were non-deterministic. Alignment classes are applied last and any stray
 * `justify-*` tokens in `className` are stripped.
 *
 * That constraint is lifted (ledger #218) — `cn()` now merges, and because the
 * alignment class is applied last it would win on its own, prefixed variants
 * (`sm:justify-*`) included. `withoutJustifyUtilities` is therefore belt-and-
 * braces rather than load-bearing. It is kept: dropping it changes which
 * utilities reach the DOM on every mode home, which wants its own visual proof,
 * and the prop remains the supported way to set this alignment either way.
 */
export type ModeHomeMainAlign = "center" | "start" | "startOnPhone";

const MODE_HOME_MAIN_ALIGN_CLASS: Record<ModeHomeMainAlign, string> = {
  // Short empty homes — centre in the visible canvas. `justify-center` alone
  // has no visible effect on phone: `<main>`'s immediate parent
  // (`mobile-composer-reserve-pad` in GlobalSearchShell) is a plain block
  // element, not a flex container, so `<main>`'s `flex-1` never fires there
  // and the box shrinks to its own content height instead of stretching to
  // fill the viewport — there is nothing to centre within. The sm+ rule
  // already carries an explicit `min-h` for the same reason, but its formula
  // (`100dvh - shell-header-h`) is NOT safe to reuse verbatim below sm: on
  // phone, `mobile-composer-reserve-pad` also adds real top/bottom padding
  // (`--phone-overlay-chrome-h`, `--mobile-composer-reserve`) that is zero at
  // sm+ but not on phone. Subtracting only the header there under-accounts
  // for that padding and pushes the document past the viewport (~40px
  // overflow, live-verified) — so both padding terms are subtracted here too.
  // `--mobile-composer-reserve` is a live CSS var, not a baked-in constant:
  // this composes correctly if its value ever changes for a route that
  // adopts `center`, at the cost of animating alongside it exactly as the
  // reserve pad's own padding does — that's the correct behaviour, not jank,
  // since the available space genuinely is changing too.
  center:
    "justify-center pt-[clamp(1.25rem,4vh,2.25rem)] sm:pt-[clamp(1.75rem,5vh,3.25rem)] max-sm:min-h-[calc(100dvh-var(--phone-overlay-chrome-h)-var(--mobile-composer-reserve))]",
  // Tall results / content — keep the top reachable on every breakpoint.
  start: "justify-start pt-3 sm:pt-4",
  // Content-rich homes that still fit after sm — top-align on phone only.
  startOnPhone: "justify-start pt-3 sm:justify-center sm:pt-[clamp(1.75rem,5vh,3.25rem)]",
};

/** Strip bare and prefixed justify utilities (`sm:justify-center`, `max-sm:justify-start`, …). */
function withoutJustifyUtilities(className?: string) {
  if (!className) return undefined;
  const cleaned = className
    .replace(/(?:^|\s)(?:[\w-]+:)*justify-(?:normal|start|end|center|between|around|evenly|stretch)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

/**
 * Standalone-route wrapper that mirrors the dashboard mode homes. The shell
 * reserves composer clearance via --mobile-composer-reserve on #main-content.
 */
export function ModeHomeMain({
  testId,
  children,
  className,
  contentAlign = "center",
}: {
  testId?: string;
  children: ReactNode;
  className?: string;
  contentAlign?: ModeHomeMainAlign;
}) {
  return (
    <main
      data-testid={testId}
      className={cn(
        "flex min-h-0 w-full flex-1 flex-col items-center bg-[color:var(--background)] px-0 pb-4 text-[color:var(--text)] sm:grow sm:px-6 sm:pb-[clamp(1.75rem,5vh,3.25rem)] lg:px-8",
        withoutJustifyUtilities(className),
        MODE_HOME_MAIN_ALIGN_CLASS[contentAlign],
      )}
    >
      {children}
    </main>
  );
}

// One quiet line of text. Deliberately no icon and no accent colour: a shield
// (and especially a ShieldCheck) reads as "verified", which this footer must not
// assert — validation status varies per document and is surfaced on the results
// themselves. Hierarchy comes from weight alone, so the label half (capability)
// carries the emphasis rather than the body half (caveat).
//
// Architectural decision (#MPZTBR): the scope line was permanently removed from
// all mode homes because every clinical surface already carries its own scope
// line, so the footer remains permanently off mode homes to avoid future
// re-introduction. The sole remaining call site is the therapy-compass page
// footer, which sits at the bottom of the sub-routes and is explicitly not
// rendered on the therapy home (`showFooter={!isHome}` in workspace.tsx).
export function ModeHomeVerificationFooter({ label, body }: { label: string; body: string }) {
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 pt-0.5 text-2xs leading-4 text-[color:var(--text-muted)] sm:pt-1">
      {/* The separator is bound to the label as one non-breaking flex item.
          As three independent items it could wrap alone: measured at 390px,
          five of the nine footers wrapped and every one stranded the dot on
          the line above the clause it joins. */}
      <span className="whitespace-nowrap font-medium text-[color:var(--text-heading)]">
        {label}{" "}
        <span className="font-normal text-[color:var(--text-muted)]" aria-hidden="true">
          ·
        </span>
      </span>
      <span>{body}</span>
    </p>
  );
}

export function ModeHomeStatusNotice({
  icon: Icon,
  title,
  body,
  actionHref,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  actionHref?: string;
  actionLabel?: string;
  /** Renders the action as a button (e.g. Retry) instead of a navigation link. */
  onAction?: () => void;
}) {
  const actionClass =
    "inline-flex min-h-tap items-center justify-center rounded-lg bg-[color:var(--command)] px-3 text-sm font-semibold text-[color:var(--command-contrast)] hover:bg-[color:var(--command-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";
  const action =
    onAction && actionLabel ? (
      <button type="button" onClick={onAction} className={actionClass}>
        {actionLabel}
      </button>
    ) : actionHref && actionLabel ? (
      <Link href={actionHref} className={actionClass}>
        {actionLabel}
      </Link>
    ) : undefined;

  return (
    <EmptyState
      icon={Icon}
      title={title}
      body={body}
      actions={action}
      tone="info"
      live="polite"
      testId="mode-home-status-notice"
    />
  );
}

export function ModeHomeTemplate({
  testId,
  title,
  subtitle,
  icon,
  actions,
  actionsLabel,
  desktopComposerSlotId,
  pillsTitle,
  pills,
  pillsAction,
  footer,
  className,
  headingLevel = 1,
  stabilizePhoneCopy = false,
  heroAction,
  startList,
}: ModeHomeTemplateProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "mode-home-template relative mx-auto box-border flex w-full max-w-none flex-col items-center justify-center gap-4 px-0 text-center sm:max-w-[60rem] sm:gap-5 lg:gap-6",
        className,
      )}
    >
      <ModeHomeHero
        testId={testId}
        title={title}
        subtitle={subtitle}
        icon={icon}
        headingLevel={headingLevel}
        stabilizePhoneCopy={stabilizePhoneCopy}
      />

      {heroAction}

      {/* Reserve settled composer height only while adoption is pending or the
          portal host is present. SSR starts pending so first paint does not CLS;
          MasterSearchHeader clears the attribute when the home media query does
          not match or portal adoption falls back, collapsing a never-filled band. */}
      {desktopComposerSlotId ? (
        <DesktopComposerPortalSlot
          id={desktopComposerSlotId}
          data-composer-reserve={modeHomeComposerReservePendingValue}
          className="mode-home-composer-slot block w-full px-4 sm:px-0 min-h-0 data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-phone)] sm:data-[composer-reserve=pending]:min-h-[var(--spacing-mode-home-composer-wide)] [&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-phone)] sm:[&:not(:empty)]:min-h-[var(--spacing-mode-home-composer-wide)]"
        />
      ) : null}

      {actions?.length ? (
        <section
          aria-label={actionsLabel}
          className="grid w-full max-w-none overflow-hidden rounded-none border-y border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--e2)] sm:max-w-none sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] sm:gap-3 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:shadow-none"
        >
          {actions.map((action, index) => {
            const ActionIcon = action.icon;
            const content = (
              <>
                <span className="grid h-10 w-10 place-items-center rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)] sm:h-tap sm:w-tap sm:rounded-xl">
                  <ActionIcon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-balance text-base-minus font-bold leading-5 text-[color:var(--text-heading)] [overflow-wrap:anywhere]">
                    {action.title}
                  </span>
                  <span className="mt-1 block text-xs font-medium leading-5 text-[color:var(--text-muted)] sm:text-sm-minus sm:leading-tight">
                    {action.description}
                  </span>
                </span>
                <ArrowRight
                  className="h-4 w-4 text-[color:var(--decoration-soft)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--clinical-accent)] motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                  aria-hidden="true"
                />
              </>
            );
            const actionClassName = cn(
              "mode-home-action group grid min-h-[4.4rem] w-full grid-cols-[2.5rem_minmax(0,1fr)_1.25rem] items-center gap-3 bg-[color:var(--surface)] px-4 py-3 text-left transition hover:bg-[color:var(--surface-subtle)] focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--focus)] disabled:cursor-wait disabled:opacity-60 sm:min-h-[4.4rem] sm:grid-cols-[2.5rem_minmax(0,1fr)_1.25rem] sm:rounded-lg sm:border sm:border-[color:var(--border)] sm:px-4 sm:py-3 sm:shadow-[var(--e2)] lg:min-h-[4.75rem] lg:grid-cols-[2.75rem_minmax(0,1fr)_1rem] lg:gap-3 lg:px-5 lg:py-3.5",
              // Phone stack separator only — the action grid becomes multi-column
              // at `sm`, where each action also becomes its own bordered card,
              // so do not keep a top edge that would double the card border.
              index > 0 && "max-sm:border-t max-sm:border-[color:var(--border)]",
            );

            if (action.href) {
              return (
                <Link key={action.title} href={action.href} data-testid={action.testId} className={actionClassName}>
                  {content}
                </Link>
              );
            }

            return (
              <button
                key={action.title}
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                data-testid={action.testId}
                className={actionClassName}
              >
                {content}
              </button>
            );
          })}
        </section>
      ) : null}

      {pills?.length ? (
        <section
          aria-label={pillsTitle ?? "Quick links"}
          className="grid w-full max-w-none self-stretch gap-2.5 border-t border-[color:var(--border)]/70 px-4 pt-5 sm:px-0 sm:pt-5"
        >
          {pillsTitle || pillsAction ? (
            <div className="flex min-h-8 w-full items-center justify-between gap-3">
              {pillsTitle ? <p className={cn(eyebrowText, "text-center sm:text-left")}>{pillsTitle}</p> : <span />}
              {pillsAction}
            </div>
          ) : null}
          <div className="answer-suggestion-row-scroll -mx-4 flex w-[calc(100%+2rem)] justify-start gap-2 overflow-x-auto px-4 pb-1 [-webkit-overflow-scrolling:touch] sm:mx-0 sm:w-full sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0 sm:pb-0">
            {pills.map((pill) => {
              const PillIcon = pill.icon;
              const displayLabel = pill.shortLabel ?? pill.label;
              const content = (
                <>
                  {PillIcon ? (
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                      <PillIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  ) : (
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", pillToneClass[pill.tone ?? "neutral"])} />
                  )}
                  <span className="text-balance text-center">{displayLabel}</span>
                </>
              );
              // DS-P2-24: catalogue chrome, not a primary CTA — compact-meta from lg.
              const pillClassName =
                "inline-flex min-h-tap shrink-0 items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs font-semibold text-[color:var(--text)] shadow-[var(--shadow-inset)] transition hover:border-[color:var(--clinical-accent)]/35 hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:text-sm lg:min-h-compact-meta";
              const pillA11y = pill.shortLabel ? { "aria-label": pill.label, title: pill.label } : {};
              return pill.href ? (
                <Link key={pill.label} href={pill.href} className={pillClassName} {...pillA11y}>
                  {content}
                </Link>
              ) : pill.onClick ? (
                <button key={pill.label} type="button" onClick={pill.onClick} className={pillClassName} {...pillA11y}>
                  {content}
                </button>
              ) : (
                <span key={pill.label} className={pillClassName} {...pillA11y}>
                  {content}
                </span>
              );
            })}
          </div>
        </section>
      ) : null}

      {footer ? <div className="w-full px-4 sm:px-0">{footer}</div> : null}

      {/* Out of flow on purpose: the home is centred in its canvas, so a list
          in the flow would lift the composer by half its height. Hanging from
          the home's bottom edge, it extends the page's scroll instead. */}
      {startList ? (
        <div className="mode-home-start absolute inset-x-0 top-full px-4 pt-6 pb-8 sm:px-0 sm:pt-8 [&:not(:has(a))]:hidden">
          {startList}
        </div>
      ) : null}
    </div>
  );
}
