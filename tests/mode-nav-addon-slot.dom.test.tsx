import { readdirSync, readFileSync } from "node:fs";
import { join, relative as relativePath, sep } from "node:path";

import { render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isHeaderAddonSlotOwnedRoute } from "@/components/mode-nav/header-addon-slot";
import { DifferentialPresentationWorkflowPage } from "@/components/differentials/differential-presentation-workflow-page";
import { hasLocalInformationPageNavigation, PageSecondaryNavigation } from "@/components/page-secondary-navigation";
import { resolveDifferentialCompareHandoff } from "@/lib/differentials";
import { phoneHeaderCollapseAddonSlotId } from "@/lib/mode-home-composer";

// Cross-mode "also matches" panel is an AuthProvider-backed component of its own;
// it is exercised by tests/ui-universal-search.spec.ts, not by this page's unit test.
vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));
import {
  MODE_NAV_ADOPTED_MODES,
  modeSecondaryNavigationEntries,
  modeUsesHeaderModeNav,
} from "@/lib/mode-secondary-navigation";

const navigationState = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

/** The universal header's single addon slot, as `master-search-header` renders it. */
function renderIntoHeaderWithAddonSlot(ui: React.ReactElement) {
  const slot = document.createElement("div");
  slot.id = phoneHeaderCollapseAddonSlotId;
  document.body.append(slot);
  const result = render(ui);
  return {
    ...result,
    occupants: () => slot.querySelectorAll<HTMLElement>('[data-testid="mode-nav"]'),
    cleanupSlot: () => slot.remove(),
  };
}

