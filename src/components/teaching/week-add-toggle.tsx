"use client";

import { Check, Plus } from "lucide-react";
import { useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { cn } from "@/components/ui-primitives";
import { teachingErrorMessage, teachingPost } from "@/lib/teaching/client";

/*
 * Adding a session another service opened to the reader's own week, and taking it out again. Week's
 * "Other services" filter and the retired What's on page share this, so the write, the optimistic
 * flip and the put-it-back-and-say-why on failure stay one behaviour.
 *
 * The signed-out sample never writes: it says so instead. Demo mode does ask, and the server's refusal
 * shows as the same notice a real refusal would.
 */
export function useWeekAdd(sample: boolean) {
  const [inWeek, setInWeek] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);

  function added(row: { occurrenceId: string; inMyWeek: boolean }): boolean {
    return inWeek[row.occurrenceId] ?? row.inMyWeek;
  }

  async function toggle(row: { occurrenceId: string; inMyWeek: boolean }) {
    if (sample) {
      setNotice("The sample doesn’t save changes.");
      return;
    }
    const id = row.occurrenceId;
    const next = !added(row);
    setInWeek((current) => ({ ...current, [id]: next }));
    setNotice(null);
    try {
      const result = await teachingPost<{ inMyWeek: boolean }>("/api/teaching/whats-on", {
        action: next ? "week_add.set" : "week_add.unset",
        occurrenceId: id,
      });
      setInWeek((current) => ({ ...current, [id]: result.inMyWeek }));
    } catch (cause) {
      setInWeek((current) => ({ ...current, [id]: !next }));
      setNotice(teachingErrorMessage(cause));
    }
  }

  return { added, toggle, notice };
}

/** The live line a failed add speaks into; empty (but present) otherwise, so the next message is announced. */
export function WeekAddNotice({ notice }: { notice: string | null }) {
  return notice ? (
    <p role="status" className="text-xs font-semibold text-[color:var(--danger-text)]">
      {notice}
    </p>
  ) : (
    <p role="status" className="sr-only" />
  );
}

export function WeekToggle({ title, added, onToggle }: { title: string; added: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={added}
      aria-label={added ? `Remove ${title} from my week` : `Add ${title} to my week`}
      onClick={onToggle}
      data-no-tab-swipe=""
      className={cn(focusRing, "grid size-12 shrink-0 place-items-center rounded-full")}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-8 place-items-center rounded-full border-[1.5px]",
          added
            ? "border-transparent bg-[color:var(--work-primary)] text-[color:var(--work-primary-text)]"
            : "border-[color:var(--mode-identity)] text-[color:var(--mode-identity)]",
        )}
      >
        {added ? <Check aria-hidden="true" className="size-4" /> : <Plus aria-hidden="true" className="size-4" />}
      </span>
      {added ? <span className="sr-only">In my week</span> : null}
    </button>
  );
}
