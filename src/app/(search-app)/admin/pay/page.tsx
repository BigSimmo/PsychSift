import type { Metadata } from "next";

import { AdminPayPage } from "@/components/work-screens/admin/pay-page";

export const metadata: Metadata = {
  title: "Pay | Admin | PsychSift",
  description:
    "Check the hours on your payslip against your roster and the extra time you logged. Hours only, with no pay rates or award figures.",
};

export default function AdminPayRoute() {
  return <AdminPayPage />;
}
