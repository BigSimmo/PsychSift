import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS } from "@/components/clinical-dashboard/settings-sections";
import { HUB_PANELS, panelsInGroup } from "@/lib/developer-area/hub-panels";
import { toolCatalogRecords } from "@/lib/tools-catalog";
import { CARE_PLAN_ROUTES } from "@/components/care-plan/mockups/routes";
import { loadRepoAwarenessSnapshot } from "@/lib/developer-area/repo-awareness-snapshot";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("hub panels", () => {
  it("gives every built panel a destination and every planned panel none", () => {
    for (const panel of HUB_PANELS) {
      if (panel.phase === 1) expect(panel.href, `${panel.id} is built but has no href`).toBeTruthy();
      else expect(panel.href, `${panel.id} is planned but has an href`).toBeUndefined();
    }
  });

  it("has unique ids", () => {
    expect(new Set(HUB_PANELS.map((panel) => panel.id)).size).toBe(HUB_PANELS.length);
  });

  it("places every panel in exactly one group", () => {
    const total = (["work", "clinical", "system", "reference"] as const).reduce(
      (sum, group) => sum + panelsInGroup(group).length,
      0,
    );
    expect(total).toBe(HUB_PANELS.length);
  });

  it("ships the ledger as a phase 1 panel", () => {
    const ledger = HUB_PANELS.find((panel) => panel.id === "task-ledger");
    expect(ledger?.phase).toBe(1);
    expect(ledger?.href).toBe("/admin/developer-hub/ledger");
  });

  it("links one clinical trust cockpit from the existing clinical group", () => {
    const clinicalTrust = HUB_PANELS.filter((panel) => panel.href === "/admin/developer-hub/clinical-trust");
    expect(clinicalTrust).toHaveLength(1);
    expect(clinicalTrust[0]).toMatchObject({ id: "clinical-trust", phase: 1, group: "clinical" });
  });

  it("keeps the existing prototypes reachable as real destinations", () => {
    for (const id of ["care-plan"]) {
      const panel = HUB_PANELS.find((entry) => entry.id === id);
      expect(panel?.phase, `${id} should be built`).toBe(1);
      expect(panel?.href, `${id} needs a destination`).toBeTruthy();
    }

    // Prototypes stay out of the live Tools catalogue mockup tree; Settings still offers Developer.
    expect(toolCatalogRecords.some((tool) => tool.href.startsWith("/mockups/"))).toBe(false);
    expect(SETTINGS_SECTIONS.some((section) => section.id === "development")).toBe(true);
  });

  it("keeps the Care Plan href in sync with its route source", () => {
    const panel = HUB_PANELS.find((entry) => entry.id === "care-plan");
    expect(panel?.href).toBe(CARE_PLAN_ROUTES.home);
  });

  it("never points a card at its own section", () => {
    // A card whose href is a fragment on this same page is a self-link, not a
    // destination. Both original offenders (`environment`, `prototypes`) were
    // removed for this reason.
    for (const panel of HUB_PANELS) {
      expect(panel.href?.startsWith("#"), `${panel.id} self-links`).not.toBe(true);
    }
  });
});

describe("phase 2 panels", () => {
  it("leaves no phase 2 entry behind", () => {
    expect(HUB_PANELS.filter((panel) => panel.phase === 2)).toEqual([]);
  });

  it("no longer lists the four engineering panels the owner retired", () => {
    for (const id of ["routes", "documentation", "test-health", "work-in-flight"]) {
      expect(
        HUB_PANELS.find((entry) => entry.id === id),
        id,
      ).toBeUndefined();
    }
  });

  it("keeps every phase-1 panel's href pointing at a route that exists", () => {
    // Guards the one failure this flip can introduce: a card that navigates to
    // a 404. Checked against the generated route list rather than a hand copy.
    const snapshot = loadRepoAwarenessSnapshot();
    const routePaths = new Set([
      ...snapshot.routes.pages.map((page) => page.path),
      // A redirect is a real address a card may legitimately point at; it is
      // only excluded from `pages` so it is not listed twice.
      ...snapshot.routes.redirects.map((redirect) => redirect.path),
    ]);
    for (const panel of HUB_PANELS) {
      if (panel.phase !== 1 || !panel.href) continue;
      // An external panel points at a static file under `public/`, which the
      // route manifest does not and should not list. Its existence is checked
      // against the filesystem below instead.
      if (panel.external) continue;
      expect(routePaths.has(panel.href), `${panel.id} -> ${panel.href}`).toBe(true);
    }
  });
});

