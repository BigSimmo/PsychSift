"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

import { RosterMonthPage } from "./roster-month-page";

// The older addresses are rare, so My shifts' page loads only when one is opened
// rather than with every Roster visit (about 16 KB less before Month can draw).
const RosterShiftsPage = dynamic(() => import("./roster-shifts-page").then((m) => m.RosterShiftsPage));

/**
 * `/roster` (work-mode redesign, owner request 6 Oct 2026): the Month tab.
 * The older addresses keep working: `?view=hours` is Hours and rest and
 * `?view=month` the plain month list, both drawn by My shifts' page as before.
 */
export function RosterHome() {
  const view = useSearchParams()?.get("view") ?? null;
  return view === "hours" || view === "month" ? <RosterShiftsPage /> : <RosterMonthPage />;
}
