import type { Metadata } from "next";

import { ContractEndPage } from "@/components/admin/contract/contract-end-page";

export const metadata: Metadata = {
  title: "Contract end | Admin | PsychSift",
  description:
    "Your contract end date, reminders 3 months and 6 weeks before, what to ask, and a message for Medical Workforce that you send yourself.",
};

export default function AdminContractRoute() {
  return <ContractEndPage />;
}
