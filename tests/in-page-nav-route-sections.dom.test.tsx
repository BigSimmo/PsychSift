import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DeveloperHubPage from "@/app/(admin)/admin/developer-hub/page";
import {
  MEDICATION_TAB_IDS,
  medicationNavSections,
  medicationSectionsByTab,
} from "@/components/clinical-dashboard/medication-nav-header";
import { MedicationRecordPage } from "@/components/clinical-dashboard/medication-record-page";
import { developerHubNavSections } from "@/components/developer-area/developer-hub-nav-header";
import { DsmDiagnosisPage } from "@/components/dsm/dsm-diagnosis-page";
import { dsmDiagnosisNavSections } from "@/components/dsm/dsm-diagnosis-nav-header";
import {
  DsmDifferentialConsiderationsPage,
  dsmDifferentialNavSections,
  type DsmDifferentialConsideration,
} from "@/components/dsm/dsm-differential-considerations-page";
import { FactsheetDetailPage } from "@/components/factsheets/factsheet-detail-page";
import { factsheetNavSections } from "@/components/factsheets/factsheet-nav-header";
import { factsheets, type Factsheet } from "@/components/factsheets/factsheets-data";
import { FormDetailPage, formNavSections } from "@/components/forms/form-detail-page";
import { FormulationMechanismPage } from "@/components/formulation/formulation-mechanism-page";
import { formulationNavSections } from "@/components/formulation/formulation-nav-header";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { sectionTargetIds, type PageSection } from "@/components/in-page-nav/page-section-index";
import { ServiceDetailPage, serviceNavSections } from "@/components/services/service-detail-page";
import { specifierNavSections } from "@/components/specifiers/specifier-nav-header";
import { specifierMapSections } from "@/components/specifiers/specifier-map-nav-header";
import { SpecifierMapPage } from "@/components/specifiers/specifier-map-page";
import { SpecifierRecordPage } from "@/components/specifiers/specifier-record-page";
import { SpecifierReferencePage } from "@/components/specifiers/specifier-reference-page";
import { dsmDiagnoses } from "@/lib/dsm";
import { formRecords } from "@/lib/forms";
import { loadMedicationSnapshot } from "@/lib/medication-snapshot";
import { formulationMechanisms } from "@/lib/formulation";
import { serviceRecords } from "@/lib/services";
import { specifierCatalogItems, curatedEnrichmentFor } from "@/lib/specifiers-content";
import { specifierRecords } from "@/lib/specifiers";

/**
 * `/admin/developer-hub` is the only async route in this table, and the only one
 * that would otherwise reach Supabase from a cross-route navigation contract.
 * Its facts are stubbed so this file keeps testing anchors, not data access;
 * `tests/developer-hub-environment-facts.test.ts` owns that half.
 */
vi.mock("@/lib/developer-area/environment-facts", () => ({
  resolveHubEnvironmentFacts: async () => ({ demoMode: true, documentCount: null, email: null }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    isSaved: () => false,
    isAuthenticated: true,
    setFavourite: vi.fn(async () => true),
  }),
}));

// The medication page refreshes its record through a live owner-aware fetch and
// mounts two data-owning sidebar panels. None of that is section navigation, so
// the page runs on its SSR fallback record here — exactly the content-first
// state `tests/medication-record-page.dom.test.tsx` pins.
vi.mock("@/components/clinical-dashboard/use-medication-catalog", () => ({
  useMedicationDetail: () => ({ data: null, loading: false, error: null }),
}));
// Same reasoning for the DSM diagnosis page: its cross-mode rail reads the
// owner-scoped service/form registries through AuthProvider, which this file
// does not mount. The rail renders nothing when no mode matches, so stubbing it
// leaves the anchor set under test untouched.
vi.mock("@/components/clinical-dashboard/cross-mode-links", () => ({
  CrossModeLinksSection: () => null,
}));
vi.mock("@/components/clinical-dashboard/patient-profile-panel", () => ({ PatientProfilePanel: () => null }));
vi.mock("@/components/clinical-dashboard/medication-considerations", () => ({
  MedicationConsiderations: () => null,
  MedicationInteractionCallout: () => null,
}));

