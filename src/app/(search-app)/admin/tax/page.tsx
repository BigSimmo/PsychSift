import type { Metadata } from "next";

import { AdminTaxPage } from "@/components/work-screens/admin/tax-page";

export const metadata: Metadata = {
  title: "Tax | Admin | PsychSift",
  description:
    "Your work expenses and tax-document checklist for the financial year. A record for you, not tax advice, with links to the ATO.",
};

export default function AdminTaxRoute() {
  return <AdminTaxPage />;
}
