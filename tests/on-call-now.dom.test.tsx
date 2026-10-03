/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { coverItems, handbookItems, OTHER_SITE, readyHandbook } from "./helpers/on-call-handbook-fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: true, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "authenticated", authEpoch: 1 }) }));
vi.mock("@/components/on-call/on-call-page-menu", () => ({ OnCallPageMenu: () => null }));
vi.mock("@/components/roster/use-roster-shifts", () => ({
  useRosterShifts: () => ({ status: "ready", shifts: [], latestImport: null, demoMode: false }),
}));
const store = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => ({
    entries: store.entries,
    loading: false,
    isOffline: false,
    signedOut: false,
    cachedAt: null,
    loadError: null,
    retry: vi.fn(),
    demoMode: false,
  }),
  cacheOnCallEntries: vi.fn(),
}));
const handbook = vi.hoisted(() => ({ state: null as unknown as HospitalHandbookState }));
vi.mock("@/components/on-call/use-hospital-handbook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/on-call/use-hospital-handbook")>()),
  useHospitalHandbook: () => handbook.state,
}));

const { OnCallHome } = await import("@/components/on-call/on-call-home");
const { ON_CALL_WHOS_ON_ENABLED } = await import("@/lib/on-call/feature-flags");
const { readOnCallMyTeam, saveOnCallMyTeam } = await import("@/lib/on-call/my-team-storage");
const { recordOnCallRecent } = await import("@/lib/on-call/recent-storage");
const { onCallRecentStorageKey } = await import("@/lib/on-call/recent-storage");
const { readOnCallShiftPick } = await import("@/lib/on-call/shift-context");
const { rememberOnCallYouCalled } = await import("@/lib/on-call/call-marks");

const AFTER_HOURS = new Date("2026-09-26T14:00:00.000Z"); // Saturday 22:00 Perth
const IN_HOURS = new Date("2026-09-23T02:00:00.000Z"); // Wednesday 10:00 Perth

function personal(overrides: Partial<OnCallEntry> & { details: unknown }): OnCallEntry {
  return {
    id: "mine",
    slug: "mine",
    section: "contacts",
    title: "My consultant",
    subtitle: null,
    body: null,
    linkedDocumentIds: [],
    tags: [],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
    ...overrides,
  } as unknown as OnCallEntry;
}

function order(ids: readonly string[]) {
  const nodes = ids.map((id) => screen.getByTestId(id));
  for (let index = 1; index < nodes.length; index += 1) {
    expect(
      nodes[index - 1].compareDocumentPosition(nodes[index]) & Node.DOCUMENT_POSITION_FOLLOWING,
      `${ids[index - 1]} comes before ${ids[index]}`,
    ).toBeTruthy();
  }
}

beforeEach(() => {
  window.localStorage.clear();
  store.entries = [];
  handbook.state = readyHandbook([]);
});
afterEach(cleanup);

