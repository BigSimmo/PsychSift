/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OnCallSearchBox } from "@/components/on-call/on-call-search-box";
import {
  ON_CALL_SECTION_HREFS,
  ON_CALL_SECTION_TITLES,
  ON_CALL_VIEW_HREFS,
  ON_CALL_VIEW_TITLES,
  type OnCallPageView,
} from "@/components/on-call/on-call-section-identity";
import { onCallViewForEntry } from "@/components/on-call/on-call-entry-view";
import { partitionLogisticsEntries } from "@/lib/on-call/compliance";
import { type OnCallEntry, type OnCallSection } from "@/lib/on-call/entry-model";
import { partitionContactsEntries } from "@/lib/on-call/who-is-who";

afterEach(cleanup);

function entry(section: OnCallSection, slug: string, title: string, overrides: Partial<OnCallEntry> = {}): OnCallEntry {
  return {
    id: slug,
    slug,
    section,
    title,
    subtitle: null,
    body: null,
    details: {},
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
    ...overrides,
  } as unknown as OnCallEntry;
}

const ED = entry("contacts", "ed-registrar", "ED registrar", {
  details: { role: "Emergency registrar", phone: "(08) 9224 1000" },
  tags: ["ward"],
});

const TEACHING = entry("education", "ward-teaching", "Ward teaching", {
  details: { recurrence: "Weekly", presenter: "Dr Halsey" },
});

const PRIVATE = entry("contacts", "okafor", "Dr M. Okafor — ward direct", {
  details: { role: "Consultant", phone: "0412 000 111" },
  isPersonal: true,
});

const ENTRIES = [ED, TEACHING, PRIVATE];

function type(value: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: /search on call/i }), { target: { value } });
}

describe("OnCallSearchBox — the box itself", () => {
  it("gives the field an accessible name", () => {
    render(<OnCallSearchBox entries={ENTRIES} />);
    expect(screen.getByRole("searchbox", { name: /search on call/i })).toBeInTheDocument();
  });

  it("renders no results furniture at all until something is typed", () => {
    render(<OnCallSearchBox entries={ENTRIES} />);
    expect(screen.queryByTestId("on-call-search-results")).not.toBeInTheDocument();
    expect(screen.queryByTestId("on-call-search-empty")).not.toBeInTheDocument();
    expect(screen.queryByText(/ward teaching/i)).not.toBeInTheDocument();
  });
});

describe("OnCallSearchBox — results", () => {
  it("groups matches under the section's own display title", () => {
    render(<OnCallSearchBox entries={ENTRIES} />);
    type("ward");
    expect(screen.getByTestId("on-call-search-group-contacts")).toHaveTextContent("Contacts");
    // `education` is titled "Teaching" everywhere a reader sees it.
    expect(screen.getByTestId("on-call-search-group-education")).toHaveTextContent("Teaching");
  });

  it("links to the exact contact while showing its recorded number", () => {
    render(<OnCallSearchBox entries={ENTRIES} />);
    type("registrar");
    const row = screen.getByTestId("on-call-search-row-ed-registrar");
    expect(row.tagName).toBe("A");
    expect(row).toHaveAttribute("href", "/on-call/contacts#on-call-entry-ed-registrar");
    expect(row).toHaveTextContent("(08) 9224 1000");
    expect(row).toHaveTextContent("Emergency registrar");
  });

  it("sends a row with no number to that section's page instead", () => {
    render(<OnCallSearchBox entries={ENTRIES} />);
    type("teaching");
    const row = screen.getByTestId("on-call-search-row-ward-teaching");
    expect(row).toHaveAttribute("href", "/teaching/week#on-call-entry-ward-teaching");
  });

  it("never prints a personal number, and links to the section instead", () => {
    render(<OnCallSearchBox entries={[PRIVATE]} />);
    type("okafor");
    const row = screen.getByTestId("on-call-search-row-okafor");
    expect(row).toHaveAttribute("href", "/on-call/contacts#on-call-entry-okafor");
    expect(row).toHaveTextContent("Dr M. Okafor — ward direct");
    expect(screen.queryByText(/0412 000 111/)).not.toBeInTheDocument();
  });

  it("clears back to nothing", () => {
    render(<OnCallSearchBox entries={ENTRIES} />);
    type("ward");
    expect(screen.getByTestId("on-call-search-results")).toBeInTheDocument();
    type("");
    expect(screen.queryByTestId("on-call-search-results")).not.toBeInTheDocument();
  });
});

