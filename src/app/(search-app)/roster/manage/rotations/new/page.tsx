import type { Metadata } from "next";

import { NewRotationRoundPage } from "@/components/roster/rotations/admin/round-form";
import { requireLivePreview } from "@/lib/live-version/server";

export const metadata: Metadata = {
  title: "New rotation round | Manage team | Roster | PsychSift",
  description: "Set the terms, the rotations on offer and who ranks them.",
};

export default async function NewRotationRoundRoute() {
  await requireLivePreview("rotation-preferences");
  return <NewRotationRoundPage />;
}
