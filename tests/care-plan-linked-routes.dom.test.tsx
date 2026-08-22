import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CarePlanErrorBoundary } from "@/components/care-plan/mockups/care-plan-error-boundary";
import { BANNED_ADMISSION_CONSTRUCTIONS, buildPatientSnapshot } from "@/components/care-plan/mockups/domain";
import {
  PROTOTYPE_NOW,
  publicCrisisContacts,
  syntheticManagementPlanVersions,
  syntheticPersonalSafetyPlanVersions,
} from "@/components/care-plan/mockups/fixtures";
import { diffManagementPlanContent } from "@/components/care-plan/mockups/management-plan-diff";
import { managementPlanFieldId } from "@/components/care-plan/mockups/management-plan-form";
import { PatientWorkspace } from "@/components/care-plan/mockups/patient-workspace";
import { CarePlanPrototypeProvider } from "@/components/care-plan/mockups/prototype-provider";
import { createInitialPrototypeState } from "@/components/care-plan/mockups/prototype-state";
import {
  FIRST_MINUTE_SECTION_LABEL,
  FULL_PLAN_SECTION_KEYS,
  FULL_PLAN_SECTION_LABEL,
  PATIENT_CONFIRMATION_EXPLANATION,
  PATIENT_CONFIRMATION_LABEL,
  SAFETY_PLAN_SECTION_KEYS,
  SAFETY_PLAN_SECTION_LABEL,
  formatPerthDate,
} from "@/components/care-plan/mockups/prototype-ui";
import { CarePlanRouteSurface, scenarioFromQuery } from "@/components/care-plan/mockups/routable-suite";
import { CARE_PLAN_ROUTES, carePlanRoute } from "@/components/care-plan/mockups/routes";
import { safetyPlanFieldId } from "@/components/care-plan/mockups/safety-plan-form";
import { FIRST_MINUTE_CONTENT_KEYS } from "@/components/care-plan/mockups/types";

/**
 * A route rendered with the world its own address names. The provider is seeded
 * from the same query string the surface reads, so a specimen scenario degrades
 * the reducer as well as the rendering — otherwise `?scenario=offline` would
 * change a data attribute and nothing else, and every refusal asserted below
 * would be asserted against a state that was never offline.
 */
function renderRoute(pathname: string, query = "") {
  const navigate = vi.fn();
  render(
    <CarePlanPrototypeProvider scenario={scenarioFromQuery(query)}>
      <CarePlanRouteSurface pathname={pathname} query={query} navigate={navigate} />
    </CarePlanPrototypeProvider>,
  );
  return navigate;
}

/**
 * Generated from the domain constant rather than transcribed. A sixth content
 * section, a reordering, or a renamed key is a defect the specification names
 * explicitly, and a hand-written list here could be "corrected" to match the bug.
 */
