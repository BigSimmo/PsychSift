/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { OnCallEducationSection } from "@/components/on-call/on-call-education-section";
import { OnCallLogisticsSection } from "@/components/on-call/on-call-logistics-section";
import { OnCallOrientationSection } from "@/components/on-call/on-call-orientation-section";
import type { OnCallLinkedDocument } from "@/components/on-call/on-call-playbook-section";
import { OnCallPlaybookSection } from "@/components/on-call/on-call-playbook-section";
import { OnCallReferralsSection } from "@/components/on-call/on-call-referrals-section";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import { ON_CALL_DEMO_PLAYBOOK_TRIGGER } from "@/lib/on-call/demo-playbook";
import type { OnCallEntry, OnCallSection } from "@/lib/on-call/entry-model";

afterEach(cleanup);

const NOW = new Date("2026-09-04T00:00:00.000Z");

function entry(
  section: OnCallSection,
  overrides: Partial<OnCallEntry> & { id: string; slug: string; title: string },
): OnCallEntry {
  return {
    section,
    subtitle: null,
    body: null,
    details: {},
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: NOW.toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Playbook — THE PLAYBOOK RULE. Read this section twice before touching it.
// ---------------------------------------------------------------------------

const AGITATION_GUIDELINE: OnCallLinkedDocument = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  title: "Aggression and Violence Management Policy",
  date: "2025-01-15T00:00:00.000Z",
};

const ACUTE_AGITATION = entry("playbook", {
  id: "bbbbbbbb-0000-0000-0000-000000000001",
  slug: "acute-agitation",
  title: "Acute agitation on the ward",
  details: {
    trigger: "Patient escalating physically, staff safety at risk",
    escalationSteps: [
      {
        order: 2,
        whoToCall: "Consultant psychiatrist",
        when: "If the registrar is unavailable after 10 minutes",
        phone: "0499 999 999",
      },
      {
        order: 1,
        whoToCall: "On-call registrar",
        when: "First point of contact",
        phone: "0412 345 678",
      },
    ],
  },
  linkedDocumentIds: [AGITATION_GUIDELINE.id],
});

// Deliberately content-free, like the search fixtures. What this case tests is
// the ABSENCE of a linked document, not any clinical situation — so it states
// no threshold and no escalation rule of its own. A fixture is how such content
// usually enters a repository: it gets copied into a seed, then a demo.
const UNLINKED_SCENARIO = entry("playbook", {
  id: "bbbbbbbb-0000-0000-0000-000000000002",
  slug: "scenario-with-no-linked-guideline",
  title: "Scenario with no linked guideline",
  details: {
    trigger: "Owner-written trigger text",
    escalationSteps: [{ order: 1, whoToCall: "On-call registrar", when: "As the owner recorded it" }],
  },
  linkedDocumentIds: [],
});

// Clinical language the app must never author in the Playbook's own voice —
// none of it may appear anywhere the component renders text itself. A
// genuinely present drug/dose word would only ever come from a linked
// document's title, which none of this fixture set supplies.
const FORBIDDEN_CLINICAL_LANGUAGE =
  /\b(administer|dosage|titrate|titration|antipsychotic|benzodiazepine|olanzapine|haloperidol|lorazepam|diazepam|IM stat|IV stat|\d+\s?mg)\b/i;

/**
 * The card's text with element boundaries preserved as spaces.
 *
 * `textContent` concatenates adjacent elements with no separator, so a drug
 * name in one span beside a dose in the next reads as `"lorazepam2mg"` — and
 * every pattern above is word-boundary anchored, so neither `\blorazepam\b`
 * nor `\b\d+\s?mg\b` matches it and the gate passes on the exact markup it
 * exists to catch. Found 2026-09-20 by an agent that hit the same flaw in its
 * own new test and went looking for others.
 *
 * Walking text nodes and joining on a space restores the boundary the DOM
 * already implies visually. It cannot over-match: two halves of one real word
 * are never in separate elements in this component.
 */
function renderedText(root: HTMLElement): string {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent?.trim();
    if (text) parts.push(text);
    node = walker.nextNode();
  }
  return parts.join(" ");
}

