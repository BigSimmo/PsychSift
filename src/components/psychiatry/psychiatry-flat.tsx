import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";

/**
 * The flat list parts the Psychiatry pages are drawn with (approved mock-up v3, 5 October 2026,
 * in the calmer Work search style): a small-capitals section label, one hairline list per group,
 * grey icons with no coloured tiles, and at most one filled button per screen.
 *
 * Colours are the dashboard tokens, so these parts belong inside `.dash-surface`.
 */

/** The white, hairline-bordered panel a list or a block of text sits in. */
export const flatPanel =
  "min-w-0 overflow-hidden rounded-xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] forced-colors:border";

/** A panel holding text rather than rows. */
export const flatPanelPadded = cn(flatPanel, "grid gap-2 px-3.5 py-3");

/** The one filled button a screen may have. */
export const flatButton = cn(
  focusRing,
  "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg bg-[color:var(--dash-ink)] px-4 text-sm font-semibold text-[color:var(--dash-page)] forced-colors:border",
);

/** The outlined button for a second action on a screen that already has a filled one. */
export const flatSecondaryButton = cn(
  focusRing,
  "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-lg border border-[color:var(--dash-line-strong)] bg-[color:var(--dash-raised)] px-4 text-sm font-semibold text-[color:var(--dash-ink)] forced-colors:border",
);

/** A plain bold link ("Open", "All forms", "Try again"), with a 48px tap area. */
export const flatLink = cn(
  focusRing,
  "inline-flex min-h-12 items-center gap-1 rounded-md text-sm font-semibold text-[color:var(--dash-ink)] no-underline hover:underline",
);

/** Small hairline tag ("On this phone", "New"). */
export function FlatTag({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) {
  return (
    <span
      data-testid={testId}
      className="whitespace-nowrap rounded-md border border-[color:var(--dash-line-strong)] px-1.5 text-2xs font-medium normal-case leading-5 tracking-normal text-[color:var(--dash-muted)] forced-colors:border"
    >
      {children}
    </span>
  );
}

/** The section heading: small capitals on the left, a link, tag or count on the right. */
export function FlatLabel({
  id,
  title,
  aside,
  as: Heading = "h2",
}: {
  readonly id?: string;
  readonly title: ReactNode;
  readonly aside?: ReactNode;
  readonly as?: "h2" | "h3";
}) {
  return (
    <div className="mt-2 flex min-h-6 flex-wrap items-center justify-between gap-2">
      <Heading id={id} className="text-2xs font-semibold uppercase tracking-widest text-[color:var(--dash-muted)]">
        {title}
      </Heading>
      {aside ? <span className="flex min-w-0 items-center gap-2">{aside}</span> : null}
    </div>
  );
}

/** A count beside a section label ("9"). */
export function FlatCount({ children }: { readonly children: ReactNode }) {
  return <span className="nums text-xs text-[color:var(--dash-muted)]">{children}</span>;
}

export function FlatList({
  label,
  children,
  testId,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <ul role="list" aria-label={label} data-testid={testId} className={cn(flatPanel, "grid")}>
      {children}
    </ul>
  );
}

const rowShell =
  "grid min-h-13 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2 text-[color:var(--dash-ink)] no-underline";

/** One list row: grey icon, title over one short line, and a chevron or a right-hand action. */
export function FlatRow({
  href,
  icon: RowIcon,
  title,
  subtitle,
  end,
  testId,
  ariaLabel,
  muted = false,
  renderLink,
}: {
  readonly href?: string;
  /**
   * Draws the row's own link instead of `href`, for a destination the route-reachability check must
   * see as a literal `<Link href>` (a page reached only from here).
   */
  readonly renderLink?: (className: string, body: ReactNode) => ReactNode;
  readonly icon?: LucideIcon | null;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  /** Replaces the chevron, e.g. "Open". */
  readonly end?: ReactNode;
  readonly testId?: string;
  readonly ariaLabel?: string;
  readonly muted?: boolean;
}) {
  const body = (
    <>
      {RowIcon ? (
        <RowIcon aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--dash-faint)]" />
      ) : (
        <span aria-hidden="true" />
      )}
      <span className="grid min-w-0 gap-px">
        <span
          className={cn(
            "break-words text-sm font-medium leading-snug",
            muted ? "text-[color:var(--dash-muted)]" : "text-[color:var(--dash-ink)]",
          )}
        >
          {title}
        </span>
        {subtitle ? <span className="break-words text-xs text-[color:var(--dash-muted)]">{subtitle}</span> : null}
      </span>
      {end ??
        (href || renderLink ? (
          <ChevronRight aria-hidden="true" className="size-icon-sm text-[color:var(--dash-faint)]" />
        ) : (
          <span />
        ))}
    </>
  );
  return (
    <li className="border-t border-[color:var(--dash-line)] first:border-t-0" data-testid={href ? undefined : testId}>
      {renderLink ? (
        renderLink(cn(focusRing, "focus-ring-contained", rowShell, "rounded-xl"), body)
      ) : href ? (
        <Link
          href={href}
          data-testid={testId}
          aria-label={ariaLabel}
          className={cn(focusRing, "focus-ring-contained", rowShell, "rounded-xl")}
        >
          {body}
        </Link>
      ) : (
        <div className={rowShell}>{body}</div>
      )}
    </li>
  );
}
