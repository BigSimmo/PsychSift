import type { Metadata } from "next";

import { MyDayCalendarPage } from "@/components/my-day/my-day-calendar-page";
import { requireLivePreview } from "@/lib/live-version/server";

export const metadata: Metadata = {
  title: "Calendar | My Day | PsychSift",
  description:
    "One calendar for everything dated: shifts, leave, rotations, booked courses, teaching, CPD and Admin dates, month by month.",
};

export default async function MyDayCalendarRoute() {
  await requireLivePreview("main-calendar");
  return <MyDayCalendarPage />;
}