describe("OnCallSearchBox — nothing matched", () => {
  it("says so quietly and names the query", () => {
    render(<OnCallSearchBox entries={ENTRIES} />);
    type("cardiology");
    const empty = screen.getByTestId("on-call-search-empty");
    expect(empty).toHaveTextContent(/cardiology/);
    expect(screen.queryByTestId("on-call-search-results")).not.toBeInTheDocument();
  });
});

describe("OnCallSearchBox — announcements", () => {
  it("announces the count out of sight, not on the visible list", () => {
    render(<OnCallSearchBox entries={ENTRIES} />);
    type("ward");
    const status = screen.getByTestId("on-call-search-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status.className).toContain("sr-only");
    expect(status).toHaveTextContent("3 results");
    expect(screen.getByTestId("on-call-search-results")).not.toHaveAttribute("aria-live");
  });

  it("uses the singular for one match, and announces an empty result", () => {
    render(<OnCallSearchBox entries={ENTRIES} />);
    type("teaching");
    expect(screen.getByTestId("on-call-search-status")).toHaveTextContent("1 result");
    type("cardiology");
    expect(screen.getByTestId("on-call-search-status")).toHaveTextContent(/nothing matched/i);
  });

  it("says nothing at all while the box is empty", () => {
    render(<OnCallSearchBox entries={ENTRIES} />);
    expect(screen.getByTestId("on-call-search-status")).toBeEmptyDOMElement();
  });
});

/**
 * Two of this mode's pages are VIEWS over a stored section — Compliance over
 * `logistics`, Who's who over `contacts` — so the section an entry is stored in
 * is not always the page it is rendered on. Grouping and linking by
 * `entry.section` put a compliance requirement under the Admin heading, wearing
 * the Admin glyph, linking to `/on-call/logistics`, where the Admin page
 * correctly refuses to render it: a search that finds the row, announces it as
 * something it is not, and then navigates away from it.
 *
 * Nothing below retypes "Compliance" or "/on-call/compliance". Every expected
 * label and href is read from the identity maps and every classification is
 * asked of the partition functions that own it, because a test that restates
 * the mapping passes just as happily when the mapping is wrong in both places.
 */
const REGISTRATION = entry("logistics", "medical-registration", "Medical registration", {
  details: {
    category: "Registration",
    kind: "compliance",
    consequence: "stops-work",
    expiresOn: "2027-03-31",
    issuingBody: "Ahpra",
    provenance: "typed",
  },
  tags: ["Paperwork"],
});

const LEAVE_FORM = entry("logistics", "study-leave-form", "Study leave form", {
  details: { category: "Leave" },
  tags: ["Paperwork"],
});

const ROLE_EXPLAINER = entry("contacts", "role-registrar", "What the registrar on call does", {
  details: { role: "Registrar on call", kind: "role-explainer" },
});

const VIEW_ENTRIES = [REGISTRATION, LEAVE_FORM, ROLE_EXPLAINER];

/**
 * The heading, the accessible group name and the href a row must get, asked of
 * the view maps rather than written out again here.
 *
 * `getByRole("region", ...)` is the accessible-name assertion: the heading was
 * half the defect, and a row that links correctly while still announcing itself
 * as Admin is still telling the reader the wrong thing about where it lives.
 */
function expectRowFiledUnder(slug: string, view: OnCallPageView) {
  const group = screen.getByTestId(`on-call-search-group-${view}`);
  expect(screen.getByRole("region", { name: ON_CALL_VIEW_TITLES[view] })).toBe(group);
  expect(group).toHaveTextContent(ON_CALL_VIEW_TITLES[view]);
  const row = screen.getByTestId(`on-call-search-row-${slug}`);
  expect(group).toContainElement(row);
  expect(row).toHaveAttribute("href", `${ON_CALL_VIEW_HREFS[view]}#on-call-entry-${slug}`);
}

/**
 * Asserts the fixture is actually the hazard — a row whose view disagrees with
 * its stored section. Without this the assertions above would still pass if the
 * two maps ever agreed, and would be proving nothing.
 */
function expectViewDisagreesWithSection(row: OnCallEntry, view: OnCallPageView) {
  expect(ON_CALL_VIEW_HREFS[view]).not.toBe(ON_CALL_SECTION_HREFS[row.section]);
  expect(ON_CALL_VIEW_TITLES[view]).not.toBe(ON_CALL_SECTION_TITLES[row.section]);
}

describe("OnCallSearchBox — grouped and linked by view, not by stored section", () => {
  it("files a compliance requirement under Compliance and sends it to the Compliance page", () => {
    // Asked of the module that owns the split, not asserted from the fixture's
    // own `details`.
    const { compliance, admin } = partitionLogisticsEntries(VIEW_ENTRIES);
    expect(compliance).toEqual([REGISTRATION]);
    expect(admin).toEqual([LEAVE_FORM]);

    const view = onCallViewForEntry(REGISTRATION);
    expectViewDisagreesWithSection(REGISTRATION, view);

    render(<OnCallSearchBox entries={VIEW_ENTRIES} />);
    type("registration");
    expectRowFiledUnder(REGISTRATION.slug, view);
    // The page it is NOT on must not be offered at all.
    expect(screen.queryByTestId(`on-call-search-group-${REGISTRATION.section}`)).not.toBeInTheDocument();
  });

  it("files a role explainer under Who's who and sends it to the Who's who page", () => {
    const { contacts, roleExplainers } = partitionContactsEntries(VIEW_ENTRIES);
    expect(roleExplainers).toEqual([ROLE_EXPLAINER]);
    expect(contacts).toEqual([]);

    const view = onCallViewForEntry(ROLE_EXPLAINER);
    expectViewDisagreesWithSection(ROLE_EXPLAINER, view);

    render(<OnCallSearchBox entries={VIEW_ENTRIES} />);
    type("registrar");
    expectRowFiledUnder(ROLE_EXPLAINER.slug, view);
    expect(screen.queryByTestId(`on-call-search-group-${ROLE_EXPLAINER.section}`)).not.toBeInTheDocument();
  });

  it("leaves an ordinary Admin row exactly where it was", () => {
    const view = onCallViewForEntry(LEAVE_FORM);
    // The other half of the contract: for a row that is not a view, the view
    // and the stored section must still agree.
    expect(ON_CALL_VIEW_HREFS[view]).toBe(ON_CALL_SECTION_HREFS[LEAVE_FORM.section]);
    expect(ON_CALL_VIEW_TITLES[view]).toBe(ON_CALL_SECTION_TITLES[LEAVE_FORM.section]);

    render(<OnCallSearchBox entries={VIEW_ENTRIES} />);
    type("leave");
    expectRowFiledUnder(LEAVE_FORM.slug, view);
  });

  it("splits the two logistics rows into two groups in one result list", () => {
    render(<OnCallSearchBox entries={VIEW_ENTRIES} />);
    // One query, both stored-`logistics` rows: grouping by section would put
    // them in a single group headed Admin.
    type("paperwork");
    expectRowFiledUnder(REGISTRATION.slug, onCallViewForEntry(REGISTRATION));
    expectRowFiledUnder(LEAVE_FORM.slug, onCallViewForEntry(LEAVE_FORM));
    expect(screen.getAllByRole("region")).toHaveLength(2);
  });
});
