import { Check, Minus } from "lucide-react";

import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";
import type { SickStep, SickStepState } from "@/lib/roster/sick/sick-report";

/**
 * "What happens next": a short vertical timeline of three steps. Flat: a
 * hairline card, small numbered dots, a 2px rail that fills in the roster
 * violet as steps complete. Each step also says its state in words for
 * screen readers, so colour is never the only cue. Presentational only.
 */

const STATE_WORDS: Record<SickStepState, string> = {
  done: "Done",
  current: "Happening now",
  warning: "Needs attention",
  skipped: "Not needed",
  todo: "Still to come",
};

function Dot({ state, index }: { readonly state: SickStepState; readonly index: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full text-2xs font-bold forced-colors:border",
        state === "done" && "bg-[color:var(--mode-identity)] text-[color:var(--mode-identity-contrast)]",
        state === "current" &&
          "border-2 border-[color:var(--mode-identity)] bg-[color:var(--surface-raised)] text-[color:var(--mode-identity)]",
        state === "warning" &&
          "border-2 border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning-text)]",
        state === "skipped" && "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
        state === "todo" &&
          "border-2 border-[color:var(--border-strong)] bg-[color:var(--surface-raised)] text-[color:var(--text-muted)]",
      )}
    >
      {state === "done" ? (
        <Check aria-hidden="true" strokeWidth={2.8} className="size-3" />
      ) : state === "skipped" ? (
        <Minus aria-hidden="true" strokeWidth={2.8} className="size-3" />
      ) : state === "warning" ? (
        "!"
      ) : state === "current" ? (
        <span className="size-2 rounded-full bg-[color:var(--mode-identity)]" />
      ) : (
        index + 1
      )}
    </span>
  );
}

export function SickTimeline({
  steps,
  label = "What happens next",
  framed = true,
  testId,
}: {
  readonly steps: readonly SickStep[];
  readonly label?: string;
  /** False inside another card (a sent report). */
  readonly framed?: boolean;
  readonly testId?: string;
}) {
  return (
    <ol
      aria-label={label}
      className={cn("grid px-3 py-1", framed && cn(modeModuleSurface, "shadow-none"))}
      data-mode-identity="roster"
      data-testid={testId}
    >
      {steps.map((step, index) => (
        <li
          key={step.title}
          className={cn(
            "relative grid min-h-13 grid-cols-[1.5rem_1fr] items-center gap-3 py-2",
            index < steps.length - 1 &&
              "after:absolute after:left-[0.6875rem] after:top-[calc(50%+0.8rem)] after:h-[calc(100%-1.6rem)] after:w-0.5 after:rounded-full after:content-['']",
            index < steps.length - 1 &&
              (step.state === "done"
                ? "after:bg-[color:var(--mode-identity)]"
                : "after:bg-[color:var(--border-strong)]"),
          )}
          data-step-state={step.state}
        >
          <Dot state={step.state} index={index} />
          <span className="grid min-w-0">
            <span
              className={cn(
                "break-words text-sm font-semibold leading-5",
                step.state === "skipped" ? "text-[color:var(--text-muted)]" : "text-[color:var(--text-heading)]",
              )}
            >
              {step.title}
              <span className="sr-only">{`. ${STATE_WORDS[step.state]}.`}</span>
            </span>
            <span className="break-words text-xs leading-4 text-[color:var(--text-muted)]">{step.sub}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
