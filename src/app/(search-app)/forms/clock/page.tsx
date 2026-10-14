import type { Metadata } from "next";

import { FormsModeNav } from "@/components/forms/forms-mode-nav";
import { MhaClockPage } from "@/components/psychiatry/mha-clock-page";
import { consolidatedModeSearchPath } from "@/lib/consolidated-mode-home-redirect";
import { mhaClockForms } from "@/lib/psychiatry-hub/mha-clock-forms";

export const metadata: Metadata = {
  title: "MHA time limits | PsychSift",
  description: "Every Mental Health Act form you are holding, with how long it has been running and its time limits.",
};

/**
 * Clinical Forms · Clock: the same MHA clock the Psychiatry hub opens at
 * /psychiatry/mha-clock, here as the Forms mode's Clock tab so the forms list,
 * the clock and the Act are one tap apart. Clocks live on this device, so both
 * addresses show the same ones.
 */
export default function FormsClockRoute() {
  return (
    <>
      <FormsModeNav current="forms-clock" />
      <MhaClockPage forms={mhaClockForms()} home={{ label: "Forms", href: consolidatedModeSearchPath("forms") }} />
    </>
  );
}
