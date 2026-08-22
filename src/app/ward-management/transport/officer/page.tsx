import type { Metadata } from "next";

import { OfficerScreen } from "@/components/ward-management/officer/officer-screen";

export const metadata: Metadata = {
  title: "Transport officer — Ward Flow",
  description: "Synthetic transport officer phone view for the Ward Flow prototype.",
};

export default function TransportOfficerPage() {
  return <OfficerScreen />;
}
