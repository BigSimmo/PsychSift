import { redirect } from "next/navigation";

import { HOSPITAL_HUB_HREF } from "@/lib/work-roles/hospital-hub";

/**
 * Workforce was a sample of the health service's side. Its live version is Hospital's Medical Workforce
 * section (sick calls, short-staffed days, new starters, people and roles), which checks the role on the
 * server, so an old link lands there (audit 11 Oct 2026).
 */
export default function AdminWorkforceRoute() {
  redirect(HOSPITAL_HUB_HREF);
}
