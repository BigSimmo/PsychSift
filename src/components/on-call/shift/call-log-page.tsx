"use client";

import { InformationPageShell } from "@/components/information-page-shell";
import { OnCallCallLogCard } from "@/components/on-call/handover/call-log";
import { OnCallToolNavHeader } from "@/components/on-call/on-call-nav-header";
import { OnCallShiftSwitch } from "@/components/on-call/shift/shift-switch";

/**
 * Call log, the middle Shift page (On Call overhaul, 20 Oct 2026). The same log Now opens as its
 * "Log a call" sheet, given a page of its own beside Handover and Breaks. Notes are kept on this
 * phone only and clear when the shift ends.
 */
export function OnCallCallLogPage() {
  return (
    <>
      <OnCallToolNavHeader title="Call log" testIdPrefix="on-call-calls" />
      <InformationPageShell testId="on-call-calls-main" width="narrow">
        <h1 className="sr-only">Call log</h1>
        <div className="grid min-w-0 gap-5" data-mode-identity="on-call">
          <OnCallShiftSwitch current="calls" />
          <OnCallCallLogCard />
        </div>
      </InformationPageShell>
    </>
  );
}