describe("OnCallPlaybookSection", () => {
  it("says the demo's shared trigger line once at the top, not on every card (design audit D24)", () => {
    const demo = DEMO_ON_CALL_ENTRIES.filter((entry) => entry.section === "playbook");
    render(<OnCallPlaybookSection entries={demo} now={NOW} />);
    expect(screen.getAllByText(ON_CALL_DEMO_PLAYBOOK_TRIGGER)).toHaveLength(1);
    expect(screen.getByTestId("on-call-playbook-demo-note")).toHaveTextContent(ON_CALL_DEMO_PLAYBOOK_TRIGGER);
  });

  it("renders escalation steps as an ordered list of who, when, and a tap-to-call number", () => {
    render(<OnCallPlaybookSection entries={[ACUTE_AGITATION]} now={NOW} />);
    const card = screen.getByTestId("on-call-playbook-card-acute-agitation");
    const list = within(card).getByRole("list");
    expect(list.tagName).toBe("OL");

    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);

    // Genuinely ordered — step 1 (lower `order`) renders first even though it
    // was supplied second in `escalationSteps`.
    const firstRow = within(items[0]!).getByTestId("on-call-playbook-step-acute-agitation-1");
    expect(firstRow).toHaveTextContent("On-call registrar");
    expect(firstRow).toHaveTextContent("First point of contact");
    expect(firstRow).toHaveAttribute("href", "tel:0412345678");

    const secondRow = within(items[1]!).getByTestId("on-call-playbook-step-acute-agitation-2");
    expect(secondRow).toHaveTextContent("Consultant psychiatrist");
    expect(secondRow).toHaveAttribute("href", "tel:0499999999");
  });

  it("shows each linked document's own title and date as the only clinical content", () => {
    render(
      <OnCallPlaybookSection
        entries={[ACUTE_AGITATION]}
        documents={{ [AGITATION_GUIDELINE.id]: AGITATION_GUIDELINE }}
        now={NOW}
      />,
    );
    const card = screen.getByTestId("on-call-playbook-card-acute-agitation");
    const link = within(card).getByRole("link", { name: /Aggression and Violence Management Policy/ });
    expect(link).toHaveAttribute("href", `/documents/${AGITATION_GUIDELINE.id}`);
    expect(link).toHaveTextContent("15/01/2025");
    expect(within(card).queryByTestId(`on-call-playbook-no-guideline-${ACUTE_AGITATION.slug}`)).toBeNull();
  });

  it("displays Unknown cleanly when a linked guideline has no recorded review date", () => {
    const unreviewedGuideline: OnCallLinkedDocument = {
      id: "aaaaaaaa-0000-0000-0000-000000000009",
      title: "Draft Aggression Policy",
      date: null,
    };
    const entryWithUnreviewed = {
      ...ACUTE_AGITATION,
      linkedDocumentIds: [unreviewedGuideline.id],
    };
    render(
      <OnCallPlaybookSection
        entries={[entryWithUnreviewed]}
        documents={{ [unreviewedGuideline.id]: unreviewedGuideline }}
        now={NOW}
      />,
    );
    const card = screen.getByTestId("on-call-playbook-card-acute-agitation");
    const link = within(card).getByRole("link", { name: /Draft Aggression Policy/ });
    expect(link).toHaveTextContent("Unknown");
  });

  // Regression, 2026-09-24: while the linked documents were still loading,
  // every card said its guideline was "unavailable" and sat under Unlinked.
  it("says a linked guideline is loading, not unavailable, while the lookup runs", () => {
    render(<OnCallPlaybookSection entries={[ACUTE_AGITATION]} documents={{}} documentsLoading now={NOW} />);
    const card = screen.getByTestId("on-call-playbook-card-acute-agitation");
    expect(within(card).getByTestId(`on-call-playbook-guidance-loading-${ACUTE_AGITATION.slug}`)).toBeInTheDocument();
    expect(within(card).queryByText(/linked guideline unavailable/i)).toBeNull();
    expect(screen.queryByTestId("on-call-playbook-group-no-guideline")).toBeNull();
  });

  it("renders a real EmptyState offering a Documents search when no guideline is linked, with no clinical text at all", () => {
    render(<OnCallPlaybookSection entries={[UNLINKED_SCENARIO]} now={NOW} />);
    const card = screen.getByTestId("on-call-playbook-card-scenario-with-no-linked-guideline");
    const emptyState = within(card).getByTestId(`on-call-playbook-no-guideline-${UNLINKED_SCENARIO.slug}`);
    expect(emptyState).toHaveTextContent(/no local guideline linked/i);

    const searchAction = within(emptyState).getByRole("link", { name: /search documents/i });
    expect(searchAction).toHaveAttribute("href", "/documents/search");

    // The clinical-safety assertion: nowhere on this card — not the empty
    // state, not the trigger/step text, not the trigger label — does the app
    // author a clinical instruction in its own voice.
    expect(renderedText(card)).not.toMatch(FORBIDDEN_CLINICAL_LANGUAGE);
    expect(renderedText(emptyState)).not.toMatch(/typically|you would|first line|as a rule/i);
  });

  it("renders a real empty state, and no cards at all, when there are no playbook entries", () => {
    render(<OnCallPlaybookSection entries={[]} now={NOW} />);
    expect(screen.getByTestId("on-call-playbook-empty")).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("brings a hospital ladder into view when it renders after the page, and ignores a damaged hash", async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    try {
      window.history.replaceState(null, "", "#%E0");
      expect(() => render(<OnCallPlaybookSection entries={[]} now={NOW} />)).not.toThrow();
      cleanup();

      window.history.replaceState(null, "", "#hospital-ladder-late");
      render(<OnCallPlaybookSection entries={[]} now={NOW} />);
      expect(scrolled).toEqual([]);
      const ladder = document.createElement("section");
      ladder.id = "hospital-ladder-late";
      document.body.append(ladder);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(scrolled).toEqual(["hospital-ladder-late"]);
      ladder.remove();
    } finally {
      Element.prototype.scrollIntoView = original;
      window.history.replaceState(null, "", "#");
    }
  });
});

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