describe("Now: the safety order", () => {
  it("leads with the hospital, then its emergency route, then Right now, your usual, your team and the footer", () => {
    handbook.state = readyHandbook(
      handbookItems([
        { id: "em", title: "Emergency: Synthetic emergency code", phone: "55", kind: "clinical" },
        { id: "sw", title: "Switchboard", phone: "9000 0000" },
      ]),
    );
    render(<OnCallHome now={IN_HOURS} />);
    order([
      "on-call-now-hospital",
      "on-call-now-emergency",
      "on-call-now-right-now",
      "on-call-home-recent",
      "on-call-now-team",
      "on-call-now-footer",
    ]);
    expect(screen.getByTestId("on-call-now-hospital")).toHaveTextContent("Synthetic Hospital");
  });

  it("pins only this site's clinical Emergency rows, three at most, with the quiet red dot", () => {
    handbook.state = readyHandbook(
      handbookItems([
        { id: "e1", title: "Emergency: Code A", phone: "55", kind: "clinical" },
        { id: "e2", title: "Emergency: Code B", phone: "56", kind: "clinical" },
        { id: "e3", title: "Emergency: Code C", phone: "57", kind: "clinical" },
        { id: "e4", title: "Emergency: Code D", phone: "58", kind: "clinical" },
        { id: "op", title: "Emergency: Operational line", phone: "59" },
        { id: "far", title: "Emergency: Other site", phone: "60", kind: "clinical", siteId: OTHER_SITE },
        { id: "all", title: "Emergency: No site", phone: "61", kind: "clinical", siteId: null },
      ]),
    );
    render(<OnCallHome now={IN_HOURS} />);
    const pin = screen.getByTestId("on-call-now-emergency");
    expect(within(pin).getAllByRole("listitem")).toHaveLength(3);
    expect(pin.querySelectorAll('[data-testid$="-emergency-dot"]')).toHaveLength(3);
    expect(pin).not.toHaveTextContent(/Operational line|Other site|No site/);
    // "55" is desk-only: it says so and has no call link of its own.
    expect(within(pin).getAllByText("From a hospital phone").length).toBeGreaterThan(0);
    expect(within(pin).queryByRole("link", { name: /^call code a/i })).toBeNull();
    expect(screen.getByTestId("on-call-now-emergency-updated")).toHaveTextContent(/Updated/);
  });

  it("pins nothing when no qualifying row is recorded, and never invents 000 for the hospital", () => {
    handbook.state = readyHandbook(handbookItems([{ id: "sw", title: "Switchboard", phone: "9000 0000" }]), {
      services: [{ id: "svc", name: "Synthetic Hospital Service", role: "editor", clinicalReviewer: false, sites: [] }],
    });
    const { container } = render(<OnCallHome now={IN_HOURS} />);
    expect(screen.queryByTestId("on-call-now-emergency")).toBeNull();
    // It says so instead, with a way to set it up and no number to dial.
    const notSetUp = screen.getByTestId("on-call-now-emergency-not-set-up");
    expect(notSetUp).toHaveTextContent("Emergency number not set up for this hospital");
    expect(screen.getByTestId("on-call-now-emergency-set-up-link")).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/on-call\/service\?service=svc&site=/),
    );
    expect(notSetUp.querySelector('a[href^="tel:"]')).toBeNull();
    // The hospital's numbers are on screen, so the public crisis lines step back too.
    expect(container.querySelector('a[href="tel:000"]')).toBeNull();
  });

  it("shows the public crisis lines, 000 first, while the hospital's numbers load or cannot be shown", () => {
    for (const status of ["loading", "signed-out", "unavailable", "no-service"] as const) {
      handbook.state = readyHandbook([], { status });
      render(<OnCallHome now={IN_HOURS} />);
      const crisis = screen.getByTestId("on-call-now-crisis");
      const links = within(crisis).getAllByRole("link");
      expect(links[0], status).toHaveAttribute("href", "tel:000");
      expect(crisis, status).toHaveTextContent(/MHERL/);
      expect(crisis, status).toHaveTextContent(/Lifeline/);
      cleanup();
    }
  });

  it("keeps the public crisis lines when the hospital's entries hold no number to call", () => {
    handbook.state = readyHandbook(
      handbookItems([{ id: "o", title: "Synthetic parking note", section: "orientation", phone: "" }]),
    );
    render(<OnCallHome now={IN_HOURS} />);
    expect(within(screen.getByTestId("on-call-now-crisis")).getAllByRole("link")[0]).toHaveAttribute("href", "tel:000");
  });

  it("keeps the space of the emergency row and your team while the hospital loads", () => {
    saveOnCallMyTeam("Medicine");
    handbook.state = readyHandbook([], { status: "loading", emergencyPinExpected: true });
    render(<OnCallHome now={IN_HOURS} />);
    expect(screen.getByTestId("on-call-now-emergency-outlines")).toBeInTheDocument();
    expect(screen.getByTestId("on-call-now-team-outlines")).toBeInTheDocument();
    expect(screen.getByTestId("on-call-now-right-now-outline")).toBeInTheDocument();
  });

  it("keeps the space of the not-set-up row for a hospital loaded before without a pin", () => {
    handbook.state = readyHandbook([], { status: "loading", emergencyPinExpected: false });
    const { rerender } = render(<OnCallHome now={IN_HOURS} />);
    expect(screen.getByTestId("on-call-now-emergency-outlines")).toBeInTheDocument();
    handbook.state = readyHandbook([]);
    rerender(<OnCallHome now={IN_HOURS} />);
    expect(screen.queryByTestId("on-call-now-emergency-outlines")).toBeNull();
    expect(screen.getByTestId("on-call-now-emergency-not-set-up")).toBeInTheDocument();
  });

  it("reserves nothing for a hospital that has never loaded on this device", () => {
    handbook.state = readyHandbook([], { status: "loading", emergencyPinExpected: null });
    render(<OnCallHome now={IN_HOURS} />);
    expect(screen.queryByTestId("on-call-now-emergency-outlines")).toBeNull();
  });

  it("tells a read-only member to ask an editor, with no link", () => {
    handbook.state = readyHandbook([], {
      services: [{ id: "svc", name: "Synthetic Hospital Service", role: "member", clinicalReviewer: false, sites: [] }],
    });
    render(<OnCallHome now={IN_HOURS} />);
    const row = screen.getByTestId("on-call-now-emergency-not-set-up");
    expect(row).toHaveTextContent("Ask a service editor to add it");
    expect(row.querySelector("a")).toBeNull();
  });

  it("holds Your usual as outlines while a hospital row in it is still arriving", () => {
    recordOnCallRecent({ id: "sw", source: "handbook" });
    handbook.state = readyHandbook([], { status: "loading" });
    render(<OnCallHome now={IN_HOURS} />);
    expect(screen.queryByTestId("on-call-now-usual-sw")).toBeNull();
    expect(
      within(screen.getByTestId("on-call-home-recent")).getByTestId("on-call-now-usual-outlines"),
    ).toBeInTheDocument();
  });
});

