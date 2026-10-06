import type { Metadata } from "next";

import { OpenShiftsAdvertPage } from "@/components/open-shifts/open-shifts-advert-page";

export const metadata: Metadata = {
  title: "Shift advert | Open shifts | PsychSift",
  description: "One extra shift advertised in your Roster team.",
  robots: { index: false, follow: false },
};

type OpenShiftsAdvertRouteProps = {
  params: Promise<{ serviceId: string; openShiftId: string }>;
};

export default async function OpenShiftsAdvertRoute({ params }: OpenShiftsAdvertRouteProps) {
  const { serviceId, openShiftId } = await params;
  return <OpenShiftsAdvertPage serviceId={serviceId} openShiftId={openShiftId} />;
}
