"use client";
import { Eraser } from "lucide-react";
import { useEffect, useState } from "react";
import { FnButton } from "@/components/first-nations/kit";
import { ModuleHeader } from "@/components/first-nations/module-header";
import { TickList, toggleIn } from "@/components/first-nations/tick-list";
import { Sheet } from "@/components/ui/sheet";
import { useHoldWhileEngaged } from "@/components/use-hold-while-engaged";
import type { StepView } from "@/lib/first-nations/view-model";

export const UNDO_MS = 6_000;

/** Ticks live in this component's state only; closing the sheet clears them. */
function Checks({ steps }: { steps: readonly StepView[] }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [undo, setUndo] = useState<ReadonlySet<string> | null>(null);
  const { held, holdProps } = useHoldWhileEngaged(undo !== null);
  useEffect(() => {
    if (!undo || held) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo, held]);
  return (
    <div className="grid gap-3">
      <TickList steps={steps} ticked={ticked} onToggle={(id) => setTicked((t) => toggleIn(t, id))} />
      {ticked.size > 0 ? (
        <FnButton
          icon={Eraser}
          label="Clear ticks"
          onClick={() => {
            setUndo(ticked);
            setTicked(new Set());
          }}
        />
      ) : null}
      {undo ? (
        <div
          role="status"
          {...holdProps}
          className="flex min-h-12 items-center justify-between rounded-xl bg-[color:var(--command)] pl-3.5 pr-1 text-sm-minus text-[color:var(--command-contrast)]"
        >
          <span>Ticks cleared</span>
          <button
            type="button"
            className="min-h-12 px-2.5 font-medium"
            onClick={() => {
              setTicked(undo);
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function BeforeYouGoIn({ steps }: { steps: readonly StepView[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="grid min-h-[5.5rem] content-start gap-0.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] pb-3 text-left shadow-[var(--e1)]"
      >
        <ModuleHeader id="fn-byg-title" icon="check" title="Checks" inControl />
        <span className="px-3 text-sm-minus font-medium text-[color:var(--text-heading)]">Before you go in</span>
        <span className="px-3 text-sm-minus text-[color:var(--text-muted)]">{`${steps.length} checks · 1 minute`}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Before you go in" description="Nothing is saved">
        <Checks steps={steps} />
      </Sheet>
    </>
  );
}
