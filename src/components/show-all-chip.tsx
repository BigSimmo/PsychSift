import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { MouseEventHandler } from "react";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";

/**
 * Soft-fill well chip used under a mode-home hero (Tools, Calculators).
 *
 * Visual face is 36px (`h-9` row face). Its corners are the Clinical control
 * rung (`rounded-lg`, the same as `controlBase`), not a pill: every caller is a
 * Clinical page, and rounded pills are a Work-mode shape only (owner decision,
 * 15 Oct 2026). The icon well inside steps down one rung to `rounded-md`. The hit target stays `min-h-tap`
 * (48px) on phones and may tighten to `lg:min-h-compact-meta` (40px) on
 * desktop — catalogue disclosure chrome, not a primary CTA. Never `min-h-11`
 * and never `--row-compact` (36px) as the tap.
 */
export function ShowAllChip({
  href,
  icon: Icon,
  label = "Show all",
  ariaLabel,
  testId,
  onClick,
}: {
  href: string;
  icon: LucideIcon;
  label?: string;
  ariaLabel: string;
  testId: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
  return (
    <div className="flex justify-center">
      <Link
        href={href}
        aria-label={ariaLabel}
        data-testid={testId}
        onClick={onClick}
        className={cn(
          "group inline-flex min-h-tap items-center justify-center text-[color:var(--clinical-accent-strong)] lg:min-h-compact-meta",
          focusRing,
        )}
      >
        <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:color-mix(in_srgb,var(--clinical-accent)_14%,var(--surface))] pl-1 pr-3 text-xs font-semibold tracking-[var(--tracking-display)] transition group-hover:bg-[color:color-mix(in_srgb,var(--clinical-accent)_20%,var(--surface))] sm:text-sm">
          <span
            data-testid={`${testId}-well`}
            className="grid size-7 shrink-0 place-items-center rounded-md border border-[color:var(--clinical-accent-border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)]"
          >
            <Icon className="size-icon-sm" strokeWidth={1.75} aria-hidden="true" />
          </span>
          {label}
        </span>
      </Link>
    </div>
  );
}
