import type { Metadata } from "next";

import { AdminDocumentsPage } from "@/components/work-screens/admin/documents-page";

export const metadata: Metadata = {
  title: "Documents | Admin | PsychSift",
  description:
    "Your contract, registration and certificates, as a list of where each one is kept. PsychSift keeps the list, never the files.",
};

export default function AdminDocumentsRoute() {
  return <AdminDocumentsPage />;
}
