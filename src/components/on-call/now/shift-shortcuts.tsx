"use client";

import { Copy, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import {
  OnCallCallLogCard,
  useOnCallCallLog,
  useOnCallHandoverDraftCount,
} from "@/components/on-call/handover/call-log";
import { onCallLeadingIcon } from "@/components/on-call/kit/calm";
import { modePressable } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";

/** The hash that opens the sheet: My Day's "Log a call" lands here. */
export const ON_CALL_LOG_A_CALL_HASH = "#log-a-call";

const pairCell = cn(
  modePressable,
  focusRing,
  "flex min-h-13 min-w-0 items-center gap-3 rounded-md px-3 text-left no-underline",
);

function countLine(count: number | null, one: string, many: (n: number) => string, none: string): string | null {
  if (count === null) return null;
  if (count === 0) return none;
  return count === 1 ? one : many(count);
}

/**
 * "Log a call" and "Handover" side by side (mock-up v10 Now). Log a call opens
 * the call log as a bottom sheet over Now; Handover opens the handover. The
 * counts are tonight's calls and the patients drafted, both read from this
 * phone only, and both left out until the phone has been read.
 */
export function NowShiftShortcuts() {
  const [open, setOpen] = useState(false);
  const calls = useOnCallCallLog()?.entries.length ?? null;
  const drafted = useOnCallHandoverDraftCount();

  // Arriving with #log-a-call (My Day's quick action) opens the sheet once.
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== ON_CALL_LOG_A_CALL_HASH) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(true);
  }, []);

  const close = () => {
    setOpen(false);
    if (typeof window !== "undefined" && window.location.hash === ON_CALL_LOG_A_CALL_HASH) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  };

  const callsLine = countLine(calls, "1 tonight", (n) => `${n} tonight`, "None yet");
  const draftedLine = countLine(drafted, "1 drafted", (n) => `${n} drafted`, "Nothing drafted");

  return (
    <div className="grid grid-cols-2 gap-2" data-testid="on-call-now-shortcuts">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        data-testid="on-call-now-log-a-call"
        className={pairCell}
      >
        <Plus aria-hidden="true" strokeWidth={1.5} className={onCallLeadingIcon} />
        <span className="grid min-w-0">
          <span className={cn(modeNameText, "break-words text-sm text-[color:var(--text-heading)]")}>Log a call</span>
          {callsLine ? <span className={cn(modeSecondaryText, "text-xs")}>{callsLine}</span> : null}
        </span>
      </button>
      {/* A literal href: the route-reachability guard reads literal hrefs only. */}
      <Link href="/on-call/handover" data-testid="on-call-home-handover" className={pairCell}>
        <Copy aria-hidden="true" strokeWidth={1.5} className={onCallLeadingIcon} />
        <span className="grid min-w-0">
          <span className={cn(modeNameText, "break-words text-sm text-[color:var(--text-heading)]")}>Handover</span>
          {draftedLine ? <span className={cn(modeSecondaryText, "text-xs")}>{draftedLine}</span> : null}
        </span>
      </Link>
      <Sheet open={open} onClose={close} title="Log a call" testId="on-call-now-log-a-call-sheet">
        <div data-mode-identity="on-call">
          <OnCallCallLogCard />
        </div>
      </Sheet>
    </div>
  );
}
