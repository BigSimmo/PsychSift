/*
 * Deliberately NOT "use client". `PageHeader` and `Breadcrumb` hold no state,
 * no effects and no event handlers — the directive was inert until adoption,
 * and then it was actively harmful: both of this module's importers
 * (`information-page-shell.tsx`, `dsm-page-header.tsx`) are server components
 * that now pass a `LucideIcon` as `icon`, and a component is a function, so
 * every record page crashed with "Functions cannot be passed directly to
 * Client Components". Rendering `<ArrowLeft />` at the call site used to hide
 * that, because an element serialises where a component does not.
 *
 * Keep it server-side. If this ever needs interactivity, the boundary belongs
 * around the interactive part, not around the page title.
 */

import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ContextualBackLink } from "@/components/contextual-back-link";
import { cn, iconTilePremium } from "@/components/ui-primitives";

export type Crumb = {
  label: string;
  /** Omit on the final crumb — the current page is not a link to itself. */
  href?: string;
  /** History-aware page back; `href` remains the deep-link fallback. */
  behavior?: "link" | "history-back";
  /**
   * Leading glyph. Exists so the first crumb can keep the back-arrow that the
   * information pages already use to get a history-less deep link home; that
   * affordance is the reason those pages had their own breadcrumb at all.
   */
  icon?: LucideIcon;
};

export type BreadcrumbProps = {
  items: Crumb[];
  className?: string;
};

/**
 * Internal navigation goes through `<Link>`, never a raw `<a href="/…">`
 * (docs/wiring-conventions.md). The trailing crumb is plain text carrying
 * `aria-current="page"`.
 *
 * A crumb is a link whenever it has an `href` — the `href`, not the position, is
 * what decides. That is the semantic the information pages already ship, where
 * the trailing crumb is the only one without one; deciding on position instead
 * would silently turn a linked final crumb into dead text.
 *
 * Crumb links are `min-h-tap` because on a phone this row is the way back out of
 * a record, and a text-height hit area is not a target.
 */
