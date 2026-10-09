import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { onCallActionLink } from "@/components/on-call/kit/calm";
import { modeInsetHairline, modeModuleSurface, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { cn, eyebrowText } from "@/components/ui-primitives";

/** An action at the right of a group's eyebrow: "All roles", "Edit", "Show all". */
export type OnCallGroupAction =
  | { readonly label: string; readonly href: string; readonly testId?: string; readonly ariaLabel?: string }
  | { readonly label: string; readonly onClick: () => void; readonly testId?: string; readonly ariaLabel?: string };

export function OnCallGroupActionControl({ action }: { readonly action: OnCallGroupAction }) {
  return "href" in action ? (
    <Link
      href={action.href}
      aria-label={action.ariaLabel}
      data-testid={action.testId}
      className={cn(onCallActionLink, focusRing)}
    >
      {action.label}
    </Link>
  ) : (
    <button
      type="button"
      onClick={action.onClick}
      aria-label={action.ariaLabel}
      data-testid={action.testId}
      className={cn(onCallActionLink, focusRing)}
    >
      {action.label}
    </button>
  );
}

/**
 * On Call's grouped list (mock-up v10): an uppercase eyebrow, a count after it
 * ("EMERGENCY · 2"), an optional note or action at its right, and the rows
 * in one white hairline card with inset hairlines. `surface="card"` keeps the raised
 * card, for the one module per screen that should stand apart (the emergency
 * route).
 *
 * `headerIcon` is still accepted so callers need not change, but the calm look
 * draws no icon tile beside an eyebrow.
 */
export function OnCallGroupedList({
  eyebrow,
  count,
  note,
  action,
  actionNode,
  surface = "flat",
  id,
  testId,
  className,
  children,
}: {
  readonly eyebrow?: string;
  readonly count?: string | number;
  /** Quiet text at the eyebrow's right ("Cover as of 21:40"). */
  readonly note?: ReactNode;
  readonly action?: OnCallGroupAction;
  /** A ready-made action, for a literal `<Link href>` the route-reachability guard can read. */
  readonly actionNode?: ReactNode;
  readonly headerIcon?: LucideIcon;
  readonly surface?: "flat" | "card";
  readonly id?: string;
  readonly testId?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={eyebrow ? headingId : undefined}
      className={cn("grid min-w-0 gap-1 scroll-mt-32", className)}
      data-testid={testId}
    >
      {eyebrow ? (
        <div className="flex min-h-12 min-w-0 flex-wrap items-center justify-between gap-x-3 px-1">
          <h2 id={headingId} className={eyebrowText}>
            {eyebrow}
            {count !== undefined ? <span className="nums">{` · ${count}`}</span> : null}
          </h2>
          {note ? <span className={cn(modeSecondaryText, "text-xs")}>{note}</span> : null}
          {action ? <OnCallGroupActionControl action={action} /> : null}
          {actionNode}
        </div>
      ) : null}
      {/* Both surfaces are one white hairline card in work mode (work-mode
          redesign, owner request 6 Oct 2026): "flat" is the kit's flat card
          (`work-card`, no lift), "card" keeps the module surface for the one
          module that should stand apart (the emergency route). */}
      <ul role="list" className={surface === "card" ? modeModuleSurface : "work-card min-w-0"}>
        {children}
      </ul>
    </section>
  );
}

/**
 * One row (48px on one line, 52px on two). A leading badge or glyph sits
 * before the text, as the mock-up draws it. With `href` the text is a link
 * ending in a chevron; a `trailing` control is always its sibling, never inside
 * it.
 */
export function OnCallRow({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  href,
  testId,
  className,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly meta?: ReactNode;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly href?: string;
  readonly testId?: string;
  readonly className?: string;
}) {
  const twoLine = Boolean(subtitle) || Boolean(meta);
  const height = twoLine ? modeRowHeight.double : modeRowHeight.single;
  const text = (
    <span className="grid min-w-0 flex-1 basis-40 gap-0.5 py-1">
      <span className={cn(modeNameText, "break-words text-base-minus leading-5 text-[color:var(--text-heading)]")}>
        {title}
      </span>
      {subtitle ? <span className={cn(modeSecondaryText, "break-words leading-5")}>{subtitle}</span> : null}
      {meta}
    </span>
  );
  const lead = leading ? (
    <span aria-hidden="true" className="flex w-9 shrink-0 items-center justify-center">
      {leading}
    </span>
  ) : null;
  const trailingSlot = trailing ? <span className="ml-auto flex shrink-0 items-center gap-1">{trailing}</span> : null;
  if (href) {
    return (
      <li className={cn(modeInsetHairline, "flex min-w-0 items-center pr-1", className)}>
        <Link
          href={href}
          data-testid={testId}
          className={cn(
            height,
            modePressable,
            focusRing,
            "flex min-w-0 flex-1 items-center gap-x-3 pl-3 no-underline",
            trailing ? "pr-1" : "pr-2",
          )}
        >
          {lead}
          {text}
          {trailing ? null : (
            <ChevronRight aria-hidden="true" className="ml-auto size-icon-md shrink-0 text-[color:var(--text-muted)]" />
          )}
        </Link>
        {trailingSlot}
      </li>
    );
  }
  return (
    <li
      className={cn(modeInsetHairline, height, "flex min-w-0 items-center gap-x-3 pl-3 pr-1", className)}
      data-testid={testId}
    >
      {lead}
      {text}
      {trailingSlot}
    </li>
  );
}