const CRISIS_TEAM_REFERRAL = entry("referrals", {
  id: "cccccccc-0000-0000-0000-000000000001",
  slug: "crisis-team",
  title: "Crisis and Emergency Response Team",
  details: {
    accepts: ["Adults with acute psychosis", "Acute suicidality with a safety plan needed"],
    exclusions: ["Under 18s", "Primary substance intoxication without mental illness"],
    catchment: "Perth metro north",
    hours: "24/7",
    howToRefer: "Phone triage line, then fax the referral form",
    phone: "1300 555 788",
    fax: "08 9222 0000",
  },
});

describe("OnCallReferralsSection", () => {
  it("renders accepts and exclusions as labelled text, never a colour-coded chip alone", async () => {
    const user = userEvent.setup();
    render(<OnCallReferralsSection entries={[CRISIS_TEAM_REFERRAL]} now={NOW} />);

    await user.click(screen.getByRole("button", { name: /^Crisis and Emergency Response Team/, expanded: false }));
    const panel = screen.getByTestId(`on-call-referral-panel-${CRISIS_TEAM_REFERRAL.slug}`);

    // The label itself is a real text node, present regardless of colour.
    expect(within(panel).getByText("Accepts:")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Adults with acute psychosis");
    expect(within(panel).getByText("Does not accept:")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Under 18s");

    // Neither list item is a `<span>`-only colour chip with no accompanying
    // label text — every fact line carries its own bolded label.
    expect(panel).toHaveTextContent("Catchment: Perth metro north");
    expect(panel).toHaveTextContent("Hours: 24/7");
    expect(panel).toHaveTextContent("How to refer: Phone triage line, then fax the referral form");
  });

  it("gives the phone number a tap-to-call row inside the expanded panel", async () => {
    const user = userEvent.setup();
    render(<OnCallReferralsSection entries={[CRISIS_TEAM_REFERRAL]} now={NOW} />);
    await user.click(screen.getByRole("button", { name: /^Crisis and Emergency Response Team/, expanded: false }));
    const phoneRow = screen.getByTestId(`on-call-referral-phone-${CRISIS_TEAM_REFERRAL.slug}`);
    expect(phoneRow).toHaveAttribute("href", "tel:1300555788");
  });

  it("renders a real empty state when there are no referral entries", () => {
    render(<OnCallReferralsSection entries={[]} now={NOW} />);
    expect(screen.getByTestId("on-call-referrals-empty")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Orientation
// ---------------------------------------------------------------------------

const WARD_4B_MANUAL: OnCallLinkedDocument = {
  id: "dddddddd-0000-0000-0000-000000000001",
  title: "Ward 4B Night Orientation Manual",
  date: "2025-03-01T00:00:00.000Z",
};

const WARD_4B_ORIENTATION = entry("orientation", {
  id: "eeeeeeee-0000-0000-0000-000000000001",
  slug: "ward-4b",
  title: "Ward 4B",
  body: "Ring switch first and mention you're on Ward 4B nights — the manual's own sign-in steps are out of date.",
  details: { pinnedSummaryIsOwnerNote: true },
  linkedDocumentIds: [WARD_4B_MANUAL.id],
});

describe("OnCallOrientationSection", () => {
  it("shows the pinned summary above the document link, visibly attributed to the owner", () => {
    render(
      <OnCallOrientationSection
        entries={[WARD_4B_ORIENTATION]}
        documents={{ [WARD_4B_MANUAL.id]: WARD_4B_MANUAL }}
        now={NOW}
      />,
    );
    const note = screen.getByTestId(`on-call-orientation-note-${WARD_4B_ORIENTATION.slug}`);
    // The attribution itself — never presented as the manual's own words.
    expect(note).toHaveTextContent(/your note/i);
    expect(note).toHaveTextContent(/ring switch first/i);

    const docLink = screen.getByRole("link", { name: /Ward 4B Night Orientation Manual/ });
    expect(docLink).toHaveAttribute("href", `/documents/${WARD_4B_MANUAL.id}`);
    expect(docLink).toHaveTextContent("01/03/2025");

    // Document order in the DOM: the note precedes the document link.
    const relativePosition = note.compareDocumentPosition(docLink);
    expect(relativePosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders a real empty state when there are no orientation entries", () => {
    render(<OnCallOrientationSection entries={[]} now={NOW} />);
    expect(screen.getByTestId("on-call-orientation-empty")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Education (displayed as "Teaching")
// ---------------------------------------------------------------------------

const JOURNAL_CLUB = entry("education", {
  id: "ffffffff-0000-0000-0000-000000000001",
  slug: "journal-club",
  title: "Journal club",
  details: {
    nextOccurrence: "08:00",
    nextOccurrenceDate: "2026-09-10",
    topics: ["Clozapine monitoring"],
  },
});

const GRAND_ROUNDS = entry("education", {
  id: "ffffffff-0000-0000-0000-000000000002",
  slug: "grand-rounds",
  title: "Grand rounds",
  details: {
    nextOccurrence: "08:00",
    nextOccurrenceDate: "2026-10-01",
    recordingUrl: "https://example-hospital-intranet.test/recordings/grand-rounds",
    topics: [],
  },
});

const AD_HOC_WORKSHOP = entry("education", {
  id: "ffffffff-0000-0000-0000-000000000003",
  slug: "ad-hoc-workshop",
  title: "Ad hoc workshop",
  details: { topics: [] },
});

// A weekly session anchored on a date that has already gone by. Nothing about
// the stored row changes as the weeks pass, so the page must do the rolling.
const REGISTRAR_TEACHING = entry("education", {
  id: "ffffffff-0000-0000-0000-000000000004",
  slug: "registrar-teaching",
  title: "Registrar teaching",
  details: {
    recurrence: "Third Sunday of the month",
    nextOccurrenceDate: "2026-01-20",
    recurrenceRule: { frequency: "monthly" },
    topics: [],
  },
});

describe("OnCallEducationSection", () => {
  it("orders sessions by next occurrence, soonest first, with undated sessions last", () => {
    render(<OnCallEducationSection entries={[GRAND_ROUNDS, AD_HOC_WORKSHOP, JOURNAL_CLUB]} now={NOW} />);
    const cards = screen.getAllByTestId(/^on-call-education-card-/).map((card) => card.getAttribute("data-testid"));
    expect(cards).toEqual([
      "on-call-education-card-journal-club",
      "on-call-education-card-grand-rounds",
      "on-call-education-card-ad-hoc-workshop",
    ]);
  });

  // Regression, 2026-09-24: two undated sessions compared as NaN, so they kept
  // whatever order they arrived in instead of sorting by title.
  it("sorts undated sessions alphabetically among themselves", () => {
    const zebra = entry("education", {
      id: "ffffffff-0000-0000-0000-000000000005",
      slug: "zebra-club",
      title: "Zebra club",
      details: { topics: [] },
    });
    render(<OnCallEducationSection entries={[zebra, AD_HOC_WORKSHOP]} now={NOW} />);
    const cards = screen.getAllByTestId(/^on-call-education-card-/).map((card) => card.getAttribute("data-testid"));
    expect(cards).toEqual(["on-call-education-card-ad-hoc-workshop", "on-call-education-card-zebra-club"]);
  });

  it("marks a recording link as leaving the app", () => {
    render(<OnCallEducationSection entries={[GRAND_ROUNDS]} now={NOW} />);
    const card = screen.getByTestId("on-call-education-card-grand-rounds");
    const recordingLink = within(card).getByRole("link", { name: /watch recording/i });
    expect(recordingLink).toHaveAttribute("target", "_blank");
    expect(recordingLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(recordingLink.querySelector("svg")).not.toBeNull();
    expect(recordingLink).toHaveTextContent(/opens in a new tab/i);
  });

  it("never draws a stored javascript: recording link", () => {
    const unsafe = entry("education", {
      id: "ffffffff-0000-0000-0000-000000000006",
      slug: "unsafe-recording",
      title: "Unsafe recording",
      details: { recordingUrl: "javascript:alert(1)", topics: [] },
    });
    render(<OnCallEducationSection entries={[unsafe]} now={NOW} />);
    const card = screen.getByTestId("on-call-education-card-unsafe-recording");
    expect(within(card).queryByRole("link", { name: /watch recording/i })).toBeNull();
    expect(card.innerHTML).not.toContain("javascript:");
  });

  it("rolls a recurring session forward instead of printing a date that has gone by", () => {
    render(<OnCallEducationSection entries={[REGISTRAR_TEACHING]} now={NOW} />);
    const card = screen.getByTestId("on-call-education-card-registrar-teaching");
    // NOW is 4 September 2026; the typed anchor was 20 January.
    expect(card).toHaveTextContent("20 Sep 2026");
    expect(card).not.toHaveTextContent("Jan");
    // The owner's own wording for the pattern still shows beside it.
    expect(card).toHaveTextContent("Third Sunday of the month");
  });

  it("renders a real empty state when there are no teaching sessions", () => {
    render(<OnCallEducationSection entries={[]} now={NOW} />);
    expect(screen.getByTestId("on-call-education-empty")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Logistics
// ---------------------------------------------------------------------------

const STAFF_CAR_PARK = entry("logistics", {
  id: "12121212-0000-0000-0000-000000000001",
  slug: "staff-car-park",
  title: "Staff car park",
  details: { category: "Parking", location: "Level 2, Hospital Ave car park", hours: "24/7" },
});

const IT_HELPDESK = entry("logistics", {
  id: "12121212-0000-0000-0000-000000000002",
  slug: "it-helpdesk",
  title: "IT helpdesk",
  details: { category: "IT", phone: "1800 111 222" },
});

describe("OnCallLogisticsSection", () => {
  it("groups rows by category, each row naming a place, an hour range, or a number", () => {
    render(<OnCallLogisticsSection entries={[STAFF_CAR_PARK, IT_HELPDESK]} now={NOW} />);

    // Alphabetical grouping: IT before Parking.
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings.indexOf("IT")).toBeLessThan(headings.indexOf("Parking"));

    const parkingGroup = screen.getByTestId("on-call-logistics-group-parking");
    const parkingRow = within(parkingGroup).getByTestId("on-call-logistics-row-staff-car-park");
    expect(parkingRow).toHaveTextContent("Level 2, Hospital Ave car park");
    expect(parkingRow).toHaveTextContent("24/7");

    const itGroup = screen.getByTestId("on-call-logistics-group-it");
    const itRow = within(itGroup).getByTestId("on-call-logistics-row-it-helpdesk");
    expect(itRow).toHaveAttribute("href", "tel:1800111222");
    // Regression, 2026-09-24: a dialable row used to hide the number it rang.
    expect(itRow).toHaveTextContent("1800 111 222");
  });

  it("renders a real empty state when there are no logistics entries", () => {
    render(<OnCallLogisticsSection entries={[]} now={NOW} />);
    expect(screen.getByTestId("on-call-logistics-empty")).toBeInTheDocument();
  });

  it("keeps the owner's own start time beside the computed date", () => {
    // Codex P2 on PR #2806. The roll-forward replaced `nextOccurrence` outright
    // with a date-only label, so "Thursday 1pm" lost its only visible TIME. That
    // free-text field is the one the reader is meant to read: the structured
    // rule exists to compute with, not to speak for it.
    const session = {
      id: "55555555-5555-4555-8555-555555555555",
      slug: "journal-club",
      section: "education",
      title: "Journal club",
      subtitle: null,
      body: null,
      details: {
        nextOccurrence: "Thursday 1pm",
        nextOccurrenceDate: "2026-01-08",
        recurrenceRule: { frequency: "weekly" },
        topics: [],
      },
      linkedDocumentIds: [],
      tags: [],
      isPersonal: false,
      includeOnCard: false,
      sortOrder: 0,
      lastVerifiedAt: new Date("2026-09-01T00:00:00.000Z").toISOString(),
    } as unknown as OnCallEntry;

    render(<OnCallEducationSection entries={[session]} now={new Date("2026-09-16T00:00:00.000Z")} />);

    const card = screen.getByText("Journal club").closest("article");
    expect(card).not.toBeNull();
    // Both: the rolled-forward date, and the time nobody else knows (with redundant day name stripped).
    expect(card).toHaveTextContent(/Sep 2026/);
    expect(card).toHaveTextContent("1pm");
    expect(card).not.toHaveTextContent("Thursday 1pm");
  });

  it("keeps schedule qualifiers beside the computed date", () => {
    const session = entry("education", {
      id: "55555555-5555-4555-8555-555555555557",
      slug: "term-journal-club",
      title: "Term journal club",
      details: {
        nextOccurrence: "Thursday 1pm, weeks 1–10",
        nextOccurrenceDate: "2026-09-17",
        topics: [],
      },
    });
    const termSession = entry("education", {
      id: "55555555-5555-4555-8555-555555555558",
      slug: "term-cme-session",
      title: "Term CME session",
      details: { nextOccurrence: "Thursday noon during term", nextOccurrenceDate: "2026-09-17", topics: [] },
    });
    render(<OnCallEducationSection entries={[session, termSession]} now={new Date("2026-09-16T00:00:00.000Z")} />);
    const card = screen.getByText("Term journal club").closest("article");
    expect(card).toHaveTextContent("1pm, weeks 1–10");
    expect(card).not.toHaveTextContent("Thursday 1pm");
    expect(screen.getByText("Term CME session").closest("article")).toHaveTextContent("noon during term");
  });

  it("strips stale relative phrases from the Next badge when a date is present", () => {
    const sessionWithRelative = {
      id: "55555555-5555-4555-8555-555555555556",
      slug: "cme-meeting",
      section: "education",
      title: "CME meeting",
      subtitle: null,
      body: null,
      details: {
        nextOccurrence: "Later this month",
        nextOccurrenceDate: "2026-09-24",
        topics: [],
      },
      linkedDocumentIds: [],
      tags: [],
      isPersonal: false,
      includeOnCard: false,
      sortOrder: 0,
      lastVerifiedAt: new Date("2026-09-01T00:00:00.000Z").toISOString(),
    } as unknown as OnCallEntry;

    render(<OnCallEducationSection entries={[sessionWithRelative]} now={new Date("2026-09-16T00:00:00.000Z")} />);
    const card = screen.getByText("CME meeting").closest("article");
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent("Thu 24 Sep 2026");
    expect(card).not.toHaveTextContent("Later this month");
  });
});