describe("Now: Right now", () => {
  it("answers with the hospital's switchboard on the dark hero until the hospital sets its hours", () => {
    handbook.state = readyHandbook(handbookItems([{ id: "sw", title: "Switchboard", phone: "9000 0000" }]));
    render(<OnCallHome now={AFTER_HOURS} />);
    const hero = screen.getByTestId("on-call-now-right-now");
    expect(hero.className).toMatch(/--surface-summary/);
    expect(within(hero).getByTestId("on-call-now-right-now-sw")).toHaveTextContent("Switchboard");
    // No hospital hours today: no period line, no track, no "after hours" wording.
    expect(screen.queryByTestId("on-call-now-right-now-track")).toBeNull();
    expect(hero).not.toHaveTextContent(/after hours/i);
    expect(within(hero).getByRole("link", { name: "All roles" })).toHaveAttribute("href", "/on-call/call");
  });

  it("says the switchboard is not set up rather than inventing a number", () => {
    render(<OnCallHome now={IN_HOURS} />);
    const hero = screen.getByTestId("on-call-now-right-now");
    expect(within(hero).getByTestId("on-call-now-right-now-not-set-up")).toHaveTextContent(
      "Not set up for this hospital",
    );
    expect(within(hero).queryByRole("link", { name: /^call/i })).toBeNull();
  });
});

describe("Now: Needs you", () => {
  function ladder(): OnCallEntry {
    return personal({
      id: "pb1",
      slug: "pb1",
      section: "playbook",
      title: "Deteriorating patient",
      isPersonal: false,
      details: {
        trigger: "Synthetic trigger",
        escalationSteps: [
          { order: 1, whoToCall: "Registrar", when: "First", phone: "9000 0011" },
          { order: 2, whoToCall: "Consultant", when: "No answer", phone: "9000 0012" },
        ],
      },
    });
  }

  it("names who was rung and when, and rings the next rung in one tap", () => {
    store.entries = [ladder()];
    rememberOnCallYouCalled("ladder:pb1:1", new Date(IN_HOURS.getTime() - 6 * 60_000));
    render(<OnCallHome now={IN_HOURS} />);
    const needs = screen.getByTestId("on-call-now-needs-you");
    expect(needs).toHaveTextContent("Waiting on Registrar");
    expect(needs).toHaveTextContent("6 min ago");
    expect(needs).toHaveTextContent(/next: Consultant/);
    expect(needs).not.toHaveTextContent(/overdue|late/i);
    expect(within(needs).getByTestId("on-call-now-needs-you-call").getAttribute("href")).toMatch(/^tel:.*90000012$/);
  });

  it("shows nothing when no rung of the reader's ladders was rung this shift", () => {
    store.entries = [ladder()];
    render(<OnCallHome now={IN_HOURS} />);
    expect(screen.queryByTestId("on-call-now-needs-you")).toBeNull();
  });
});

