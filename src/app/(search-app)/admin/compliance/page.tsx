import type { Metadata } from "next";

import { AdminCompliancePage } from "@/components/admin/admin-compliance-page";

export const metadata: Metadata = {
  title: "Compliance | Admin | PsychSift",
  description:
    "Every requirement your health service asks for, grouped, with what you have recorded, what falls due next and what to do before your next job. Your own recorded dates, never a check with the issuing body.",
};

export default function AdminComplianceRoute() {
  return <AdminCompliancePage />;
}
