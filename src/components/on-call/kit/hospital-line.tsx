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
  const [open, setOpen] = useState(false);
  const name = handbook.siteName ?? handbook.serviceName;
  if (!name) return null;
  const canChange = handbook.hospitals.length > 1;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 px-3" data-testid={testId}>
      <p className={cn(modeNameText, "min-w-0 break-words text-base-minus text-[color:var(--text-heading)]")}>{name}</p>
      {canChange ? (
        <>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={`Change hospital, currently ${name}`}
            onClick={() => setOpen(true)}
            className={cn(
              focusRing,
              "inline-flex min-h-12 items-center rounded-md px-1 text-base-minus font-medium text-[color:var(--clinical-accent)]",
            )}
            data-testid={`${testId}-change`}
          >
            Change
          </button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Choose hospital" testId={`${testId}-sheet`}>
            <div data-mode-identity="on-call" className="min-w-0">
              <OnCallHospitalChooser handbook={handbook} onChosen={() => setOpen(false)} />
            </div>
          </Sheet>
        </>
      ) : null}
    </div>
  );
}
