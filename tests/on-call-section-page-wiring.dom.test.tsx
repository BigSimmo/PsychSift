/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnCallSectionPage } from "@/components/on-call/on-call-section-page";
import {
  ON_CALL_ORIENTATION_UNFILED_LABEL,
  onCallOrientationCategoryFacet,
  onCallPageSections,
} from "@/components/on-call/on-call-page-sections";
import type { OnCallPageView } from "@/components/on-call/on-call-section-identity";
import { partitionLogisticsEntries } from "@/lib/on-call/compliance";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import { ON_CALL_SECTIONS, type OnCallEntry, type OnCallSection } from "@/lib/on-call/entry-model";
import { universalHeaderTrailingSlotId } from "@/lib/mode-home-composer";

// The Playbook page renders the hospital ladders, which read the hospital handbook.
// Give it a signed-in reader whose hospital has published nothing, as other On Call tests do.
vi.mock("@/components/on-call/use-hospital-handbook", async (importOriginal) => {
  const { items, ready } = await import("./helpers/on-call-handbook-fixture");
  const state = ready(items([]));
  return {
    ...(await importOriginal<typeof import("@/components/on-call/use-hospital-handbook")>()),
    useHospitalHandbook: () => state,
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call/contacts",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: true, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
}));

vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: () => null,
}));

vi.mock("@/lib/on-call/linked-documents", () => ({
  useOnCallLinkedDocuments: () => ({}),
  useOnCallLinkedDocumentsState: () => ({ documents: {}, loading: false }),
}));

const storeState = vi.hoisted(() => ({
  entries: [] as OnCallEntry[],
  loading: false,
  isOffline: false,
  signedOut: false,
  cachedAt: null as string | null,
}));

vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => storeState,
  cacheOnCallEntries: vi.fn(),
}));

const FRESH = new Date("2026-06-01T00:00:00.000Z").toISOString();

/** One entry per section, each carrying the minimum its own schema needs. */
const DETAILS_BY_SECTION: Record<OnCallSection, Record<string, unknown>> = {
  contacts: { role: "Switchboard", phone: "9111 2222" },
  playbook: { trigger: "Owner-written trigger text", escalationSteps: [{ order: 1, whoToCall: "Registrar" }] },
  referrals: { accepts: [], exclusions: [], phone: "9333 4444" },
  orientation: {},
  education: { presenter: "Dr Example", nextOccurrence: "Thursday 1pm" },
  logistics: { category: "Parking", location: "Level B1" },
};

function entryFor(section: OnCallSection): OnCallEntry {
  return {
    id: `0000000${ON_CALL_SECTIONS.indexOf(section)}-0000-0000-0000-000000000000`,
    slug: `${section}-entry`,
    section,
    title: `${section} entry title`,
    subtitle: null,
    body: "Owner-written body text.",
    details: DETAILS_BY_SECTION[section],
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: FRESH,
  };
}

// The page menu portals into the universal header's trailing slot and renders
// NOTHING when that host is absent — deliberately, per the portal's own note —
// so a standalone render needs the slot to exist before it can be found.
beforeEach(() => {
  const slot = document.createElement("div");
  slot.id = universalHeaderTrailingSlotId;
  document.body.append(slot);
});

afterEach(() => {
  cleanup();
  document.getElementById(universalHeaderTrailingSlotId)?.remove();
  Object.assign(storeState, { entries: [], loading: false, isOffline: false, signedOut: false, cachedAt: null });
});