const FIRST_MINUTE_HEADINGS_FROM_DOMAIN = FIRST_MINUTE_CONTENT_KEYS.map(
  (key, index) => `${index + 1}. ${FIRST_MINUTE_SECTION_LABEL[key]}`,
);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Care Plan route shell", () => {
  it("gives every route exactly one first-level heading", () => {
    for (const route of Object.values(CARE_PLAN_ROUTES)) {
      const { unmount } = render(
        <CarePlanPrototypeProvider>
          <CarePlanRouteSurface pathname={route} query="" navigate={vi.fn()} />
        </CarePlanPrototypeProvider>,
      );
      expect(screen.getAllByRole("heading", { level: 1 }), `${route} must have one <h1>`).toHaveLength(1);
      unmount();
    }
  });

  it("moves keyboard focus to the route heading so a routed page announces itself", () => {
    renderRoute(CARE_PLAN_ROUTES.patients);
    const heading = screen.getByRole("heading", { level: 1, name: "Patients" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveFocus();
  });

  // The commonest navigation in this product is patient to patient on the same
  // route, and both patients resolve to the same heading. If focus keys on the
  // heading text rather than the address, a screen-reader user moves to a
  // different patient's plan and hears nothing at all.
  it("moves focus again when only the patient changes and the heading text does not", () => {
    const navigate = vi.fn();
    const surface = (pathname: string) => (
      <CarePlanPrototypeProvider>
        <CarePlanRouteSurface pathname={pathname} query="" navigate={navigate} />
      </CarePlanPrototypeProvider>
    );
    const { rerender } = render(surface(carePlanRoute.managementPlan("SYN-PATIENT-001")));

    const heading = screen.getByRole("heading", { level: 1, name: "Management Plan" });
    expect(heading).toHaveFocus();

    // Simulate the user tabbing away, then navigating to another patient.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(heading).not.toHaveFocus();

    rerender(surface(carePlanRoute.managementPlan("SYN-PATIENT-002")));

    const headingAfter = screen.getByRole("heading", { level: 1, name: "Management Plan" });
    // Same node: the shell persists across navigation rather than remounting,
    // which is also what lets the search field keep what was typed into it.
    expect(headingAfter).toBe(heading);
    expect(headingAfter).toHaveFocus();
  });

  // Exercised on two shell-owned routes. Home and Patients own an in-flow
  // directory search of their own from Task 4 onwards, so the shell composer is
  // not rendered there and there is never a second search field on one page.
  it("keeps the typed search term across a navigation because the shell persists", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const surface = (pathname: string) => (
      <CarePlanPrototypeProvider>
        <CarePlanRouteSurface pathname={pathname} query="" navigate={navigate} />
      </CarePlanPrototypeProvider>
    );
    const { rerender } = render(surface(CARE_PLAN_ROUTES.reviews));

    await user.type(screen.getByRole("searchbox", { name: "Search patients" }), "Rowan");
    rerender(surface(CARE_PLAN_ROUTES.team));
    expect(screen.getByRole("searchbox", { name: "Search patients" })).toHaveValue("Rowan");
  });

  it("announces a route change once, through the heading, not through a second live region", () => {
    renderRoute(CARE_PLAN_ROUTES.patients);
    const heading = screen.getByRole("heading", { level: 1, name: "Patients" });
    expect(heading).toHaveFocus();
    // A hand-rolled aria-live region repeating the heading would make every
    // route change announce twice.
    const liveRegions = Array.from(document.querySelectorAll("[aria-live]")).filter(
      (node) => node.textContent?.trim() === "Patients",
    );
    expect(liveRegions).toEqual([]);
  });

  it("states the synthetic boundary and that nothing is saved", () => {
    renderRoute(CARE_PLAN_ROUTES.home);
    expect(screen.getByText("Synthetic prototype — fictional data only")).toBeInTheDocument();
    expect(screen.getByText("Nothing is saved. Reloading this page starts over.")).toBeInTheDocument();
  });

  it("names the signed-in synthetic clinician and their role", () => {
    renderRoute(CARE_PLAN_ROUTES.home);
    const identity = screen.getByTestId("care-plan-active-user");
    expect(within(identity).getByText("Dr Casey Example")).toBeInTheDocument();
    expect(within(identity).getByText("Emergency Physician, North River Hospital ED")).toBeInTheDocument();
  });

  /**
   * Approval is role-gated, withdrawal is senior-only, and a prototype that
   * cannot move between those two views cannot demonstrate its own central
   * governance rule. The switcher is interaction modelling: it explains why an
   * action is offered, and the reducer stays the final guard either way.
   */
  it("offers a prototype role switcher beside the signed-in clinician", () => {
    renderRoute(CARE_PLAN_ROUTES.home);
    const identity = screen.getByTestId("care-plan-active-user");
    const switcher = within(identity).getByRole("combobox", { name: "Prototype role" });
    expect(switcher).toHaveValue("SYN-USER-ED-001");
    expect(
      within(identity)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Dr Casey Example — Emergency department clinician",
      "Morgan Sample — Emergency department mental health liaison clinician",
      "Dr Taylor Fiction — Named senior clinician",
      "Riley Demo — Care planning coordinator",
    ]);
  });

  it("changes the signed-in synthetic clinician when a different role is chosen", async () => {
    const user = userEvent.setup();
    renderRoute(CARE_PLAN_ROUTES.home);
    await user.selectOptions(screen.getByRole("combobox", { name: "Prototype role" }), "SYN-USER-SENIOR-001");

    const identity = screen.getByTestId("care-plan-active-user");
    expect(within(identity).getByText("Dr Taylor Fiction")).toBeInTheDocument();
    expect(within(identity).getByText("Consultant Psychiatrist, North River Health Service")).toBeInTheDocument();
  });

  it("says plainly that the role switcher is not authentication", () => {
    renderRoute(CARE_PLAN_ROUTES.home);
    const identity = screen.getByTestId("care-plan-active-user");
    expect(identity).toHaveTextContent(/explains which actions are offered/i);
    expect(identity).toHaveTextContent(/not a sign-in, and it protects nothing/i);
  });

  it("keeps the role switcher off a printed page", () => {
    renderRoute(carePlanRoute.managementPlanPrint("SYN-PATIENT-001"));
    expect(screen.getByRole("combobox", { name: "Prototype role" }).closest("[data-print-hide='true']")).not.toBeNull();
  });

  it("renders the desktop rail as real links built from the route registry", () => {
    renderRoute(CARE_PLAN_ROUTES.home);
    const rail = screen.getByRole("navigation", { name: "Care Plan sections" });
    for (const [label, href] of [
      ["Home", CARE_PLAN_ROUTES.home],
      ["Patients", CARE_PLAN_ROUTES.patients],
      ["Reviews", CARE_PLAN_ROUTES.reviews],
      ["Team", CARE_PLAN_ROUTES.team],
      ["Governance", CARE_PLAN_ROUTES.governance],
    ] as const) {
      expect(within(rail).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
    expect(
      within(screen.getByRole("navigation", { name: "Care Plan prototype tools" })).getByRole("link", {
        name: "System states",
      }),
    ).toHaveAttribute("href", CARE_PLAN_ROUTES.systemStates);
  });

  it("renders the phone dock and reaches the remaining destinations through More", async () => {
    const user = userEvent.setup();
    renderRoute(CARE_PLAN_ROUTES.home);
    const dock = screen.getByRole("navigation", { name: "Care Plan phone navigation" });
    for (const [label, href] of [
      ["Home", CARE_PLAN_ROUTES.home],
      ["Patients", CARE_PLAN_ROUTES.patients],
      ["Reviews", CARE_PLAN_ROUTES.reviews],
    ] as const) {
      expect(within(dock).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }

    await user.click(within(dock).getByRole("button", { name: "More" }));
    const sheet = screen.getByRole("dialog", { name: "More" });
    expect(within(sheet).getByRole("link", { name: /^Team/ })).toHaveAttribute("href", CARE_PLAN_ROUTES.team);
    expect(within(sheet).getByRole("link", { name: /^Governance/ })).toHaveAttribute(
      "href",
      CARE_PLAN_ROUTES.governance,
    );
    expect(within(sheet).getByRole("link", { name: /^System states/ })).toHaveAttribute(
      "href",
      CARE_PLAN_ROUTES.systemStates,
    );
  });

  it("keeps the phone dock out of a printed page", () => {
    renderRoute(CARE_PLAN_ROUTES.home);
    expect(screen.getByRole("navigation", { name: "Care Plan phone navigation" })).toHaveAttribute(
      "data-print-hide",
      "true",
    );
  });

  // A printed Care Plan leaves the screen: it is carried to a bedside or sent
  // with a handover. Paper that shows a clinical heading with nothing saying the
  // content is fictional is the failure this asserts against, so the marker must
  // survive print on every route — most of all the three print routes.
  it.each([
    CARE_PLAN_ROUTES.managementPlanPrint,
    CARE_PLAN_ROUTES.patientPlanPrint,
    CARE_PLAN_ROUTES.safetyPlanPrint,
    CARE_PLAN_ROUTES.home,
  ])("keeps the synthetic marker on the printed page for %s", (pathname) => {
    renderRoute(pathname);
    const marker = screen.getByTestId("care-plan-synthetic-marker");
    expect(marker).toHaveTextContent("Synthetic prototype — fictional data only");
    expect(marker.closest("[data-print-hide='true']")).toBeNull();

    const memoryNotice = screen.getByText("Nothing is saved. Reloading this page starts over.");
    expect(memoryNotice.closest("[data-print-hide='true']")).toBeNull();

    // The search slot is chrome, and chrome still goes.
    expect(screen.getByRole("search").closest("[data-print-hide='true']")).not.toBeNull();
  });

  it.each([
    [CARE_PLAN_ROUTES.home, "Home"],
    [CARE_PLAN_ROUTES.patients, "Patients"],
    [CARE_PLAN_ROUTES.patient, "Patients"],
    [CARE_PLAN_ROUTES.managementPlan, "Patients"],
    [CARE_PLAN_ROUTES.presentation, "Patients"],
    [CARE_PLAN_ROUTES.reviews, "Reviews"],
    [CARE_PLAN_ROUTES.team, "Team"],
    [CARE_PLAN_ROUTES.governance, "Governance"],
  ])("marks %s as the current destination %s", (pathname, destination) => {
    renderRoute(pathname);
    const rail = screen.getByRole("navigation", { name: "Care Plan sections" });
    expect(within(rail).getByRole("link", { name: destination })).toHaveAttribute("aria-current", "page");
    const others = within(rail)
      .getAllByRole("link")
      .filter((link) => link.textContent?.trim() !== destination);
    for (const link of others) expect(link).not.toHaveAttribute("aria-current");
  });

  it("marks the system-states route current on its own rail link", () => {
    renderRoute(CARE_PLAN_ROUTES.systemStates);
    expect(
      within(screen.getByRole("navigation", { name: "Care Plan prototype tools" })).getByRole("link", {
        name: "System states",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  // Home, Patients and the patient Overview are deliberately absent: Task 4
  // replaced their purpose surface with the real Clinical Snapshot. The
  // Management Plan and its print route went the same way in Task 5, the two
  // Management Plan authoring routes in Task 6, the three ED Presentation
  // routes in Task 7, and the three Personal Safety Plan routes in Task 8. The
  // block below asserts that none of those thirteen renders a purpose surface
  // at all.
  it.each([
    [
      CARE_PLAN_ROUTES.history,
      "History",
      "Combined plan, presentation-amendment, print, and contact-action audit chronology",
    ],
    [
      CARE_PLAN_ROUTES.reviews,
      "Reviews",
      "Awaiting Approval, Review Suggested, contact verification, and manual identification queues",
    ],
    [CARE_PLAN_ROUTES.team, "Team", "Synthetic CMHT and plan-owner directory"],
    [
      CARE_PLAN_ROUTES.governance,
      "Governance",
      "Prototype boundary, roles, lifecycle rules, and unresolved identification policy",
    ],
    [CARE_PLAN_ROUTES.systemStates, "System states", "Deterministic degraded-state specimens and scenario controls"],
  ])("maps %s to the %s route purpose surface", (pathname, heading, purpose) => {
    renderRoute(pathname);
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    const surface = screen.getByTestId("care-plan-route-purpose");
    expect(within(surface).getByText(purpose)).toBeInTheDocument();
  });

  it("offers exactly one search slot and navigates it without putting record content in the URL", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(CARE_PLAN_ROUTES.reviews);
    const search = screen.getByRole("searchbox", { name: "Search patients" });
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    await user.type(search, "Rowan");
    await user.click(screen.getByRole("button", { name: "Search patients" }));
    expect(navigate).toHaveBeenCalledWith(CARE_PLAN_ROUTES.patients);
    expect(navigate.mock.calls.every(([href]) => !String(href).includes("Rowan"))).toBe(true);
  });

  it("reads the named specimen scenario from the URL and nothing else", () => {
    renderRoute(CARE_PLAN_ROUTES.home);
    expect(document.querySelector("[data-care-plan-scenario]")).toHaveAttribute("data-care-plan-scenario", "normal");

    document.body.innerHTML = "";
    renderRoute(CARE_PLAN_ROUTES.systemStates, "scenario=overdue-plan");
    expect(document.querySelector("[data-care-plan-scenario]")).toHaveAttribute(
      "data-care-plan-scenario",
      "overdue-plan",
    );

    document.body.innerHTML = "";
    renderRoute(CARE_PLAN_ROUTES.systemStates, "scenario=not-a-scenario");
    expect(document.querySelector("[data-care-plan-scenario]")).toHaveAttribute("data-care-plan-scenario", "normal");
  });

  it("shows no unavailable authoring controls on a reading surface", () => {
    renderRoute(CARE_PLAN_ROUTES.managementPlan);
    expect(screen.queryByTitle(/coming soon/i)).toBeNull();
    expect(document.querySelector("[aria-disabled='true']")).toBeNull();
  });

  it("replaces the route-purpose surface on every route that now has real content", () => {
    for (const route of [
      CARE_PLAN_ROUTES.home,
      CARE_PLAN_ROUTES.patients,
      CARE_PLAN_ROUTES.patient,
      CARE_PLAN_ROUTES.managementPlan,
      CARE_PLAN_ROUTES.managementPlanEdit,
      CARE_PLAN_ROUTES.managementPlanReview,
      CARE_PLAN_ROUTES.managementPlanPrint,
      CARE_PLAN_ROUTES.presentations,
      CARE_PLAN_ROUTES.newPresentation,
      CARE_PLAN_ROUTES.presentation,
      CARE_PLAN_ROUTES.safetyPlan,
      CARE_PLAN_ROUTES.safetyPlanEdit,
      CARE_PLAN_ROUTES.safetyPlanPrint,
      CARE_PLAN_ROUTES.patientPlan,
      CARE_PLAN_ROUTES.patientPlanEdit,
      CARE_PLAN_ROUTES.patientPlanPrint,
    ]) {
      const { unmount } = render(
        <CarePlanPrototypeProvider>
          <CarePlanRouteSurface pathname={route} query="" navigate={vi.fn()} />
        </CarePlanPrototypeProvider>,
      );
      expect(screen.queryByTestId("care-plan-route-purpose"), `${route} still shows a purpose surface`).toBeNull();
      unmount();
    }
  });
});

describe("Care Plan patient directory", () => {
  async function searchAndOpen(query: string, openName: RegExp) {
    const user = userEvent.setup();
    renderRoute(CARE_PLAN_ROUTES.home);
    await user.type(screen.getByRole("searchbox", { name: "Search synthetic patients" }), query);
    await user.click(screen.getByRole("button", { name: openName }));
    return user;
  }

  // The brief's worked example, corrected against the fixtures: Mira's plan
  // carries Current version 1 and Awaiting Approval version 2, not 2 and 3.
  //
  // Deliberately no `scenario=overdue-plan`. Mira's overdue review date and her
  // awaiting version are fixture facts and need no specimen; naming the scenario
  // would pre-select her, and the search and the click this test exists to
  // exercise would then be landing on a patient who was already open.
  it("finds a synthetic patient and keeps Current Plan above an awaiting draft", async () => {
    const user = userEvent.setup();
    renderRoute(CARE_PLAN_ROUTES.home);
    expect(screen.getByRole("region", { name: "Rowan Sample clinical snapshot" })).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search synthetic patients" }), "SYN-MRN-0002");
    await user.click(screen.getByRole("button", { name: /Open Mira Example/i }));

    const workspace = screen.getByRole("region", { name: "Mira Example clinical snapshot" });
    expect(within(workspace).getByRole("heading", { level: 2, name: "Current Plan" })).toBeInTheDocument();
    expect(within(workspace).getByText(/Awaiting Approval version 2/i)).toBeInTheDocument();
    expect(within(workspace).getByText(/Current version 1 remains in use/i)).toBeInTheDocument();

    // Hierarchy, not merely presence: the awaiting version must never be able to
    // drift above the version a clinician is meant to act on.
    const current = within(workspace).getByRole("heading", { level: 2, name: "Current Plan" });
    const awaiting = within(workspace).getByText(/Awaiting Approval version 2/i);
    expect(current.compareDocumentPosition(awaiting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ["full name", "Mira Example"],
    ["preferred name", "Mira"],
    ["alias", "Mira Example-Hale"],
    ["MRN", "SYN-MRN-0002"],
    ["ISO date of birth", "1948-09-22"],
    ["displayed date of birth", "22/09/1948"],
  ])("searches the supported %s identity field", async (_label, query) => {
    const user = userEvent.setup();
    renderRoute(CARE_PLAN_ROUTES.home);
    await user.type(screen.getByRole("searchbox", { name: "Search synthetic patients" }), query);
    expect(screen.getByRole("button", { name: /Open Mira Example/i })).toBeInTheDocument();
  });

  it("does not search plan or presentation content", async () => {
    const user = userEvent.setup();
    renderRoute(CARE_PLAN_ROUTES.home);
    // A distinctive phrase from Mira's Current Plan content. Identity search
    // must not become a full-text search of clinical text.
    await user.type(screen.getByRole("searchbox", { name: "Search synthetic patients" }), "hearing aids");
    expect(screen.queryByRole("button", { name: /Open Mira Example/i })).toBeNull();
    expect(screen.getByTestId("care-plan-directory-no-results")).toBeInTheDocument();
  });

  it("shows deterministic no-results content and no patient rows", async () => {
    const user = userEvent.setup();
    renderRoute(CARE_PLAN_ROUTES.home);
    await user.type(screen.getByRole("searchbox", { name: "Search synthetic patients" }), "SYN-MRN-9999");
    const results = screen.getByTestId("care-plan-directory-results");
    expect(within(results).queryAllByRole("button", { name: /^Open / })).toEqual([]);
    const empty = screen.getByTestId("care-plan-directory-no-results");
    expect(empty).toHaveTextContent("No synthetic patient matches SYN-MRN-9999");
    expect(empty).toHaveTextContent(/Check the MRN, or try a different spelling/i);
  });

  it("offers recent patients before anything is typed", () => {
    renderRoute(CARE_PLAN_ROUTES.home);
    expect(screen.getByRole("heading", { name: "Recent patients" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Open / }).length).toBeGreaterThan(0);
  });

  it("states the lookback window and that counts decide nothing", () => {
    renderRoute(CARE_PLAN_ROUTES.home);
    const directory = screen.getByRole("region", { name: "Synthetic patient directory" });
    expect(within(directory).getByText(/in the 12 months to 20\/08\/2026/i)).toBeInTheDocument();
    expect(
      within(directory).getByText(
        /Counts describe what happened\. They do not determine eligibility for a Management Plan\./i,
      ),
    ).toBeInTheDocument();
  });

  // Ranking everyone by attendance is the banned label without the word. It
  // exists only inside Identification Review, which is not this surface.
  it("offers no way to sort or rank the directory by presentation count", () => {
    renderRoute(CARE_PLAN_ROUTES.home);
    const directory = screen.getByRole("region", { name: "Synthetic patient directory" });
    expect(within(directory).queryAllByRole("button", { name: /sort|rank|most|highest/i })).toEqual([]);
    expect(within(directory).queryAllByRole("combobox")).toEqual([]);
    expect(within(directory).queryAllByRole("columnheader")).toEqual([]);
  });

  it("offers a manual Identification Review entry point rather than an automatic rule", () => {
    renderRoute(CARE_PLAN_ROUTES.home);
    const directory = screen.getByRole("region", { name: "Synthetic patient directory" });
    expect(within(directory).getByRole("link", { name: /Refer someone for Identification Review/i })).toHaveAttribute(
      "href",
      CARE_PLAN_ROUTES.reviews,
    );
  });

  it("keeps exactly one search field on Home, owned by the directory", () => {
    renderRoute(CARE_PLAN_ROUTES.home);
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    expect(screen.getByRole("searchbox", { name: "Search synthetic patients" })).toBeInTheDocument();
  });

  it("keeps the whole snapshot free of unavailable authoring controls", async () => {
    await searchAndOpen("SYN-MRN-0002", /Open Mira Example/i);
    expect(screen.queryByTitle(/coming soon/i)).toBeNull();
    expect(document.querySelector("[aria-disabled='true']")).toBeNull();
  });
});

describe("Care Plan clinical snapshot", () => {
  const FIRST_MINUTE_HEADINGS = [
    "1. How to approach this person",
    "2. What helps",
    "3. What makes it worse",
    "4. What we have agreed to do",
    "5. What would make this presentation different",
  ];

  it("renders exactly the five first-minute sections, in order", () => {
    renderRoute(CARE_PLAN_ROUTES.patient);
    const sections = screen.getByTestId("care-plan-first-minute-sections");
    expect(
      within(sections)
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(FIRST_MINUTE_HEADINGS);
  });

  // Presence is not enough. The specification requires section 5 to be visually
  // distinct from the other four and never collapsed, truncated, clipped, or put
  // behind a disclosure — all of which leave it in the DOM.
  it("keeps the fifth section visually distinct and never collapsed, truncated or hidden", () => {
    renderRoute(CARE_PLAN_ROUTES.patient);
    const boundary = screen
      .getByRole("heading", { level: 3, name: "5. What would make this presentation different" })
      .closest("section");
    const ordinary = screen.getByRole("heading", { level: 3, name: "2. What helps" }).closest("section");
    expect(boundary).not.toBeNull();
    expect(ordinary).not.toBeNull();

    const boundaryClasses = (boundary?.className ?? "").split(/\s+/).filter(Boolean);
    const ordinaryClasses = (ordinary?.className ?? "").split(/\s+/).filter(Boolean);
    const distinguishing = boundaryClasses.filter((token) => !ordinaryClasses.includes(token));
    expect(distinguishing.length, "section 5 must carry a treatment the other four do not").toBeGreaterThan(0);

    // …and that treatment must not be a way of hiding or shortening it.
    for (const suppression of [/^sr-only$/, /^hidden$/, /^truncate$/, /line-clamp/, /^max-h-/, /^overflow-hidden$/]) {
      for (const token of boundaryClasses) {
        expect(token, `section 5 must not be suppressed by ${suppression}`).not.toMatch(suppression);
      }
    }
    expect(boundary?.closest("details"), "section 5 must not sit behind a disclosure").toBeNull();
    expect(boundary?.closest("[hidden]")).toBeNull();
    expect(boundary?.getAttribute("aria-hidden")).toBeNull();
  });

  it("uses none of the removed nineteen-field vocabulary on the summary card", () => {
    renderRoute(CARE_PLAN_ROUTES.patient);
    const card = screen.getByRole("region", { name: "Current Plan" });
    for (const removed of [
      /preferred engagement/i,
      /may increase distress/i,
      /immediate continuity considerations/i,
      /helpful interventions/i,
      /usual presentation pattern/i,
    ]) {
      expect(card.textContent ?? "", `${removed} is a removed field name`).not.toMatch(removed);
    }
  });

  it("pins the safety boundary beneath identity, above all plan content, and keeps it in print", () => {
    renderRoute(CARE_PLAN_ROUTES.patient);
    const identity = screen.getByTestId("care-plan-identity-band");
    const pinned = screen.getByTestId("care-plan-pinned-safety-boundary");
    const card = screen.getByRole("region", { name: "Current Plan" });

    expect(identity.compareDocumentPosition(pinned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pinned.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pinned.closest("[data-print-hide='true']")).toBeNull();
    // It links to the full section; it never replaces it.
    expect(within(pinned).getByRole("link", { name: /What would make this presentation different/i })).toHaveAttribute(
      "href",
      "#care-plan-first-minute-whatWouldMakeThisDifferent",
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "5. What would make this presentation different" }),
    ).toHaveAttribute("id", "care-plan-first-minute-whatWouldMakeThisDifferent");
  });

  it("states the fresh-assessment boundary on every view of the plan", () => {
    renderRoute(CARE_PLAN_ROUTES.patient);
    expect(
      within(screen.getByRole("region", { name: "Current Plan" })).getByText(
        "This plan supports continuity. It never replaces fresh triage, physical assessment, mental-state assessment, immediate risk assessment, clinical judgement, or legal obligations.",
      ),
    ).toBeInTheDocument();
  });

  it("presents version, owner, approver, dates and links as metadata", () => {
    renderRoute(CARE_PLAN_ROUTES.patient);
    const metadata = screen.getByTestId("care-plan-current-plan-metadata");
    expect(metadata).toHaveTextContent("Current version 2");
    expect(metadata).toHaveTextContent("Morgan Sample");
    expect(metadata).toHaveTextContent("Dr Taylor Fiction");
    expect(metadata).toHaveTextContent("20/05/2026");
    expect(metadata).toHaveTextContent("20/05/2027");
    expect(metadata).toHaveTextContent("Within review");
    expect(metadata).toHaveTextContent("North River CMHT");
    expect(within(metadata).getByRole("link", { name: /Personal Safety Plan/i })).toHaveAttribute(
      "href",
      carePlanRoute.safetyPlan("SYN-PATIENT-001"),
    );
    // Metadata is not a sixth content section.
    expect(within(metadata).queryAllByRole("heading", { level: 3 })).toEqual([]);
  });

  it("derives an overdue review from the date and keeps the content readable below the warning", () => {
    renderRoute(carePlanRoute.patient("SYN-PATIENT-002"));
    const warning = screen.getByTestId("care-plan-review-warning");
    expect(warning).toHaveTextContent(/Review overdue/i);
    expect(warning).toHaveTextContent("16/07/2026");
    const card = screen.getByRole("region", { name: "Current Plan" });
    expect(warning.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getByText(/check that Mira has her hearing aids in/i)).toBeInTheDocument();
  });

  it("says No Current Plan and keeps a Draft visibly separate without promoting it", () => {
    renderRoute(carePlanRoute.patient("SYN-PATIENT-005"));
    const workspace = screen.getByRole("region", { name: "Alex Fiction clinical snapshot" });
    expect(within(workspace).getByText("No Current Plan")).toBeInTheDocument();
    expect(within(workspace).queryByRole("region", { name: "Current Plan" })).toBeNull();
    const draft = within(workspace).getByRole("region", { name: "Version in progress" });
    expect(draft).toHaveTextContent(/Draft version 1/i);
    expect(draft).toHaveTextContent(/This is not a plan in use\./i);
    expect(within(draft).queryByRole("heading", { level: 2, name: "Current Plan" })).toBeNull();
  });

  it("names the withdrawal date, clinician and reason instead of a bare No Current Plan", () => {
    renderRoute(carePlanRoute.patient("SYN-PATIENT-004"));
    const withdrawn = screen.getByTestId("care-plan-withdrawn-notice");
    expect(withdrawn).toHaveTextContent("Plan withdrawn on 04/07/2026 by Dr Taylor Fiction");
    expect(withdrawn).toHaveTextContent(/Evelyn's circumstances have changed substantially/i);
    expect(screen.queryByText("No Current Plan")).toBeNull();
  });

  it("marks a version written without the person's involvement", () => {
    renderRoute(carePlanRoute.patient("SYN-PATIENT-005"));
    expect(
      within(screen.getByRole("region", { name: "Version in progress" })).getByText(
        "Written without this person's involvement",
      ),
    ).toBeInTheDocument();
  });

  it("keeps identity and currency facts visible in the identity band", () => {
    renderRoute(CARE_PLAN_ROUTES.patient);
    const band = screen.getByTestId("care-plan-identity-band");
    expect(band).toHaveTextContent("Rowan Sample");
    expect(band).toHaveTextContent("SYN-MRN-0001");
    expect(band).toHaveTextContent("12/04/1986");
    expect(band).toHaveTextContent("Adult");
    expect(band).toHaveTextContent("Rowan");
    expect(band).toHaveTextContent("they/them");
    expect(band).toHaveTextContent("North River Health Service");
    expect(band).toHaveTextContent(/Current Plan.*version 2/i);
    expect(band).toHaveTextContent(/Personal Safety Plan/i);
    expect(band).toHaveTextContent(/verified/i);
    expect(band).toHaveTextContent(/in the 12 months to 20\/08\/2026/i);
    expect(within(band).getByText("Synthetic prototype — fictional people, teams, and hospitals")).toBeInTheDocument();
  });

  // Never display a nearby patient's plan as a fallback.
  it("refuses to show plan content when the record is not confirmed as the right person", () => {
    renderRoute(CARE_PLAN_ROUTES.patient, "scenario=identity-uncertain");
    expect(screen.queryByRole("region", { name: "Current Plan" })).toBeNull();
    expect(screen.getByTestId("care-plan-identity-uncertain")).toHaveTextContent(/Return to search/i);
  });

  it("links the four primary patient sections and History from the selected patient", () => {
    renderRoute(carePlanRoute.patient("SYN-PATIENT-002"));
    const nav = screen.getByRole("navigation", { name: "Patient sections" });
    for (const [label, href] of [
      ["Overview", carePlanRoute.patient("SYN-PATIENT-002")],
      ["Management Plan", carePlanRoute.managementPlan("SYN-PATIENT-002")],
      ["Personal Safety Plan", carePlanRoute.safetyPlan("SYN-PATIENT-002")],
      ["ED Presentations", carePlanRoute.presentations("SYN-PATIENT-002")],
      ["History", carePlanRoute.history("SYN-PATIENT-002")],
    ] as const) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
    expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  });

  // Home embeds the workspace beside a directory. Marking Overview as the
  // current page there announces a link to `/patients/<id>` as the address the
  // reader is already on, which it is not.
  it.each([CARE_PLAN_ROUTES.home, CARE_PLAN_ROUTES.patients])(
    "marks no patient section as the current page on %s",
    (pathname) => {
      renderRoute(pathname);
      const nav = screen.getByRole("navigation", { name: "Patient sections" });
      for (const link of within(nav).getAllByRole("link")) {
        expect(link, `${link.textContent} must not claim to be the current page`).not.toHaveAttribute("aria-current");
      }
    },
  );

  // Selecting a patient changes no address, so the shell's route-heading focus
  // never fires. Without a focus move the workspace appears in the next column
  // on a desktop and below the entire directory list on a 320px phone, with
  // nothing announced and nothing visibly changed above the fold.
  it("moves focus to the workspace when a patient is selected", async () => {
    const user = userEvent.setup();
    renderRoute(CARE_PLAN_ROUTES.home);
    expect(screen.getByRole("region", { name: "Rowan Sample clinical snapshot" })).not.toHaveFocus();

    await user.type(screen.getByRole("searchbox", { name: "Search synthetic patients" }), "SYN-MRN-0002");
    await user.click(screen.getByRole("button", { name: /Open Mira Example/i }));

    const workspace = screen.getByRole("region", { name: "Mira Example clinical snapshot" });
    expect(workspace).toHaveAttribute("tabindex", "-1");
    expect(workspace).toHaveFocus();
  });

  // …but it must not steal the mount-time focus the shell puts on the route
  // heading, or every page load would jump past the line saying where you are.
  //
  // Asserting the *final* focus cannot see this: the shell's effect is a
  // parent's and therefore runs last, so it would quietly repair the theft on
  // every render and the guard would be untestable. A positive control proved
  // exactly that — removing the mount-time guard left all 89 tests passing. So
  // this records the focus events in order and asserts the workspace never
  // appears among them, momentarily or otherwise.
  it("never takes mount-time focus from the shell heading, even momentarily", () => {
    const focusedNames: string[] = [];
    const listener = (event: Event) => {
      const target = event.target as HTMLElement | null;
      focusedNames.push(target?.getAttribute("aria-label") ?? target?.tagName ?? "");
    };
    document.addEventListener("focusin", listener);
    try {
      renderRoute(CARE_PLAN_ROUTES.home);
    } finally {
      document.removeEventListener("focusin", listener);
    }

    expect(focusedNames.filter((name) => name.endsWith("clinical snapshot"))).toEqual([]);
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toHaveFocus();
    expect(screen.getByRole("region", { name: "Rowan Sample clinical snapshot" })).not.toHaveFocus();
  });

  it("leaves focus to the shell heading on a patient address, where the route did change", () => {
    renderRoute(carePlanRoute.patient("SYN-PATIENT-002"));
    expect(screen.getByRole("heading", { level: 1, name: "Patient overview" })).toHaveFocus();
    expect(screen.getByRole("region", { name: "Mira Example clinical snapshot" })).not.toHaveFocus();
  });

  // Patient-to-patient on a patient address is a real route change, and the
  // shell already owns it. Two owners would both fire, the parent's would land
  // last, and the competition would be invisible in the final state — so this
  // watches the focus events instead.
  it("does not compete with the shell heading when the patient address itself changes", () => {
    const navigate = vi.fn();
    const surface = (pathname: string) => (
      <CarePlanPrototypeProvider>
        <CarePlanRouteSurface pathname={pathname} query="" navigate={navigate} />
      </CarePlanPrototypeProvider>
    );
    const { rerender } = render(surface(carePlanRoute.patient("SYN-PATIENT-001")));

    const focusedNames: string[] = [];
    const listener = (event: Event) => {
      const target = event.target as HTMLElement | null;
      focusedNames.push(target?.getAttribute("aria-label") ?? target?.tagName ?? "");
    };
    document.addEventListener("focusin", listener);
    try {
      rerender(surface(carePlanRoute.patient("SYN-PATIENT-002")));
    } finally {
      document.removeEventListener("focusin", listener);
    }

    expect(focusedNames.filter((name) => name.endsWith("clinical snapshot"))).toEqual([]);
    expect(screen.getByRole("heading", { level: 1, name: "Patient overview" })).toHaveFocus();
  });

  // The return leg. `ClinicalSnapshotSurface` is rendered at one JSX position
  // for all three variants, so React never remounts it and its refs survive the
  // whole trip: Home → a patient address → back to Home, with the selection
  // never changing. A guard that only asked "is this a directory surface?" saw
  // that final flip back to `true` as a fresh selection and moved focus on what
  // is really a route change.
  //
  // Like its two siblings this watches the focus *events*, because the shell's
  // effect is a parent's and lands last — so the final DOM state is correct even
  // when the workspace has already grabbed focus, and a final-state assertion
  // could never fail.
  it.each([
    ["Home", CARE_PLAN_ROUTES.home, "Home"],
    ["Patients", CARE_PLAN_ROUTES.patients, "Patients"],
  ])(
    "does not compete with the shell heading when returning from a patient address to %s",
    async (_label, back, heading) => {
      const user = userEvent.setup();
      const navigate = vi.fn();
      const surface = (pathname: string) => (
        <CarePlanPrototypeProvider>
          <CarePlanRouteSurface pathname={pathname} query="" navigate={navigate} />
        </CarePlanPrototypeProvider>
      );
      const { rerender } = render(surface(CARE_PLAN_ROUTES.home));

      // Choose a patient first. This focus move is the correct one, and it is what
      // leaves the surface in the state the regression needs.
      await user.type(screen.getByRole("searchbox", { name: "Search synthetic patients" }), "SYN-MRN-0002");
      await user.click(screen.getByRole("button", { name: /Open Mira Example/i }));
      expect(screen.getByRole("region", { name: "Mira Example clinical snapshot" })).toHaveFocus();

      // Follow the full-record link. The selection does not change from here on.
      rerender(surface(carePlanRoute.patient("SYN-PATIENT-002")));

      const focusedNames: string[] = [];
      const listener = (event: Event) => {
        const target = event.target as HTMLElement | null;
        focusedNames.push(target?.getAttribute("aria-label") ?? target?.tagName ?? "");
      };
      document.addEventListener("focusin", listener);
      try {
        rerender(surface(back));
      } finally {
        document.removeEventListener("focusin", listener);
      }

      expect(focusedNames.filter((name) => name.endsWith("clinical snapshot"))).toEqual([]);
      expect(screen.getByRole("heading", { level: 1, name: heading })).toHaveFocus();
    },
  );
});

// A Current version whose `reviewDueAt` is null derives no review state at all.
// `deriveReviewState` was deliberately made to return `overdue` for a date it
// cannot parse, because a clinical currency indicator must not resolve to the
// most reassuring state on bad input. An absent date is the same situation, and
// it reaches a different code path — the one that renders nothing.
//
// No fixture patient is in this state, so the snapshot is constructed.
describe("Care Plan review currency with no review date", () => {
  function undatedWorkspace() {
    const state = createInitialPrototypeState();
    const base = buildPatientSnapshot(state, "SYN-PATIENT-001", PROTOTYPE_NOW);
    if (base === null || base.currentManagementVersion === null) {
      throw new Error("SYN-PATIENT-001 must have a Current version for this test to mean anything.");
    }
    render(
      <PatientWorkspace
        snapshot={{
          ...base,
          currentManagementVersion: { ...base.currentManagementVersion, reviewDueAt: null },
          reviewState: null,
        }}
        users={state.users}
        scenario="normal"
        outcome={null}
        activeSection={null}
        reviewsHref={CARE_PLAN_ROUTES.reviews}
        onRecordContactIntent={() => {}}
        contactActionBlockedReason={null}
      />,
    );
  }

  it("says the review currency is unknown rather than showing nothing", () => {
    undatedWorkspace();
    const warning = screen.getByTestId("care-plan-review-warning");
    expect(warning).toHaveTextContent("Review currency unknown");
    expect(warning).toHaveTextContent(/Treat it as due for review/i);
  });

  it("does not let the summary card imply the plan is within review", () => {
    undatedWorkspace();
    const metadata = screen.getByTestId("care-plan-current-plan-metadata");
    expect(metadata).toHaveTextContent("Review currency unknown");
    expect(metadata).not.toHaveTextContent("Within review");
  });

  it("keeps the plan itself fully readable", () => {
    undatedWorkspace();
    const card = screen.getByRole("region", { name: "Current Plan" });
    expect(within(card).getAllByRole("heading", { level: 3 })).toHaveLength(5);
  });
});

describe("Care Plan CMHT contact actions", () => {
  it("exposes only intent-safe CMHT launch links", () => {
    renderRoute(CARE_PLAN_ROUTES.patient);
    expect(screen.getByRole("link", { name: "Email North River CMHT" })).toHaveAttribute(
      "href",
      "mailto:north-river.cmht@example.org?subject=Care+Plan+%E2%80%94+team+contact+request",
    );
    expect(screen.getByRole("link", { name: "Call North River CMHT" })).toHaveAttribute("href", "tel:+61491570101");
  });

  // An allowlist, not a denylist. The requirement forbids five classes of
  // content — name, MRN, date of birth, presentation content, plan content — and
  // a list of strings can only ever cover the ones somebody thought of: a
  // planted `&plan=…`, or `12 April 1986` instead of `12/04/1986`, would walk
  // straight past it. Pinning the whole query string to the single expected pair
  // fails on any added parameter whatever it carries.
  it("puts nothing but the generic subject in the mailto", () => {
    renderRoute(CARE_PLAN_ROUTES.patient);
    const href = screen.getByRole("link", { name: "Email North River CMHT" }).getAttribute("href") ?? "";
    const [address, query = "", ...rest] = href.split("?");

    expect(address).toBe("mailto:north-river.cmht@example.org");
    expect(rest, "a mailto carries exactly one query string").toEqual([]);
    expect(query).toBe("subject=Care+Plan+%E2%80%94+team+contact+request");
    expect([...new URLSearchParams(query).keys()], "subject is the only permitted parameter").toEqual(["subject"]);
    expect(new URLSearchParams(query).get("subject")).toBe("Care Plan — team contact request");
    expect(href, "a mailto carries no fragment either").not.toContain("#");
  });

  it("shows the displayed contact details, hours, coordinator and after-hours route", () => {
    renderRoute(CARE_PLAN_ROUTES.patient);
    const contacts = screen.getByRole("region", { name: "Community mental health team" });
    expect(contacts).toHaveTextContent("north-river.cmht@example.org");
    expect(contacts).toHaveTextContent("0491 570 101");
    expect(contacts).toHaveTextContent("Monday to Friday, 8:30 am to 5:00 pm AWST");
    expect(contacts).toHaveTextContent("Sam Placeholder");
    expect(contacts).toHaveTextContent("1300 555 788");
    expect(contacts).toHaveTextContent("30/07/2026");
  });

  it("records a contact intent and claims only that an application was requested", async () => {
    const user = userEvent.setup();
    renderRoute(CARE_PLAN_ROUTES.patient);
    await user.click(screen.getByRole("link", { name: "Email North River CMHT" }));
    const outcome = screen.getByTestId("care-plan-outcome");
    expect(outcome).toHaveTextContent(
      "An email application was asked to open. This prototype records only that request, not what happens next.",
    );
    for (const overclaim of [/sent/i, /delivered/i, /received/i, /replied/i, /notified/i]) {
      expect(outcome.textContent ?? "").not.toMatch(overclaim);
    }
  });

  it.each(["permission-unavailable", "version-conflict"])(
    "prevents an unrecordable contact launch when %s blocks its audit intent",
    (scenario) => {
      renderRoute(CARE_PLAN_ROUTES.patient, `scenario=${scenario}`);
      const email = screen.getByRole("link", { name: "Email North River CMHT" });

      expect(email).toHaveAttribute("aria-disabled", "true");
      expect(fireEvent.click(email)).toBe(false);
      expect(screen.getByRole("alert")).toHaveTextContent(/nothing was changed|newer version/i);
      expect(screen.queryByTestId("care-plan-outcome")).toBeNull();
    },
  );

  it("keeps unverified contact details visible with a warning, last-verified date and a Reviews link", () => {
    renderRoute(carePlanRoute.patient("SYN-PATIENT-003"));
    const contacts = screen.getByRole("region", { name: "Community mental health team" });
    // Details stay visible: withholding them would send nobody anywhere.
    expect(contacts).toHaveTextContent("wandoo-district.cmht@example.org");
    expect(within(contacts).getByRole("link", { name: "Call Wandoo District CMHT" })).toHaveAttribute(
      "href",
      "tel:+61491570121",
    );
    const warning = within(contacts).getByTestId("care-plan-contact-verification-warning");
    expect(warning).toHaveTextContent(/have not been verified/i);
    expect(warning).toHaveTextContent("20/01/2025");
    expect(warning.textContent ?? "").not.toMatch(/available now|currently available|reachable/i);
    expect(within(warning).getByRole("link", { name: /Reviews/i })).toHaveAttribute("href", CARE_PLAN_ROUTES.reviews);
  });

  it("keeps details visible and explains a launch failure in three parts", async () => {
    const user = userEvent.setup();
    renderRoute(CARE_PLAN_ROUTES.patient, "scenario=launch-failure");
    await user.click(screen.getByRole("link", { name: "Email North River CMHT" }));
    const failure = screen.getByTestId("care-plan-launch-failure");
    expect(failure).toHaveTextContent(/could not be opened/i);
    expect(failure).toHaveTextContent(/Nothing was sent/i);
    expect(failure).toHaveTextContent(/north-river\.cmht@example\.org/);
    // The contact details themselves are still on screen.
    const contacts = screen.getByRole("region", { name: "Community mental health team" });
    expect(within(contacts).getByRole("link", { name: "Call North River CMHT" })).toBeInTheDocument();
  });

  // The guarded-launch behaviour itself (aria-disabled, preventDefault, no
  // audit outcome) is covered by "prevents an unrecordable contact launch
  // when %s blocks its audit intent" above, across both scenarios that can
  // block record-contact-intent.
});

describe("Care Plan Management Plan reading", () => {
  it("keeps the generated heading list identical to the approved copy", () => {
    // The other tests in this file generate their expectation from
    // `FIRST_MINUTE_CONTENT_KEYS`, which cannot catch a renamed label. This one
    // pins the words themselves, so the two together catch both a reordering and
    // a rewording.
    expect(FIRST_MINUTE_HEADINGS_FROM_DOMAIN).toEqual([
      "1. How to approach this person",
      "2. What helps",
      "3. What makes it worse",
      "4. What we have agreed to do",
      "5. What would make this presentation different",
    ]);
  });

  it("renders the summary card as exactly the first-minute keys, in order", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"));
    const sections = screen.getByTestId("care-plan-first-minute-sections");
    expect(
      within(sections)
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(FIRST_MINUTE_HEADINGS_FROM_DOMAIN);
  });

  // The brief's worked example, corrected against the committed code: the test
  // identifier is `care-plan-pinned-safety-boundary` and the first heading is
  // `1. How to approach this person`, not a per-patient heading.
  it("pins the safety boundary above all plan content", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"));
    const pinned = screen.getByTestId("care-plan-pinned-safety-boundary");
    const firstSection = screen.getByRole("heading", { level: 3, name: "1. How to approach this person" });
    expect(pinned.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pinned).toHaveTextContent(/assess afresh/i);
    expect(pinned.closest("[data-print-hide='true']")).toBeNull();
  });

  it("puts the pinned boundary beneath the patient identity block and above every other plan element", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"));
    const identity = screen.getByTestId("care-plan-plan-identity");
    const pinned = screen.getByTestId("care-plan-pinned-safety-boundary");
    expect(identity.compareDocumentPosition(pinned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const testId of ["care-plan-current-plan-metadata", "care-plan-full-plan", "care-plan-plan-governance"]) {
      expect(
        pinned.compareDocumentPosition(screen.getByTestId(testId)) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${testId} must follow the pinned safety boundary`,
      ).toBeTruthy();
    }
  });

  it("renders the full-plan tier and says Not recorded rather than omitting an empty section", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-002"));
    const full = screen.getByTestId("care-plan-full-plan");
    expect(within(full).getByRole("heading", { level: 3, name: "Why this plan exists" })).toBeInTheDocument();
    expect(within(full).getByText(/Mira is known to the Coastal Plains Older Adult CMHT/)).toBeInTheDocument();

    // Mira's Current version records neither practical needs nor anything that
    // should prompt a review. Both must still appear, saying so.
    for (const heading of ["Practical needs", "What should prompt a review"]) {
      const section = within(full).getByRole("heading", { level: 3, name: heading }).closest("section");
      expect(section, `${heading} must be rendered`).not.toBeNull();
      expect(section).toHaveTextContent("Not recorded");
    }
    // …and a section that does have content shows it rather than Not recorded.
    const involved = within(full).getByRole("heading", { level: 3, name: "Who else is involved" }).closest("section");
    expect(involved).toHaveTextContent(/Coastal Plains Older Adult CMHT is the durable service contact/);
    expect(involved).not.toHaveTextContent("Not recorded");
  });

  it("presents version, approval, ownership, review and sharing facts as metadata", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"));
    // Version, approval, ownership and review currency belong to the shared
    // summary card, which the Clinical Snapshot renders too.
    const summary = screen.getByTestId("care-plan-current-plan-metadata");
    expect(summary).toHaveTextContent("Current version 2");
    expect(summary).toHaveTextContent("Morgan Sample");
    expect(summary).toHaveTextContent("Dr Taylor Fiction");
    expect(summary).toHaveTextContent("20/05/2026");
    expect(summary).toHaveTextContent("20/05/2027");
    expect(summary).toHaveTextContent("Within review");

    // The governance block carries only what the card does not.
    const governance = screen.getByTestId("care-plan-plan-governance");
    expect(governance).toHaveTextContent("22/05/2026");
    expect(governance).toHaveTextContent(/1 open Review Trigger/);
    expect(governance).toHaveTextContent(/No current Patient Plan/i);
    // Metadata, never a sixth content section.
    expect(within(governance).queryAllByRole("heading", { level: 3 })).toEqual([]);
  });

  // The same fact stated twice on one page is not emphasis; it is a second copy
  // that a later edit can leave saying something different. Counted across the
  // whole page rather than asserted absent from one block, so moving the copy
  // somewhere else cannot satisfy it.
  it("states each version and currency fact exactly once", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"));
    for (const fact of ["Current version 2", "Within review"]) {
      expect(screen.getAllByText(fact), `${fact} must be rendered once`).toHaveLength(1);
    }
  });

  it("marks a version written without this person's involvement exactly once", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-002"));
    const markers = screen.getAllByText("Written without this person's involvement");
    expect(markers).toHaveLength(1);
    expect(markers[0]?.closest("[data-testid='care-plan-awaiting-version']")).not.toBeNull();
  });

  /**
   * `satisfies readonly (keyof ManagementPlanContent)[]` checks membership, not
   * exhaustiveness. A twelfth content field added later could render on no
   * surface at all, which is the failure the specification legislated against
   * for the summary card — so the same treatment applies to the full-plan tier.
   *
   * Measured against a fixture version's own content object, so the runtime keys
   * come from real data rather than from another hand-written list.
   */
  it("renders every Management Plan content field across the two tiers", () => {
    const content = syntheticManagementPlanVersions[0]?.content;
    expect(content, "the fixtures must carry at least one version").toBeDefined();
    const rendered = [...FIRST_MINUTE_CONTENT_KEYS, "whyThisPlanExists", ...FULL_PLAN_SECTION_KEYS];
    expect([...rendered].sort()).toEqual(Object.keys(content ?? {}).sort());
    // Fails closed if the tiers ever collapse into one another.
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it("derives the review state at render rather than reading a stored one", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-002"));
    const warning = screen.getByTestId("care-plan-review-warning");
    expect(warning).toHaveTextContent(/Review overdue/i);
    expect(warning).toHaveTextContent("16/07/2026");
    // An overdue plan stays fully readable below the warning.
    const card = screen.getByRole("region", { name: "Current Plan" });
    expect(warning.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).getAllByRole("heading", { level: 3 })).toHaveLength(5);
  });

  it("marks a version written without this person's involvement", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-002"));
    expect(
      within(screen.getByTestId("care-plan-awaiting-version")).getByText("Written without this person's involvement"),
    ).toBeInTheDocument();
  });

  it("keeps a separate Awaiting Approval version clearly subordinate to the Current one", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-002"));
    const card = screen.getByRole("region", { name: "Current Plan" });
    const awaiting = screen.getByTestId("care-plan-awaiting-version");
    expect(card.compareDocumentPosition(awaiting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(awaiting).toHaveTextContent(/Awaiting Approval version 2/);
    expect(awaiting).toHaveTextContent(/not a plan in use/i);
    expect(within(awaiting).queryAllByRole("heading", { level: 3 })).toEqual([]);
  });

  // The brief's second worked example. Its three pinned fixture values —
  // SYN-PATIENT-004, the withdrawal date, and Dr Taylor Fiction — were checked
  // against the fixtures and all three hold.
  it("shows a withdrawn plan as withdrawn, never as no plan at all", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-004"), "scenario=withdrawn-plan");
    const withdrawn = screen.getByTestId("care-plan-withdrawn-notice");
    expect(withdrawn).toHaveTextContent("Plan withdrawn on 04/07/2026 by Dr Taylor Fiction");
    expect(withdrawn).toHaveTextContent(/Evelyn's circumstances have changed substantially/);
    expect(screen.queryByText("No Current Plan")).toBeNull();
  });

  it("keeps the withdrawn version's content readable without putting it back in use", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-004"), "scenario=withdrawn-plan");
    const superseded = screen.getByTestId("care-plan-superseded-content");
    expect(superseded).toHaveTextContent(/Ask Evie how she would like to be addressed/);
    expect(superseded).toHaveTextContent(/not in use/i);
    // A withdrawn version is never dressed as the Current Plan.
    expect(screen.queryByRole("region", { name: "Current Plan" })).toBeNull();
  });

  it("offers the printed copy as navigation to the print route rather than an action here", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"));
    expect(screen.getByRole("link", { name: /Print this plan/i })).toHaveAttribute(
      "href",
      carePlanRoute.managementPlanPrint("SYN-PATIENT-001"),
    );
  });
});

describe("Care Plan Management Plan print", () => {
  it("carries the identifiers, the pinned boundary and exactly the five sections in order", () => {
    renderRoute(carePlanRoute.managementPlanPrint("SYN-PATIENT-001"));
    const paper = screen.getByTestId("care-plan-print-output");
    expect(paper).toHaveAttribute("data-print-output");
    expect(paper).toHaveTextContent("Rowan Sample");
    expect(paper).toHaveTextContent("SYN-MRN-0001");
    expect(paper).toHaveTextContent("12/04/1986");
    expect(within(paper).getByTestId("care-plan-pinned-safety-boundary")).toHaveTextContent(/assess afresh/i);
    expect(
      within(paper)
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(FIRST_MINUTE_HEADINGS_FROM_DOMAIN);
  });

  it("carries the version and approval metadata and the team contact block", () => {
    renderRoute(carePlanRoute.managementPlanPrint("SYN-PATIENT-001"));
    const paper = screen.getByTestId("care-plan-print-output");
    expect(paper).toHaveTextContent("Current version 2");
    expect(paper).toHaveTextContent("Dr Taylor Fiction");
    expect(paper).toHaveTextContent("20/05/2026");
    const cmht = within(paper).getByTestId("care-plan-print-cmht");
    expect(cmht).toHaveTextContent("North River CMHT");
    expect(cmht).toHaveTextContent("north-river.cmht@example.org");
    expect(cmht).toHaveTextContent("0491 570 101");
    expect(cmht).toHaveTextContent("1300 555 788");
  });

  it("states the record warning, the deterministic stamp, the synthetic marker and a confidential footer", () => {
    renderRoute(carePlanRoute.managementPlanPrint("SYN-PATIENT-001"));
    const paper = screen.getByTestId("care-plan-print-output");
    expect(within(paper).getByTestId("care-plan-print-record-warning")).toHaveTextContent(
      /check the electronic record/i,
    );
    // Deterministic: PROTOTYPE_NOW, never a wall clock.
    expect(paper.querySelector("[data-print-stamp]")).toHaveTextContent("20/08/2026");
    // The synthetic marker must live inside the printed subtree. Everything
    // outside `[data-print-output]` is made invisible by the shared print rule,
    // so the shell header's marker does not reach the paper.
    expect(within(paper).getByText("Synthetic prototype — fictional people, teams, and hospitals")).toBeInTheDocument();
    expect(paper.querySelector("[data-print-confidential]")).toHaveTextContent(/Confidential clinical document/i);
  });

  it("omits navigation, actions, audit history and drafts from the printed copy", () => {
    renderRoute(carePlanRoute.managementPlanPrint("SYN-PATIENT-002"));
    const paper = screen.getByTestId("care-plan-print-output");
    const text = paper.textContent ?? "";

    expect(within(paper).queryAllByRole("navigation")).toEqual([]);
    expect(within(paper).queryAllByRole("button")).toEqual([]);
    // SYN-PATIENT-002 has an Awaiting Approval version 2 on screen. It is not
    // the plan in use, so it never travels to a bedside.
    expect(text).not.toMatch(/Awaiting Approval|Version in progress|Draft version/i);
    // Audit history is a screen surface: a chronology is unreadable on paper and
    // is not what a reader at a bedside needs. Deliberately not a bare /history/
    // match — Mira's own plan content says "repeating the whole history", which
    // is clinical text, not an audit trail.
    expect(within(paper).queryAllByRole("link", { name: /history/i })).toEqual([]);
    expect(text).not.toMatch(/audit|amendment|Review Trigger|presentation activity/i);
    expect(within(paper).queryAllByRole("link", { name: /^(?:Email|Call) /i })).toEqual([]);
    // The whole patient-section navigation is absent from the route, not merely
    // from the paper.
    expect(screen.queryByRole("navigation", { name: "Patient sections" })).toBeNull();
  });

  it("records a print intent that claims only that the print view was opened", async () => {
    const user = userEvent.setup();
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);
    renderRoute(carePlanRoute.managementPlanPrint("SYN-PATIENT-001"));

    await user.click(screen.getByRole("button", { name: /Print this plan/i }));

    expect(printSpy).toHaveBeenCalledTimes(1);
    const outcome = screen.getByTestId("care-plan-print-outcome");
    expect(outcome).toHaveTextContent("The print view was opened.");
    for (const overclaim of [/printed successfully/i, /sent to the printer/i, /copy was produced/i]) {
      expect(outcome.textContent ?? "").not.toMatch(overclaim);
    }
    // The outcome notice is screen chrome and never travels onto the paper.
    expect(outcome.closest("[data-print-hide='true']")).not.toBeNull();
  });

  it.each(["permission-unavailable", "version-conflict"])(
    "does not open the browser print dialogue when %s blocks the print intent",
    async (scenario) => {
      const user = userEvent.setup();
      const printSpy = vi.fn();
      vi.stubGlobal("print", printSpy);
      renderRoute(carePlanRoute.managementPlanPrint("SYN-PATIENT-001"), `scenario=${scenario}`);

      const printButton = screen.getByRole("button", { name: /Print this plan/i });
      expect(printButton).toHaveAttribute("aria-disabled", "true");
      expect(printButton).toHaveAccessibleDescription(screen.getByTestId("care-plan-print-blocked").textContent ?? "");
      await user.click(printButton);

      expect(printSpy).not.toHaveBeenCalled();
      expect(screen.queryByTestId("care-plan-print-outcome")).toBeNull();
    },
  );

  it("keeps the print control off the paper", () => {
    renderRoute(carePlanRoute.managementPlanPrint("SYN-PATIENT-001"));
    const control = screen.getByRole("button", { name: /Print this plan/i });
    expect(control.closest("[data-print-hide='true']")).not.toBeNull();
    expect(control.closest("[data-print-output]")).toBeNull();
  });

  it("says plainly when there is no Current Plan to print", () => {
    renderRoute(carePlanRoute.managementPlanPrint("SYN-PATIENT-004"), "scenario=withdrawn-plan");
    expect(screen.getByTestId("care-plan-print-unavailable")).toHaveTextContent(/Plan withdrawn on 04\/07\/2026/);
    expect(screen.queryByTestId("care-plan-print-output")).toBeNull();
  });

  // No component added by this task calls `focus()`, and the shell's
  // pathname-keyed effect commits last — so a final-state assertion here could
  // never fail. This watches the focus events instead.
  it("leaves the mount-time focus to the shell heading", () => {
    const focusedNames: string[] = [];
    const listener = (event: Event) => {
      const target = event.target as HTMLElement | null;
      focusedNames.push(target?.getAttribute("aria-label") ?? target?.tagName ?? "");
    };
    document.addEventListener("focusin", listener);
    try {
      renderRoute(carePlanRoute.managementPlanPrint("SYN-PATIENT-001"));
    } finally {
      document.removeEventListener("focusin", listener);
    }

    expect(focusedNames).toEqual(["H1"]);
    expect(screen.getByRole("heading", { level: 1, name: "Print Management Plan" })).toHaveFocus();
  });
});

// --- Stage B: governed authoring ----------------------------------------------

const SENIOR = "SYN-USER-SENIOR-001";
const LIAISON = "SYN-USER-LIAISON-001";

async function signInAs(user: ReturnType<typeof userEvent.setup>, userId: string) {
  await user.selectOptions(screen.getByRole("combobox", { name: "Prototype role" }), userId);
}

function recordFocusOrder(): { stop: () => string[] } {
  const seen: string[] = [];
  const listener = (event: Event) => {
    const target = event.target as HTMLElement | null;
    seen.push(target?.getAttribute("data-testid") ?? target?.id ?? target?.tagName ?? "");
  };
  document.addEventListener("focusin", listener);
  return {
    stop() {
      document.removeEventListener("focusin", listener);
      return seen;
    },
  };
}

describe("Care Plan authoring entry points on the reading surface", () => {
  /**
   * The reading surface is the primary use, and a reader without authoring
   * permission gets a clean one. Role-inapplicable controls are absent, not
   * rendered as a row of unavailable buttons — the stated-reason pattern is for
   * an action this role *could* take but cannot right now.
   */
  it("shows a reader with no authoring permission no authoring controls at all", () => {
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"));
    expect(screen.queryByTitle(/coming soon/i)).toBeNull();
    expect(document.querySelector("[aria-disabled='true']")).toBeNull();
    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      expect(/\/management-plan\/(?:edit|review)$/.test(href), `${href} is an authoring surface`).toBe(false);
    }
    expect(
      screen.queryAllByRole("button", { name: /draft|approve|withdraw|submit|return for changes|formal review/i }),
    ).toEqual([]);
  });

  it("offers a drafting entry point to a clinician who may author", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"));
    await signInAs(user, LIAISON);

    expect(screen.getByRole("link", { name: /Draft a replacement version/i })).toHaveAttribute(
      "href",
      carePlanRoute.managementPlanEdit("SYN-PATIENT-001"),
    );
    // Approval and withdrawal are not this role's, so they are absent rather
    // than shown unavailable.
    expect(screen.queryAllByRole("button", { name: /withdraw|formal review/i })).toEqual([]);
  });

  it("offers withdrawal and formal review only to the named senior clinician", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"));
    await signInAs(user, SENIOR);

    expect(screen.getByRole("button", { name: /Withdraw this plan/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record a formal review/i })).toBeInTheDocument();
  });

  // Authoring is supporting machinery. It never occupies space the first-minute
  // reading content needs, and never appears above it.
  it("keeps every authoring control below the whole reading surface", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"));
    await signInAs(user, SENIOR);

    const actions = screen.getByTestId("care-plan-plan-actions");
    for (const testId of [
      "care-plan-pinned-safety-boundary",
      "care-plan-current-plan-metadata",
      "care-plan-first-minute-sections",
      "care-plan-full-plan",
      "care-plan-plan-governance",
    ]) {
      expect(
        screen.getByTestId(testId).compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
        `the authoring controls must follow ${testId}`,
      ).toBeTruthy();
    }
  });

  it("records that the plan has been shown to this person without writing a patient copy", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-002"), "scenario=overdue-plan");
    await user.click(screen.getByRole("button", { name: /Record that this plan has been shown/i }));

    const outcome = screen.getByTestId("care-plan-outcome");
    expect(outcome).toHaveTextContent(/Recorded that Mira has been shown version 1/i);
    expect(outcome).toHaveTextContent(/No patient copy was written/i);
    expect(screen.getByTestId("care-plan-plan-governance")).toHaveTextContent(/Shown on/i);
  });

  it("refuses a second sharing record rather than replacing the recorded date", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"));
    await user.click(screen.getByRole("button", { name: /Record that this plan has been shown/i }));
    expect(screen.getByTestId("care-plan-outcome")).toHaveTextContent(/already recorded as shown to Rowan/i);
  });

  it("records a formal review that moves the date without creating a version", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-002"), "scenario=overdue-plan");
    await signInAs(user, SENIOR);
    await user.click(screen.getByRole("button", { name: /Record a formal review/i }));

    const sheet = screen.getByRole("dialog", { name: /Record a formal review/i });
    await user.type(
      within(sheet).getByRole("textbox", { name: /What was reviewed/i }),
      "Reviewed with the Coastal Plains team; the agreed order of assessment still describes what happens.",
    );
    await user.clear(within(sheet).getByLabelText(/Next review date/i));
    await user.type(within(sheet).getByLabelText(/Next review date/i), "2027-08-20");
    await user.click(within(sheet).getByRole("button", { name: /Record this review/i }));

    expect(screen.getByTestId("care-plan-outcome")).toHaveTextContent(/Formal review recorded/i);
    expect(screen.getByTestId("care-plan-outcome")).toHaveTextContent(/stays the Current Plan/i);
    // The content is untouched and no new version appeared; only the date moved,
    // which is what takes the plan out of the overdue state.
    expect(screen.getByTestId("care-plan-current-plan-metadata")).toHaveTextContent("Current version 1");
    expect(screen.getByTestId("care-plan-current-plan-metadata")).toHaveTextContent("20/08/2027");
    expect(screen.queryByTestId("care-plan-review-warning")).toBeNull();
    expect(screen.getByTestId("care-plan-first-minute-sections")).toHaveTextContent(
      /hearing aids in before you start/i,
    );
  });

  /**
   * Every one of the four plan actions changes a record, so every one of them can
   * be blocked by the same degraded states. The first shape of this block
   * computed a reason for the sharing control only: formal review and withdrawal
   * were plain enabled buttons whose refusal a clinician discovered only after
   * opening a sheet, typing a reason, and confirming — worst on withdrawal, the
   * most consequential control on the page.
   */
  it("states the degraded-state reason on every plan action, not only the first", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"), "scenario=offline");
    await signInAs(user, SENIOR);

    for (const name of [/Record that this plan has been shown/i, /Record a formal review/i, /Withdraw this plan/i]) {
      const control = screen.getByRole("button", { name });
      expect(control, `${name} must say why it is unavailable`).toHaveAttribute("aria-disabled", "true");
      expect(control).not.toHaveAttribute("disabled");
      const describedBy = control.getAttribute("aria-describedby") ?? "";
      expect(document.getElementById(describedBy)?.textContent ?? "").toMatch(/offline, so nothing was changed/i);
    }

    // Activation does nothing: no sheet, and no record written.
    await user.click(screen.getByRole("button", { name: /Withdraw this plan/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Record a formal review/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: "Current Plan" })).toBeInTheDocument();
  });

  // One reason, stated once. Three identical paragraphs saying the device is
  // offline is noise, not emphasis.
  it("states one shared reason once rather than repeating it per control", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"), "scenario=offline");
    await signInAs(user, SENIOR);

    const notices = within(screen.getByTestId("care-plan-plan-actions")).getAllByRole("alert");
    expect(notices).toHaveLength(1);
  });

  it("withdraws a Current plan for a senior clinician and shows the withdrawal line afterwards", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlan("SYN-PATIENT-001"));
    await signInAs(user, SENIOR);
    await user.click(screen.getByRole("button", { name: /Withdraw this plan/i }));

    const sheet = screen.getByRole("dialog", { name: /Withdraw this plan/i });
    await user.type(
      within(sheet).getByRole("textbox", { name: /Why is this plan being withdrawn/i }),
      "Rowan has moved out of the catchment and the plan no longer describes the service that would use it.",
    );
    await user.click(within(sheet).getByRole("button", { name: /Withdraw this plan/i }));

    expect(screen.getByTestId("care-plan-withdrawn-notice")).toHaveTextContent(
      /Plan withdrawn on .* by Dr Taylor Fiction — Rowan has moved out of the catchment/i,
    );
    // Never a bare No Current Plan, and no superseded version put back in use.
    expect(screen.queryByText("No Current Plan")).toBeNull();
    expect(screen.queryByRole("region", { name: "Current Plan" })).toBeNull();
  });
});

describe("Care Plan Management Plan drafting", () => {
  it("starts a replacement version from the Current Plan without displacing it", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanEdit("SYN-PATIENT-001"));
    await signInAs(user, LIAISON);
    await user.click(screen.getByRole("button", { name: /Start a replacement version/i }));

    // Initialised from the Current version's content, not from an empty form.
    const approach = screen.getByRole("textbox", { name: /How to approach this person/i }) as HTMLTextAreaElement;
    expect(approach.value).toContain("Introduce yourself by name and role");
    expect(screen.getByTestId("care-plan-form-current-plan-notice")).toHaveTextContent(
      /Current version 2 stays in use until a senior clinician approves a replacement/i,
    );
  });

  it("says plainly when drafting is not part of the signed-in role", () => {
    renderRoute(carePlanRoute.managementPlanEdit("SYN-PATIENT-001"));
    expect(screen.getByTestId("care-plan-form-unavailable")).toHaveTextContent(/Dr Casey Example/);
    expect(screen.getByTestId("care-plan-form-unavailable")).toHaveTextContent(/does not carry this action/i);
    expect(screen.queryAllByRole("textbox")).toEqual([]);
  });

  it("keeps a version awaiting approval read-only and sends the reader to the review route", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanEdit("SYN-PATIENT-002"), "scenario=overdue-plan");
    await signInAs(user, LIAISON);

    expect(screen.getByTestId("care-plan-form-read-only")).toHaveTextContent(
      /Version 2 is awaiting approval and cannot be edited/i,
    );
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.getByRole("link", { name: /Open the version awaiting approval/i })).toHaveAttribute(
      "href",
      carePlanRoute.managementPlanReview("SYN-PATIENT-002"),
    );
  });

  it("lists every required field in a linked summary and leaves focus on it", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanEdit("SYN-PATIENT-005"));
    await signInAs(user, LIAISON);

    await user.clear(screen.getByRole("textbox", { name: /Reason for this version/i }));
    for (const key of FIRST_MINUTE_CONTENT_KEYS) {
      await user.clear(screen.getByRole("textbox", { name: new RegExp(FIRST_MINUTE_SECTION_LABEL[key], "i") }));
    }
    await user.clear(screen.getByRole("textbox", { name: /Why this plan exists/i }));

    const focus = recordFocusOrder();
    await user.click(screen.getByRole("button", { name: /Submit for senior approval/i }));
    const order = focus.stop();

    const summary = screen.getByTestId("error-summary");
    expect(within(summary).getAllByTestId("error-summary-link")).toHaveLength(7);
    expect(within(summary).getAllByRole("link")[0]).toHaveAttribute(
      "href",
      `#${managementPlanFieldId("revisionReason")}`,
    );

    // Final-state focus assertions are provably unable to fail in this shell, so
    // this asserts the order of the focus events instead. There is exactly one
    // owner — `ErrorSummary`, the repository default — so focus finishes on the
    // summary, where a reader hears how many problems there are and picks one.
    // Nothing may move it on to a field afterwards: a second owner would cut the
    // summary off part-read, and the reader would never learn the other six.
    expect(order.at(-1)).toBe("error-summary");
    expect(
      order.filter((id) => id.startsWith("care-plan-management-form-")),
      "no later focus move may take the reader off the summary",
    ).toEqual([]);
    // The summary's links are how focus reaches a field, and they are the
    // reader's choice rather than one made for them.
    expect(within(summary).getAllByRole("link")[0]).toHaveAttribute(
      "href",
      `#${managementPlanFieldId("revisionReason")}`,
    );
    // Nothing was submitted.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not require the five optional full-plan sections", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanEdit("SYN-PATIENT-005"));
    await signInAs(user, LIAISON);

    for (const key of FULL_PLAN_SECTION_KEYS) {
      await user.clear(screen.getByRole("textbox", { name: new RegExp(FULL_PLAN_SECTION_LABEL[key], "i") }));
    }
    await user.click(screen.getByRole("button", { name: /Submit for senior approval/i }));

    expect(screen.queryByTestId("error-summary")).toBeNull();
    expect(screen.getByRole("dialog", { name: /Submit version 1 for senior approval/i })).toBeInTheDocument();
  });

  /**
   * A wording guard, not clinical interpretation. It refuses a construction that
   * reads at 3am as a pre-authorised refusal by a clinician who has never met the
   * person; it takes no view on whether the clinical position is right. The
   * banned phrase is read from the exported constant rather than retyped.
   */
  it("rejects a prohibitive admission construction and names the one it found", async () => {
    const banned = BANNED_ADMISSION_CONSTRUCTIONS[0] ?? "";
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanEdit("SYN-PATIENT-005"));
    await signInAs(user, LIAISON);

    const field = screen.getByRole("textbox", { name: /What we have agreed to do/i });
    await user.clear(field);
    await user.type(field, `This person ${banned} when they attend at night.`);
    await user.click(screen.getByRole("button", { name: /Submit for senior approval/i }));

    const error = screen.getByTestId("care-plan-banned-wording-error");
    expect(error).toHaveTextContent(banned);
    expect(error).toHaveTextContent(/does not set a ceiling on the care offered on the day/i);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // A Draft never hides or replaces the Current Plan, at any point in the edit.
  it("leaves the Current Plan in use while a replacement is being written", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanEdit("SYN-PATIENT-001"));
    await signInAs(user, LIAISON);
    await user.click(screen.getByRole("button", { name: /Start a replacement version/i }));
    await user.type(screen.getByRole("textbox", { name: /Reason for this version/i }), " Extended after the review.");
    await user.click(screen.getByRole("button", { name: /Save Draft/i }));

    expect(screen.getByTestId("care-plan-form-outcome")).toHaveTextContent(/Draft version 3 saved/i);
    expect(screen.getByTestId("care-plan-form-current-plan-notice")).toHaveTextContent(
      /Current version 2 stays in use/i,
    );
  });

  it("saves a draft and says plainly that it is not approved for use", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanEdit("SYN-PATIENT-005"));
    await signInAs(user, LIAISON);

    const field = screen.getByRole("textbox", { name: /What helps/i });
    await user.type(field, "\nA charged phone, and a stated time for the next update.");
    await user.click(screen.getByRole("button", { name: /Save Draft/i }));

    expect(screen.getByTestId("care-plan-form-outcome")).toHaveTextContent(/Draft version 1 saved/i);
    expect(screen.getByTestId("care-plan-form-outcome")).toHaveTextContent(/not approved for use/i);
  });

  it("submits a draft through a confirmation and navigates to the review route", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(carePlanRoute.managementPlanEdit("SYN-PATIENT-005"));
    await signInAs(user, LIAISON);
    await user.click(screen.getByRole("button", { name: /Submit for senior approval/i }));

    const dialog = screen.getByRole("dialog", { name: /Submit version 1 for senior approval/i });
    expect(dialog).toHaveTextContent(/A senior clinician decides whether it becomes the Current Plan/i);
    await user.click(within(dialog).getByRole("button", { name: /Submit for approval/i }));

    expect(navigate).toHaveBeenCalledWith(carePlanRoute.managementPlanReview("SYN-PATIENT-005"));
  });

  /**
   * Asserting on the mocked `navigate` proves the address and nothing about what
   * is at it. Alex has no Current Plan, and the first shape of this route
   * compared the proposed content against itself: every one of the eleven
   * sections read `Unchanged`, against `Comparing Current version 0`. A senior
   * clinician deciding on a patient's *first* plan was told nothing had changed.
   * So this follows the navigation and renders the destination.
   */
  it("shows a first version as a first version, not as a comparison against nothing", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const surface = (pathname: string) => (
      <CarePlanPrototypeProvider>
        <CarePlanRouteSurface pathname={pathname} query="" navigate={navigate} />
      </CarePlanPrototypeProvider>
    );
    const { rerender } = render(surface(carePlanRoute.managementPlanEdit("SYN-PATIENT-005")));
    await signInAs(user, LIAISON);
    await user.click(screen.getByRole("button", { name: /Submit for senior approval/i }));
    await user.click(
      within(screen.getByRole("dialog", { name: /Submit version 1 for senior approval/i })).getByRole("button", {
        name: /Submit for approval/i,
      }),
    );

    rerender(surface(carePlanRoute.managementPlanReview("SYN-PATIENT-005")));

    const first = screen.getByTestId("care-plan-review-first-version");
    expect(first).toHaveTextContent(/This is the first version of Alex's Management Plan/i);
    expect(first).toHaveTextContent(/no earlier version to compare it against/i);
    // The whole of what is proposed is readable, since there is nothing to diff.
    expect(first).toHaveTextContent(/Alex asked not to take part in writing this plan/i);

    // Never a comparison table, and never a version number that does not exist.
    expect(screen.queryByTestId("care-plan-diff")).toBeNull();
    expect(screen.queryByText(/Unchanged in both versions/i)).toBeNull();
    expect(screen.queryByText(/version 0/i)).toBeNull();
    // The decision itself is still offered.
    expect(screen.getByRole("button", { name: "Approve version 1" })).toBeInTheDocument();
  });

  it("states why nothing can be saved while the device is offline", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanEdit("SYN-PATIENT-005"), "scenario=offline");
    await signInAs(user, LIAISON);

    const save = screen.getByRole("button", { name: /Save Draft/i });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).not.toHaveAttribute("disabled");
    expect(screen.getByTestId("care-plan-form-blocked")).toHaveTextContent(/offline, so nothing was changed/i);

    await user.click(save);
    expect(screen.queryByTestId("care-plan-form-outcome")).toBeNull();
  });
});

describe("Care Plan Management Plan comparison", () => {
  it("labels a section that gains content Added and one that loses it Removed", () => {
    const base = syntheticManagementPlanVersions[0]?.content;
    expect(base, "the fixtures must carry at least one version").toBeDefined();
    if (!base) return;

    const changes = diffManagementPlanContent(
      { ...base, practicalNeeds: [], whatHelps: ["A quiet space."] },
      { ...base, practicalNeeds: ["Large-print information."], whatHelps: [] },
    );
    const byKey = new Map(changes.map((change) => [change.key, change.status]));
    expect(byKey.get("practicalNeeds")).toBe("Added");
    expect(byKey.get("whatHelps")).toBe("Removed");
    expect(byKey.get("whyThisPlanExists")).toBe("Unchanged");
  });

  it("covers every content field exactly once, in the reading order", () => {
    const base = syntheticManagementPlanVersions[0]?.content;
    if (!base) throw new Error("the fixtures must carry at least one version");
    const keys = diffManagementPlanContent(base, base).map((change) => change.key);
    expect(keys).toEqual([...FIRST_MINUTE_CONTENT_KEYS, "whyThisPlanExists", ...FULL_PLAN_SECTION_KEYS]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("compares the submitted version against the Current one with semantic labels", () => {
    renderRoute(carePlanRoute.managementPlanReview("SYN-PATIENT-002"), "scenario=overdue-plan");
    const diff = screen.getByTestId("care-plan-diff");
    expect(diff).toHaveTextContent(/Comparing Current version 1 with proposed version 2/i);

    // Mira's version 2 fills two sections her Current version left empty, and
    // leaves the fifth first-minute section word for word as it was.
    expect(within(diff).getByTestId("care-plan-diff-practicalNeeds")).toHaveTextContent("Added");
    expect(within(diff).getByTestId("care-plan-diff-whatWouldMakeThisDifferent")).toHaveTextContent("Unchanged");
    expect(within(diff).getByTestId("care-plan-diff-agreedEdApproach")).toHaveTextContent("Changed");
  });

  it("offers no way to edit the version while it is awaiting approval", () => {
    renderRoute(carePlanRoute.managementPlanReview("SYN-PATIENT-002"), "scenario=overdue-plan");
    expect(within(screen.getByTestId("care-plan-review-proposed")).queryAllByRole("textbox")).toEqual([]);
    expect(within(screen.getByTestId("care-plan-diff")).queryAllByRole("textbox")).toEqual([]);
  });

  it("names the author, owner, proposed approver, reason and participation state", () => {
    renderRoute(carePlanRoute.managementPlanReview("SYN-PATIENT-002"), "scenario=overdue-plan");
    const proposed = screen.getByTestId("care-plan-review-proposed");
    expect(proposed).toHaveTextContent("Morgan Sample");
    expect(proposed).toHaveTextContent(/Any named senior clinician/i);
    expect(proposed).toHaveTextContent(/the medical-first order needs stating more plainly/i);
    expect(proposed).toHaveTextContent("Written without this person's involvement");
  });

  // The Current Plan is never displaced by a version awaiting a decision.
  it("keeps the Current Plan visible and unchanged while a version awaits approval", () => {
    renderRoute(carePlanRoute.managementPlanReview("SYN-PATIENT-002"), "scenario=overdue-plan");
    const card = screen.getByRole("region", { name: "Current Plan" });
    expect(within(card).getByText("Current version 1")).toBeInTheDocument();
    expect(
      card.compareDocumentPosition(screen.getByTestId("care-plan-diff")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("Care Plan Management Plan approval", () => {
  /**
   * The brief's worked example, corrected against the fixtures: `SYN-MGMT-VERSION-004`
   * on `SYN-MGMT-PLAN-002` is version 2 awaiting approval, and the version it
   * would replace is version 1 — not 3 and 2. The route, the role selection, and
   * the approver's name all hold as written.
   */
  it("requires named senior approval before an awaiting version becomes Current", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanReview("SYN-PATIENT-002"), "scenario=overdue-plan");
    await user.selectOptions(screen.getByRole("combobox", { name: "Prototype role" }), "SYN-USER-SENIOR-001");
    await user.click(screen.getByRole("button", { name: "Approve version 2" }));
    const dialog = screen.getByRole("dialog", { name: "Approve Management Plan version 2" });
    await user.click(within(dialog).getByRole("button", { name: "Approve and make Current" }));

    expect(screen.getByRole("heading", { level: 2, name: "Current Plan" })).toBeInTheDocument();
    expect(screen.getByText(/Current version 2/i)).toBeInTheDocument();
    expect(screen.getByText(/Approved by Dr Taylor Fiction/i)).toBeInTheDocument();
  });

  it("leaves exactly one Current version and supersedes the one it replaced", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanReview("SYN-PATIENT-002"), "scenario=overdue-plan");
    await signInAs(user, SENIOR);
    await user.click(screen.getByRole("button", { name: "Approve version 2" }));
    await user.click(
      within(screen.getByRole("dialog", { name: /Approve Management Plan version 2/i })).getByRole("button", {
        name: "Approve and make Current",
      }),
    );

    expect(screen.getAllByText(/^Current version \d+$/)).toHaveLength(1);
    expect(screen.getByText("Current version 2")).toBeInTheDocument();
    expect(screen.queryByText("Current version 1")).toBeNull();
    expect(screen.getByTestId("care-plan-review-none-awaiting")).toHaveTextContent(/No version is awaiting approval/i);
  });

  /**
   * A version may be approved at any participation state — a person's absence
   * must never block their plan being written — but the consequence is stated
   * before the decision, and it lands in a queue somebody owns rather than only
   * as a marker whoever opens the plan might read.
   */
  it("states the involvement consequence in the dialog and raises the Review Trigger", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanReview("SYN-PATIENT-002"), "scenario=overdue-plan");
    await signInAs(user, SENIOR);
    await user.click(screen.getByRole("button", { name: "Approve version 2" }));

    const dialog = screen.getByRole("dialog", { name: /Approve Management Plan version 2/i });
    expect(dialog).toHaveTextContent(/No involvement has been recorded for Mira/i);
    expect(dialog).toHaveTextContent(/permanent marker saying it was written without this person's involvement/i);
    expect(dialog).toHaveTextContent(/raise an open Review Trigger/i);

    await user.click(within(dialog).getByRole("button", { name: "Approve and make Current" }));
    expect(screen.getByTestId("care-plan-review-outcome")).toHaveTextContent(/open Review Trigger was raised/i);
    expect(
      within(screen.getByRole("region", { name: "Current Plan" })).getByText(
        "Written without this person's involvement",
      ),
    ).toBeInTheDocument();
  });

  it("states why a clinician who is not the named senior cannot approve", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanReview("SYN-PATIENT-002"), "scenario=overdue-plan");
    await signInAs(user, LIAISON);

    const approve = screen.getByRole("button", { name: "Approve version 2" });
    expect(approve).toHaveAttribute("aria-disabled", "true");
    expect(approve).not.toHaveAttribute("disabled");
    expect(screen.getByTestId("care-plan-review-blocked")).toHaveTextContent(/Morgan Sample/);
    expect(screen.getByTestId("care-plan-review-blocked")).toHaveTextContent(/does not carry this action/i);

    await user.click(approve);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("care-plan-review-proposed")).toHaveTextContent(/Awaiting Approval version 2/i);
  });

  it("states why a version conflict blocks the decision", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanReview("SYN-PATIENT-002"), "scenario=version-conflict");
    await signInAs(user, SENIOR);

    const approve = screen.getByRole("button", { name: "Approve version 2" });
    expect(approve).toHaveAttribute("aria-disabled", "true");
    expect(approve).not.toHaveAttribute("disabled");
    expect(screen.getByTestId("care-plan-review-blocked")).toHaveTextContent(/A newer version of this record exists/i);

    // Activation does nothing, as with the offline and non-senior refusals: the
    // attribute alone is a claim about the control, not about what it does.
    await user.click(approve);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("care-plan-review-proposed")).toHaveTextContent(/Awaiting Approval version 2/i);
    expect(
      within(screen.getByRole("region", { name: "Current Plan" })).getByText("Current version 1"),
    ).toBeInTheDocument();
  });

  it("returns a version for changes with a required reason and sends the author to the draft", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(carePlanRoute.managementPlanReview("SYN-PATIENT-002"), "scenario=overdue-plan");
    await signInAs(user, SENIOR);
    await user.click(screen.getByRole("button", { name: /Return for changes/i }));

    const sheet = screen.getByRole("dialog", { name: /Return version 2 for changes/i });
    // The reason is what the author is given to work from, so it is required.
    await user.click(within(sheet).getByRole("button", { name: /Return for changes/i }));
    expect(within(sheet).getByTestId("field-error")).toHaveTextContent(/needs a reason/i);
    expect(navigate).not.toHaveBeenCalled();

    await user.type(
      within(sheet).getByRole("textbox", { name: /What needs to change/i }),
      "Please name who agreed the order of assessment and on what date.",
    );
    await user.click(within(sheet).getByRole("button", { name: /Return for changes/i }));

    expect(navigate).toHaveBeenCalledWith(carePlanRoute.managementPlanEdit("SYN-PATIENT-002"));
    expect(screen.getByTestId("care-plan-review-outcome")).toHaveTextContent(/returned to Draft for changes/i);
    expect(screen.getByTestId("care-plan-review-outcome")).toHaveTextContent(/Current Plan is unchanged/i);
  });

  it("announces every outcome through a live region rather than a silent update", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.managementPlanReview("SYN-PATIENT-002"), "scenario=overdue-plan");
    await signInAs(user, SENIOR);
    await user.click(screen.getByRole("button", { name: "Approve version 2" }));
    await user.click(
      within(screen.getByRole("dialog", { name: /Approve Management Plan version 2/i })).getByRole("button", {
        name: "Approve and make Current",
      }),
    );

    const outcome = screen.getByTestId("care-plan-review-outcome");
    expect(within(outcome).getByRole("status")).toHaveTextContent(/now the Current Plan/i);
  });

  it("says plainly when nothing is awaiting a decision", () => {
    renderRoute(carePlanRoute.managementPlanReview("SYN-PATIENT-001"));
    expect(screen.getByTestId("care-plan-review-none-awaiting")).toHaveTextContent(/No version is awaiting approval/i);
    expect(screen.queryByTestId("care-plan-diff")).toBeNull();
    expect(screen.getByRole("region", { name: "Current Plan" })).toBeInTheDocument();
  });
});

