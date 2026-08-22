import type { Metadata } from "next";

import { WardScreen } from "@/components/ward-management/ward/ward-screen";

export const metadata: Metadata = {
  title: "Ward — Ward Flow",
  description: "Synthetic single-unit ward view for the Ward Flow prototype.",
};

export default async function WardUnitPage({ params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params;
  return <WardScreen unitId={decodeURIComponent(unitId)} />;
}