describe("every section renders its own entries", () => {
  // The regression this pins: only Contacts was wired to the store, so the
  // other five list components were reachable from their tests and from
  // nothing else. Five of six pages said "no entries yet" no matter what the
  // owner had saved, and there was no way to add an entry to them at all.
  for (const section of ON_CALL_SECTIONS) {
    it(`shows a saved ${section} entry on the ${section} page`, () => {
      storeState.entries = [entryFor(section)];
      render(<OnCallSectionPage view={section} />);
      // `getAllByText`: Referrals renders its title in both the disclosure
      // summary and the expanded body, so one match is not guaranteed.
      expect(screen.getAllByText(`${section} entry title`).length).toBeGreaterThan(0);
      expect(screen.queryByTestId(`on-call-${section}-loading`)).toBeNull();
    });

    it(`does not assert an empty ${section} while the first fetch runs`, () => {
      storeState.entries = [];
      storeState.loading = true;
      render(<OnCallSectionPage view={section} />);
      expect(screen.getByTestId(`on-call-${section}-loading`)).toBeTruthy();
    });
  }
});

/** One contact, filed under a single area tag — the page's grouping key. */
function contact(id: string, slug: string, title: string, tags: string[]): OnCallEntry {
  return {
    id,
    slug,
    section: "contacts",
    title,
    subtitle: null,
    body: null,
    details: { role: title, phone: "0000 000 001" },
    linkedDocumentIds: [],
    tags,
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: new Date().toISOString(),
  } as unknown as OnCallEntry;
}

function roleExplainer(id: string, slug: string, title: string, tags: string[]): OnCallEntry {
  return {
    id,
    slug,
    section: "contacts",
    title,
    subtitle: null,
    body: "What this role does.",
    details: { role: title, kind: "role-explainer" },
    linkedDocumentIds: [],
    tags,
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: FRESH,
  } as unknown as OnCallEntry;
}

/** Two areas, which is the floor at which a page has navigation rather than a heading. */
const ROUTED_CONTACTS = [
  contact("aaaa1111-1111-4111-8111-111111111111", "ward-a", "Ward A", ["Wards"]),
  contact("aaaa2222-2222-4222-8222-222222222222", "service-a", "Service A", ["Services"]),
];

