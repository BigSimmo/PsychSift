import type { Metadata } from "next";

import { LiveTracker } from "@/components/ward-management/tracker/live-tracker";

export const metadata: Metadata = {
  title: "Live tracker - Ward Flow",
  description: "Synthetic coordinator's live tracker of every vehicle: which patient, which leg, how long since.",
};

export default function WardTransportPage() {
  return <LiveTracker />;
}