describe("header addon slot ownership", () => {
  afterEach(() => {
    navigationState.pathname = "/";
    for (const slot of document.querySelectorAll(`#${phoneHeaderCollapseAddonSlotId}`)) {
      slot.remove();
    }
  });

  it("recognises the routes whose page portals its own header", () => {
    expect(isHeaderAddonSlotOwnedRoute("/differentials/diagnoses/delirium")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/documents/11111111-1111-4111-8111-111111111111")).toBe(true);
    // The six information routes converted onto `InPageNavHeader`.
    expect(isHeaderAddonSlotOwnedRoute("/services/community-team")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/forms/transport-crisis-form")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/specifiers/with-anxious-distress")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/formulation/rumination")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/dsm/diagnoses/major-depressive-disorder")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/dsm/diagnoses/major-depressive-disorder/differentials")).toBe(true);
    // Every On Call route claims the slot: the section pages and the dashboard
    // mount `RegistryModeNav` themselves, and `/on-call/card` mounts the mode's
    // one remaining `InPageNavHeader`. They have to mount it themselves — all of
    // them are information pages, so `PageSecondaryNavigation` returns null
    // before the mode branch and the shell cannot draw this mode's bar.
    expect(isHeaderAddonSlotOwnedRoute("/on-call/contacts")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/on-call/playbook")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/on-call/referrals")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/on-call/orientation")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/on-call/education")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/on-call/who-is-who")).toBe(true);
    // On Call's Admin page moved to Admin > Help (Admin update 1). Admin's three
    // sub-pages mount `AdminNavHeader`; its Today page mounts none.
    expect(isHeaderAddonSlotOwnedRoute("/admin/help")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/admin/renewals")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/admin/new-job")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/admin")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/on-call/card")).toBe(true);
    // The mode home is a dashboard now, not a redirect stub, and it mounts the
    // rail like every other page in the mode.
    expect(isHeaderAddonSlotOwnedRoute("/on-call")).toBe(true);
    // `/on-call/search` no longer exists — the mode declares no search surface —
    // so nothing claims it.
    expect(isHeaderAddonSlotOwnedRoute("/on-call/search")).toBe(false);
    // CPD's five page families claim the slot through their own tab row or read header.
    expect(isHeaderAddonSlotOwnedRoute("/cme/programme")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/cme/setup")).toBe(true);
    for (const pathname of [
      "/cme",
      "/cme/check",
      "/cme/log",
      "/cme/routines",
      "/cme/plan",
      "/cme/calendar",
      "/cme/training",
      "/cme/learning",
    ]) {
      expect(isHeaderAddonSlotOwnedRoute(pathname)).toBe(true);
    }
    expect(isHeaderAddonSlotOwnedRoute("/cme/new")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/cme/summary")).toBe(false);
    // One activity and Customise mount the breadcrumb `CmeDetailNavHeader`.
    // The activity matcher is exactly one segment under `/cme/log/`.
    expect(isHeaderAddonSlotOwnedRoute("/cme/log/cme-2026-001")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/cme/customise")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/cme/log/cme-2026-001/evidence")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/cme/log/")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/cme/logbook")).toBe(false);
    // Every First Nations route claims the slot: the mode home and every
    // section mount `FirstNationsNavHeader` themselves.
    expect(isHeaderAddonSlotOwnedRoute("/first-nations")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/first-nations/contacts")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/first-nations/talking")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/first-nations/family")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/first-nations/mental-health")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/first-nations/on-the-ward")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/first-nations/mistakes")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/first-nations/going-home")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/first-nations/end-of-life")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/first-nations/card")).toBe(true);
    // Teaching claims the slot on exactly the two pages that mount
    // `TeachingNavHeader`. Its four top pages use the pages sheet instead.
    expect(isHeaderAddonSlotOwnedRoute("/teaching/session/11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/teaching/session/11111111-1111-4111-8111-111111111111/check-in")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/teaching")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/teaching/week")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/teaching/organise")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/teaching/c/complete")).toBe(false);
    // Factsheet and medication detail, converted onto the shared header.
    expect(isHeaderAddonSlotOwnedRoute("/factsheets/sertraline")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/medications/sertraline")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/medications")).toBe(false);

    // The developer hub index portals `DeveloperHubNavHeader`; its `/ledger`
    // child route owns no header of its own, so it must stay outside the
    // claimant set even though it shares the hub's path prefix.
    expect(isHeaderAddonSlotOwnedRoute("/mockups/development")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/mockups/development/ledger")).toBe(false);

    // The presentations workflow owns the shared mode bar with its resolved
    // catalogue selection, while the shell index is not a document detail route.
    expect(isHeaderAddonSlotOwnedRoute("/differentials/presentations/acute-confusion-encephalopathy")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/documents/search")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/differentials/diagnoses")).toBe(false);
    // Mode homes and the builder/compare/map/search surfaces keep the mode bar,
    // so they must stay outside the claimant set.
    expect(isHeaderAddonSlotOwnedRoute("/services")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/specifiers/compare")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/formulation/builder")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/dsm/search")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/dsm/compare")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/factsheets/search")).toBe(false);
    expect(isHeaderAddonSlotOwnedRoute("/factsheets/topics")).toBe(false);
  });

  it("is covered, route for route, by the locally-owned early return", () => {
    // This is the load-bearing assertion. Nothing in `PageSecondaryNavigation`
    // states "do not mount a bar where the page owns the slot" — what keeps the
    // slot to one occupant is that every claimant route happens to also be
    // `hasLocalInformationPageNavigation`, which returns null well before the
    // mode branch. Two independently maintained lists agreeing by coincidence.
    //
    // A future claimant outside that cover reaches the mode branch and mounts a
    // second header into an occupied slot. This fails when that happens, and
    // the fix is an explicit guard at the mode branch.
    //
    // `/mockups/development` is deliberately not in this list. It is a claimant
    // (see the test above and the "names every component" test below), but it
    // never reaches `PageSecondaryNavigation` at all: `/mockups/**` has its own
    // layout (`src/app/mockups/layout.tsx`), outside the `(search-app)` route
    // group and its `AppModeId`-keyed shell, so there is no `modeId` for which
    // `PageSecondaryNavigation` would ever be asked to render on this path. The
    // coincidence this test guards — a mode-nav route also being locally-owned
    // information navigation — has nothing to say about a route that isn't a
    // mode-nav route in the first place.
    for (const pathname of [
      "/differentials/diagnoses/delirium",
      "/differentials/presentations/acute-confusion-encephalopathy",
      "/documents/11111111-1111-4111-8111-111111111111",
      "/documents/11111111-1111-4111-8111-111111111111/source",
      "/services/community-team",
      "/forms/transport-crisis-form",
      "/specifiers/with-anxious-distress",
      "/formulation/rumination",
      "/dsm/diagnoses/major-depressive-disorder",
      "/dsm/diagnoses/major-depressive-disorder/differentials",
      "/factsheets/sertraline",
      "/medications/sertraline",
      "/on-call/contacts",
      "/on-call/playbook",
      "/on-call/referrals",
      "/on-call/orientation",
      "/on-call/education",
      "/admin/renewals",
      "/admin/new-job",
      "/admin/help",
      "/cme/programme",
      "/cme/setup",
      "/cme",
      "/cme/check",
      "/cme/log",
      "/cme/routines",
      "/cme/plan",
      "/cme/calendar",
      "/cme/training",
      "/cme/learning",
      "/cme/log/cme-2026-001",
      "/cme/customise",
      "/first-nations",
      "/first-nations/contacts",
      "/first-nations/talking",
      "/first-nations/family",
      "/first-nations/mental-health",
      "/first-nations/on-the-ward",
      "/first-nations/mistakes",
      "/first-nations/going-home",
      "/first-nations/end-of-life",
      "/first-nations/card",
      "/teaching/session/11111111-1111-4111-8111-111111111111",
      "/teaching/session/11111111-1111-4111-8111-111111111111/check-in",
    ]) {
      expect(isHeaderAddonSlotOwnedRoute(pathname)).toBe(true);
      expect(hasLocalInformationPageNavigation(pathname)).toBe(true);
    }
  });

  it("renders no bar on a claimant route, even for an adopted mode", async () => {
    // Behavioural pin on the outcome the cover above produces. Differentials is
    // adopted and carries three destinations, so the old incidental protection
    // — fewer than MODE_NAV_MIN_ITEMS, ModeNav renders nothing — no longer
    // applies to it.
    expect(modeUsesHeaderModeNav("differentials")).toBe(true);

    const view = renderIntoHeaderWithAddonSlot(
      <PageSecondaryNavigation
        modeId="differentials"
        pathname="/differentials/diagnoses/delirium"
        hasSubmittedSearch
      />,
    );
    await waitFor(() => expect(view.occupants()).toHaveLength(0));
    view.cleanupSlot();
  });

  it("gives adopted modes' own workflow routes exactly one bar in the slot", async () => {
    expect(modeUsesHeaderModeNav("dsm")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/dsm/compare")).toBe(false);

    const view = renderIntoHeaderWithAddonSlot(
      <PageSecondaryNavigation modeId="dsm" pathname="/dsm/compare" hasSubmittedSearch={false} />,
    );
    await waitFor(() => expect(view.occupants()).toHaveLength(1));
    view.cleanupSlot();

    expect(modeUsesHeaderModeNav("differentials")).toBe(true);
    expect(isHeaderAddonSlotOwnedRoute("/differentials/presentations/acute-confusion-encephalopathy")).toBe(true);
    expect(hasLocalInformationPageNavigation("/differentials/presentations/acute-confusion-encephalopathy")).toBe(true);

    const differentialView = renderIntoHeaderWithAddonSlot(
      <PageSecondaryNavigation
        modeId="differentials"
        pathname="/differentials/presentations/acute-confusion-encephalopathy"
        hasSubmittedSearch={false}
      />,
    );
    await waitFor(() => expect(differentialView.occupants()).toHaveLength(0));
    differentialView.cleanupSlot();
  });

  it("keeps the ad-hoc compare workspace to one shell-owned Compare bar", async () => {
    navigationState.pathname = "/differentials/compare";
    const handoff = resolveDifferentialCompareHandoff(
      ["medical-gi-endocrine-painful-organic-cause", "bpsd-as-unmet-need-delirium-pain-mimic"],
      "Pain",
    );
    expect(handoff.kind).toBe("ad-hoc");
    if (handoff.kind !== "ad-hoc") throw new Error("Expected an ad-hoc differential comparison");

    const searchParamString = new URL(handoff.href, "http://differentials.test").searchParams.toString();
    const view = renderIntoHeaderWithAddonSlot(
      <>
        <PageSecondaryNavigation
          modeId="differentials"
          pathname="/differentials/compare"
          hasSubmittedSearch={false}
          searchParamString={searchParamString}
        />
        <DifferentialPresentationWorkflowPage
          query="Pain"
          selectedIds={handoff.selection.diagnosisIds}
          workflow={handoff.selection.workflow}
        />
      </>,
    );

    await waitFor(() => expect(view.occupants()).toHaveLength(1));
    const shellBar = within(view.occupants()[0]!);
    expect(shellBar.getByRole("link", { name: "Compare" })).toHaveAttribute("aria-current", "page");
    expect(shellBar.getByRole("link", { name: "Presentations" })).not.toHaveAttribute("aria-current");
    view.cleanupSlot();
  });

  it("keeps a default presentation comparison selection in its shared Compare link", async () => {
    const view = renderIntoHeaderWithAddonSlot(
      <DifferentialPresentationWorkflowPage presentationSlug="acute-confusion-encephalopathy" />,
    );

    await waitFor(() => expect(view.occupants()).toHaveLength(1));
    expect(within(view.occupants()[0]!).getByRole("link", { name: "Compare" })).toHaveAttribute(
      "href",
      "/differentials/compare?ids=delirium%2Csubstance-intoxication%2Csubstance-withdrawal%2Cpost-ictal-confusion",
    );
    view.cleanupSlot();
  });

  it("names every component that claims the slot", () => {
    // The only evidence a route claims the slot is that its component renders
    // into it, so the predicate cannot be derived from routes alone. Enumerate
    // the claimants instead: a new one fails here until
    // `isHeaderAddonSlotOwnedRoute` is given its route.
    //
    // There are three forms of that evidence, and all must be scanned. A page can
    // render `PhoneHeaderCollapsePortal` itself (DocumentViewer still does), use
    // `InPageNavHeader`, or render the shared `RegistryModeNav` directly.
    const claimsSlot = /<(PhoneHeaderCollapsePortal|InPageNavHeader|RegistryModeNav)\b/;
    // The shared header and shell adapter are mechanisms, not claimants: neither
    // represents a route that can own the slot on its own.
    const sharedHeader = "src/components/in-page-nav/in-page-nav-header.tsx";
    const shellModeNav = "src/components/page-secondary-navigation.tsx";
    const claimants: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.name.endsWith(".tsx")) continue;
        // Design-scratch routes 404 in production and own no header.
        if (entry.name.includes("-mockups")) continue;
        // Posix separators regardless of host: a `String.replace` of
        // `${cwd}/` matches nothing on Windows, so both the shared-header
        // exclusion below and the comparison at the end silently missed.
        const relative = relativePath(process.cwd(), path).split(sep).join("/");
        if (relative === sharedHeader || relative === shellModeNav) continue;
        if (claimsSlot.test(readFileSync(path, "utf8"))) {
          claimants.push(relative);
        }
      }
    };
    walk(join(process.cwd(), "src/components"));

    // The `*-nav-header.tsx` modules are the section-table siblings
    // `docs/search-chrome-behaviour.md` pins every new conversion to. For the
    // five Server Component pages they are also a necessity — sections carry
    // `LucideIcon` values and the header needs hooks, neither of which crosses
    // the RSC boundary — while `factsheet-` and `medication-nav-header.tsx`
    // adopt the same shape from Client Component pages by convention. Either
    // way the route's claim is registered in the sibling, not the page.
    // `developer-hub-nav-header.tsx` is the fifth: `DeveloperHubPage` (the
    // `/mockups/development` index) is a Server Component for the same reason
    // — its sections carry `LucideIcon` values and the header itself needs
    // hooks (`useInPageSectionNav`).
    expect(claimants.sort()).toEqual([
      "src/components/DocumentViewer.tsx",
      // Work-mode redesign, owner request 6 Oct 2026: Admin's section chips now sit
      // inside the page (the shared chip row), so `admin-nav-header.tsx` no longer
      // claims the header slot. The work frame's own tabs fill that place.
      "src/components/clinical-dashboard/medication-nav-header.tsx",
      // CME's Programme and Setup pages share one `*-nav-header.tsx` sibling
      // (`cmeSections` is a superset the header narrows per render), so the
      // whole mode's claim is registered in this one file. The breadcrumb
      // header for one activity and Customise (`CmeDetailNavHeader`) lives
      // there too.
      // `cme-page-tabs.tsx` no longer claims the slot: the mode band now carries
      // CPD's page tabs, and its sub-page chips sit in page flow under it. The
      // `/cme` routes stay registered so the shell never adds a second nav.
      "src/components/cme/cme-nav-header.tsx",
      "src/components/developer-area/developer-hub-nav-header.tsx",
      "src/components/dictionary/dictionary-catalogue-pages.tsx",
      "src/components/dictionary/dictionary-term-page.tsx",
      "src/components/differentials/differential-detail-page.tsx",
      "src/components/differentials/differential-presentation-workflow-page.tsx",
      "src/components/dsm/dsm-diagnosis-nav-header.tsx",
      "src/components/dsm/dsm-differential-considerations-page.tsx",
      "src/components/factsheets/factsheet-nav-header.tsx",
      // First Nations' own header, mounted on the mode home and every section.
      "src/components/first-nations/first-nations-nav-header.tsx",
      "src/components/forms/form-detail-page.tsx",
      "src/components/formulation/formulation-nav-header.tsx",
      // On Call now follows the sibling convention exactly: both its headers —
      // the essentials card's and the section pages' — live in
      // `on-call-nav-header.tsx`, and nothing else in the mode claims the slot.
      //
      // Two files came off this list when the shared rail did. The section page
      // mounted `RegistryModeNav` until that bar turned out to be listing the
      // same nine destinations the mode pill already opens; the home mounted it
      // too, on a page whose tile grid IS the section list. The home's page
      // menu goes to the universal header's TRAILING slot, which is a different
      // host and not this one.
      "src/components/on-call/on-call-nav-header.tsx",
      // Roster manage owns its own header for the manager surface.
      "src/components/roster/manage/roster-manage-nav-header.tsx",
      "src/components/services/service-detail-page.tsx",
      // The source record has no section index, so it renders the header's
      // breadcrumb shape (back, title) straight from the Server Component page
      // and needs no `*-nav-header.tsx` sibling to carry hooks or icons.
      "src/components/sources/sources-pages.tsx",
      "src/components/specifiers/specifier-nav-header.tsx",
      "src/components/teaching/teaching-nav-header.tsx",
      "src/components/therapy-compass/therapy-record-nav-header.tsx",
    ]);
  });

  it("keeps the modes that register no destinations off the bar entirely", () => {
    // These four each carried a single `action` entry that focused a composer
    // already on screen. It was deleted rather than adopted: a one-button <nav>
    // is a landmark and a tab stop spent on a no-op, and ModeNav renders
    // nothing below two items, so adopting would have removed the control and
    // put nothing back (PR #1645). They now have neither the header bar nor the
    // in-flow strip.
    //
    // `factsheets` left this list when it gained a real second destination:
    // `/factsheets/topics` (browse) and `/factsheets/search` are separate
    // components, so it was a port rather than a deletion.
    for (const modeId of ["documents", "answer", "prescribing", "tools"] as const) {
      expect(modeSecondaryNavigationEntries(modeId)).toEqual([]);
      expect([...MODE_NAV_ADOPTED_MODES]).not.toContain(modeId);
      expect(modeUsesHeaderModeNav(modeId)).toBe(false);
    }
  });
});
