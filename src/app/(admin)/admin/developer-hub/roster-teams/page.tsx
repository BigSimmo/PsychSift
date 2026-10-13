import type { Metadata } from "next";

import { RosterTeamsPanel } from "@/components/developer-area/hub/roster-teams-panel";
import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import { resolveLiveFreshness } from "@/lib/developer-area/freshness";

export const metadata: Metadata = {
  title: "Roster teams · Owner panel · PsychSift",
  description: "Confirm health-service teams and name their roster managers.",
};

export default function Page() {
  return (
    <PanelPageShell
      testId="developer-roster-teams"
      title="Roster teams"
      freshness={resolveLiveFreshness(null, new Date())}
      freshnessLabel="Roster teams"
    >
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        Confirm a team before its members share a roster. Only a signed-in administrator can make changes or see a
        member&apos;s email.
      </p>
      <RosterTeamsPanel />
    </PanelPageShell>
  );
}
