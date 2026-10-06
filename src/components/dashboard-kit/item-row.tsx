import type { ReactNode } from "react";

import { dashMuted } from "@/components/dashboard-kit/recipes";
import { cn } from "@/components/ui-primitives";

/**
 * The compact two-line row: an icon chip, a title over one short line, and
 * the row's actions (pills) on the right. `subtitleTone="passed"` is for a
 * date that has genuinely passed and nothing else.
 */
export function DashItemRow({
  chip,
  title,
  subtitle,
  subtitleTone = "muted",
  actions,
  testId,
}: {
  readonly chip?: ReactNode;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly subtitleTone?: "muted" | "passed";
  readonly actions?: ReactNode;
  readonly testId?: string;
}) {
  return (
    <li
      data-testid={testId}
      className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-[color:var(--dash-line)] px-3 py-1 first:border-t-0"
    >
      {chip ?? <span aria-hidden="true" />}
      <span className="grid min-w-0 gap-0.5 py-1.5">
        <span className="break-words font-dash-title text-base-minus leading-tight text-[color:var(--dash-ink)]">
          {title}
        </span>
        {subtitle ? (
          <span
            className={cn(
              "break-words",
              subtitleTone === "passed" ? "font-dash-title text-xs text-[color:var(--dash-amber)]" : dashMuted,
            )}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
      {actions ? <span className="flex shrink-0 items-center gap-1">{actions}</span> : null}
    </li>
  );
}

/** The white inset list that holds item rows. */
export function DashItemList({ children, testId }: { readonly children: ReactNode; readonly testId?: string }) {
  return (
    <ul
      role="list"
      data-testid={testId}
      className="grid min-w-0 rounded-2xl border border-[color:var(--dash-line)] bg-[color:var(--dash-raised)] forced-colors:border"
    >
      {children}
    </ul>
  );
}
