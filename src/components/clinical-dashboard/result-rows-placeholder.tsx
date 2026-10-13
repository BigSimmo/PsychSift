import { Skeleton, cn } from "@/components/ui-primitives";

/**
 * Placeholder rows shaped like the result cards they stand in for.
 *
 * A results page used to show a spinner or one muted sentence ("Loading medication
 * catalogue…") over an otherwise empty page until the first response landed, and then
 * snap to a full list. These rows hold the list's real geometry instead, an icon tile
 * beside a title, a subtitle and a short detail line, so the page reads as "results
 * arriving" and nothing below it jumps when they do.
 *
 * Accessibility follows `LoadingPanel`'s skeleton variant (COMPONENTS.md §9.29): one
 * `role="status"` node named by `label`, an `sr-only` twin of the label, every shimmer
 * bar `aria-hidden`, and no `aria-live` on visible content (§9.2). Callers do not mark a
 * parent `aria-busy`: that would hold back this status until the rows had gone.
 */
// The inset tone, not Skeleton's default subtle one: on a raised card the subtle tone is
// nearly the card's own colour in light mode, so the rows read as empty boxes.
const bar = "bg-[color:var(--surface-inset)]";

export function ResultRowsPlaceholder({
  label,
  rows = 4,
  className,
  testId,
}: {
  label: string;
  rows?: number;
  className?: string;
  testId?: string;
}) {
  return (
    <div role="status" aria-label={label} data-testid={testId} className={cn("grid gap-2", className)}>
      {Array.from({ length: rows }).map((_, index) => {
        const delay = `${index * 60}ms`;
        return (
          <div
            key={index}
            aria-hidden
            className="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-2.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-2 shadow-[var(--shadow-inset)]"
          >
            <Skeleton className={cn("size-9 rounded-lg", bar)} animationDelay={delay} />
            <div className="grid min-w-0 gap-2 py-0.5">
              <Skeleton className={cn("h-4", bar, index % 2 === 0 ? "w-1/2" : "w-2/5")} animationDelay={delay} />
              <Skeleton className={cn("h-3 w-4/5", bar)} animationDelay={delay} />
              <Skeleton className={cn("h-3", bar, index % 2 === 0 ? "w-3/5" : "w-2/3")} animationDelay={delay} />
            </div>
          </div>
        );
      })}
      <span className="sr-only">{label}</span>
    </div>
  );
}
