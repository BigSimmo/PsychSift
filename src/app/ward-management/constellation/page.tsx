import { redirect } from "next/navigation";

/**
 * Phase 2 retired the constellation command view into the coordinator screen and
 * the network diagram. The route stays as a bookmark/deep-link backstop so the
 * live main URL does not 404 after Phase 3 lands.
 */
export default function WardConstellationRedirect() {
  redirect("/ward-management/network");
}
