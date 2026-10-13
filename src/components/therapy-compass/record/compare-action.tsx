"use client";

import { useId, useState } from "react";
import { Scale } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ignoreUnavailableActivation } from "@/components/ui-primitives";
import { THERAPY_MAX_COMPARE } from "@/lib/therapy-compass-navigation";

import { useTcBindings } from "../bindings";
import type { Therapy } from "../data/types";

/**
 * "Add to compare" on a therapy record.
 *
 * This lives in the page body rather than in the chrome, and that is deliberate.
 * The compare tray docks above the phone search pill, and record pages have no
 * pill — claiming a dock slot there would open a blank band at the bottom of the
 * page (`docs/search-chrome-behaviour.md`, "reserve inflates on claim"). So the
 * record keeps the design's headline move — add it while you are reading it —
 * as ordinary page content, and introduces no second bottom owner.
 *
 * The status line is not decoration. On these routes the tray is not on screen,
 * so without it an add is completely silent: the reader taps, nothing visible
 * changes, and the only feedback is a URL they are not looking at.
 */
export function TherapyCompareAction({ therapy }: { therapy: Therapy }) {
  const b = useTcBindings();
  const fullNoteId = useId();
  const [notice, setNotice] = useState<string | null>(null);

  const inCompare = b.isInCompare(therapy.slug);
  const count = b.compareSlugs.length;
  const full = !inCompare && count >= THERAPY_MAX_COMPARE;

  function announce(next: number, verb: string) {
    setNotice(`${verb} — ${next} of ${THERAPY_MAX_COMPARE} selected to compare.`);
  }

  return (
    <div data-testid="therapy-record-compare-action" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          icon={Scale}
          aria-pressed={inCompare}
          // A full tray states its reason and keeps its tab stop; native
          // `disabled` would drop the control out of reach of the explanation.
          aria-disabled={full ? true : undefined}
          aria-describedby={full ? fullNoteId : undefined}
          title={full ? `Compare holds ${THERAPY_MAX_COMPARE} therapies — remove one first` : undefined}
          onClick={
            full
              ? ignoreUnavailableActivation
              : inCompare
                ? () => {
                    b.removeCompare(therapy.slug);
                    announce(count - 1, "Removed from compare");
                  }
                : () => {
                    b.addCompare(therapy.slug);
                    announce(count + 1, "Added to compare");
                  }
          }
        >
          {inCompare ? "In compare tray" : full ? "Compare tray full" : "Add to compare"}
        </Button>
        {count >= 2 ? (
          <Button variant="secondary" onClick={() => b.goCompare()}>
            Compare {count}
          </Button>
        ) : null}
      </div>
      {full ? (
        <span id={fullNoteId} className="sr-only">
          The comparison already holds {THERAPY_MAX_COMPARE} therapies. Remove one before adding another.
        </span>
      ) : null}
      {notice ? (
        <p className="m-0 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 text-xs font-semibold text-[color:var(--text-muted)]">
          {notice}
        </p>
      ) : null}
      {/* Always-hidden announcer: SPEC.md §9.2 forbids aria-live on the visible
          box above, which used to carry it directly. */}
      <span role="status" aria-live="polite" className="sr-only">
        {notice}
      </span>
    </div>
  );
}
