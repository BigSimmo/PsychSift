"use client";

import { useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { OnCallHospitalChooser } from "@/components/on-call/kit/handbook-state";
import { modeNameText } from "@/components/mode-kit/type";
import type { HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";

/**
 * The hospital line (review F3): the hospital's name at 15px/500, and "Change"
 * when the reader belongs to more than one. It is the first line on Now and the
 * subtitle on Call and Find. Names are text only (owner Q6). Renders nothing
 * until a hospital is known.
 */
export function OnCallHospitalLine({
  handbook,
  testId = "on-call-hospital-line",
}: {
  readonly handbook: HospitalHandbookState;
  readonly testId?: string;
}) {
  const name = handbook.siteName ?? handbook.serviceName;
  if (!name) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 px-1" data-testid={testId}>
      <p className={cn(modeNameText, "min-w-0 break-words text-base-minus text-[color:var(--text-heading)]")}>{name}</p>
      <OnCallHospitalChange handbook={handbook} testId={testId} />
    </div>
  );
}

/**
 * The "Change" control on its own, with its chooser sheet, for a surface that
 * already names the hospital (Now's summary hero). Renders nothing unless the
 * reader belongs to more than one hospital. `variant="hero"` draws it as the
 * hero's quiet pill; the default is the hospital line's text button.
 */
export function OnCallHospitalChange({
  handbook,
  testId,
  variant = "line",
}: {
  readonly handbook: HospitalHandbookState;
  /** Stem for the control's testids: `${testId}-change` and `${testId}-sheet`. */
  readonly testId: string;
  readonly variant?: "line" | "hero";
}) {
  const [open, setOpen] = useState(false);
  const name = handbook.siteName ?? handbook.serviceName;
  if (!name || handbook.hospitals.length <= 1) return null;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Change hospital, currently ${name}`}
        onClick={() => setOpen(true)}
        className={
          variant === "hero"
            ? "work-hero__action"
            : cn(
                focusRing,
                "inline-flex min-h-12 items-center rounded-md px-1 text-base-minus font-medium text-[color:var(--clinical-accent)]",
              )
        }
        data-variant={variant === "hero" ? "quiet" : undefined}
        data-testid={`${testId}-change`}
      >
        {variant === "hero" ? "Change hospital" : "Change"}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Choose hospital" testId={`${testId}-sheet`}>
        <div data-mode-identity="on-call" className="min-w-0">
          <OnCallHospitalChooser handbook={handbook} onChosen={() => setOpen(false)} />
        </div>
      </Sheet>
    </>
  );
}
