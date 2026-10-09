import type { Metadata } from "next";

import { ReadyForDayOnePage } from "@/components/admin/ready/ready-for-day-one-page";

export const metadata: Metadata = {
  title: "Ready for day one | Admin | PsychSift",
  description:
    "What is recorded and what is still to do before your new job starts, from your own Admin records, with a status-only copy for Medical Workforce that you send yourself.",
};

export default function AdminReadyForDayOneRoute() {
  return <ReadyForDayOnePage />;
}