afterEach(cleanup);

/**
 * The guard `/issues #256` asks for, and the one the pill rail never had.
 *
 * The rail declared section sets in a table beside the pages rather than inside
 * them, and `AvailableInformationPageNavigation` silently dropped any section
 * whose anchor was missing — so a set could rot to nothing and the only symptom
 * was a route quietly drawing no navigation. Two routes were in exactly that
 * state when this was written: `/dsm/diagnoses/<slug>` rendered three of five
 * declared anchors, and its `/differentials` child rendered one of four.
 *
 * The stop rule from that issue is what shapes this file: **assert against the
 * rendered DOM, never a source grep**. Several anchors reach the DOM through a
 * prop (`SpecifierSafetyNote id=…`, the local `Section` helper on the services
 * page), so a scan for `id="…"` reports live sections as dead.
 */
type RouteCase = {
  name: string;
  sections: readonly PageSection[];
  /**
   * Async because a route component may be an async Server Component —
   * `/admin/developer-hub` awaits its environment facts. Callers must `await`
   * this before handing it to `render`.
   */
  render: () => ReactElement | Promise<ReactElement>;
  /**
   * Anchors that legitimately depend on the record. Each is asserted present on
   * a fixture that has the data and absent on one that does not, rather than
   * being skipped.
   */
  conditional?: readonly string[];
  /**
   * Declared sections this fixture legitimately does not render, because no
   * fixture of its kind carries the data (the therapy and procedure factsheets
   * are each alone in their category, so neither has a "More in topic" list).
   *
   * These are asserted *absent* rather than skipped: an unrendered anchor is
   * the case `useResolvedPageSections` must drop, so proving it is missing is
   * as load-bearing as proving the others are present. Do not use this to
   * silence a section that should render.
   */
  absent?: readonly string[];
};

const specifierRecord = specifierRecords[0];
const specifierCatalogItem = specifierCatalogItems().find((item) => curatedEnrichmentFor(item));
const dsmDiagnosisWithKeyFeatures = dsmDiagnoses.find(
  (diagnosis) => diagnosis.key_features.length > 0 && diagnosis.criteria_display.length > 0,
);
const dsmDiagnosisWithDifferentials = dsmDiagnoses.find((diagnosis) => diagnosis.differentials.length > 0);

/**
 * One factsheet per `kind`. The five kinds render five different bodies, so a
 * single fixture would leave four section sets unguarded — which is how `tocFor`
 * (the hand-maintained switch this index replaces) drifted out of step with the
 * page in the first place.
 */
function factsheetOfKind(kind: Factsheet["kind"]): Factsheet {
  const sheet = factsheets.find((candidate) => candidate.kind === kind);
  if (!sheet) throw new Error(`Expected a ${kind} factsheet fixture`);
  return sheet;
}

function factsheetRoute(kind: Factsheet["kind"], absent?: readonly string[]): RouteCase {
  const factsheet = factsheetOfKind(kind);
  return {
    name: `/factsheets/[slug] (${kind})`,
    sections: factsheetNavSections(factsheet),
    render: () => <FactsheetDetailPage factsheet={factsheet} />,
    conditional: ["factsheet-more-in-topic"],
    absent,
  };
}

function buildConsiderations(values: string[]): DsmDifferentialConsideration[] {
  return values.map((value, index) => ({
    id: `${index}-consideration`,
    title: value,
    fullText: value,
    rationale: "Listed as a differential consideration in the supplied diagnosis record.",
    group: "overlap",
  }));
}

