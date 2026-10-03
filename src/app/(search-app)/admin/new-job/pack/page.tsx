import type { Metadata } from "next";

import { AdminCredentialPackPage } from "@/components/admin/new-job/admin-credential-pack-page";

export const metadata: Metadata = {
  title: "Credential pack | Admin | PsychSift",
  description:
    "Your registration numbers and renewal dates on one page to check, trim and save as a PDF on your own device — nothing is uploaded.",
};

export default function AdminCredentialPackRoute() {
  return <AdminCredentialPackPage />;
}
