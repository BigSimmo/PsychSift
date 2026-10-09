import type { Metadata } from "next";

import { AdminPeoplePage } from "@/components/work-screens/admin/people-page";

export const metadata: Metadata = {
  title: "People and roles | Admin | PsychSift",
  description:
    "Who holds Medical Workforce, Director of Clinical Training and supervisor roles in a hospital, and the place to give or remove them.",
};

export default function AdminPeopleRoute() {
  return <AdminPeoplePage />;
}
