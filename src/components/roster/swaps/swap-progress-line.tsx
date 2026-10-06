import { Check } from "lucide-react";

import { cn } from "@/components/ui-primitives";
import { formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { SwapStep } from "@/lib/roster/team/swap-progress";

const STATE_WORDS: Record<SwapStep["state"], string> = { done: "done", current: "now", todo: "still to come" };

function waitingWords(waitingOn: string) {
  if (waitingOn === "You") return "waiting on you";
  if (waitingOn === "Your manager") return "waiting for your manager";
  return `waiting on ${waitingOn}`;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Where a swap has got to: one plain line ("Sam said yes · now waiting for
 * your manager"), then the steps in small type. The current step is marked
 * `aria-current="step"` and every step says its state in words, so nothing
 * depends on colour. A swap that has ended shows how it ended instead.
 * Built from spans so it can sit inside a list row's second line.
 */
export function SwapProgressLine({
  steps,
  waitingOn,
  ended,
  expiresAt,
  agreedBy,
}: {
  steps: readonly SwapStep[];
  waitingOn: string | null;
  ended: string | null;
  /** When a swap still waiting for an answer runs out, if the read carries it. */
  expiresAt?: string | null;
  /** Who has already said yes, for a swap now waiting on the manager. */
  agreedBy?: string | null;
}) {
  const summary = ended
    ? ended
    : waitingOn
      ? agreedBy
        ? `${agreedBy} said yes · now ${waitingWords(waitingOn)}`
        : `${capital(waitingWords(waitingOn))}${expiresAt ? `, expires ${formatPerthDay(perthDateOf(expiresAt))}` : ""}`
      : null;
  return (
    <span className="grid gap-0.5">
      {summary ? <span className={ended ? "font-medium" : undefined}>{summary}</span> : null}
      <span role="list" aria-label="Swap progress" className="flex flex-wrap gap-x-2.5 text-xs">
        {steps.map((step) => (
          <span
            role="listitem"
            key={step.label}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-1",
              step.state === "current" && "font-semibold text-[color:var(--text-heading)]",
              step.state === "done" && "text-[color:var(--text)]",
              step.state === "todo" && "text-[color:var(--text-muted)]",
            )}
          >
            {step.state === "done" ? (
              <Check aria-hidden="true" strokeWidth={1.6} className="size-icon-sm shrink-0" />
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 shrink-0 rounded-full border border-current",
                  step.state === "current" && "bg-current",
                )}
              />
            )}
            <span>{step.label}</span>
            <span className="sr-only"> ({STATE_WORDS[step.state]})</span>
          </span>
        ))}
      </span>
    </span>
  );
}
