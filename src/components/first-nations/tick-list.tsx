// Tick list: controlled; the parent owns the ticks, which live in component state only.
import { useId } from "react";
import { ModeUpdatedLine } from "@/components/first-nations/kit";
import { ReviewStamp } from "@/components/first-nations/review-stamp";
import type { StepView } from "@/lib/first-nations/view-model";

export function TickList({
  steps,
  ticked,
  onToggle,
}: {
  steps: readonly StepView[];
  ticked: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  // The same step can sit in two lists on one page (the side panel and a sheet), so ids are per list.
  const listId = useId();
  return (
    <ol className="grid rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)]">
      {steps.map((step, i) => {
        const detailId = `${listId}-${step.id}-detail`;
        return (
          <li key={step.id} className="border-t border-[color:var(--border)] first:border-t-0">
            <label className="grid min-h-[3.25rem] cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 px-3 pb-1 pt-2.5">
              <input
                type="checkbox"
                checked={ticked.has(step.id)}
                onChange={() => onToggle(step.id)}
                className="row-span-2 mt-0.5 size-5 accent-[color:var(--clinical-accent)]"
                aria-describedby={step.detail ? detailId : undefined}
              />
              <span className="text-sm-minus font-medium text-[color:var(--text-heading)]">
                <span className="nums mr-1 text-[color:var(--text-muted)]">{i + 1}</span>
                {step.title}
              </span>
              {step.detail ? (
                <span id={detailId} className="text-sm-minus text-[color:var(--text-muted)]">
                  {step.detail}
                </span>
              ) : null}
            </label>
            {/* Provenance sits outside the label so opening the source never ticks the step. */}
            <div className="px-3 pb-2.5 pl-11">
              <ModeUpdatedLine
                updatedAt={step.checkedAt}
                verb="Checked"
                sources={[{ label: step.source.title, url: step.source.url }]}
              />
              <ReviewStamp stamp={step.review} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function toggleIn(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
