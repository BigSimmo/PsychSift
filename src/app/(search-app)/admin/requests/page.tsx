import type { Metadata } from "next";

import { AdminRequestsPage } from "@/components/work-screens/admin/requests-page";

export const metadata: Metadata = {
  title: "Requests | Admin | PsychSift",
  description:
    "Requests you send to Medical Workforce, Staff Health or anyone else, written for you to send yourself and tracked until there is an answer.",
};

export default function AdminRequestsRoute() {
  return <AdminRequestsPage />;
}