describe("the second header row is about THIS page", () => {
  // The mode pill opens On Call's nine pages. The section pages briefly carried
  // the shared `ModeNav` rail listing the same nine underneath it — two
  // controls doing one job, while nothing at all helped a reader move around
  // the page in front of them. Contacts runs to six groups and several screens.
  //
  // The bar is back, but pointed the other way: it lists the CURRENT PAGE's
  // groups. These tests pin the direction, which is the whole correction — the
  // component being shared is not the thing that went wrong.
  it("mounts no bar of the mode's own routes", () => {
    storeState.entries = ROUTED_CONTACTS;
    render(<OnCallSectionPage view="contacts" />);
    expect(screen.queryAllByTestId("mode-nav")).toHaveLength(0);
    expect(screen.queryAllByRole("navigation", { name: "On Call pages" })).toHaveLength(0);
  });

  it("puts the page's actions in-page, not in a header row of their own", () => {
    // More sits beside the list. The universal header trailing slot is Search
    // my work (and the home bell), not a second ellipsis.
    storeState.entries = ROUTED_CONTACTS;
    render(<OnCallSectionPage view="contacts" />);
    expect(screen.getByTestId("on-call-page-menu-trigger")).toBeTruthy();
    expect(screen.queryByTestId("on-call-section-actions-trigger")).toBeNull();
  });

  it("renders no header at all on a page with nothing to group by", () => {
    // Referrals with no entries has one group at most, and one group is a
    // heading rather than navigation. With the title and the actions both gone
    // there is nothing left for a header to hold, so it is absent rather than
    // drawn as an empty 48px band under the pill.
    //
    // jsdom resolves no section either way (see above), so this case cannot
    // tell "no groups" from "jsdom": it pins the DECLARATION, which is the half
    // that is decidable here, and the browser spec pins the other half.
    storeState.entries = [];
    render(<OnCallSectionPage view="referrals" />);
    expect(onCallPageSections({ view: "referrals", entries: [] })).toEqual([]);
    expect(screen.queryByTestId("on-call-section-detail-header")).toBeNull();
    expect(screen.queryByTestId("on-call-section-section-trigger")).toBeNull();
  });

  it("declares no jump list for a page with a single group", () => {
    // One heading is a heading, not navigation, and the shared bar says the
    // same thing with `MODE_NAV_MIN_ITEMS`. Contacts filed entirely under one
    // area used to declare a one-slot bar.
    const oneArea = [
      contact("bbbb1111-1111-4111-8111-111111111111", "ward-a", "Ward A", ["Wards"]),
      contact("bbbb2222-2222-4222-8222-222222222222", "ward-b", "Ward B", ["Wards"]),
    ];
    expect(onCallPageSections({ view: "contacts", entries: oneArea })).toEqual([]);
    expect(onCallPageSections({ view: "contacts", entries: ROUTED_CONTACTS }).length).toBeGreaterThanOrEqual(2);
  });

  it("names the page for a screen reader without painting it a second time", () => {
    // An eyebrow reading "On Call", a display-size "Contacts" and a list
    // heading reading "Contacts" all sat under a sticky header already saying
    // "Contacts". Both headings survive — the `<h1>` for the document outline,
    // the `<h2>` to label the list region — and neither is painted.
    storeState.entries = [];
    const { container } = render(<OnCallSectionPage view="contacts" />);

    const headings = Array.from(container.querySelectorAll("h1, h2, h3")).filter(
      (node) => node.textContent?.trim() === "Contacts",
    );
    expect(headings.map((node) => node.tagName)).toEqual(["H1", "H2"]);
    for (const heading of headings) {
      expect(heading.className, `${heading.tagName} is painted`).toContain("sr-only");
    }
    expect(container.textContent).not.toContain("Filed by role first");

    const region = container.querySelector("#on-call-contacts-entries");
    const labelId = region?.getAttribute("aria-labelledby");
    expect(labelId).toBe("on-call-contacts-entries-heading");
    expect(container.querySelector(`#${labelId}`)?.textContent).toBe("Contacts");
  });

  it("declares only anchors the page actually renders", () => {
    // A declared section whose anchor is not on the page is a dead jump. The
    // declaration and the rendering are two files, so this asserts them against
    // each other on real DOM — never by grepping for `id=`.
    //
    // Resolution itself cannot be asserted here: `useResolvedPageSections`
    // tests visibility with `getClientRects()`, which jsdom reports empty for
    // everything, so no section ever resolves in this environment. That the
    // header then OPENS with those groups is proven in
    // `tests/ui-on-call-boards.spec.ts`, in a browser.
    const entries = [
      contact("aaaa1111-1111-4111-8111-111111111111", "ward-a", "Ward A", ["Wards"]),
      contact("aaaa2222-2222-4222-8222-222222222222", "service-a", "Service A", ["Services"]),
    ];
    storeState.entries = entries;
    const { container } = render(<OnCallSectionPage view="contacts" />);

    const declared = onCallPageSections({ view: "contacts", entries });
    expect(declared.length).toBeGreaterThan(0);
    for (const section of declared) {
      expect(
        container.querySelector(`#${section.id}`),
        `${section.label} declares #${section.id}, which is absent`,
      ).not.toBeNull();
    }
  });

  it("declares only anchors the Who's who page actually renders", () => {
    const entries = [
      roleExplainer("cccc1111-1111-4111-8111-111111111111", "reg", "Registrar", ["Medical"]),
      roleExplainer("cccc2222-2222-4222-8222-222222222222", "cns", "CNS", ["Nursing"]),
    ];
    storeState.entries = entries;
    const { container } = render(<OnCallSectionPage view="who-is-who" />);

    const declared = onCallPageSections({ view: "who-is-who", entries });
    expect(declared.length).toBeGreaterThan(0);
    for (const section of declared) {
      expect(
        container.querySelector(`#${section.id}`),
        `${section.label} declares #${section.id}, which is absent`,
      ).not.toBeNull();
    }
  });
});

