import type { Metadata } from "next";

import { OnCallRosterWhosOnPage } from "@/components/on-call/roster-whos-on/on-call-roster-whos-on-page";

export const metadata: Metadata = {
  title: "From your team roster | On Call | PsychSift",
  description:
    "Who is on yesterday, today and tomorrow, read straight from your team's published roster. Names and shifts only.",
};

export default function OnCallRosterWhosOnRoute() {
  return <OnCallRosterWhosOnPage />;
}