/**
 * Until this task the scenario named in a URL reached the `data-care-plan-scenario`
 * attribute and the surfaces' `scenario` prop, and stopped there. The reducer's
 * own flags — `connectivity`, `permission`, `identity`, `versionConflict` — were
 * never set by an address, so every branch of `getPrototypeMutationBlockReason`
 * was dead in the running application across Tasks 4, 5 and 6.
 *
 * These render the provider with no seed, so only the sync under test can put the
 * reducer into a specimen state.
 */
describe("Care Plan specimen scenarios reach the reducer", () => {
  function surface(pathname: string, query: string, navigate = vi.fn()) {
    return (
      <CarePlanPrototypeProvider>
        <CarePlanRouteSurface pathname={pathname} query={query} navigate={navigate} />
      </CarePlanPrototypeProvider>
    );
  }

  it("applies a scenario named in the URL to the reducer, not only to the rendering", async () => {
    const user = userEvent.setup();
    render(surface(carePlanRoute.managementPlanEdit("SYN-PATIENT-005"), "scenario=offline"));
    await signInAs(user, LIAISON);

    expect(screen.getByRole("button", { name: /Save Draft/i })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("care-plan-form-blocked")).toHaveTextContent(/offline, so nothing was changed/i);
  });

  it("returns to the ordinary world when the reader leaves a scenario address", async () => {
    const user = userEvent.setup();
    const { rerender } = render(surface(carePlanRoute.managementPlanEdit("SYN-PATIENT-005"), "scenario=offline"));
    await signInAs(user, LIAISON);
    expect(screen.getByTestId("care-plan-form-blocked")).toBeInTheDocument();

    rerender(surface(carePlanRoute.managementPlanEdit("SYN-PATIENT-005"), ""));
    expect(screen.queryByTestId("care-plan-form-blocked")).toBeNull();
  });

  /**
   * `apply-scenario` reconstructs the fixtures, so dispatching it on an ordinary
   * navigation would throw away work that only exists in memory. An earlier
   * ruling on this project removed an online/offline listener for exactly that
   * reason. This is the harm, stated as a test: a clinician half-way through
   * drafting a version must not lose it by following a link.
   *
   * The second navigation is the one that matters. A link that only changes the
   * path leaves the effect's dependencies untouched, so it never re-runs and the
   * test would pass whatever the guard did — a control proved exactly that. A
   * link that keeps the scenario but changes another query parameter, which
   * `carePlanRoute.withQuery` exists to build, does re-run it. That is where the
   * guard earns its place.
   */
  it("does not reconstruct the world when navigating inside one scenario", async () => {
    const user = userEvent.setup();
    const edit = carePlanRoute.managementPlanEdit("SYN-PATIENT-005");
    const { rerender } = render(surface(edit, "scenario=overdue-plan"));
    await signInAs(user, LIAISON);

    const typed = "A seat away from the corridor, and a stated time for the next update.";
    await user.type(screen.getByRole("textbox", { name: /What helps/i }), `\n${typed}`);
    await user.click(screen.getByRole("button", { name: /Save Draft/i }));
    expect(screen.getByTestId("care-plan-form-outcome")).toHaveTextContent(/Draft version 1 saved/i);

    // An ordinary link, inside the same scenario, and back again.
    rerender(surface(carePlanRoute.managementPlan("SYN-PATIENT-005"), "scenario=overdue-plan"));
    rerender(surface(edit, "scenario=overdue-plan"));

    // …and a link that keeps the scenario while changing the query around it.
    rerender(surface(edit, "scenario=overdue-plan&view=awaiting"));
    rerender(surface(edit, "scenario=overdue-plan"));

    const helps = screen.getByRole("textbox", { name: /What helps/i }) as HTMLTextAreaElement;
    expect(helps.value, "the draft must survive an ordinary navigation").toContain(typed);
    // …and so must who is signed in, which a reconstruction would also reset.
    expect(within(screen.getByTestId("care-plan-active-user")).getByText("Morgan Sample")).toBeInTheDocument();
  });
});