const routes: RouteCase[] = [
  {
    name: "/services/[slug]",
    sections: serviceNavSections,
    render: () => <ServiceDetailPage service={serviceRecords[0]} />,
  },
  {
    name: "/forms/[slug]",
    sections: formNavSections,
    render: () => <FormDetailPage form={formRecords[0]} />,
    // Form 1A has no quoted Act time limit, so it renders no Timeline; the section's presence
    // on a form that has one is pinned by tests/mha-timeline-panel.dom.test.tsx.
    absent: ["form-timeline"],
  },
  {
    name: "/specifiers/map",
    sections: specifierMapSections,
    render: () => <SpecifierMapPage />,
  },
  {
    name: "/specifiers/[slug] (curated record)",
    sections: specifierNavSections,
    render: () => <SpecifierRecordPage record={specifierRecord} />,
  },
  {
    name: "/specifiers/[slug] (catalogue reference)",
    sections: specifierNavSections,
    render: () => <SpecifierReferencePage item={specifierCatalogItem!} />,
    // Only the enriched reference page renders the fit panel.
    conditional: ["specifier-fit"],
  },
  {
    name: "/formulation/[slug]",
    sections: formulationNavSections,
    render: () => <FormulationMechanismPage mechanism={formulationMechanisms[0]} />,
  },
  {
    name: "/dsm/diagnoses/[slug]",
    sections: dsmDiagnosisNavSections,
    render: () => <DsmDiagnosisPage diagnosis={dsmDiagnosisWithKeyFeatures!} />,
    conditional: ["key-features"],
  },
  {
    name: "/dsm/diagnoses/[slug]/differentials",
    sections: dsmDifferentialNavSections,
    render: () => (
      <DsmDifferentialConsiderationsPage
        diagnosis={{
          slug: dsmDiagnosisWithDifferentials!.slug,
          title: dsmDiagnosisWithDifferentials!.title,
          icdCode: dsmDiagnosisWithDifferentials!.icd_code,
          category: dsmDiagnosisWithDifferentials!.category.label,
        }}
        considerations={buildConsiderations(dsmDiagnosisWithDifferentials!.differentials)}
      />
    ),
  },
  {
    name: "/admin/developer-hub",
    sections: developerHubNavSections,
    render: () => DeveloperHubPage(),
  },
  factsheetRoute("medRich"),
  factsheetRoute("medLite"),
  factsheetRoute("condition"),
  // `cbt` is the only Therapies sheet and `lithium-monitoring` the only Tests &
  // procedures sheet, so neither has a topic sibling to list.
  factsheetRoute("therapy", ["factsheet-more-in-topic"]),
  factsheetRoute("procedure", ["factsheet-more-in-topic"]),
];