export function Breadcrumb({ items, className }: BreadcrumbProps) {
  if (!items.length) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          const Icon = item.icon;
          return (
            <li key={`${item.label}:${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <ChevronRight
                  aria-hidden="true"
                  className="size-icon-xs shrink-0 text-[color:var(--decoration-soft)]"
                />
              ) : null}
              {item.href && item.behavior === "history-back" ? (
                <ContextualBackLink
                  fallbackHref={item.href}
                  className="inline-flex min-h-tap min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[color:var(--text-muted)] transition hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                >
                  {Icon ? <Icon aria-hidden="true" className="size-icon-sm shrink-0" /> : null}
                  <span className="truncate" title={item.label}>
                    {item.label}
                  </span>
                </ContextualBackLink>
              ) : item.href ? (
                <Link
                  href={item.href}
                  className="inline-flex min-h-tap min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[color:var(--text-muted)] transition hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                >
                  {Icon ? <Icon aria-hidden="true" className="size-icon-sm shrink-0" /> : null}
                  <span className="truncate" title={item.label}>
                    {item.label}
                  </span>
                </Link>
              ) : (
                <>
                  {Icon ? <Icon aria-hidden="true" className="size-icon-sm shrink-0" /> : null}
                  {/* The label is this element's own text, not a nested span:
                      `aria-current` has to sit on the node the reader lands on.
                      `title` gives the truncated current crumb (SPEC.md §11's
                      "no other full-name path" case) a recovery path. */}
                  <span
                    aria-current={last ? "page" : undefined}
                    className="truncate px-1.5 font-semibold text-[color:var(--text)]"
                    title={item.label}
                  >
                    {item.label}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/*
 * One heading voice for every page title block. Exported so the few pages that
 * hand-roll their own header (they own layout the shared component cannot)
 * can borrow the same type instead of drifting: eyebrow 11px muted caps, title
 * 24px (26px from sm) bold with tight tracking, description 14px muted capped
 * at a comfortable line length. Spacing is 6px between each tier.
 */
export const pageHeadingEyebrowClass =
  "text-2xs font-semibold uppercase leading-4 tracking-eyebrow text-[color:var(--text-muted)]";
export const pageHeadingTitleClass =
  "text-balance text-2xl font-bold leading-tight tracking-display text-[color:var(--text-heading)] sm:text-3xl-minus";
export const pageHeadingDescriptionClass =
  "max-w-[60ch] text-pretty text-sm font-normal leading-6 text-[color:var(--text-muted)]";

export type PageHeaderProps = {
  title: string;
  /** Short kicker above the title — section, mode, or record kind. */
  eyebrow?: string;
  description?: ReactNode;
  icon?: LucideIcon;
  breadcrumb?: Crumb[];
  /** Primary/secondary controls. One filled `--command` button, at most. */
  actions?: ReactNode;
  /** Status chips, counts, or provenance shown under the description. */
  meta?: ReactNode;
  /**
   * Chips that belong on the title line itself — urgency, source state, a count.
   *
   * `meta` puts its row BELOW the whole title block, which on a wide screen
   * spends a full row on a single "Urgent" chip while the space beside the
   * heading sits empty. `inlineMeta` sits next to the `<h1>` and wraps under it
   * on a phone, so the chip travels with the title it qualifies.
   *
   * Kept separate rather than moving `meta`: the existing callers' provenance
   * rows are several chips long and belong under the description, not beside a
   * heading they would push into a second line.
   */
  inlineMeta?: ReactNode;
  className?: string;
};

/**
 * Page-level counterpart to `PanelHeading`: `PanelHeading` titles a panel inside a
 * page, `PageHeader` titles the page itself and owns the `<h1>`. A page should
 * carry exactly one.
 *
 * Two COMPONENTS §9.16 defects close here, and they are the same defect twice.
 * The `<h1>` truncated, and the actions row was `shrink-0` beside a title that
 * could shrink — so a long diagnosis name lost its ending to an ellipsis while a
 * pair of buttons kept their full width. A page title is the answer to "where am
 * I", so it wraps; the title column is `minmax(0, 1fr)` and the actions wrap onto
 * their own row rather than eating into it.
 *
 * The title takes one shared scale (24px, 26px from sm, bold) so every page
 * heading reads the same; see the exported `pageHeading*Class` strings.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  icon: Icon,
  breadcrumb,
  actions,
  meta,
  inlineMeta,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("min-w-0 space-y-3", className)}>
      {breadcrumb?.length ? <Breadcrumb items={breadcrumb} /> : null}
      {/* The title column has a floor and the actions column does not.
          `[minmax(0,1fr)_auto]` gave the actions track its full max-content
          width first and let the title track collapse toward 0, so a long
          clinical title next to three buttons was still starved — the wrap
          fixed WHERE the actions sat, not how much width they took. With
          `minmax(20ch,1fr)` the title keeps a readable measure and the actions
          track (`minmax(0,auto)`, contents already `flex-wrap min-w-0`) is the
          one that gives way and wraps. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 sm:grid-cols-[minmax(20ch,1fr)_minmax(0,auto)]">
        <div className="flex min-w-0 items-start gap-3">
          {/* Hidden on phones, as the hand-rolled record headers already had it
              (`sm:grid` on the DSM tile before adoption). The tile is decorative
              — the icon is `aria-hidden` and the title carries the meaning — and
              on a 390px screen it spends width a wrapping clinical title needs.
              Restored here rather than via a per-caller escape hatch so every
              page header keeps one treatment.

              `max-sm:hidden`, not `hidden sm:grid`: `iconTilePremium` already
              carries `grid`, and `cn()` used to be a plain join with no
              tailwind-merge (ledger #218), so `hidden` + `sm:grid` + `grid`
              left three display utilities to be resolved by stylesheet order
              rather than by intent. One base display plus one max-width
              override had nothing to race.

              That constraint is lifted — `cn()` now merges, and `grid hidden
              sm:grid` resolves to `hidden sm:grid`. This site keeps
              `max-sm:hidden` anyway: swapping it back is a change to which
              display utility renders, so it belongs in a change whose Chromium
              job is being read, not in the dependency PR. */}
          {Icon ? (
            <span className={cn(iconTilePremium, "max-sm:hidden")}>
              <Icon aria-hidden="true" className="size-icon-lg" />
            </span>
          ) : null}
          <div className="min-w-0">
            {eyebrow ? <p className={pageHeadingEyebrowClass}>{eyebrow}</p> : null}
            {/* `items-baseline` would drop a bordered chip below the cap line of a
                28px heading; `items-center` keeps the chip optically centred on
                the title's first line, and `flex-wrap` sends it under the title
                on a narrow screen rather than squeezing the heading. */}
            <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", eyebrow && "mt-1.5")}>
              <h1 className={pageHeadingTitleClass}>{title}</h1>
              {inlineMeta}
            </div>
            {description ? <p className={cn("mt-1.5", pageHeadingDescriptionClass)}>{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
    </header>
  );
}
