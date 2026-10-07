"use client";

import { useState } from "react";

import { RemindMeSheet, YourRemindersSheet } from "@/components/alerts/remind-me-sheet";
import { useOpenMyDayCustomise } from "@/components/my-day/my-day-open-customise";
import { useWorkFrameAction } from "@/components/work-frame/work-frame-store";

/**
 * My Day's two More actions on a page that is not My Day's own dashboard
 * (Work profile): Reminders opens Your reminders here, and Customise goes to
 * Today with the Customise sheet open. Mounted only for a signed-in reader.
 */
export function MyDayMoreActions({ now }: { readonly now: Date }) {
  const [sheet, setSheet] = useState<"reminders" | "remind-me" | null>(null);
  useWorkFrameAction("my-day-reminders", () => setSheet("reminders"));
  useWorkFrameAction("my-day-customise", useOpenMyDayCustomise());
  return (
    <>
      <YourRemindersSheet
        open={sheet === "reminders"}
        onClose={() => setSheet(null)}
        now={now}
        onAdd={() => setSheet("remind-me")}
      />
      <RemindMeSheet open={sheet === "remind-me"} onClose={() => setSheet("reminders")} now={now} shiftEndsAt={null} />
    </>
  );
}