describe("Now: Your usual", () => {
  it("takes a hospital row's title from the signed-in handbook, never from storage", () => {
    recordOnCallRecent({ id: "sw", source: "handbook" });
    expect(window.localStorage.getItem(onCallRecentStorageKey) ?? "").not.toMatch(/Switchboard|title|9000/);
    handbook.state = readyHandbook(handbookItems([{ id: "sw", title: "Switchboard", phone: "9000 0000" }]));
    render(<OnCallHome now={IN_HOURS} />);
    expect(screen.getByTestId("on-call-now-usual-sw")).toHaveTextContent("Switchboard");
  });

  it("hides a hospital row once nobody is signed in to the handbook", () => {
    recordOnCallRecent({ id: "sw", source: "handbook" });
    handbook.state = readyHandbook([], { status: "signed-out" });
    render(<OnCallHome now={IN_HOURS} />);
    expect(screen.queryByTestId("on-call-now-usual-sw")).toBeNull();
  });

  it("tells the reader a usual number was removed instead of dialling it", () => {
    recordOnCallRecent({ id: "gone", source: "handbook" });
    handbook.state = readyHandbook([], { removed: [{ id: "gone", goneAt: "2026-09-23T01:00:00.000Z" }] });
    render(<OnCallHome now={IN_HOURS} />);
    const tile = screen.getByTestId("on-call-now-usual-gone");
    expect(tile).toHaveTextContent("This number was removed. Check with switchboard.");
    expect(within(tile).queryByRole("link")).toBeNull();
  });

  it("keeps a personal number's digits off Now but still dials it", () => {
    store.entries = [personal({ tags: ["call-first"], details: { role: "My consultant", phone: "9000 0021" } })];
    render(<OnCallHome now={IN_HOURS} />);
    const tile = screen.getByTestId("on-call-now-usual-mine");
    expect(tile).not.toHaveTextContent("9000 0021");
    expect(
      within(tile)
        .getByRole("link", { name: /^call my consultant$/i })
        .getAttribute("href"),
    ).toMatch(/^tel:.*90000021$/);
  });

  it("shows four tiles, then Show all", async () => {
    store.entries = ["a", "b", "c", "d", "e"].map((id, index) =>
      personal({
        id,
        slug: id,
        title: `Synthetic ${id}`,
        isPersonal: false,
        sortOrder: index,
        tags: ["call-first"],
        details: { role: id, phone: `9000 003${index}` },
      }),
    );
    render(<OnCallHome now={IN_HOURS} />);
    const list = screen.getByTestId("on-call-now-usual");
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    await userEvent.click(screen.getByTestId("on-call-now-usual-more"));
    expect(within(screen.getByTestId("on-call-now-usual")).getAllByRole("listitem")).toHaveLength(5);
  });
});

describe("Now: Your team", () => {
  it("shows three roles from the reader's team", () => {
    saveOnCallMyTeam("Medicine");
    handbook.state = readyHandbook(
      coverItems([
        { id: "m1", title: "Medicine: Registrar", phone: "9000 0001" },
        { id: "m2", title: "Medicine: Consultant", phone: "9000 0002" },
        { id: "m3", title: "Medicine: Intern", phone: "9000 0003" },
        { id: "m4", title: "Medicine: Resident", phone: "9000 0004" },
        { id: "i1", title: "ICU: Registrar", phone: "9000 0005" },
      ]),
    );
    render(<OnCallHome now={IN_HOURS} />);
    const team = screen.getByTestId("on-call-now-team");
    expect(team).toHaveTextContent("Your team · Medicine");
    expect(within(team).getAllByRole("listitem")).toHaveLength(3);
    expect(team).not.toHaveTextContent("ICU");
  });

  it("does not swap to the after-hours manager until the hospital sets its hours", () => {
    saveOnCallMyTeam("Medicine");
    handbook.state = readyHandbook(
      handbookItems([
        { id: "m1", title: "Medicine: Registrar", phone: "9000 0001" },
        { id: "ahm", title: "After-hours manager: Coordinator", phone: "9000 0009" },
      ]),
    );
    render(<OnCallHome now={AFTER_HOURS} />);
    const team = screen.getByTestId("on-call-now-team");
    expect(within(team).getAllByRole("listitem")).toHaveLength(1);
    expect(team).not.toHaveTextContent(/Coordinator|not recorded/i);
  });

  it("offers one Choose your team row, and keeps the choice on this device", async () => {
    handbook.state = readyHandbook(handbookItems([{ id: "m1", title: "Medicine: Registrar", phone: "9000 0001" }]));
    render(<OnCallHome now={IN_HOURS} />);
    await userEvent.click(screen.getByTestId("on-call-now-team-choose"));
    const chooser = screen.getByTestId("on-call-now-team-chooser");
    await userEvent.click(within(chooser).getByRole("button", { name: "Medicine" }));
    expect(readOnCallMyTeam()).toBe("Medicine");
    expect(screen.getByTestId("on-call-now-team")).toHaveTextContent("Your team · Medicine");
  });

  it("links to Who's on only while the flag is on", () => {
    saveOnCallMyTeam("Medicine");
    handbook.state = readyHandbook(handbookItems([{ id: "m1", title: "Medicine: Registrar", phone: "9000 0001" }]));
    render(<OnCallHome now={IN_HOURS} />);
    expect(screen.queryAllByRole("link", { name: "Everyone on" })).toHaveLength(ON_CALL_WHOS_ON_ENABLED ? 1 : 0);
    expect(document.querySelector('a[href="/on-call/whos-on"]') === null).toBe(!ON_CALL_WHOS_ON_ENABLED);
  });
});

