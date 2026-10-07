"use client";

import { Phone } from "lucide-react";

import { useSignedOutSample } from "@/components/mode-kit/use-signed-out-sample";
import { setOnCallHospitalPhone } from "@/components/on-call/call/call-device-stores";
import { onCallLeadingIcon } from "@/components/on-call/kit/calm";
import { OnCallGroupedList } from "@/components/on-call/kit/grouped-list";
import { modeInsetHairline, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import { cn } from "@/components/ui-primitives";

/**
 * "I'm on a hospital phone" (owner card 19:06Z): off by default, kept on this
 * phone only. While it is on, a short extension gets its own call disc,
 * because a hospital-issued handset can dial it; while it is off, a short
 * extension stays desk-only (review F1). The line under it says what the
 * current setting means (mock-up v10 s-2), so "off" is never a guess.
 */
export function OnCallHospitalPhoneSwitch({
  on,
  testId = "on-call-hospital-phone",
}: {
  readonly on: boolean;
  readonly testId?: string;
}) {
  // The signed-out sample keeps nothing on this phone and its numbers never dial, so it has no switch.
  const sample = useSignedOutSample("call");
  if (sample) return null;
  return (
    <OnCallGroupedList testId={testId}>
      <li className={cn(modeInsetHairline, modeRowHeight.double, "flex min-w-0 items-center gap-3 pl-3 pr-1")}>
        <span aria-hidden="true" className="flex w-9 shrink-0 items-center justify-center">
          <Phone aria-hidden="true" strokeWidth={2} className={onCallLeadingIcon} />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={cn(modeNameText, "break-words text-base-minus text-[color:var(--text-heading)]")}>
            I&apos;m on a hospital phone
          </span>
          <span className={cn(modeSecondaryText, "break-words")}>
            {on
              ? "On: you're on a hospital phone, so short extensions are dialled"
              : "Off: you're on your mobile, so full numbers are dialled"}
          </span>
        </span>
        <ToggleSwitch enabled={on} onToggle={() => setOnCallHospitalPhone(!on)} aria-label="I'm on a hospital phone" />
      </li>
    </OnCallGroupedList>
  );
}