/**
 * Task 7 — the ED Presentation surfaces.
 *
 * `ROWAN` carries eight episodes, two amendable ones and both an open and a
 * resolved Review Trigger, so it is the patient every ordinary assertion uses.
 * The patients with an awaiting-approval version, a draft-only plan, a withdrawn
 * plan and no plan at all are each used exactly where their state is the point.
 */
const COORDINATOR = "SYN-USER-COORD-001";
const ROWAN_PATIENT = "SYN-PATIENT-001";
const MIRA_PATIENT = "SYN-PATIENT-002";
const EVIE_PATIENT = "SYN-PATIENT-004";
const ALEX_PATIENT = "SYN-PATIENT-005";

type PresentationAnswers = {
  site: string;
  disposition: string;
  availability: string;
  use: string;
  helpfulness: string;
  note: string;
};

/**
 * The six required answers, filled the way a clinician would. The worked example
 * in the task brief fills only three of them; the six are what the specification
 * actually requires, so a helper that filled fewer would make every success test
 * below assert against a form that could not have saved.
 */
async function recordRequiredAnswers(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<PresentationAnswers> = {},
) {
  const answers: PresentationAnswers = {
    site: "SYN-ED-001",
    disposition: "discharged_home",
    availability: "available",
    use: "used",
    helpfulness: "helpful",
    note: "Came in late after a difficult evening and went home the same night.",
    ...overrides,
  };
  await user.selectOptions(screen.getByLabelText(/^Emergency department/), answers.site);
  await user.selectOptions(screen.getByLabelText(/^Disposition/), answers.disposition);
  await user.selectOptions(screen.getByLabelText(/^Was the Current Plan available\?/), answers.availability);
  await user.selectOptions(screen.getByLabelText(/^Was the Current Plan used\?/), answers.use);
  await user.selectOptions(screen.getByLabelText(/^Was the plan helpful\?/), answers.helpfulness);
  await user.clear(screen.getByLabelText(/^In one line: why they came and what happened/));
  await user.type(screen.getByLabelText(/^In one line: why they came and what happened/), answers.note);
}

