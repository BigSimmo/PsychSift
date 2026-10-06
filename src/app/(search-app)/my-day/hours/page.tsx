import type { Metadata } from "next";

import { MyDayHoursPage } from "@/components/my-day/my-day-hours-page";

export const metadata: Metadata = {
  title: "Hours | My Day | PsychSift",
  description: "Your rostered hours this week and this fortnight, and your next leave, private to your account.",
};

export default function MyDayHoursRoute() {
  return <MyDayHoursPage />;
}
