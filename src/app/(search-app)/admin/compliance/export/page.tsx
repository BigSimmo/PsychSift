import type { Metadata } from "next";

import { AdminComplianceExportPage } from "@/components/admin/admin-compliance-export-page";

export const metadata: Metadata = {
  title: "Export | Compliance | Admin | PsychSift",
  description:
    "A copy of your own compliance record as an Excel file, saved on your device. Nothing is uploaded or sent to your health service.",
};

export default function AdminComplianceExportRoute() {
  return <AdminComplianceExportPage />;
}
