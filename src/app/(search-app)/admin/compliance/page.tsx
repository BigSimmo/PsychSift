import { redirect } from "next/navigation";

import { ADMIN_PAGE_HREFS } from "@/lib/admin/page-hrefs";

/** Compliance is Renewals' By group view since 11 Oct 2026 (audit item 4), so an old link opens it there. */
export default function AdminComplianceRoute() {
  redirect(ADMIN_PAGE_HREFS.compliance);
}
