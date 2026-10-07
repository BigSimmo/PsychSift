import { redirect } from "next/navigation";

/**
 * Backstop: My Work became Admin (Admin update 1), and Admin opens on Today
 * again (work-mode redesign, owner request 6 Oct 2026). The proxy's 307
 * normally answers first.
 */
export default function MyWorkBackstop() {
  redirect("/admin");
}
