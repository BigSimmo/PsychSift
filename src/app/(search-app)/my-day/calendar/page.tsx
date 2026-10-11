import type { Metadata } from "next";

import { MyDayCalendarPage } from "@/components/my-day/my-day-calendar-page";

export const metadata: Metadata = {
  title: "Calendar | My Day | PsychSift",
  description:
    "One calendar for everything dated: shifts, leave, rotations, booked courses, teaching, CPD and Admin dates, month by month.",
};

export default function MyDayCalendarRoute() {
  return <MyDayCalendarPage />;
}
