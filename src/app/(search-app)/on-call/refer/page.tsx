import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OnCallReferPage } from "@/components/on-call/refer/refer-page";
import { getWorkModeLaunch } from "@/lib/work-mode-launch/server";

export const metadata: Metadata = {
  title: "Refer | On Call | PsychSift",
  description: "How to refer to each service at your hospital, and your own referral notes.",
};

// Refer is a tab of Contacts in the current work mode (Work mode simplify plan, owner approval
// 12 Oct 2026), so one search covers numbers and referrals. The classic work mode (the rollback)
// keeps its own Refer page.
export default async function OnCallReferRoute() {
  if ((await getWorkModeLaunch()).newWorkMode) redirect("/on-call/call?show=refer");
  return <OnCallReferPage />;
}
