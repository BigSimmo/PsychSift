import type { Metadata } from "next";

import { OnCallFirstNightPage } from "@/components/on-call/on-call-first-night-page";

export const metadata: Metadata = {
  title: "First night | On Call | PsychSift",
  description: "A short path for your first on-call shifts: before, during, and if something goes wrong.",
};

export default function OnCallFirstNightRoute() {
  return (
    <div className="min-h-[56px]">
      <OnCallFirstNightPage />
    </div>
  );
}
