import type { Metadata } from "next";

import { OnCallFirstWeekPage } from "@/components/on-call/first-week/first-week-page";

export const metadata: Metadata = {
  title: "Your first week | On Call | PsychSift",
  description:
    "Your rotation-start pack: the hospital's orientation, who is who, how to escalate and your New job logins, highlighted from a week before you start.",
};

export default async function OnCallFirstWeekRoute({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  const { section } = await searchParams;
  return <OnCallFirstWeekPage section={typeof section === "string" ? section : undefined} />;
}
