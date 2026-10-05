"use client";

import { Clock } from "lucide-react";
import { useSyncExternalStore } from "react";

import { ModeRow } from "@/components/mode-kit/grouped-list";
import { modeInsetHairline, modeRaisedCard } from "@/components/mode-kit/recipes";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { remindMeClock } from "@/lib/alerts/remind-me";
import type { EndOfShift } from "@/lib/alerts/end-of-shift";
import { patientLabelsExpireAt, subscribePatientLabelsCleared } from "@/lib/patient-label-storage";

function readLabelExpiry(): number | null {
  try {
    return patientLabelsExpireAt();
  } catch {
    return null;
  }
}

/**
 * Screen 16: one card in the last 30 minutes of a rostered shift. It says
 * when this device's patient labels clear (they already clear at the rostered
 * end) and offers the one reflection worth catching before going home. It
 * names the shift, never a patient.
 */
export function EndOfShiftCard({ shift }: { readonly shift: EndOfShift }) {
  const labelsClearAt = useSyncExternalStore(subscribePatientLabelsCleared, readLabelExpiry, () => null);
  const ends = remindMeClock(Date.parse(shift.endsAt));
  return (
    <section className="grid min-w-0 gap-2" aria-label="End of shift" data-testid="end-of-shift-card">
      <div className={cn(modeRaisedCard, "overflow-hidden")}>
        <div className="grid gap-1 px-3 pb-3 pt-3">
          <p className={cn(eyebrowText, "flex items-center gap-1.5")}>
            <Clock aria-hidden="true" strokeWidth={1.5} className="size-icon-sm" />
            {`${shift.label} ends ${ends}`}
          </p>
          <p className="text-xl font-semibold text-[color:var(--text-heading)]">
            {`${shift.minutesLeft} ${shift.minutesLeft === 1 ? "minute" : "minutes"} left`}
          </p>
          {labelsClearAt !== null ? (
            <p className="text-sm text-[color:var(--text-muted)]">
              {
                // "when the shift ends" only when they really clear then, not at the fallback lifetime.
                Math.abs(labelsClearAt - Date.parse(shift.endsAt)) < 60_000
                  ? `Patient labels on this device clear at ${remindMeClock(labelsClearAt)}, when the shift ends`
                  : `Patient labels on this device clear at ${remindMeClock(labelsClearAt)}`
              }
            </p>
          ) : null}
        </div>
        <ul role="list" className={cn(modeInsetHairline, "before:left-0")}>
          <ModeRow
            title="One thing you learnt today"
            subtitle="Saves to CPD as a reflection"
            href="/cme/new?from=my-day"
            testId="end-of-shift-reflection"
          />
        </ul>
      </div>
      <p className="px-3 text-sm text-[color:var(--text-muted)]">
        Shows only on rostered shifts. Nothing here names a patient.
      </p>
    </section>
  );
}
