import { redirect } from "next/navigation";

/** Backstop: My Work became Admin (Admin update 1). The proxy's 307 normally answers first. */
export default function MyWorkBackstop() {
  redirect("/admin/renewals");
}
