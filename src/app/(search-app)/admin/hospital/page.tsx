import type { Metadata } from "next";

import { AdminHospitalPage } from "@/components/work-screens/hospital/hospital-page";

export const metadata: Metadata = {
  title: "Hospital | Admin | PsychSift",
  description:
    "The one way in for people with a hospital role: Medical Workforce, the DCT, supervisors and roster managers.",
};

export default function AdminHospitalRoute() {
  return <AdminHospitalPage />;
}
