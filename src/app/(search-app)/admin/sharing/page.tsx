import { redirect } from "next/navigation";

import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";

/** Sharing is Requests' "Send a pack" view since 11 Oct 2026 (audit), so an old link opens it there. */
export default function AdminSharingRoute() {
  redirect(ADMIN_WORK_SCREEN_HREFS.sharing);
}