async function submitPresentation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Record ED presentation" }));
}

describe("Care Plan ED Presentation timeline", () => {
  it("lists every episode for this patient newest first, as a semantic list with the recorded facts", () => {
    renderRoute(carePlanRoute.presentations(ROWAN_PATIENT));
    const entries = within(screen.getByTestId("care-plan-presentation-timeline")).getAllByRole("listitem");
    expect(entries).toHaveLength(8);

    const newest = entries[0]!;
    expect(within(newest).getByText("North River Hospital ED")).toBeInTheDocument();
    expect(within(newest).getByText(/Mental health admission/)).toBeInTheDocument();
    expect(within(newest).getByText(/Came in by taxi late evening/)).toBeInTheDocument();
    expect(within(newest).getByText(/Current version 2/)).toBeInTheDocument();
    expect(within(newest).getByText(/Out of hours; message left on the shared mailbox/)).toBeInTheDocument();
    expect(within(newest).getByText(/First admission since the plan was agreed/)).toBeInTheDocument();

    // Newest first, proved by the arrival dates rather than by the order of the
    // fixture array, which a later edit could reorder without anything failing.
    const arrivals = entries.map((entry) => within(entry).getByTestId("care-plan-presentation-arrival").textContent);
    const parsed = arrivals.map((text) => {
      const [day, month, year] = String(text).slice(0, 10).split("/");
      return Date.parse(`${year}-${month}-${day}`);
    });
    expect(parsed).toEqual([...parsed].sort((left, right) => right - left));
  });

  it("states the observation window and the objective counts without a label, verdict or ranking", () => {
    renderRoute(carePlanRoute.presentations(ROWAN_PATIENT));
    const activity = screen.getByTestId("care-plan-presentation-activity");
    expect(activity).toHaveTextContent(/7 ED Presentations recorded in the 12 months to 20\/08\/2026/i);
    expect(activity).toHaveTextContent(/North River Hospital ED: 5/);
    expect(activity).toHaveTextContent(/Coastal Plains Hospital ED: 2/);
    expect(activity).toHaveTextContent(/Counts describe what happened. They decide nothing/i);

    // Sorting people by how often they attend belongs to the Identification
    // Review workflow and nowhere else.
    expect(screen.queryByRole("combobox", { name: /sort/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /sort/i })).toBeNull();
  });

  it("filters the timeline by emergency department without changing the counts", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.presentations(ROWAN_PATIENT));
    await user.selectOptions(screen.getByLabelText(/^Emergency department/), "SYN-ED-002");

    const entries = within(screen.getByTestId("care-plan-presentation-timeline")).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    for (const entry of entries) expect(within(entry).getByText("Coastal Plains Hospital ED")).toBeInTheDocument();
    expect(screen.getByTestId("care-plan-presentation-activity")).toHaveTextContent(/7 ED Presentations recorded/);
  });

  it("filters the timeline by disposition and says plainly when nothing matches", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.presentations(ROWAN_PATIENT));
    await user.selectOptions(screen.getByLabelText(/^Disposition/), "mental_health_admission");
    expect(within(screen.getByTestId("care-plan-presentation-timeline")).getAllByRole("listitem")).toHaveLength(1);

    await user.selectOptions(screen.getByLabelText(/^Disposition/), "transfer");
    expect(screen.queryByTestId("care-plan-presentation-timeline")).toBeNull();
    expect(screen.getByTestId("care-plan-presentation-none-matching")).toHaveTextContent(
      /No recorded ED Presentation matches those filters/i,
    );
  });

  it("shows how many corrections an episode carries and links each episode to its own address", () => {
    renderRoute(carePlanRoute.presentations(ROWAN_PATIENT));
    const entries = within(screen.getByTestId("care-plan-presentation-timeline")).getAllByRole("listitem");

    const amended = entries.find((entry) => entry.textContent?.includes("Presented while staying with family"))!;
    expect(within(amended).getByText(/1 correction recorded/i)).toBeInTheDocument();
    // A bare count says an answer moved but not which one, which leaves a reader
    // unable to tell a corrected entry from an uncorrected one without opening it.
    expect(within(amended).getByText(/1 correction recorded — Was the plan helpful\?/i)).toBeInTheDocument();

    const unamended = entries.find((entry) => entry.textContent?.includes("Came in by taxi late evening"))!;
    expect(within(unamended).getByText(/No corrections recorded/i)).toBeInTheDocument();

    expect(within(entries[0]!).getByRole("link", { name: /Open this ED Presentation/i })).toHaveAttribute(
      "href",
      carePlanRoute.presentation(ROWAN_PATIENT, "SYN-PRESENTATION-001"),
    );
    expect(screen.getByRole("link", { name: "Record ED presentation" })).toHaveAttribute(
      "href",
      carePlanRoute.newPresentation(ROWAN_PATIENT),
    );
  });

  /**
   * The episode is append-only, so the record still holds the answer first
   * given and the correction sits beside it. The episode page shows both. A
   * timeline entry has no room for that, and showing only the pre-correction
   * value with a bare count beside it is the one arrangement that actively
   * misleads — it reads as current and is not. So the timeline shows what the
   * record says today.
   */
  it("shows the corrected answer on a timeline entry, not the value it replaced", () => {
    renderRoute(carePlanRoute.presentations(ROWAN_PATIENT));
    const entries = within(screen.getByTestId("care-plan-presentation-timeline")).getAllByRole("listitem");
    const amended = entries.find((entry) => entry.textContent?.includes("Presented while staying with family"))!;

    // SYN-PRESENTATION-003 was recorded `helpful` and corrected to `mixed`.
    expect(within(amended).getByText(/Available · Partly used · Helped in part/)).toBeInTheDocument();
    expect(within(amended).queryByText(/Available · Partly used · Helpful/)).toBeNull();

    // …and an uncorrected entry still shows exactly what was recorded.
    const untouched = entries.find((entry) => entry.textContent?.includes("Came in by taxi late evening"))!;
    expect(within(untouched).getByText(/Available · Used · Helpful/)).toBeInTheDocument();
  });
});

