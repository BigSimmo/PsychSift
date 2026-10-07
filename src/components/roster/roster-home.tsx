"use client";

import { useSearchParams } from "next/navigation";

import { RosterMonthPage } from "./roster-month-page";
import { RosterShiftsPage } from "./roster-shifts-page";

/**
 * `/roster` (work-mode redesign, owner request 6 Oct 2026): the Month tab.
 * The older addresses keep working: `?view=hours` is Hours and rest and
 * `?view=month` the plain month list, both drawn by My shifts' page as before.
 */
export function RosterHome() {
  const view = useSearchParams()?.get("view") ?? null;
  return view === "hours" || view === "month" ? <RosterShiftsPage /> : <RosterMonthPage />;
}
