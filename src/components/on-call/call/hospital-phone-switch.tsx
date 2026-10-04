"use client";

import { useSignedOutSample } from "@/components/mode-kit/use-signed-out-sample";
import { setOnCallHospitalPhone } from "@/components/on-call/call/call-device-stores";
import { OnCallGroupedList } from "@/components/on-call/kit/grouped-list";
import { modeInsetHairline, modeRowHeight } from "@/components/mode-kit/recipes";
import { modeNameText, modeSecondaryText } from "@/components/mode-kit/type";
import { ToggleSwitch } from "@/components/primitive-recipes/feedback";
import { cn } from "@/components/ui-primitives";

/**
 * "I'm on a hospital phone" (owner card 19:06Z): off by default, kept on this
 * phone only. While it is on, a short extension gets its own call disc,
 * because a hospital-issued handset can dial it; while it is off, a short
 * extension stays desk-only (review F1). The condition line is the switch's
 * own label, not an explanation.
 */
export function OnCallHospitalPhoneSwitch({
  on,
  testId = "on-call-hospital-phone",
}: {
  readonly on: boolean;
  readonly testId?: string;
}) {
  // The signed-out sample keeps nothing on this phone and its numbers never dial, so it has no switch.
  const sample = useSignedOutSample();
  if (sample) return null;
  return (
    <OnCallGroupedList testId={testId}>
      <li className={cn(modeInsetHairline, modeRowHeight.double, "flex min-w-0 items-center gap-3 pl-3 pr-1")}>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={cn(modeNameText, "break-words text-base-minus text-[color:var(--text-heading)]")}>
            I&apos;m on a hospital phone
          </span>
          <span className={cn(modeSecondaryText, "break-words")}>
            Only on a hospital-issued phone that dials extensions
          </span>
        </span>
        <ToggleSwitch enabled={on} onToggle={() => setOnCallHospitalPhone(!on)} aria-label="I'm on a hospital phone" />
      </li>
    </OnCallGroupedList>
  );
}
