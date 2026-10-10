import type { Metadata } from "next";

import { RotationRoundsPage } from "@/components/roster/rotations/admin/rounds-page";

export const metadata: Metadata = {
  title: "Rotation rounds | Manage team | Roster | PsychSift",
  description: "Ask your team to rank their rotations, allocate the year and publish it to their calendars.",
};

export default async function RotationRoundsRoute() {
  return <RotationRoundsPage />;
}
