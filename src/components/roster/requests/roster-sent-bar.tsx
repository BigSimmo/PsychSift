"use client";

import { CheckCircle2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { ROSTER_UNDO_MS } from "@/components/roster/roster-format";
import { rosterOutlineButton } from "@/components/roster/roster-list";
import { cn } from "@/components/ui-primitives";

export type SentReceipt = { message: string; undo?: () => Promise<void> };

/** `ROSTER_UNDO_MS` (10 seconds) to reverse a newly sent request. A failed reversal stays visible. */
export function RosterSentBar({ receipt, clear }: { receipt: SentReceipt | null; clear: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previousReceipt, setPreviousReceipt] = useState(receipt);
  if (receipt !== previousReceipt) {
    setPreviousReceipt(receipt);
    setError(null);
    setBusy(false);
  }
  useEffect(() => {
    if (!receipt || busy || error) return;
    const timer = window.setTimeout(clear, ROSTER_UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [receipt, clear, busy, error]);
  if (!receipt) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-lg py-1.5 pl-3.5 pr-1.5 text-sm text-[color:var(--text)] forced-colors:border",
        error
          ? "border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]"
          : "bg-[color:color-mix(in_oklab,var(--text-heading)_7%,var(--surface-raised))]",
      )}
    >
      {error ? (
        <TriangleAlert
          aria-hidden="true"
          strokeWidth={1.6}
          className="size-icon-md shrink-0 text-[color:var(--warning-text)]"
        />
      ) : (
        <CheckCircle2
          aria-hidden="true"
          strokeWidth={1.6}
          className="size-icon-md shrink-0 text-[color:var(--text-muted)]"
        />
      )}
      <span className="min-w-0 flex-1 break-words py-2">{error ?? receipt.message}</span>
      {receipt.undo ? (
        <button
          type="button"
          className={cn(rosterOutlineButton, "shrink-0 px-4")}
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => {
            setBusy(true);
            void receipt.undo!().then(clear, () => {
              setError("Could not undo. Check the request before trying again.");
              setBusy(false);
            });
          }}
        >
          {busy ? "Undoing…" : "Undo"}
        </button>
      ) : null}
    </div>
  );
}
