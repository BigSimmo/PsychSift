"use client";

import { X } from "lucide-react";
import { useId, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { dashCard, dashEyebrow } from "@/components/dashboard-kit/recipes";
import { cn } from "@/components/ui-primitives";

export type DashCardTone = "default" | "hero" | "flag";

const TONE: Readonly<Record<DashCardTone, string>> = {
  default: "",
  hero: "dash-hero gap-3 border-0 p-4 shadow-[var(--dash-shadow)] forced-colors:border",
  flag: "gap-1.5 border-[color:var(--dash-green-line)] bg-[color:var(--dash-flag)] px-3 py-2.5",
};

/**
 * One dashboard card: a heading row (eyebrow and an optional aside such as
 * "All 11" or a Week/Month switch) over its body. With `onHide` (edit mode)
 * the card is outlined and carries a Hide button; the button keeps a 48px
 * tap area round its small visible face.
 *
 * `title` is always the card's accessible name. `showTitle={false}` keeps it
 * for screen readers only (the hero and the flag, whose first line says it).
 */
export function DashCard({
  title,
  showTitle = true,
  aside,
  tone = "default",
  onHide,
  className,
  testId,
  children,
}: {
  readonly title: string;
  readonly showTitle?: boolean;
  readonly aside?: ReactNode;
  readonly tone?: DashCardTone;
  readonly onHide?: () => void;
  readonly className?: string;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  const editing = onHide !== undefined;
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      data-tone={tone}
      className={cn(
        dashCard,
        TONE[tone],
        editing && "outline-2 -outline-offset-2 outline-dashed outline-[color:var(--dash-line-strong)]",
        className,
      )}
    >
      {showTitle || aside ? (
        <div className="flex min-h-6 min-w-0 items-center justify-between gap-2">
          <h2 id={headingId} className={cn(dashEyebrow, !showTitle && "sr-only")}>
            {title}
          </h2>
          {aside ? <div className={cn("flex shrink-0 items-center gap-1", editing && "mr-8")}>{aside}</div> : null}
        </div>
      ) : (
        <h2 id={headingId} className="sr-only">
          {title}
        </h2>
      )}
      {children}
      {editing ? (
        <button
          type="button"
          onClick={onHide}
          aria-label={`Hide ${title}`}
          data-testid={testId ? `${testId}-hide` : undefined}
          className={cn(focusRing, "absolute -top-2 -right-2 grid size-12 place-items-center rounded-full")}
        >
          <span
            aria-hidden="true"
            className={cn(
              "grid size-6 place-items-center rounded-full forced-colors:border",
              tone === "hero"
                ? "bg-[color:var(--dash-hero-ink)] text-[color:var(--dash-hero-3)]"
                : "bg-[color:var(--dash-ink)] text-[color:var(--dash-page)]",
            )}
          >
            <X aria-hidden="true" className="size-icon-xs" />
          </span>
        </button>
      ) : null}
    </section>
  );
}
