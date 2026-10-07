"use client";

import { Copy, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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

const pairCell = cn(modePressable, focusRing, "flex min-h-14 min-w-0 items-center gap-3 px-3 text-left no-underline");

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
  // Opened from #log-a-call there is no opener in focus, so closing returns to the button.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const calls = useOnCallCallLog()?.entries.length ?? null;
  const drafted = useOnCallHandoverDraftCount();

  // Arriving with #log-a-call (My Day's quick action) opens the sheet once.
  // So does the hash arriving while Now is already open (a link to it tapped
  // from this page, or the browser's Forward), which no remount would catch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const openOnHash = () => {
      if (window.location.hash === ON_CALL_LOG_A_CALL_HASH) setOpen(true);
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    openOnHash();
    window.addEventListener("hashchange", openOnHash);
    return () => window.removeEventListener("hashchange", openOnHash);
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
    // One flat card split in two (work-mode redesign, owner request 6 Oct 2026).
    <div
      className="work-card grid grid-cols-2 divide-x divide-[color:var(--border)]"
      data-testid="on-call-now-shortcuts"
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        data-testid="on-call-now-log-a-call"
        className={pairCell}
      >
        <Plus aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />
        <span className="grid min-w-0">
          <span className={cn(modeNameText, "break-words text-sm text-[color:var(--text-heading)]")}>Log a call</span>
          {callsLine ? <span className={cn(modeSecondaryText, "text-xs")}>{callsLine}</span> : null}
        </span>
      </button>
      {/* A literal href: the route-reachability guard reads literal hrefs only. */}
      <Link href="/on-call/handover" data-testid="on-call-home-handover" className={pairCell}>
        <Copy aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />
        <span className="grid min-w-0">
          <span className={cn(modeNameText, "break-words text-sm text-[color:var(--text-heading)]")}>Handover</span>
          {draftedLine ? <span className={cn(modeSecondaryText, "text-xs")}>{draftedLine}</span> : null}
        </span>
      </Link>
      <Sheet
        open={open}
        onClose={close}
        returnFocusRef={buttonRef}
        title="Log a call"
        testId="on-call-now-log-a-call-sheet"
      >
        <div data-mode-identity="on-call">
          <OnCallCallLogCard />
        </div>
      </Sheet>
    </div>
  );
}