/**
 * Every group a page DECLARES, asserted against the anchors it RENDERS.
 *
 * The same loop the two cases above write out, factored once because three
 * more pages need it. The direction is the whole point and it only runs one
 * way: a declared anchor that is not on the page is a jump list row that
 * silently does nothing, while an extra rendered heading is merely a heading
 * the bar does not offer. Declared ⊆ rendered is therefore the assertion, and
 * the count is checked first so a page that declares nothing cannot pass by
 * looping zero times.
 */
function expectDeclaredAnchorsRendered(
  view: OnCallPageView,
  entries: readonly OnCallEntry[],
  container: HTMLElement,
): void {
  const declared = onCallPageSections({ view, entries });
  expect(declared.length, `${view} declared no groups at all, so this case proves nothing`).toBeGreaterThan(0);
  for (const section of declared) {
    expect(
      container.querySelector(`#${section.id}`),
      `${section.label} declares #${section.id}, which is absent`,
    ).not.toBeNull();
  }
}

describe("the three pages whose grouping key is quieter than a tag", () => {
  // Contacts and Who's who file by a tag the reader typed and can see on the
  // row. Admin files by `details.category`, Compliance by a consequence band,
  // and Orientation by a folder that is optional on the section — keys that
  // are invisible on the page, and that live in a different file from the
  // declaration that navigates to them. A fallback heading reading "Other" in
  // one and "General" in the other is not a visible bug; it is a jump list row
  // that goes nowhere, and exactly that mismatch has already shipped once on
  // Admin and been fixed.
  //
  // These run against the real demo corpus rather than a fixture written here,
  // for two reasons. It is what a visitor actually sees, so a break is a break
  // in the shipped product; and it is built to exercise every Admin folder,
  // every compliance band and the unfiled orientation fallback, which a
  // hand-rolled fixture would stop doing the first time somebody adds a band.
  //
  // Nothing below names a category, a folder or a band. Every expectation is
  // read from the declaration helpers or from the corpus itself, so renaming
  // a label — which the one-word convention keeps inviting — moves both sides
  // at once and these cases stay true.

  it("declares only anchors the Admin page actually renders", () => {
    const entries = [...DEMO_ON_CALL_ENTRIES];
    storeState.entries = entries;
    const { container } = render(<OnCallSectionPage view="logistics" />);
    expectDeclaredAnchorsRendered("logistics", entries, container);
  });

  it("declares only anchors the Compliance page actually renders", () => {
    // The band that carries two strings is the one at risk here: the bar gets
    // `barLabel` ("Blocking") and the page renders `heading` ("Stops you
    // working"), and the slug must come from the heading on BOTH sides. Slug
    // the short word on either side and every anchor on this page moves.
    const entries = [...DEMO_ON_CALL_ENTRIES];
    storeState.entries = entries;
    const { container } = render(<OnCallSectionPage view="compliance" />);
    expectDeclaredAnchorsRendered("compliance", entries, container);
  });

  it("declares only anchors the Orientation page actually renders", () => {
    const entries = [...DEMO_ON_CALL_ENTRIES];
    storeState.entries = entries;
    const { container } = render(<OnCallSectionPage view="orientation" />);
    expectDeclaredAnchorsRendered("orientation", entries, container);
  });

  it("keeps a manual with no folder on the shelf, under the trailing fallback", () => {
    // `details.category` is optional on this section — orientation rows
    // existed before folders did — so the interesting row is the one nobody
    // has filed. Dropping it would be the mode's own worst failure: a manual
    // withheld because of a missing field. It lands under the trailing
    // fallback group instead, which is the last thing `onCallEntryGroups`
    // appends and therefore the last group declared.
    const entries = [...DEMO_ON_CALL_ENTRIES];
    const unfiled = entries.filter(
      (entry) => entry.section === "orientation" && onCallOrientationCategoryFacet(entry).length === 0,
    );
    expect(unfiled.length, "the demo corpus files every manual, so the fallback is unexercised").toBeGreaterThan(0);

    storeState.entries = entries;
    const { container } = render(<OnCallSectionPage view="orientation" />);

    const declared = onCallPageSections({ view: "orientation", entries });
    const trailing = declared[declared.length - 1];
    expect(trailing?.label).toBe(ON_CALL_ORIENTATION_UNFILED_LABEL);
    const fallbackGroup = container.querySelector(`#${trailing?.id}`);
    expect(fallbackGroup).not.toBeNull();

    for (const entry of unfiled) {
      const card = container.querySelector(`[data-testid="on-call-orientation-card-${entry.slug}"]`);
      expect(card, `${entry.title} has no folder and vanished from the shelf`).not.toBeNull();
      expect(
        fallbackGroup?.contains(card),
        `${entry.title} renders outside the ${trailing?.label} group it was declared under`,
      ).toBe(true);
    }
  });
});

