import { redirect } from "next/navigation";

/*
 * Backstop: What's on became Week's "Other services" filter (owner-approved mock-up, Oct 2026). Old
 * bookmarks, the PWA and help links land on that filter. The component `teaching-whats-on.tsx` stays
 * in the tree under the 30-day rule but no route renders it.
 */
export default function TeachingWhatsOnBackstop() {
  redirect("/teaching/week?view=other");
}
