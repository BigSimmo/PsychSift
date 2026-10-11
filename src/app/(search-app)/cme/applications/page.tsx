import { redirect } from "next/navigation";

/** Job applications moved to Admin (11 Oct 2026). Keep old bookmarks and links working. */
export default function CmeApplicationsMovedRoute() {
  redirect("/admin/applications");
}
