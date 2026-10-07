import type { Metadata } from "next";

import { WorkRolesPage } from "@/components/preview-role/work-roles-page";

export const metadata: Metadata = {
  title: "View work mode as · PsychSift preview",
  description: "Preview-only role switcher for testing work mode as a junior doctor, a supervisor or an admin.",
};

export default function WorkRolesMockupRoute() {
  return <WorkRolesPage />;
}
