import type { EmptyStateProps } from "@/components/primitive-recipes/feedback";
import { cn } from "@/components/ui-primitives";

/**
 * On Call's empty, signed-out and failed states as the work-mode empty card
 * (work-mode redesign, owner request 6 Oct 2026): one flat white hairline
 * card, a flat tint badge, the title, one sentence and the actions, centred.
 *
 * It takes the shared `EmptyState`'s props unchanged, so every On Call page
 * swaps the import and keeps its words, heading level, live region, tone and
 * test id exactly as they were. Only the look changes: no dashed border, no
 * inset shadow. `align` and `centeredTreatment` are accepted and ignored,
 * because the work-mode card is always centred.
 */
export function OnCallEmptyState({
  icon: Icon,
  iconNode,
  title,
  headingLevel,
  body,
  description,
  actions,
  live = "off",
  tone = "neutral",
  testId,
}: EmptyStateProps) {
  const Title = headingLevel ? (`h${headingLevel}` as "h2" | "h3" | "h4" | "h5" | "h6") : "p";
  const copy = body ?? description;
  return (
    <div
      data-testid={testId}
      role={live === "assertive" ? "alert" : live === "polite" ? "status" : undefined}
      className="work-card work-empty min-w-0"
    >
      {Icon || iconNode ? (
        <span
          aria-hidden="true"
          className={cn(
            "work-empty__badge",
            tone === "danger" && "bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
            tone === "info" && "bg-[color:var(--info-soft)] text-[color:var(--info)]",
          )}
        >
          {Icon ? <Icon aria-hidden="true" strokeWidth={2} /> : iconNode}
        </span>
      ) : null}
      <Title className="work-empty__title break-words text-[color:var(--text-heading)]">{title}</Title>
      {copy ? <p className="work-empty__body break-words">{copy}</p> : null}
      {actions ? <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
