import type { Metadata } from "next";

import { OnCallFreshnessPanel } from "@/components/developer-area/hub/on-call-freshness-panel";
import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import { resolveLiveFreshness } from "@/lib/developer-area/freshness";

export const metadata: Metadata = {
  title: "On Call freshness · Developer · PsychSift",
  description: "Which On Call entries are overdue for confirmation, read live.",
};

export default function DeveloperOnCallFreshnessPage() {
  /**
   * Live rather than a build-time snapshot, following the ingestion panel:
   * `OnCallFreshnessPanel` is a Client Component reading `/api/on-call/entries`
   * on mount. Staleness is derived at read time and never stored, so a snapshot
   * stamped at build would be answering about a hub that has since moved on.
   */
  const freshness = resolveLiveFreshness(null, new Date());

  return (
    <PanelPageShell
      testId="developer-on-call-freshness"
      title="On Call freshness"
      freshness={freshness}
      freshnessLabel="On Call entries"
    >
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        An On Call entry is overdue once it has never been confirmed, or was last confirmed more than twelve months ago.
        This is reported here rather than on the On Call home: someone opening the hub mid-shift is looking for a
        number, and what needs re-checking is a maintenance question. Each entry still carries its own badge inside its
        section, where confirming it is one tap.
      </p>
      <OnCallFreshnessPanel />
    </PanelPageShell>
  );
}
