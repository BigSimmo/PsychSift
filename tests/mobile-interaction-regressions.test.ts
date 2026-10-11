import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { differentialDiagnosesCards } from "@/lib/differentials";

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("mobile interaction regressions", () => {
  it("keys diagnosis cards by their unique stable identity", () => {
    const ids = differentialDiagnosesCards.map((card) => card.id);
    const titles = differentialDiagnosesCards.map((card) => card.title);
    const streamSource = source("src/components/differentials/differential-stream-workspace.tsx");

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(titles).size).toBeLessThan(titles.length);
    expect(streamSource).toContain("key={item.id}");
    expect(streamSource).not.toContain("key={item.title}");
    expect(streamSource).not.toContain("key={card.title}");
  });

  it("leaves phone vertical scrolling to the shared shell", () => {
    const presentationSource = source("src/components/differentials/differential-presentation-workflow-page.tsx");
    const favouritesSource = source("src/components/clinical-dashboard/favourites-command-library-page.tsx");
    const differentialsHomeSource = source("src/components/clinical-dashboard/differentials-home.tsx");

    // `sm:grow`, not `sm:min-h-[calc(100dvh-…)]`: these surfaces fill the shell's
    // reserve pad by growing into it. The viewport estimate over-reserved on
    // every route and left dead scroll on pages with nothing left to show.
    expect(presentationSource).toMatch(
      /data-testid="differential-presentation-page"\s+className="[^"]*min-h-0[^"]*overflow-x-clip[^"]*sm:grow/,
    );
    expect(presentationSource).not.toContain("sm:min-h-[calc(100dvh-var(--shell-header-h))]");
    expect(favouritesSource).toMatch(
      /data-testid="favourites-hub"\s+className="[^"]*min-h-0[^"]*overflow-x-clip[^"]*sm:grow/,
    );
    // The xl split rail still reaches the bottom, now against the grown hub.
    expect(favouritesSource).toContain('"grid min-h-0 min-w-0 overflow-x-clip sm:min-h-full"');
    expect(favouritesSource).not.toContain("sm:min-h-[calc(100dvh-var(--shell-header-h))]");
    // overflow-x-hidden would force overflow-y:auto and nest a scrollport under #main-content.
    expect(differentialsHomeSource).toMatch(
      /data-testid="differentials-search-results"[\s\S]*?className="[^"]*overflow-x-clip[^"]*"/,
    );
    expect(differentialsHomeSource).not.toMatch(
      /data-testid="differentials-search-results"[\s\S]*?className="[^"]*overflow-x-hidden[^"]*"/,
    );
  });

  it("keeps the privacy link at the semantic tap size", () => {
    const privacySource = source("src/components/privacy-input-notice.tsx");

    expect(privacySource).toContain("inline-flex min-h-tap items-center");
    expect(privacySource).toContain("sm:min-h-0");
  });

  it("uses the shared mode navigation and keeps the compare dock honest on phone", () => {
    const presentationSource = source("src/components/differentials/differential-presentation-workflow-page.tsx");

    expect(presentationSource).not.toContain("Differential presentation sections");
    expect(presentationSource).not.toContain("Back to differentials");
    expect(presentationSource).not.toContain("Differential breadcrumbs");
    expect(presentationSource).toContain("differentialCompareSearchHref(");
    expect(presentationSource).toContain("Edit selection");
    expect(presentationSource).toContain("Comparing ({workflow.selectedCount})");
    expect(presentationSource).not.toContain("Compare ({workflow.selectedCount} selected)");
    expect(presentationSource).not.toContain("Density controls coming soon");
    expect(presentationSource).not.toContain("Column filters unavailable");
    expect(presentationSource).not.toContain("Edit columns");
  });

  it("does not fake Add success or Tools sort/more menus", () => {
    const visualEvidence = source("src/components/clinical-dashboard/visual-evidence.tsx");
    const evidencePanels = source("src/components/clinical-dashboard/evidence-panels.tsx");
    const tools = source("src/components/applications-launcher-page.tsx");
    const header = source("src/components/clinical-dashboard/master-search-header.tsx");

    // `aria-disabled` + an inert handler, and NOT the native `disabled` attribute
    // alongside it: the native one wins on focus, so pairing them left the reason
    // unreachable by keyboard exactly as if the aria attribute were absent.
    expect(visualEvidence).toContain('title="Add to favourites — coming soon"');
    expect(visualEvidence).toMatch(
      /type="button"\s+aria-disabled="true"\s+onClick=\{ignoreUnavailableActivation\}\s+aria-describedby="visual-evidence-add-unavailable"/,
    );
    expect(visualEvidence).not.toContain("setAdded(true)");
    expect(evidencePanels).toContain('title="Add to favourites — coming soon"');
    expect(evidencePanels).toMatch(
      /type="button"\s+aria-disabled="true"\s+onClick=\{ignoreUnavailableActivation\}\s+aria-describedby="clinical-notes-add-unavailable"/,
    );
    expect(evidencePanels).not.toContain("setAdded(true)");

    expect(tools).toContain("Sorted A to Z");
    expect(tools).not.toContain("Sort by");
    expect(tools).not.toContain("hasMenu");
    expect(tools).toContain('label: "Saved", desktopLabel: "Favourites"');
    expect(tools).toContain('if (filter === "more") return app.area === "coordination" || app.area === "saved";');
    expect(tools).toContain("launcherAppMatchesFilter(app, effectiveFilter)");
    // Tools local search submit is an interactive control: both end tracks and
    // the submit face must read the tap knob (not a leftover h-10 / 2.75rem).
    expect(tools).toContain("grid-cols-[var(--spacing-tap)_minmax(0,1fr)_var(--spacing-tap)]");
    expect(tools).toMatch(
      /data-testid="tools-local-search-submit"[\s\S]{0,120}?className=\{cn\(\s*"grid h-tap w-tap place-items-center/,
    );

    expect(header).toContain('pushIfLeaveConfirmed("/dsm/compare")');
    expect(header).toContain('pushIfLeaveConfirmed("/specifiers/builder")');
    expect(header).toContain('pushIfLeaveConfirmed("/formulation/map")');
    expect(header).not.toContain("window.location.assign");
  });
});
