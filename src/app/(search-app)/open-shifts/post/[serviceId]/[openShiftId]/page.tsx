import type { Metadata } from "next";

import { OpenShiftsPostedShiftPage } from "@/components/open-shifts/open-shifts-posted-shift-page";

export const metadata: Metadata = {
  title: "Posted shift | Open shifts | PsychSift",
  description: "One extra shift you posted, with its applicants.",
  robots: { index: false, follow: false },
};

type OpenShiftsPostedShiftRouteProps = {
  params: Promise<{ serviceId: string; openShiftId: string }>;
};

export default async function OpenShiftsPostedShiftRoute({ params }: OpenShiftsPostedShiftRouteProps) {
  const { serviceId, openShiftId } = await params;
  return <OpenShiftsPostedShiftPage serviceId={serviceId} openShiftId={openShiftId} />;
}