describe("Care Plan ED Presentation recording", () => {
  it("refuses to record until every required answer is given, and names each one", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(carePlanRoute.newPresentation(ROWAN_PATIENT));
    await user.clear(screen.getByLabelText(/^In one line: why they came and what happened/));
    await submitPresentation(user);

    const summary = screen.getByTestId("error-summary");
    for (const label of [
      "Emergency department",
      "Disposition",
      "Was the Current Plan available?",
      "Was the Current Plan used?",
      "Was the plan helpful?",
      "In one line: why they came and what happened",
    ]) {
      expect(within(summary).getByText(new RegExp(label.replace(/[?]/g, "\\?")))).toBeInTheDocument();
    }
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("care-plan-presentation-recorded")).toBeNull();
  });

  it("keeps the optional detail behind one disclosure that is closed on open and never blocks the save", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(carePlanRoute.newPresentation(ROWAN_PATIENT));
    const disclosure = screen.getByRole("button", { name: /Add more detail/i });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");

    await recordRequiredAnswers(user);
    await submitPresentation(user);

    expect(screen.getByTestId("care-plan-presentation-recorded")).toBeInTheDocument();
    expect(navigate).toHaveBeenCalledTimes(1);

    // Nothing optional was filled in, so the episode carries none of it — and it
    // reads as not recorded rather than as an invented value.
    expect(screen.getByTestId("care-plan-presentation-recorded")).toHaveTextContent(
      /Presenting indication\s*Not recorded/,
    );
  });

  it("opens the optional detail on request", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.newPresentation(ROWAN_PATIENT));
    await user.click(screen.getByRole("button", { name: /Add more detail/i }));
    expect(screen.getByRole("button", { name: /Add more detail/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("links the Current version at form open and never a version still being written", () => {
    renderRoute(carePlanRoute.newPresentation(MIRA_PATIENT));
    // Mira has Current version 1 and version 2 awaiting a senior decision.
    const linked = screen.getByTestId("care-plan-presentation-linked-plan");
    expect(linked).toHaveTextContent(/Current version 1/);
    expect(linked).not.toHaveTextContent(/version 2/);
  });

  it("says no Current Plan was available and records no plan version when only a draft exists", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.newPresentation(ALEX_PATIENT));
    expect(screen.getByTestId("care-plan-presentation-linked-plan")).toHaveTextContent(
      /No Current Plan was available/i,
    );

    await recordRequiredAnswers(user, {
      availability: "unavailable",
      use: "not_applicable",
      helpfulness: "not_assessed",
    });
    await submitPresentation(user);
    expect(screen.getByTestId("care-plan-presentation-recorded")).toHaveTextContent(/No Current Plan was available/i);
  });

  it("records plan-use feedback and creates a Review Suggested item without changing the plan", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.newPresentation(ROWAN_PATIENT));
    await recordRequiredAnswers(user, { use: "partially_used", helpfulness: "mixed" });
    await user.type(screen.getByLabelText(/^Why is review suggested\?/), "The sensory guidance needs clarification.");
    await submitPresentation(user);

    expect(screen.getByRole("status")).toHaveTextContent(/ED Presentation recorded in this synthetic session/i);
    expect(screen.getByText(/Review Suggested/i)).toBeInTheDocument();
    expect(screen.getByText(/Current version 2/i)).toBeInTheDocument();
    expect(screen.getByTestId("care-plan-presentation-recorded")).toHaveTextContent(
      /The Management Plan itself is unchanged/i,
    );
    // The sentence the clinician wrote is what reaches the queue. A reason typed
    // without also ticking the box is still a suggestion to review, and dropping
    // it would replace a specific request with a generic one.
    expect(screen.getByTestId("care-plan-presentation-trigger")).toHaveTextContent(
      /The sensory guidance needs clarification/,
    );
  });

  it("offers no recording form at all to a role that does not carry the action", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.newPresentation(ROWAN_PATIENT));
    await signInAs(user, COORDINATOR);

    expect(screen.getByTestId("care-plan-presentation-unavailable")).toHaveTextContent(
      /care planning coordinator role, which does not carry this action/i,
    );
    expect(screen.queryByRole("button", { name: "Record ED presentation" })).toBeNull();
  });

  it("raises no review request when the plan was available, used, and helped", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.newPresentation(ROWAN_PATIENT));
    await recordRequiredAnswers(user);
    await submitPresentation(user);

    expect(screen.getByTestId("care-plan-presentation-recorded")).toBeInTheDocument();
    expect(screen.queryByTestId("care-plan-presentation-trigger")).toBeNull();
  });

  it("raises a review request when an episode ends in an admission", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.newPresentation(EVIE_PATIENT));
    await recordRequiredAnswers(user, { disposition: "mental_health_admission" });
    await submitPresentation(user);

    expect(screen.getByTestId("care-plan-presentation-trigger")).toHaveTextContent(
      /This episode ended in an admission/i,
    );
  });

  it("requires a reason when a plan review is suggested", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.newPresentation(ROWAN_PATIENT));
    await recordRequiredAnswers(user);
    await user.click(screen.getByRole("checkbox", { name: /Suggest a plan review/i }));
    await submitPresentation(user);

    expect(within(screen.getByTestId("error-summary")).getByText(/Why is review suggested\?/)).toBeInTheDocument();
    expect(screen.queryByTestId("care-plan-presentation-recorded")).toBeNull();
  });

  it("requires a reason when the agreed approach could not be followed", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.newPresentation(ROWAN_PATIENT));
    await recordRequiredAnswers(user);
    await user.click(screen.getByRole("button", { name: /Add more detail/i }));
    await user.click(screen.getByRole("checkbox", { name: /The agreed approach could not be followed/i }));
    await submitPresentation(user);

    expect(
      within(screen.getByTestId("error-summary")).getByText(/Why was the agreed approach not followed\?/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("care-plan-presentation-recorded")).toBeNull();
  });

  it("raises a review request when a deviation is recorded with its reason", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.newPresentation(EVIE_PATIENT));
    await recordRequiredAnswers(user);
    await user.click(screen.getByRole("button", { name: /Add more detail/i }));
    await user.click(screen.getByRole("checkbox", { name: /The agreed approach could not be followed/i }));
    await user.type(
      screen.getByLabelText(/^Why was the agreed approach not followed\?/),
      "No side room was free, so the low-stimulus space could not be offered.",
    );
    await submitPresentation(user);

    expect(screen.getByTestId("care-plan-presentation-trigger")).toHaveTextContent(/No side room was free/);
  });

  it("does not raise a second review request for a reason already open on this plan", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const surface = (pathname: string) => (
      <CarePlanPrototypeProvider>
        <CarePlanRouteSurface pathname={pathname} query="" navigate={navigate} />
      </CarePlanPrototypeProvider>
    );
    const { rerender } = render(surface(carePlanRoute.newPresentation(EVIE_PATIENT)));

    await recordRequiredAnswers(user, { disposition: "mental_health_admission" });
    await submitPresentation(user);
    expect(screen.getByTestId("care-plan-presentation-trigger")).toBeInTheDocument();

    // Leave the form and come back, exactly as the address change would.
    rerender(surface(carePlanRoute.presentations(EVIE_PATIENT)));
    rerender(surface(carePlanRoute.newPresentation(EVIE_PATIENT)));

    await recordRequiredAnswers(user, { disposition: "mental_health_admission" });
    await submitPresentation(user);
    expect(screen.getByTestId("care-plan-presentation-recorded")).toBeInTheDocument();
    expect(screen.queryByTestId("care-plan-presentation-trigger")).toBeNull();
  });

  it("navigates to the episode the reducer actually appended", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(carePlanRoute.newPresentation(ROWAN_PATIENT));
    await recordRequiredAnswers(user);
    await submitPresentation(user);
    expect(navigate).toHaveBeenCalledWith(carePlanRoute.presentation(ROWAN_PATIENT, "SYN-PRESENTATION-021"));
  });

  it("refuses to record while the prototype is offline, and says so", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.newPresentation(ROWAN_PATIENT), "scenario=offline");
    expect(screen.getByRole("button", { name: "Record ED presentation" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("care-plan-presentation-blocked")).toHaveTextContent(/offline, so nothing was changed/i);

    await recordRequiredAnswers(user);
    await submitPresentation(user);
    expect(screen.queryByTestId("care-plan-presentation-recorded")).toBeNull();
  });

  it("writes nothing against a record that is not confirmed as the right person", () => {
    renderRoute(carePlanRoute.newPresentation(ROWAN_PATIENT), "scenario=identity-uncertain");
    expect(screen.getByTestId("care-plan-identity-uncertain")).toHaveTextContent(
      /has not been confirmed as the right person/i,
    );
    expect(screen.queryByRole("button", { name: "Record ED presentation" })).toBeNull();
  });
});

describe("Care Plan ED Presentation detail and corrections", () => {
  const AMENDED = carePlanRoute.presentation(ROWAN_PATIENT, "SYN-PRESENTATION-003");
  const NEWEST = carePlanRoute.presentation(ROWAN_PATIENT, "SYN-PRESENTATION-001");

  it("shows the immutable episode, who recorded it and when, and the linked plan version", () => {
    renderRoute(NEWEST);
    const episode = screen.getByTestId("care-plan-presentation-episode");
    expect(episode).toHaveTextContent(/North River Hospital ED/);
    expect(episode).toHaveTextContent(/Mental health admission/);
    expect(episode).toHaveTextContent(/Came in by taxi late evening/);
    expect(episode).toHaveTextContent(/Current version 2/);
    expect(screen.getByTestId("care-plan-presentation-attribution")).toHaveTextContent(/Dr Casey Example/);
    expect(screen.getByTestId("care-plan-presentation-trigger")).toHaveTextContent(
      /First mental-health admission since this version was agreed/i,
    );
  });

  it("renders optional detail nobody filled in as Not recorded rather than dropping it", () => {
    renderRoute(carePlanRoute.presentation(ALEX_PATIENT, "SYN-PRESENTATION-018"));
    const episode = screen.getByTestId("care-plan-presentation-episode");
    expect(episode).toHaveTextContent(/Presenting indication\s*Not recorded/);
    expect(episode).toHaveTextContent(/Assessment outcome\s*Not recorded/);
  });

  it("shows an existing correction beside the value first recorded, never in place of it", () => {
    renderRoute(AMENDED);
    const episode = screen.getByTestId("care-plan-presentation-episode");
    expect(episode).toHaveTextContent(/Recorded as Helpful/);
    expect(episode).toHaveTextContent(/Corrected to Helped in part/);
    expect(screen.getByTestId("care-plan-presentation-amendments")).toHaveTextContent(
      /Recorded as helpful at the end of the shift/,
    );
  });

  it("appends a correction with its author, time and reason, keeping the original on screen", async () => {
    const user = userEvent.setup();
    renderRoute(NEWEST);
    await user.click(screen.getByRole("button", { name: "Amend recorded outcome" }));

    const sheet = screen.getByRole("dialog", { name: /Correct this ED Presentation/i });
    await user.selectOptions(within(sheet).getByLabelText(/^Disposition/), "short_stay");
    await user.type(
      within(sheet).getByLabelText(/^Why is this being corrected\?/),
      "Recorded as an admission at handover; it was a short stay in the observation unit.",
    );
    await user.click(within(sheet).getByRole("button", { name: "Record correction" }));

    const episode = screen.getByTestId("care-plan-presentation-episode");
    expect(episode).toHaveTextContent(/Recorded as Mental health admission/);
    expect(episode).toHaveTextContent(/Corrected to Short stay/);

    const amendments = screen.getByTestId("care-plan-presentation-amendments");
    expect(amendments).toHaveTextContent(/Dr Casey Example/);
    expect(amendments).toHaveTextContent(/it was a short stay in the observation unit/);
  });

  it("appends one correction per changed plan-use answer under a single reason", async () => {
    const user = userEvent.setup();
    renderRoute(NEWEST);
    await user.click(screen.getByRole("button", { name: "Amend recorded outcome" }));

    const sheet = screen.getByRole("dialog", { name: /Correct this ED Presentation/i });
    await user.selectOptions(within(sheet).getByLabelText(/^Was the Current Plan used\?/), "partially_used");
    await user.selectOptions(within(sheet).getByLabelText(/^Was the plan helpful\?/), "mixed");
    await user.type(
      within(sheet).getByLabelText(/^Why is this being corrected\?/),
      "On reflection only part of the plan could be followed on the night.",
    );
    await user.click(within(sheet).getByRole("button", { name: "Record correction" }));

    const entries = within(screen.getByTestId("care-plan-presentation-amendments")).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry).toHaveTextContent(/On reflection only part of the plan could be followed/);
    }
  });

  it("refuses a correction with no reason, and one that changes nothing", async () => {
    const user = userEvent.setup();
    renderRoute(NEWEST);
    await user.click(screen.getByRole("button", { name: "Amend recorded outcome" }));
    const sheet = screen.getByRole("dialog", { name: /Correct this ED Presentation/i });

    await user.selectOptions(within(sheet).getByLabelText(/^Disposition/), "short_stay");
    await user.click(within(sheet).getByRole("button", { name: "Record correction" }));
    expect(within(sheet).getByTestId("care-plan-amendment-error")).toHaveTextContent(
      /needs a reason, so a later reader can see why/i,
    );
    expect(screen.queryByTestId("care-plan-presentation-amendments")).toHaveTextContent(/No corrections recorded/i);

    await user.selectOptions(within(sheet).getByLabelText(/^Disposition/), "mental_health_admission");
    await user.type(within(sheet).getByLabelText(/^Why is this being corrected\?/), "Nothing actually changed here.");
    await user.click(within(sheet).getByRole("button", { name: "Record correction" }));
    expect(within(sheet).getByTestId("care-plan-amendment-error")).toHaveTextContent(
      /Change at least one answer before recording a correction/i,
    );
  });

  /**
   * The reducer refuses a blank replacement and records that only in
   * `lastOutcome`, which the next successful correction in the same batch
   * overwrites. A sheet that dispatched per field and closed regardless would
   * therefore drop one correction, keep another, and report success — and on a
   * record whose whole purpose is that corrections stay visible and attributed,
   * a silently discarded correction is the worst available outcome.
   *
   * `note` precedes `planHelpfulness` in the field order, so this is exactly the
   * ordering that hides the loss.
   */
  it("refuses the whole correction rather than dropping a blanked answer behind a success banner", async () => {
    const user = userEvent.setup();
    renderRoute(NEWEST);
    await user.click(screen.getByRole("button", { name: "Amend recorded outcome" }));
    const sheet = screen.getByRole("dialog", { name: /Correct this ED Presentation/i });

    await user.clear(within(sheet).getByLabelText(/^In one line: why they came and what happened/));
    await user.selectOptions(within(sheet).getByLabelText(/^Was the plan helpful\?/), "mixed");
    await user.type(
      within(sheet).getByLabelText(/^Why is this being corrected\?/),
      "Tidying the record at the end of the shift.",
    );
    await user.click(within(sheet).getByRole("button", { name: "Record correction" }));

    expect(within(sheet).getByTestId("care-plan-amendment-error")).toHaveTextContent(
      /In one line: why they came and what happened cannot be corrected to nothing/i,
    );
    // The sheet stays open holding the clinician's work…
    expect(screen.getByRole("dialog", { name: /Correct this ED Presentation/i })).toBeInTheDocument();
    // …nothing was appended, not even the answer that would have been accepted…
    expect(screen.getByTestId("care-plan-presentation-amendments")).toHaveTextContent(/No corrections recorded/i);
    // …and nothing anywhere claims a correction was recorded.
    expect(screen.queryByText(/Correction recorded beside the original/i)).toBeNull();
  });

  it("refuses to show an episode recorded against another patient", () => {
    // Episode 009 is Mira's. Under Rowan's address it is an unknown record, and
    // showing the nearest match would be showing the wrong person's episode.
    renderRoute(carePlanRoute.presentation(ROWAN_PATIENT, "SYN-PRESENTATION-009"));
    expect(screen.getByTestId("care-plan-presentation-identity-uncertain")).toHaveTextContent(
      /does not belong to the patient named in this address/i,
    );
    expect(screen.queryByTestId("care-plan-presentation-episode")).toBeNull();
    expect(screen.queryByText(/Fell at home in the morning/)).toBeNull();
  });
});

// --- Stage C: the patient's own document ---------------------------------------

/**
 * Generated from the shared vocabulary rather than transcribed, for the same
 * reason the first-minute headings are: an eighth section, a reordering, or a
 * renamed key is a defect, and a hand-written list here could be "corrected" to
 * match the bug rather than catch it.
 */
const SAFETY_HEADINGS_FROM_DOMAIN = SAFETY_PLAN_SECTION_KEYS.map((key) => SAFETY_PLAN_SECTION_LABEL[key]);

const ROWAN_SAFETY_VERSION = syntheticPersonalSafetyPlanVersions[0];

/** Wording that would read a person's own decision about their own document as a
 *  failure to comply with something. None of it may appear on any of the four
 *  confirmation states, on screen or on paper. */
const NON_COMPLIANCE_WORDING =
  /non[- ]?complian|did not comply|failed to|refus(?:ed|es|al)|unco[- ]?operative|non[- ]?engage|declined to engage|missing|incomplete/i;

/**
 * Wording that denies the document it is displayed on. Every confirmation label
 * and sentence appears beside a Personal Safety Plan that exists — Evie's is
 * Current and holds the crisis numbers — so "chose not to make a safety plan"
 * contradicts the page carrying it. What a person declines is writing their own
 * part, not the existence of the sheet with the numbers on it.
 */
const DENIES_THE_DOCUMENT = /no safety plan|not to (?:make|have|write|complete|create) (?:a|any|the) safety plan/i;

