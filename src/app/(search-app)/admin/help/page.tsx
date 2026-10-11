import type { Metadata } from "next";

import { AdminHelpPage } from "@/components/admin/admin-help-page";

export const metadata: Metadata = {
  title: "Numbers | Admin | PsychSift",
  description:
    "Crisis lines first, then support, guides, contacts and on-site detail, with a search that understands everyday words.",
};

export default function AdminHelpRoute() {
  return <AdminHelpPage />;
}