describe("ingestion panel (2026-08-25)", () => {
  it("flips from a phase 3 placeholder to a built panel with its real href", () => {
    const panel = HUB_PANELS.find((entry) => entry.id === "ingestion");
    expect(panel).toBeDefined();
    expect(panel!.phase).toBe(1);
    expect(panel!.href).toBe("/admin/developer-hub/ingestion");
    expect(panel!.group).toBe("system");
  });
});

describe("clinical sign-off queue panel (2026-09-18)", () => {
  it("ships in the clinical group with the route it names", () => {
    const panel = HUB_PANELS.find((entry) => entry.id === "clinical-sign-off");
    expect(panel).toBeDefined();
    expect(panel!.phase).toBe(1);
    expect(panel!.group).toBe("clinical");
    expect(panel!.href).toBe("/admin/developer-hub/clinical-sign-off");
  });

  it("never lets the card claim completeness or the power to sign anything off", () => {
    // Two failure modes, both worse than no card. "Every clinical record" is a
    // coverage claim the page cannot make good on -- it reads the seven families
    // this repository holds on disk and knows nothing about any other. And the
    // page is read-only aggregation, so a verb suggesting it approves, publishes
    // or clears records would promise a control that does not exist.
    const panel = HUB_PANELS.find((entry) => entry.id === "clinical-sign-off");
    expect(panel!.summary).not.toMatch(/\ball\b|\bevery\b|complete/i);
    expect(panel!.summary).not.toMatch(/approve|publish|clear|unhide/i);
  });
});

describe("placeholder pruning (2026-08-25)", () => {
  // `errors`, `budgets`, `commands`, `decision-log` and `database-drift` were
  // deliberately removed, not renamed or moved — each restated a fact a gate
  // or another document already guarantees (Sentry, the
  // bundle/lighthouse/maintainability budgets, docs/scripts-index.md,
  // docs/decisions/, and live-drift.yml respectively). This pins the removal
  // so a future edit does not silently re-add one believing it was forgotten.
  it("no longer declares the five removed placeholders", () => {
    for (const id of ["errors", "budgets", "commands", "decision-log", "database-drift"]) {
      expect(
        HUB_PANELS.find((panel) => panel.id === id),
        `${id} should have been removed`,
      ).toBeUndefined();
    }
  });

  it("kept hazard-register through the pruning, and built it rather than dropping it", () => {
    // Distinguishes "removed for restating an already-guaranteed fact" from
    // "still to build" — hazard-register was the latter, reconsidered as a
    // clinical-safety surface rather than dropped, and built on 2026-09-08.
    // The assertion moved from phase 4 to phase 1 with it; what it pins is
    // unchanged, that this id is never quietly removed.
    const panel = HUB_PANELS.find((entry) => entry.id === "hazard-register");
    expect(panel).toBeDefined();
    expect(panel!.phase).toBe(1);
    expect(panel!.href).toBe("/admin/developer-hub/hazards");
    // The one wording trap on this card: it must not claim to cover every
    // clinical risk. Three of the four uncontrolled rows are reviews nobody has
    // convened, so a completeness claim here would be the first untrue thing on
    // the hub.
    expect(panel!.summary).not.toMatch(/\ball\b|\bevery\b|complete/i);
  });

  it("leaves every remaining group non-empty, so the hub never has to hide a panel-less section", () => {
    for (const group of ["work", "clinical", "system", "reference"] as const) {
      expect(panelsInGroup(group).length, `${group} group is now empty`).toBeGreaterThan(0);
    }
  });
});

describe("the brand sheet the hub links to", () => {
  // The hub's "Brand and design" card is the only panel that leaves the app for
  // a static file. Two things have to hold or the card is worse than no card:
  // the file has to be there, and it has to be the same sheet the repository
  // documents — a stale copy would show a retired mark to the one person most
  // likely to trust it.
  const panel = HUB_PANELS.find((entry) => entry.id === "brand");

  it("is declared external, so it renders as an anchor rather than a Link", () => {
    expect(panel?.external).toBe(true);
    expect(panel?.href).toBe("/brand/preview.html");
  });

  it("is served from public/ and is byte-identical to the documented sheet", () => {
    const served = readFileSync(join(process.cwd(), "public", "brand", "preview.html"));
    const documented = readFileSync(join(process.cwd(), "docs", "brand", "preview.html"));
    const digest = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
    expect(
      digest(served),
      "public/brand/preview.html has drifted from docs/brand/preview.html — copy the documented sheet over the served one so the Developer Hub link cannot show a retired mark",
    ).toBe(digest(documented));
  });
});