describe("Care Plan Personal Safety Plan reading", () => {
  it("renders exactly the seven patient-voice sections, in the specified order", () => {
    renderRoute(carePlanRoute.safetyPlan("SYN-PATIENT-001"));
    const sections = screen.getByTestId("care-plan-safety-sections");
    expect(
      within(sections)
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(SAFETY_HEADINGS_FROM_DOMAIN);
    expect(SAFETY_HEADINGS_FROM_DOMAIN).toHaveLength(7);
    // The person's own words, rendered as written.
    expect(sections).toHaveTextContent("Two or three nights of broken sleep in a row.");
    // Personal supports are structured entries, not a line of free text.
    expect(sections).toHaveTextContent("Jess Sample");
    expect(sections).toHaveTextContent("Sister");
    expect(sections).toHaveTextContent("0491 570 131");
  });

  it("says whose document this is, and that it is neither a Management Plan nor a risk assessment", () => {
    renderRoute(carePlanRoute.safetyPlan("SYN-PATIENT-001"));
    const ownership = screen.getByTestId("care-plan-safety-ownership");
    expect(ownership).toHaveTextContent(/Rowan/);
    expect(ownership).toHaveTextContent(/own Personal Safety Plan/i);
    expect(ownership).toHaveTextContent(/not a Management Plan/i);
    expect(ownership).toHaveTextContent(/not a risk assessment/i);
    expect(ownership).toHaveTextContent(/never replaces fresh assessment/i);
  });

  it("states the version, last-confirmed date, review currency and who wrote it with them", () => {
    renderRoute(carePlanRoute.safetyPlan("SYN-PATIENT-001"));
    const metadata = screen.getByTestId("care-plan-safety-version");
    expect(metadata).toHaveTextContent("Version 1");
    expect(metadata).toHaveTextContent(formatPerthDate(ROWAN_SAFETY_VERSION.confirmedAt));
    expect(metadata).toHaveTextContent(formatPerthDate(ROWAN_SAFETY_VERSION.reviewDueAt));
    expect(metadata).toHaveTextContent("Morgan Sample");
    expect(metadata).toHaveTextContent(/Rowan chose the wording/);
  });

  it("derives review currency at render rather than reading a stored one", () => {
    // Two versions, one code path, two answers derived from their own dates.
    // Rowan's falls inside the warning window, and the plan stays fully readable
    // below the warning rather than being replaced or collapsed by it.
    renderRoute(carePlanRoute.safetyPlan("SYN-PATIENT-001"));
    expect(screen.getByTestId("care-plan-safety-version")).toHaveTextContent("Review due soon");
    expect(screen.getByTestId("care-plan-review-warning")).toHaveTextContent(/due for review on/i);
    expect(screen.getByTestId("care-plan-safety-sections")).toHaveTextContent(
      "Two or three nights of broken sleep in a row.",
    );
    cleanup();

    // Mira's is five months old against a twelve-month interval.
    renderRoute(carePlanRoute.safetyPlan("SYN-PATIENT-002"));
    expect(screen.getByTestId("care-plan-safety-version")).toHaveTextContent("Within review");
    expect(screen.queryByTestId("care-plan-review-warning")).toBeNull();
  });

  it("describes every patient-confirmation state without reading any of them as non-compliance", () => {
    for (const [state, wording] of [
      ...Object.entries(PATIENT_CONFIRMATION_LABEL),
      ...Object.entries(PATIENT_CONFIRMATION_EXPLANATION),
    ]) {
      expect(wording, `${state} is worded as non-compliance`).not.toMatch(NON_COMPLIANCE_WORDING);
      expect(wording, `${state} denies the plan it is displayed on`).not.toMatch(DENIES_THE_DOCUMENT);
    }

    renderRoute(carePlanRoute.safetyPlan("SYN-PATIENT-004"));
    const confirmation = screen.getByTestId("care-plan-safety-confirmation");
    expect(confirmation).toHaveTextContent(PATIENT_CONFIRMATION_LABEL.declined);
    expect(confirmation).toHaveTextContent(/their decision about their own document/i);
    expect(confirmation.textContent ?? "").not.toMatch(NON_COMPLIANCE_WORDING);
    // Evie's version IS a current Personal Safety Plan, holding the numbers to
    // ring, so nothing on this page may tell a reader she has none.
    expect(confirmation.textContent ?? "").not.toMatch(DENIES_THE_DOCUMENT);
    // Evie's version deliberately holds only the crisis numbers. Empty sections
    // are her decision, so they read as `Not recorded`, never as a gap she owes.
    expect(screen.getByTestId("care-plan-safety-sections")).toHaveTextContent("Not recorded");
  });

  it("shows a discussed-but-unconfirmed version as this person's plan all the same", () => {
    renderRoute(carePlanRoute.safetyPlan("SYN-PATIENT-002"));
    const confirmation = screen.getByTestId("care-plan-safety-confirmation");
    expect(confirmation).toHaveTextContent(PATIENT_CONFIRMATION_LABEL.discussed_not_confirmed);
    expect(confirmation.textContent ?? "").not.toMatch(NON_COMPLIANCE_WORDING);
    expect(screen.getByTestId("care-plan-safety-sections")).toBeInTheDocument();
  });

  it("offers no senior-approval control anywhere on the Personal Safety Plan", () => {
    for (const route of [
      carePlanRoute.safetyPlan("SYN-PATIENT-001"),
      // Jordan, not Rowan: Jordan has an open draft, so this scans the populated
      // form — every field, section frame and action — rather than the start
      // panel that a patient with no draft renders. A scan that misses the
      // surface it names is the failure this project has hit seven times.
      carePlanRoute.safetyPlanEdit("SYN-PATIENT-003"),
    ]) {
      const { unmount } = render(
        <CarePlanPrototypeProvider>
          <CarePlanRouteSurface pathname={route} query="" navigate={vi.fn()} />
        </CarePlanPrototypeProvider>,
      );
      const surface = screen.getByTestId(
        route.endsWith("/edit") ? "care-plan-safety-form-surface" : "care-plan-safety-surface",
      );
      expect(
        within(surface).queryByRole("button", { name: /approv/i }),
        `${route} offers an approval control`,
      ).toBeNull();
      expect(within(surface).queryByRole("link", { name: /approv/i })).toBeNull();
      expect(surface.textContent ?? "", `${route} mentions senior approval`).not.toMatch(
        /approval|approve|senior clinician/i,
      );
      unmount();
    }
  });

  it("says plainly when there is no current version, and keeps a draft visibly subordinate", () => {
    renderRoute(carePlanRoute.safetyPlan("SYN-PATIENT-003"));
    expect(screen.getByTestId("care-plan-safety-no-current")).toHaveTextContent(
      /Jordan has no current Personal Safety Plan/i,
    );
    const draft = screen.getByTestId("care-plan-safety-draft-notice");
    expect(draft).toHaveTextContent(/Draft version 1/);
    expect(draft).toHaveTextContent(/not (?:his|their) plan yet/i);
    expect(draft).toHaveTextContent(PATIENT_CONFIRMATION_LABEL.unavailable);
    // A draft is not a plan, so its content is never rendered as one.
    expect(screen.queryByTestId("care-plan-safety-sections")).toBeNull();
  });

  it("refuses to show the plan when the record is not confirmed as the right person", () => {
    renderRoute(carePlanRoute.safetyPlan("SYN-PATIENT-001"), "scenario=identity-uncertain");
    expect(screen.getByTestId("care-plan-identity-uncertain")).toHaveTextContent(
      /not been confirmed as the right person/i,
    );
    expect(screen.queryByTestId("care-plan-safety-sections")).toBeNull();
  });

  it("links the printed patient copy and the authoring route without an approval step", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.safetyPlan("SYN-PATIENT-001"));
    expect(screen.getByRole("link", { name: /Print this plan/i })).toHaveAttribute(
      "href",
      carePlanRoute.safetyPlanPrint("SYN-PATIENT-001"),
    );
    // Every clinical role may write one, including the emergency department
    // clinician who is signed in by default — 2am in ED is when a safety plan
    // most often gets made.
    expect(screen.getByRole("link", { name: /Start a new version/i })).toHaveAttribute(
      "href",
      carePlanRoute.safetyPlanEdit("SYN-PATIENT-001"),
    );

    await signInAs(user, "SYN-USER-COORD-001");
    expect(screen.queryByRole("link", { name: /Start a new version/i })).toBeNull();
    expect(screen.getByTestId("care-plan-safety-authoring-unavailable")).toHaveTextContent(/Riley Demo/);
  });
});

describe("Care Plan Personal Safety Plan authoring", () => {
  it("starts a new version from the current one without displacing it", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.safetyPlanEdit("SYN-PATIENT-001"));

    await user.click(screen.getByRole("button", { name: /Start a new version/i }));

    expect(screen.getByTestId("care-plan-safety-form-outcome")).toHaveTextContent(
      /draft version 2 created. It is not in use until it is made current/i,
    );
    // Seeded from the version in use, so nothing already agreed has to be typed
    // again, and the version in use is untouched.
    expect(screen.getByLabelText(SAFETY_PLAN_SECTION_LABEL.reasonsForLiving)).toHaveValue(
      "My nephew.\nThe allotment, especially in spring.\nFinishing the course I started.",
    );
    expect(screen.getByTestId("care-plan-safety-current-notice")).toHaveTextContent(/version 1 stays in use/i);
  });

  it("opens the draft that already exists rather than offering to start a second one", () => {
    renderRoute(carePlanRoute.safetyPlanEdit("SYN-PATIENT-003"));
    expect(screen.queryByRole("button", { name: /Start a new version/i })).toBeNull();
    expect(screen.getByLabelText(SAFETY_PLAN_SECTION_LABEL.warningSigns)).toHaveValue("Long stretches awake at night.");
  });

  it("names every incomplete section in a linked summary before a version can be made current", async () => {
    const user = userEvent.setup();
    // Jordan's open draft carries one warning sign and one coping strategy and
    // nothing else, and no review date at all.
    renderRoute(carePlanRoute.safetyPlanEdit("SYN-PATIENT-003"));

    await user.selectOptions(screen.getByLabelText(/What this person has confirmed/i), "confirmed");
    await user.click(screen.getByRole("button", { name: /Make current Personal Safety Plan/i }));

    const summary = screen.getByTestId("error-summary");
    const links = within(summary).getAllByTestId("error-summary-link");
    // Each entry reads `<field>: <what to do>`; the field is what identifies it.
    const named = links.map((node) => (node.textContent ?? "").split(":")[0]);
    expect(named).toContain(SAFETY_PLAN_SECTION_LABEL.saferSurroundings);
    expect(named).toContain(SAFETY_PLAN_SECTION_LABEL.reasonsForLiving);
    expect(named).toContain(SAFETY_PLAN_SECTION_LABEL.personalSupports);
    expect(named).toContain("Next review date");
    expect(named).not.toContain(SAFETY_PLAN_SECTION_LABEL.warningSigns);
    expect(links[named.indexOf(SAFETY_PLAN_SECTION_LABEL.reasonsForLiving)]).toHaveAttribute(
      "href",
      `#${safetyPlanFieldId("reasonsForLiving")}`,
    );
    // Nothing was written, so the draft is still a draft and no confirmation was
    // ever asked for.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not require the person's own words when they declined or were not available", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(carePlanRoute.safetyPlanEdit("SYN-PATIENT-003"));

    await user.selectOptions(screen.getByLabelText(/What this person has confirmed/i), "declined");
    await user.type(screen.getByLabelText(/Next review date/i), "2027-08-20");
    await user.clear(screen.getByLabelText(/How this version was written/i));
    await user.type(
      screen.getByLabelText(/How this version was written/i),
      "Jordan chose not to write one and asked that the crisis numbers alone be kept.",
    );
    await user.click(screen.getByRole("button", { name: /Make current Personal Safety Plan/i }));
    await user.click(screen.getByRole("button", { name: /Make it the current plan/i }));

    expect(screen.queryByTestId("error-summary")).toBeNull();
    expect(navigate).toHaveBeenCalledWith(carePlanRoute.safetyPlan("SYN-PATIENT-003"));
  });

  it("names what the reader actually asked for when a save fails, not making it current", async () => {
    const user = userEvent.setup();
    // Jordan's open draft carries no review date, which is the one rule saving
    // itself enforces, so Save draft raises an error of its own.
    renderRoute(carePlanRoute.safetyPlanEdit("SYN-PATIENT-003"));

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(screen.getByTestId("error-summary")).toHaveTextContent("This draft could not be saved");
    expect(screen.getByTestId("error-summary").textContent ?? "").not.toMatch(/could not be made current/i);

    await user.click(screen.getByRole("button", { name: /Make current Personal Safety Plan/i }));
    expect(screen.getByTestId("error-summary")).toHaveTextContent("This version could not be made current");
  });

  it("lets a person be taken off the contact list as easily as they were added", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.safetyPlanEdit("SYN-PATIENT-001"));
    await user.click(screen.getByRole("button", { name: /Start a new version/i }));

    expect(screen.getByLabelText(/Telephone number for Jess Sample/i)).toHaveValue("0491 570 131");
    // Asked from the patient's side: how this person knows Rowan, never how
    // Jess is related to Jess.
    expect(screen.getByLabelText("How Jess Sample knows Rowan")).toHaveValue("Sister");

    await user.click(screen.getByRole("button", { name: "Remove Jess Sample" }));

    expect(screen.queryByLabelText(/Telephone number for Jess Sample/i)).toBeNull();
    expect(screen.getByLabelText(/Telephone number for Ari Placeholder/i)).toHaveValue("0491 570 132");

    // Removing every row leaves one empty row rather than a section with
    // nothing to type into — the branch a partial removal never reaches.
    await user.click(screen.getByRole("button", { name: "Remove Ari Placeholder" }));
    await user.click(screen.getByRole("button", { name: "Remove person 1" }));
    expect(screen.getByLabelText("Name of person 1")).toHaveValue("");
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(1);
  });

  it("still requires the professional and emergency contacts when this person declined", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.safetyPlanEdit("SYN-PATIENT-003"));

    await user.selectOptions(screen.getByLabelText(/What this person has confirmed/i), "declined");
    // A required field's label carries the shared shell's `(required)` marker,
    // so this matches the heading rather than the whole label text.
    await user.clear(
      screen.getByLabelText(new RegExp(`^${SAFETY_PLAN_SECTION_LABEL.professionalAndEmergencySupport}`)),
    );
    await user.click(screen.getByRole("button", { name: /Make current Personal Safety Plan/i }));

    // Nobody's own words can be required of a person who declined. Who to ring
    // is a different question, and it is the whole reason the sheet exists.
    expect(
      within(screen.getByTestId("error-summary"))
        .getAllByTestId("error-summary-link")
        .map((node) => (node.textContent ?? "").split(":")[0]),
    ).toEqual(["Next review date", SAFETY_PLAN_SECTION_LABEL.professionalAndEmergencySupport]);
  });

  it("requires a name, a relationship and a telephone number for every person listed", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.safetyPlanEdit("SYN-PATIENT-001"));
    await user.click(screen.getByRole("button", { name: /Start a new version/i }));

    await user.clear(screen.getByLabelText(/Telephone number for Jess Sample/i));
    await user.click(screen.getByRole("button", { name: /Make current Personal Safety Plan/i }));

    expect(
      within(screen.getByTestId("error-summary"))
        .getAllByTestId("error-summary-link")
        .map((node) => (node.textContent ?? "").split(":")[0]),
    ).toContain(SAFETY_PLAN_SECTION_LABEL.personalSupports);
    expect(screen.getByTestId("error-summary")).toHaveTextContent(/telephone number/i);
  });

  it("makes a version current through a plain confirmation and supersedes the one it replaces", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(carePlanRoute.safetyPlanEdit("SYN-PATIENT-001"));
    await user.click(screen.getByRole("button", { name: /Start a new version/i }));
    await user.selectOptions(screen.getByLabelText(/What this person has confirmed/i), "confirmed");
    // A new version starts with no note of its own: the last version's note
    // describes the conversation that produced the last version, not this one.
    await user.type(
      screen.getByLabelText(/How this version was written/i),
      "Read back through with Rowan, who confirmed the wording is still theirs.",
    );

    await user.click(screen.getByRole("button", { name: /Make current Personal Safety Plan/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent ?? "").not.toMatch(/approval|approve|senior/i);
    await user.click(within(dialog).getByRole("button", { name: /Make it the current plan/i }));

    expect(screen.getByTestId("care-plan-safety-form-outcome")).toHaveTextContent(/version 2 is now the current one/i);
    expect(navigate).toHaveBeenCalledWith(carePlanRoute.safetyPlan("SYN-PATIENT-001"));
  });

  it("refuses to write against a record that is not confirmed as the right person", () => {
    renderRoute(carePlanRoute.safetyPlanEdit("SYN-PATIENT-001"), "scenario=identity-uncertain");
    expect(screen.getByTestId("care-plan-identity-uncertain")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start a new version/i })).toBeNull();
  });

  it("says plainly when the signed-in role does not carry safety-plan authoring", async () => {
    const user = userEvent.setup();
    renderRoute(carePlanRoute.safetyPlanEdit("SYN-PATIENT-001"));
    await signInAs(user, "SYN-USER-COORD-001");

    expect(screen.getByTestId("care-plan-safety-form-unavailable")).toHaveTextContent(/care planning coordinator/i);
    expect(screen.queryByRole("button", { name: /Start a new version/i })).toBeNull();
  });
});

