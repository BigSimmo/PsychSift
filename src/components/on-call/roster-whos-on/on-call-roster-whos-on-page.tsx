"use client";

import { Building2, ChevronLeft } from "lucide-react";

import { focusRing } from "@/components/card-recipes";
import { ContextualBackLink } from "@/components/contextual-back-link";

import { OnCallRosterWhosOnSection } from "@/components/on-call/roster-whos-on/on-call-roster-whos-on-section";
import { useHospitalClock } from "@/components/on-call/use-hospital-clock";
import { useHospitalHandbook } from "@/components/on-call/use-hospital-handbook";
import { WorkBody, WorkCard, WorkIconRow } from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";
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
        <ContextualBackLink
          fallbackHref="/on-call/whos-on"
          data-testid="on-call-roster-back"
          className={cn(
            focusRing,
            "-ml-1 inline-flex min-h-12 w-fit items-center gap-1 text-sm font-medium text-[color:var(--mode-identity)] no-underline",
          )}
        >
          <ChevronLeft aria-hidden="true" className="size-icon-sm" />
          Who&apos;s on
        </ContextualBackLink>
        {/* The one heading for the list. The section's visible label is not a second heading. */}
        <h1 id="on-call-roster-page-heading" className="sr-only">
          Who is on, from your team roster
        </h1>
        <OnCallRosterWhosOnSection
          now={now}
          switchboard={switchboard}
          hospitalName={hospitalName}
          pageHeadingId="on-call-roster-page-heading"
        />
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
