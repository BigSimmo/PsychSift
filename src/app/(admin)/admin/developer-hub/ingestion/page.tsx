import type { Metadata } from "next";

import { IngestionPanel } from "@/components/developer-area/hub/ingestion-panel";
import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import { resolveLiveFreshness } from "@/lib/developer-area/freshness";

export const metadata: Metadata = {
  title: "Ingestion · Developer · PsychSift",
  description: "Whether an uploaded document actually indexed — queued, processing, finished, or stuck — read live.",
};

export default function DeveloperIngestionPage() {
  /**
   * Every other Phase 1/2 panel stamps "content as of <build time>", read from
   * a snapshot committed at build time. This page is deliberately live (plan §3,
   * Ruling I1, #XKS6FD): `IngestionPanel` is a Client Component that polls
   * `/api/ingestion/jobs` live. Using `resolveLiveFreshness` stamps the page as
   * "read live on demand" rather than claiming "revision unknown" (#XKS6FD).
   */
  const freshness = resolveLiveFreshness(null, new Date());

  return (
    <PanelPageShell
      testId="developer-ingestion"
      title="Ingestion"
      freshness={freshness}
      freshnessLabel="Ingestion jobs"
    >
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        Whether an uploaded document actually indexed — queued, processing, finished, or stuck — read live from the same
        endpoint the app itself uses, not from a build-time snapshot.
      </p>
      <IngestionPanel />
    </PanelPageShell>
  );
}
