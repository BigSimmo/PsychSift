import { redirect } from "next/navigation";

/** Backstop: moved to Teaching > Week. The proxy's 307 normally answers first. */
export default function OnCallEducationBackstop() {
  redirect("/teaching/week");
}
