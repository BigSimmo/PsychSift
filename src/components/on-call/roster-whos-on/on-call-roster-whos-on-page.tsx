"use client";

import { Building2 } from "lucide-react";

import { OnCallRosterWhosOnSection } from "@/components/on-call/roster-whos-on/on-call-roster-whos-on-section";
import { useHospitalClock } from "@/components/on-call/use-hospital-clock";
import { useHospitalHandbook } from "@/components/on-call/use-hospital-handbook";
import { WorkBody, WorkCard, WorkIconRow } from "@/components/mode-kit/work";
import { switchboardItem } from "@/lib/on-call/now-rows";

/** The hospital's switchboard from its published handbook, for "ring switchboard to confirm". */
function useRosterSwitchboard() {
  const handbook = useHospitalHandbook();
  const ready = handbook.status === "ready";
  return {
    switchboard: ready ? switchboardItem(handbook.items) : null,
    hospitalName: handbook.siteName ?? handbook.serviceName,
  };
}

/**
 * Who is on, from your team roster (round 2 feature 22), as its own page until
 * the main build mounts the section on People. The hospital's roles by team
 * stay on Who's on, linked below.
 */
export function OnCallRosterWhosOnPage({ now: pinned }: { now?: Date } = {}) {
  const now = useHospitalClock(pinned);
  const { switchboard, hospitalName } = useRosterSwitchboard();
  return (
    <main data-testid="on-call-roster-whos-on-main" className="min-w-0">
      <WorkBody>
        <h1 className="sr-only">Who is on, from your team roster</h1>
        <OnCallRosterWhosOnSection now={now} switchboard={switchboard} hospitalName={hospitalName} />
        <WorkCard>
          <WorkIconRow
            icon={Building2}
            title="Hospital roles by team"
            sub="Numbers from your hospital's handbook"
            href="/on-call/whos-on"
            testId="on-call-roster-hospital-roles"
          />
        </WorkCard>
      </WorkBody>
    </main>
  );
}

/**
 * The compact "Right now, from your roster" block for On Call Now: who is on
 * at this moment, with a link to the full list. For the main build to mount.
 */
export function OnCallRosterRightNow({ now }: { readonly now: Date }) {
  const { switchboard, hospitalName } = useRosterSwitchboard();
  return <OnCallRosterWhosOnSection now={now} switchboard={switchboard} hospitalName={hospitalName} variant="now" />;
}
