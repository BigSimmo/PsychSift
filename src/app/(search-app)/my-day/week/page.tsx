import type { Metadata } from "next";

import { MyDayWeekPage } from "@/components/my-day/my-day-week-page";

export const metadata: Metadata = {
  title: "Week | My Day | PsychSift",
  description:
    "The next seven days in one place: your roster shifts, teaching sessions, CPD routines and recorded Admin dates, day by day.",
};

export default function MyDayWeekRoute() {
  return <MyDayWeekPage />;
}