describe("Care Plan Personal Safety Plan print", () => {
  it("prints the patient-facing document with exactly the seven sections, in order", () => {
    renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-001"));
    const paper = screen.getByTestId("care-plan-safety-print-output");
    expect(paper).toHaveAttribute("data-print-output");
    expect(within(paper).getByRole("heading", { level: 2, name: "My Personal Safety Plan" })).toBeInTheDocument();
    expect(
      within(screen.getByTestId("care-plan-safety-sections"))
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(SAFETY_HEADINGS_FROM_DOMAIN);
    // Every section is a block the browser is asked not to split, so a person's
    // reasons for living cannot end up half on one sheet and half on the next.
    for (const heading of within(screen.getByTestId("care-plan-safety-sections")).getAllByRole("heading", {
      level: 3,
    })) {
      expect(heading.closest("[data-print-break-inside='avoid']")).not.toBeNull();
    }
  });

  /**
   * The defect this exists for has happened twice. Task 3 put `data-print-hide`
   * on the shell header, which carried the only synthetic marker; Task 5 found
   * that on a `PrintOutput` route everything outside `[data-print-output]` is
   * invisible anyway, so the shell's marker cannot reach paper at all. This is
   * the patient's own document, it leaves the building, and it lists real crisis
   * telephone numbers — so the marker must be inside the printed subtree AND
   * must have no print-hidden ancestor. Asserting only that the element itself
   * lacks the attribute would have missed the original defect, which was
   * inherited from an ancestor.
   */
  it("carries the synthetic watermark inside the printed subtree, under no hidden ancestor", () => {
    renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-001"));
    const paper = screen.getByTestId("care-plan-safety-print-output");
    const marker = within(paper).getByText("Synthetic prototype — fictional people, teams, and hospitals");
    expect(marker.closest("[data-print-output]")).toBe(paper);
    expect(marker.closest("[data-print-hide='true']")).toBeNull();
    expect(paper.closest("[data-print-hide='true']")).toBeNull();
    expect(paper.querySelector("[data-print-confidential]")).toHaveTextContent(/Confidential clinical document/i);
    // Deterministic: derived from PROTOTYPE_NOW, never a wall clock.
    expect(paper.querySelector("[data-print-stamp]")).toHaveTextContent("20/08/2026");
    expect(paper.querySelector("[data-print-stamp]")?.closest("[data-print-hide='true']")).toBeNull();
  });

  it("carries the preferred name and the synthetic record number and no other identifier", () => {
    renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-001"));
    const paper = screen.getByTestId("care-plan-safety-print-output");
    const text = paper.textContent ?? "";
    expect(text).toContain("Rowan");
    expect(text).toContain("SYN-MRN-0001");
    expect(text).not.toContain("Rowan Sample");
    expect(text).not.toMatch(/12\/04\/1986|1986-04-12|date of birth/i);
    expect(text).not.toContain("they/them");
    expect(text).not.toContain("North River Health Service");
  });

  it("omits ED Presentation content, audit history and Management Plan metadata", () => {
    renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-001"));
    const paper = screen.getByTestId("care-plan-safety-print-output");
    const text = paper.textContent ?? "";
    expect(text).not.toMatch(/Management Plan|risk assessment|mental[- ]state/i);
    expect(text).not.toMatch(/ED Presentation|presentation activity|disposition|admission|arrived at/i);
    expect(text).not.toMatch(/audit|Review Trigger|Draft|Superseded|plan owner|Approved (?:by|on)/i);
    expect(within(paper).queryAllByRole("button")).toEqual([]);
    expect(within(paper).queryAllByRole("navigation")).toEqual([]);
  });

  it("prints the real public crisis lines with their caveats, hours and official sources", () => {
    renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-001"));
    const crisis = screen.getByTestId("care-plan-safety-crisis");
    expect(crisis.closest("[data-print-output]")).not.toBeNull();

    for (const contact of publicCrisisContacts) {
      expect(crisis, `${contact.name} is missing from the printed copy`).toHaveTextContent(contact.telephoneDisplay);
      expect(crisis).toHaveTextContent(contact.availability);
      // The two MHERL entries share one official page, so this asks whether the
      // source is reachable rather than whether it is unique.
      expect(
        crisis.querySelector(`a[href="${contact.sourceUrl}"]`),
        `${contact.name} is printed with no official source`,
      ).not.toBeNull();
      if (contact.caveat !== null) expect(crisis).toHaveTextContent(contact.caveat);
    }
    // The four public numbers stay real, and are the only real ones here.
    expect(crisis).toHaveTextContent("000");
    expect(crisis).toHaveTextContent("1300 555 788");
    expect(crisis).toHaveTextContent("1800 676 822");
    expect(crisis).toHaveTextContent("1800 552 002");
    expect(crisis).toHaveTextContent(/not an emergency service/i);
    // The person's own team, so the sheet answers "who do I ring first".
    expect(crisis).toHaveTextContent("North River CMHT");
    expect(crisis).toHaveTextContent("0491 570 101");
  });

  it("records a print intent that claims only that the print view was opened", async () => {
    const user = userEvent.setup();
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);
    renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-001"));

    await user.click(screen.getByRole("button", { name: "Print Personal Safety Plan" }));

    expect(printSpy).toHaveBeenCalledTimes(1);
    const outcome = screen.getByTestId("care-plan-safety-print-outcome");
    expect(outcome).toHaveTextContent("The print view was opened.");
    for (const overclaim of [/printed successfully/i, /sent to the printer/i, /copy was produced/i]) {
      expect(outcome.textContent ?? "").not.toMatch(overclaim);
    }
    const control = screen.getByRole("button", { name: "Print Personal Safety Plan" });
    expect(control.closest("[data-print-hide='true']")).not.toBeNull();
    expect(control.closest("[data-print-output]")).toBeNull();
    expect(outcome.closest("[data-print-hide='true']")).not.toBeNull();
  });

  it("keeps printing available while the device is offline", async () => {
    const user = userEvent.setup();
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);
    renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-001"), "scenario=offline");

    const control = screen.getByRole("button", { name: "Print Personal Safety Plan" });
    expect(control).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByTestId("care-plan-safety-print-blocked")).toBeNull();
    await user.click(control);
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("still refuses to print when the record is not confirmed as the right person", () => {
    renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-001"), "scenario=identity-uncertain");
    expect(screen.getByTestId("care-plan-identity-uncertain")).toHaveTextContent(/cannot be taken back/i);
    expect(screen.queryByTestId("care-plan-safety-print-output")).toBeNull();
    expect(screen.queryByRole("button", { name: "Print Personal Safety Plan" })).toBeNull();
  });

  it("states why printing is unavailable when permission could not be confirmed", async () => {
    const user = userEvent.setup();
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);
    renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-001"), "scenario=permission-unavailable");

    const control = screen.getByRole("button", { name: "Print Personal Safety Plan" });
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).not.toHaveAttribute("disabled");
    expect(screen.getByTestId("care-plan-safety-print-blocked")).toHaveTextContent(/Permission for this action/i);
    await user.click(control);
    expect(printSpy).not.toHaveBeenCalled();
  });

  it("does not ask the browser to print in the print-failure specimen, and keeps the whole plan on screen", async () => {
    const user = userEvent.setup();
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);
    renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-001"), "scenario=print-failure");

    await user.click(screen.getByRole("button", { name: "Print Personal Safety Plan" }));

    expect(printSpy).not.toHaveBeenCalled();
    const failure = screen.getByTestId("care-plan-safety-print-failure");
    // Three parts: what happened, what it means, and what the reader can do.
    expect(failure).toHaveTextContent(/could not be opened/i);
    expect(failure).toHaveTextContent(/Nothing was printed, and nothing was recorded/i);
    expect(failure).toHaveTextContent(/still on this page/i);
    // The plan itself is never withheld because the printer could not be reached.
    expect(
      within(screen.getByTestId("care-plan-safety-sections"))
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(SAFETY_HEADINGS_FROM_DOMAIN);
    expect(screen.getByTestId("care-plan-safety-crisis")).toHaveTextContent("1300 555 788");
    expect(screen.queryByTestId("care-plan-safety-print-outcome")).toBeNull();
  });

  /**
   * The worst sheet this build could hand somebody. `SYN-SAFETY-VERSION-004` is
   * Current, the person declined to write their own part, and all six of the
   * patient-voice arrays are empty. Rendering the clinical treatment on paper
   * produced a document addressed to that person reading "My reasons for living
   * — Not recorded", under a sentence claiming these were their own words.
   *
   * It is not an edge case: a fresh draft defaults to `unavailable` with the
   * review date pre-filled, so the minimum version that can be made current
   * carries a note and one line of service contacts and no own words at all.
   *
   * The clinical reading surface keeps `Not recorded`, and the test above pins
   * that, so this cannot be "fixed" by taking the clinician's signal away.
   */
  it("hands a person who wrote no part of their plan a sheet with no blanks about their life", () => {
    renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-004"));
    const paper = screen.getByTestId("care-plan-safety-print-output");
    const text = paper.textContent ?? "";

    expect(text).not.toContain("Not recorded");
    // Heading and all: an empty section is not printed at the person at all.
    expect(
      within(screen.getByTestId("care-plan-safety-sections"))
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent),
    ).toEqual([SAFETY_PLAN_SECTION_LABEL.professionalAndEmergencySupport]);
    for (const key of SAFETY_PLAN_SECTION_KEYS.filter((k) => k !== "professionalAndEmergencySupport")) {
      expect(text, `${SAFETY_PLAN_SECTION_LABEL[key]} printed over a blank`).not.toContain(
        SAFETY_PLAN_SECTION_LABEL[key],
      );
    }

    // The claim that these are the reader's own words is false here, so it is
    // not made; the sheet says what it does hold instead.
    expect(text).not.toMatch(/in your own words/i);
    expect(screen.getByTestId("care-plan-safety-paper-intro")).toHaveTextContent(/numbers to ring if you need help/i);
    expect(screen.getByTestId("care-plan-safety-paper-intro")).toHaveTextContent(/yours to decide about/i);
    // A row reading "Last confirmed — Not recorded" is worse than no row.
    expect(text).not.toContain("Last confirmed");
    expect(text).toContain("Evie");
    expect(text).toContain("SYN-MRN-0004");

    // What the sheet is for is still all there.
    const crisis = screen.getByTestId("care-plan-safety-crisis");
    expect(crisis).toHaveTextContent("1300 555 788");
    expect(crisis).toHaveTextContent("000");
    expect(crisis).toHaveTextContent(/not an emergency service/i);
  });

  it("keeps every section a person did write, and drops only the ones they did not", () => {
    // Rowan wrote all seven, so the printed copy is unchanged by the omission
    // rule — it removes blanks, never content.
    renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-001"));
    expect(
      within(screen.getByTestId("care-plan-safety-sections"))
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(SAFETY_HEADINGS_FROM_DOMAIN);
    expect(screen.getByTestId("care-plan-safety-paper-intro")).toHaveTextContent(/in your own words/i);
  });

  it("says plainly when there is no current version to print", () => {
    renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-003"));
    expect(screen.getByTestId("care-plan-safety-print-unavailable")).toHaveTextContent(
      /no current Personal Safety Plan/i,
    );
    expect(screen.queryByTestId("care-plan-safety-print-output")).toBeNull();
  });

  // No component added by this task calls `focus()`, and the shell's
  // pathname-keyed effect commits last, so a final-state assertion here could
  // never fail. This watches the focus events instead.
  it("leaves the mount-time focus to the shell heading", () => {
    const focusedNames: string[] = [];
    const listener = (event: Event) => {
      const target = event.target as HTMLElement | null;
      focusedNames.push(target?.getAttribute("aria-label") ?? target?.tagName ?? "");
    };
    document.addEventListener("focusin", listener);
    try {
      renderRoute(carePlanRoute.safetyPlanPrint("SYN-PATIENT-001"));
    } finally {
      document.removeEventListener("focusin", listener);
    }

    expect(focusedNames).toEqual(["H1"]);
    expect(screen.getByRole("heading", { level: 1, name: "Print Personal Safety Plan" })).toHaveFocus();
  });
});

describe("Care Plan error boundary", () => {
  function Thrower(): never {
    throw new Error("Two versions are recorded as Current for SYN-MGMT-PLAN-001.");
  }

  it("catches an invariant violation and shows the shared recovery panel instead of a blank tree", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <CarePlanErrorBoundary>
        <Thrower />
      </CarePlanErrorBoundary>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Care Plan could not be displayed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("renders its children untouched when nothing throws", () => {
    render(
      <CarePlanErrorBoundary>
        <p>Route content</p>
      </CarePlanErrorBoundary>,
    );
    expect(screen.getByText("Route content")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Care Plan could not be displayed" })).toBeNull();
  });
});

/**
 * The Patient Plan, driven through the interface.
 *
 * These render one provider and move between addresses inside it, because a
 * patient copy only exists after somebody makes one: a fresh provider per route
 * would put the print route in front of a world where nothing had been written.
 */
describe("Care Plan Patient Plan", () => {
  /** The eight headings, written out here rather than imported. A content check
   *  that reads the constant its subject renders from can never disagree with
   *  it. */
  const PATIENT_PLAN_HEADINGS = [
    "Why we wrote this together",
    "What matters to you",
    "What helps you",
    "What makes things harder",
    "What we agreed will happen when you come to the emergency department",
    "If something new is happening",
    "Who's involved in your care",
    "Things that might help",
  ];

  function renderJourney(pathname: string) {
    const navigate = vi.fn();
    const view = (at: string) => (
      <CarePlanPrototypeProvider>
        <CarePlanRouteSurface pathname={at} query="" navigate={navigate} />
      </CarePlanPrototypeProvider>
    );
    const { rerender } = render(view(pathname));
    return { navigate, goTo: (at: string) => rerender(view(at)) };
  }

  async function createDraft(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Create the patient copy" }));
  }

  /**
   * Pasted rather than typed. Typing this into eight textareas is ~250
   * simulated keystrokes, which took long enough to push neighbouring tests
   * past their timeout — the suite failed on a different pair of tests on each
   * run, which is a flake rather than a finding.
   */
  async function fillEverySection(user: ReturnType<typeof userEvent.setup>) {
    for (const field of screen.getAllByRole("textbox")) {
      await user.clear(field);
      await user.click(field);
      await user.paste("Written with you at the bedside.");
    }
  }

  it("offers no copy until one is made, and then shows what the conversion refused to guess", async () => {
    const user = userEvent.setup();
    renderJourney(carePlanRoute.patientPlan("SYN-PATIENT-001"));

    expect(screen.getByTestId("care-plan-patient-plan-no-current")).toHaveTextContent(/no approved Patient Plan/i);
    await createDraft(user);

    const draftNotice = screen.getByTestId("care-plan-patient-plan-draft-notice");
    expect(draftNotice).toHaveTextContent(/sections still to write/i);
  });

  it("states why each blank section is blank, in words a clinician can act on", async () => {
    const user = userEvent.setup();
    renderJourney(carePlanRoute.patientPlanEdit("SYN-PATIENT-001"));
    await createDraft(user);

    const agreed = screen.getByTestId("care-plan-patient-plan-form-gap-whatWeAgreedWillHappen");
    expect(agreed).toHaveTextContent(/never converted automatically/i);
    expect(agreed).toHaveTextContent(/written by a clinician/i);
  });

  /**
   * The control is unavailable for a stated reason, so it keeps its tab stop and
   * the reason can actually be reached. `aria-disabled` and native `disabled`
   * together fail lint; native `disabled` alone would take the reason with it.
   */
  it("makes approval unavailable with a stated reason while any section is blank", async () => {
    const user = userEvent.setup();
    renderJourney(carePlanRoute.patientPlanEdit("SYN-PATIENT-001"));
    await createDraft(user);

    const approve = screen.getByRole("button", { name: "Approve patient copy" });
    expect(approve).toHaveAttribute("aria-disabled", "true");
    expect(approve).not.toHaveAttribute("disabled");
    const reason = screen.getByTestId("care-plan-patient-plan-approve-unavailable");
    expect(reason).toHaveTextContent(/cannot be approved while/i);
    expect(approve.getAttribute("aria-describedby")).toBe(reason.id);

    await user.click(approve);
    expect(screen.getByRole("button", { name: "Approve patient copy" })).toHaveAttribute("aria-disabled", "true");
  });

  it("approves once every section is written, and shows the eight headings in order", async () => {
    const user = userEvent.setup();
    const { goTo } = renderJourney(carePlanRoute.patientPlanEdit("SYN-PATIENT-001"));
    await createDraft(user);
    await fillEverySection(user);
    await user.click(screen.getByRole("button", { name: "Approve patient copy" }));

    goTo(carePlanRoute.patientPlan("SYN-PATIENT-001"));
    expect(
      within(screen.getByTestId("care-plan-patient-plan-sections"))
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(PATIENT_PLAN_HEADINGS);
  });

  /**
   * The print hazard that has now bitten twice. `globals.css` makes everything
   * outside `[data-print-output]` invisible when printing, so the shell's
   * synthetic marker cannot reach the paper. The printed subtree must carry its
   * own, and the assertion is against the marker's *ancestors* — checking only
   * that the element itself lacks the attribute would have missed the original
   * defect, which was inherited.
   */
  it("carries the synthetic watermark inside the printed subtree, under no hidden ancestor", async () => {
    const user = userEvent.setup();
    const { goTo } = renderJourney(carePlanRoute.patientPlanEdit("SYN-PATIENT-001"));
    await createDraft(user);
    await fillEverySection(user);
    await user.click(screen.getByRole("button", { name: "Approve patient copy" }));
    goTo(carePlanRoute.patientPlanPrint("SYN-PATIENT-001"));

    const paper = screen.getByTestId("care-plan-patient-plan-print-output");
    const marker = within(paper).getByText("Synthetic prototype — fictional people, teams, and hospitals");
    expect(marker.closest("[data-print-output]")).toBe(paper);
    expect(marker.closest("[data-print-hide='true']")).toBeNull();
    expect(paper.closest("[data-print-hide='true']")).toBeNull();
    expect(paper.querySelector("[data-print-confidential]")).toHaveTextContent(/Confidential clinical document/i);
    // Deterministic: derived from PROTOTYPE_NOW, never a wall clock.
    expect(paper.querySelector("[data-print-stamp]")).toHaveTextContent("20/08/2026");
    expect(paper.querySelector("[data-print-stamp]")?.closest("[data-print-hide='true']")).toBeNull();
  });

  it("prints the preferred name and record number, and no navigation, audit, or plan metadata", async () => {
    const user = userEvent.setup();
    const { goTo } = renderJourney(carePlanRoute.patientPlanEdit("SYN-PATIENT-001"));
    await createDraft(user);
    await fillEverySection(user);
    await user.click(screen.getByRole("button", { name: "Approve patient copy" }));
    goTo(carePlanRoute.patientPlanPrint("SYN-PATIENT-001"));

    const paper = screen.getByTestId("care-plan-patient-plan-print-output");
    const text = paper.textContent ?? "";
    expect(text).toContain("Rowan");
    expect(text).toContain("SYN-MRN-0001");
    expect(text).not.toContain("Rowan Sample");
    expect(text).not.toMatch(/12\/04\/1986|1986-04-12|date of birth/i);
    expect(text).not.toContain("they/them");
    expect(text).not.toContain("North River Health Service");
    expect(text).not.toMatch(/audit|Review Trigger|Superseded|plan owner|Awaiting Approval|revision reason/i);
    expect(text).not.toMatch(/Not recorded/);
    /*
     * Clinical vocabulary is checked on the plan's own eight sections rather
     * than on the whole sheet. The crisis block carries MHERL's and Rurallink's
     * own published wording — each "is a telephone triage and support line. It
     * is not an emergency service" — and paraphrasing a real service's safety
     * caveat to satisfy a house style would be a worse error than the one this
     * guards against.
     */
    const sections = screen.getByTestId("care-plan-patient-plan-sections").textContent ?? "";
    expect(sections).not.toMatch(/ED Presentation|disposition|mental[- ]state|risk assessment|triage/i);
    expect(within(paper).queryAllByRole("button")).toEqual([]);
    expect(within(paper).queryAllByRole("navigation")).toEqual([]);
  });

  it("prints the real crisis lines with their caveats and official sources, and nothing fictional beside them", async () => {
    const user = userEvent.setup();
    const { goTo } = renderJourney(carePlanRoute.patientPlanEdit("SYN-PATIENT-001"));
    await createDraft(user);
    await fillEverySection(user);
    await user.click(screen.getByRole("button", { name: "Approve patient copy" }));
    goTo(carePlanRoute.patientPlanPrint("SYN-PATIENT-001"));

    const resources = screen.getByTestId("care-plan-patient-plan-resources");
    for (const contact of publicCrisisContacts) {
      expect(resources, `${contact.name} is missing`).toHaveTextContent(contact.telephoneDisplay);
      expect(
        resources.querySelector(`a[href="${contact.sourceUrl}"]`),
        `${contact.name} is printed with no official source`,
      ).not.toBeNull();
      if (contact.caveat !== null) expect(resources).toHaveTextContent(contact.caveat);
    }
    expect(resources).toHaveTextContent(/not an emergency service/i);
  });

  /**
   * A copy the person may be holding is never regenerated, hidden, or
   * withdrawn. It says it needs updating, and stays completely readable.
   */
  it("marks a copy as needing updating without taking any of it away", async () => {
    const user = userEvent.setup();
    const { goTo } = renderJourney(carePlanRoute.patientPlanEdit("SYN-PATIENT-002"));
    await createDraft(user);
    await fillEverySection(user);
    await user.click(screen.getByRole("button", { name: "Approve patient copy" }));

    // Approve the Management Plan version already awaiting approval, which moves
    // the plan on underneath the copy just approved.
    goTo(carePlanRoute.managementPlanReview("SYN-PATIENT-002"));
    await signInAs(user, "SYN-USER-SENIOR-001");
    await user.click(screen.getByRole("button", { name: /^Approve version/ }));
    await user.click(screen.getByRole("button", { name: "Approve and make Current" }));

    goTo(carePlanRoute.patientPlan("SYN-PATIENT-002"));
    expect(screen.getByTestId("care-plan-patient-plan-stale")).toHaveTextContent(/needs updating/i);
    // Every heading is still there, and nothing was withdrawn.
    expect(
      within(screen.getByTestId("care-plan-patient-plan-sections")).getAllByRole("heading", { level: 3 }),
    ).toHaveLength(8);
    expect(screen.queryByTestId("care-plan-patient-plan-no-current")).toBeNull();

    // The same currency warning shown on screen must reach the printed sheet.
    // The screen-only StaleNotice above sits outside `[data-print-output]`, so
    // if the print surface carries no warning of its own a clinician can print
    // and hand over an earlier-version copy whose paper looks current.
    goTo(carePlanRoute.patientPlanPrint("SYN-PATIENT-002"));
    const paper = screen.getByTestId("care-plan-patient-plan-print-output");
    const staleOnPaper = within(paper).getByTestId("care-plan-patient-plan-print-stale");
    expect(staleOnPaper).toHaveTextContent(/needs updating/i);
    expect(staleOnPaper.closest("[data-print-hide='true']")).toBeNull();
  });
});