describe("in-page navigation section contracts", () => {
  it.each(routes.map((route) => [route.name, route] as const))(
    "%s renders an anchor for every declared section",
    async (_name, route) => {
      const { container } = render(await route.render());

      for (const section of route.sections) {
        const found = sectionTargetIds(section).some((id) => container.querySelector(`#${CSS.escape(id)}`));
        if (route.absent?.includes(section.id)) {
          // The other side of the same contract: this fixture carries no data
          // for the section, so nothing may render its anchor and
          // `useResolvedPageSections` drops the entry.
          expect(found, `${route.name}: "${section.id}" renders an anchor it was declared not to have`).toBe(false);
          continue;
        }
        // A section may declare several breakpoint copies; jsdom applies no
        // Tailwind, so both are in the DOM here and any one of them proves the
        // anchor exists. Which copy is *displayed* is resolved at runtime by
        // `useResolvedPageSections`, and covered by the Playwright pair check.
        expect(found, `${route.name}: no element renders an anchor for "${section.id}"`).toBe(true);
      }
    },
  );

  it.each(routes.map((route) => [route.name, route] as const))(
    "%s gives every anchor the shared in-page scroll margin",
    async (_name, route) => {
      // Information-page sections carried no scroll-mt at all before the shared
      // header existed, so without this every jump lands underneath it.
      const { container } = render(await route.render());

      for (const section of route.sections) {
        if (route.absent?.includes(section.id)) continue;
        const anchor = sectionTargetIds(section)
          .map((id) => container.querySelector(`#${CSS.escape(id)}`))
          .find((element): element is Element => element !== null);
        expect(anchor?.className, `${route.name}: "${section.id}" has no in-page scroll margin`).toContain(
          inPageAnchor,
        );
      }
    },
  );

  it("drops a conditional section rather than declaring a dead anchor", () => {
    // The other half of the conditional cases above: with the data absent the
    // anchor must be absent too, so `useResolvedPageSections` filters the entry
    // out instead of the header offering a jump that goes nowhere.
    const withoutKeyFeatures = dsmDiagnoses.find((diagnosis) => diagnosis.key_features.length === 0);
    if (withoutKeyFeatures) {
      const { container } = render(<DsmDiagnosisPage diagnosis={withoutKeyFeatures} />);
      expect(container.querySelector("#key-features")).toBeNull();
      // The unconditional ones still render, so this is a filtered section and
      // not a page that failed to render at all.
      expect(container.querySelector("#criteria")).not.toBeNull();
      cleanup();
    }

    const withoutEnrichment = specifierCatalogItems().find((item) => !curatedEnrichmentFor(item));
    if (withoutEnrichment) {
      const { container } = render(<SpecifierReferencePage item={withoutEnrichment} />);
      expect(container.querySelector("#specifier-fit")).toBeNull();
      expect(container.querySelector("#specifier-overview")).not.toBeNull();
    }
  });

  it("covers every route that mounts the shared header", () => {
    // A component converted without a case here would leave its declared
    // sections unguarded, which is the whole failure mode. Nine anchor-scrolling
    // routes plus one factsheet case per `kind`; the medication page swaps
    // panels rather than scrolling and is guarded by the suite below.
    //
    // Therapy's record header is in neither list on purpose. Its sections are
    // that therapy's own *routes* — record, patient sheet, brief intervention,
    // comparison — so there is no anchor to scroll to and no panel to swap, and
    // a declared destination resolves to a navigation call rather than to
    // rendered DOM. That resolution is guarded in
    // `tests/therapy-record-nav.dom.test.tsx`, including the case this file's
    // conditional-anchor rule covers elsewhere: a record with no patient sheet
    // must drop the slot rather than offer a route that 404s.
    expect(routes).toHaveLength(14);
  });

  it("keeps the specifier map jump cards synchronized during ordinary scrolling", async () => {
    class TestIntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds = [];

      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    let scrollY = 0;
    const scrollSpy = vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
    const sectionTops: Record<string, number> = {
      "episode-features": 0,
      "course-onset": 320,
      "severity-remission": 640,
    };
    const clientRectsSpy = vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (
      this: HTMLElement,
    ) {
      return sectionTops[this.id] === undefined
        ? ([] as unknown as DOMRectList)
        : ([this.getBoundingClientRect()] as unknown as DOMRectList);
    });
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const top = (sectionTops[this.id] ?? 1_000) - scrollY;
      return {
        x: 0,
        y: top,
        top,
        right: 100,
        bottom: top + 100,
        left: 0,
        width: 100,
        height: 100,
        toJSON: () => ({}),
      } as DOMRect;
    });

    try {
      render(<SpecifierMapPage />);
      await waitFor(() => expect(screen.getByTestId("specifier-map-jump-episode-features")).toBeInTheDocument());

      scrollY = 160;
      fireEvent.scroll(window);

      await waitFor(() => {
        expect(screen.getByTestId("specifier-map-jump-course-onset")).toHaveAttribute("aria-current", "true");
      });
    } finally {
      clientRectsSpy.mockRestore();
      rectSpy.mockRestore();
      scrollSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

/**
 * The panel-swap half of the same contract.
 *
 * Medications declare tab ids rather than DOM anchors — selecting one exchanges
 * the rendered panel instead of scrolling to it, so there is nothing to carry
 * `inPageAnchor` and the assertions above do not apply. What still must hold is
 * `/issues #256`'s stop rule: every declared section resolves to something the
 * route actually renders, proven against the DOM rather than by reading the
 * table back to itself. Here that is the panel each tab id swaps in.
 */
describe("in-page navigation panel-swap contracts", () => {
  // Every tab must have content, or "the panel swapped" would be indistinguishable
  // from the empty state on a sparse record.
  const medication = loadMedicationSnapshot().find((record) => {
    const byTab = medicationSectionsByTab(record);
    return MEDICATION_TAB_IDS.every((id) => byTab[id].length > 0);
  });

  it("has a medication fixture that fills all four tabs", () => {
    expect(medication, "no snapshot medication renders every declared tab").toBeDefined();
  });

  it("/medications/[slug] swaps in a panel for every declared section", async () => {
    const user = userEvent.setup();
    render(<MedicationRecordPage slug={medication!.slug} fallbackRecord={medication!} />);

    for (const section of medicationNavSections) {
      await user.click(screen.getByTestId("medication-section-trigger"));
      const sheet = screen.getByTestId("medication-section-sheet");
      await user.click(within(sheet).getByRole("button", { name: new RegExp(`^${section.label}`) }));

      const panel = document.querySelector(`#medication-panel-${CSS.escape(section.id)}`);
      expect(panel, `no panel renders for the declared "${section.id}" section`).not.toBeNull();
      // The panel is the live one, not a stale sibling left in the DOM.
      expect(document.querySelectorAll('[id^="medication-panel-"]')).toHaveLength(1);
    }
  });

  it("names every declared section in the visible rail, with its count", () => {
    // The rail is the desktop navigation, so a section missing from it is
    // unreachable above `sm` even though the sheet still lists it.
    render(<MedicationRecordPage slug={medication!.slug} fallbackRecord={medication!} />);
    const rail = screen.getByTestId("medication-section-rail");
    const byTab = medicationSectionsByTab(medication!);

    for (const section of medicationNavSections) {
      const entry = within(rail).getByRole("button", { name: new RegExp(`^${section.label}`) });
      expect(entry, `"${section.id}" is missing from the rail`).toBeInTheDocument();
      expect(entry).toHaveTextContent(String(byTab[section.id as keyof typeof byTab].length));
    }
  });

  it("uses Therapy priority bands instead of a horizontally scrolling rail", () => {
    render(<MedicationRecordPage slug={medication!.slug} fallbackRecord={medication!} />);
    const rail = screen.getByTestId("medication-section-rail");

    expect(rail).not.toHaveClass("overflow-x-auto");
    expect(rail.querySelector(".mode-nav")).toHaveAttribute("data-density-profile", "extended-counted");
    expect(
      within(rail)
        .getByRole("button", { name: /^Summary/ })
        .closest("li"),
    ).toHaveAttribute("data-band", "3");
    expect(
      within(rail)
        .getByRole("button", { name: /^Dosing/ })
        .closest("li"),
    ).toHaveAttribute("data-band", "3");
    expect(
      within(rail)
        .getByRole("button", { name: /^Safety/ })
        .closest("li"),
    ).toHaveAttribute("data-band", "5");
    expect(
      within(rail)
        .getByRole("button", { name: /^Additional/ })
        .closest("li"),
    ).toHaveAttribute("data-band", "5");
    expect(screen.getByTestId("medication-section-overflow").closest("li")).toHaveAttribute("data-until", "4");
  });

  it("opens the section sheet from More and returns focus to that opener", async () => {
    const user = userEvent.setup();
    render(<MedicationRecordPage slug={medication!.slug} fallbackRecord={medication!} />);
    const overflow = screen.getByTestId("medication-section-overflow");

    await user.click(overflow);
    const sheet = screen.getByTestId("medication-section-sheet");
    await user.click(within(sheet).getByRole("button", { name: /^Safety/ }));

    expect(document.querySelector("#medication-panel-safety")).not.toBeNull();
    expect(overflow).toHaveAccessibleName("More, current section: Safety");
    await waitFor(() => expect(overflow).toHaveFocus());
  });

  it("restores focus to a visible rail control when More hides while the sheet is open", async () => {
    // Mimic the 33rem `@container` band: More vanishes while the dialog is still
    // open. Sheet only checks `isConnected` on returnFocusRef, so without a late
    // visible-target resolver keyboard focus would land on <body>.
    const user = userEvent.setup();
    render(<MedicationRecordPage slug={medication!.slug} fallbackRecord={medication!} />);
    const overflow = screen.getByTestId("medication-section-overflow");
    const rail = screen.getByTestId("medication-section-rail");
    const summary = within(rail).getByRole("button", { name: /^Summary/ });

    await user.click(overflow);
    expect(await screen.findByTestId("medication-section-sheet")).toBeTruthy();

    // Mirror the wide rail band: title disclosure is `sm:hidden`, More is
    // `@container` `display: none`, and every section slot is shown.
    const titleTrigger = screen.getByTestId("medication-section-trigger");
    titleTrigger.style.display = "none";
    const moreSlot = overflow.closest("li");
    expect(moreSlot).not.toBeNull();
    moreSlot!.style.display = "none";
    for (const slot of rail.querySelectorAll<HTMLElement>("li[data-band]")) {
      slot.style.display = "flex";
    }

    await user.click(screen.getByRole("button", { name: "Close section list" }));
    await waitFor(() => expect(screen.queryByTestId("medication-section-sheet")).toBeNull());
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(document.activeElement).toBe(summary);
    expect(document.activeElement).not.toBe(overflow);
    expect(document.activeElement).not.toBe(titleTrigger);
  });

  it("swaps the panel from the rail, not only from the sheet", async () => {
    const user = userEvent.setup();
    render(<MedicationRecordPage slug={medication!.slug} fallbackRecord={medication!} />);
    const rail = screen.getByTestId("medication-section-rail");

    await user.click(within(rail).getByRole("button", { name: /^Safety/ }));

    expect(document.querySelector("#medication-panel-safety")).not.toBeNull();
    expect(within(rail).getByRole("button", { name: /^Safety/ })).toHaveAttribute("aria-current", "true");
  });

  it("opens every card when a medication category becomes active", async () => {
    const user = userEvent.setup();
    render(<MedicationRecordPage slug={medication!.slug} fallbackRecord={medication!} />);
    const rail = screen.getByTestId("medication-section-rail");

    for (const section of medicationNavSections) {
      await user.click(within(rail).getByRole("button", { name: new RegExp(`^${section.label}`) }));
      const panel = document.querySelector<HTMLElement>(`#medication-panel-${CSS.escape(section.id)}`);
      const cards = Array.from(panel?.querySelectorAll<HTMLDetailsElement>(":scope > details") ?? []);

      expect(cards.length, `the "${section.id}" panel renders no cards`).toBeGreaterThan(0);
      expect(
        cards.every((card) => card.open),
        `the "${section.id}" panel contains a folded card`,
      ).toBe(true);
    }
  });

  it("offers no dead segment: every declared tab holds at least one section", () => {
    // The track always draws four segments, so a tab that could never hold
    // content would be a permanently empty destination. This pins the grouping
    // predicate against the real corpus rather than against itself.
    const byTab = medicationSectionsByTab(medication!);
    for (const id of MEDICATION_TAB_IDS) {
      expect(byTab[id].length, `the "${id}" tab renders no sections`).toBeGreaterThan(0);
    }
  });
});
