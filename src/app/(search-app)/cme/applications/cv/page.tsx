import { redirect } from "next/navigation";

/** The CV moved to Admin with Job applications (11 Oct 2026). Keep old bookmarks and links working. */
export default function CmeApplicationsCvMovedRoute() {
  redirect("/admin/applications/cv");
}
