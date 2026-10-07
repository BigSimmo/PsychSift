import type { Metadata } from "next";

import { AdminSharingPage } from "@/components/work-screens/admin/sharing-page";

export const metadata: Metadata = {
  title: "Sharing | Admin | PsychSift",
  description:
    "What you would share with Medical Workforce and Staff Health, and the pack you send yourself. Sharing from PsychSift is not live yet.",
};

export default function AdminSharingRoute() {
  return <AdminSharingPage />;
}