describe("Now: the footer group", () => {
  it("opens one sheet for the shift pick and the start and end lists, never the other phases", async () => {
    handbook.state = readyHandbook(
      handbookItems([
        { id: "o1", title: "Collect the pager", section: "orientation", phase: "first_shift" },
        { id: "o2", title: "Return the pager", section: "orientation", phase: "ongoing" },
        { id: "o3", title: "Sign contract", section: "orientation", phase: "before_start" },
        { id: "o4", title: "Hand in badge", section: "orientation", phase: "leaving" },
      ]),
    );
    render(<OnCallHome now={IN_HOURS} />);
    expect(screen.getByTestId("on-call-now-checklists")).toHaveTextContent("Start of shift · 0 of 1 done");
    await userEvent.click(screen.getByTestId("on-call-now-checklists"));
    const sheet = screen.getByTestId("on-call-now-checklists-sheet");
    expect(within(sheet).getByTestId("on-call-now-checklist-start")).toHaveTextContent("Collect the pager");
    expect(within(sheet).getByTestId("on-call-now-checklist-end")).toHaveTextContent("Return the pager");
    expect(screen.queryByText("Sign contract")).toBeNull();
    expect(screen.queryByText("Hand in badge")).toBeNull();
    await userEvent.click(within(screen.getByTestId("on-call-now-shift-pick")).getByRole("radio", { name: "Night" }));
    expect(readOnCallShiftPick()?.period).toBe("night");
  });

  it("keeps no ticks: a tick lives on the page only", async () => {
    handbook.state = readyHandbook(
      handbookItems([{ id: "o1", title: "Collect the pager", section: "orientation", phase: "first_shift" }]),
    );
    render(<OnCallHome now={IN_HOURS} />);
    await userEvent.click(screen.getByTestId("on-call-now-checklists"));
    const before = Object.keys(window.localStorage);
    await userEvent.click(screen.getByTestId("on-call-now-checklist-item-o1"));
    expect(screen.getByTestId("on-call-now-checklist-item-o1")).toHaveAttribute("aria-pressed", "true");
    expect(Object.keys(window.localStorage)).toEqual(before);
    expect(screen.getByTestId("on-call-now-checklists")).toHaveTextContent("1 of 1 done");
  });

  it("ends with Who do I call now, Systems down, First night and On site", () => {
    render(<OnCallHome now={IN_HOURS} />);
    const footer = screen.getByTestId("on-call-now-footer");
    expect(within(footer).getByTestId("on-call-home-call-now")).toHaveAttribute("href", "/on-call/now");
    expect(screen.getByTestId("on-call-now-systems-down")).toHaveAttribute(
      "href",
      "/on-call/find#on-call-group-downtime",
    );
    expect(within(footer).getByTestId("on-call-home-first-night")).toHaveAttribute("href", "/on-call/first-night");
    expect(screen.getByTestId("on-call-now-on-site")).toHaveAttribute("href", "/admin/help");
    expect(screen.getByTestId("on-call-now-on-site")).toHaveTextContent("On site: access, food, taxi");
  });
});

describe("Now: what is not on it", () => {
  it("has no search box, no ask box, no tile grid, no tool row and no teaching strip", () => {
    render(<OnCallHome now={IN_HOURS} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    for (const id of [
      "on-call-search",
      "on-call-home-sections",
      "on-call-home-tools",
      "on-call-home-upcoming",
      "on-call-home-pinned-module",
      "on-call-home-call-first",
      "on-call-home-wards",
    ]) {
      expect(screen.queryByTestId(id), id).toBeNull();
    }
  });

  it("draws nothing heavier than 600", () => {
    handbook.state = readyHandbook(handbookItems([{ id: "sw", title: "Switchboard", phone: "9000 0000" }]));
    const { container } = render(<OnCallHome now={IN_HOURS} />);
    expect(container.querySelector(".font-bold, .font-extrabold, .font-black")).toBeNull();
  });
});