describe("Admin and Compliance are one stored section, and neither may show the other's rows", () => {
  // `section` is a database CHECK constraint and a seventh value costs a
  // migration that reaches the live clinical database within seconds, so these
  // two pages are one stored section split on `details.kind`. The documented
  // cost of that choice is exactly one hazard, written down in
  // `src/lib/on-call/compliance.ts`: a requirement whose lapse can stop
  // somebody working, filed among the parking notes and the pay claims, where
  // nothing is expected to expire and so nobody looks for a date.
  //
  // `partitionLogisticsEntries` is the single place the split is made, so both
  // cases below ask it which rows belong where rather than restating the rule
  // — a test that re-derived the split would keep passing if the split itself
  // were wrong.

  it("keeps compliance requirements out of the Admin list", () => {
    const entries = [...DEMO_ON_CALL_ENTRIES];
    const { admin, compliance } = partitionLogisticsEntries(entries);
    expect(compliance.length, "the demo corpus carries no compliance rows to keep out").toBeGreaterThan(0);
    expect(admin.length, "the demo corpus carries no admin rows to show").toBeGreaterThan(0);

    storeState.entries = entries;
    render(<OnCallSectionPage view="logistics" />);

    for (const entry of admin) {
      expect(
        screen.queryByTestId(`on-call-logistics-row-${entry.slug}`),
        `${entry.title} is an Admin row and is missing from Admin`,
      ).not.toBeNull();
    }
    for (const entry of compliance) {
      expect(
        screen.queryByTestId(`on-call-logistics-row-${entry.slug}`),
        `${entry.title} expires, and is filed here among the forms`,
      ).toBeNull();
      // The title too, not only the row: a requirement reaching this page by
      // some other route — a future summary line, a recents strip — is the
      // same hazard wearing different markup.
      expect(screen.queryAllByText(entry.title), `${entry.title} is named on the Admin page`).toHaveLength(0);
    }
  });

  it("keeps ordinary Admin rows off the Compliance page", () => {
    // The mirror, and not redundant: the two lists filter with the same helper
    // but in opposite directions, and only one of them was ever the documented
    // hazard. An Admin row appearing here is the milder half — a parking note
    // shown under "Stops you working" is wrong in a way a reader would spot —
    // but it would also be counted into a band, and this page's bands are
    // ordered by what lapsing costs.
    const entries = [...DEMO_ON_CALL_ENTRIES];
    const { admin, compliance } = partitionLogisticsEntries(entries);

    storeState.entries = entries;
    render(<OnCallSectionPage view="compliance" />);

    for (const entry of compliance) {
      expect(
        screen.queryByTestId(`on-call-compliance-row-${entry.slug}`),
        `${entry.title} is a requirement and is missing from Compliance`,
      ).not.toBeNull();
    }
    for (const entry of admin) {
      expect(
        screen.queryByTestId(`on-call-compliance-row-${entry.slug}`),
        `${entry.title} is ordinary admin and is filed here as a requirement`,
      ).toBeNull();
      expect(screen.queryAllByText(entry.title), `${entry.title} is named on the Compliance page`).toHaveLength(0);
    }
  });
});
