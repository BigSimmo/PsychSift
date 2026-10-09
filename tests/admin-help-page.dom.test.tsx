/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminHelpPage } from "@/components/admin/admin-help-page";
import { adminPinsStorageKey } from "@/lib/admin/pins";
import { WA_CRISIS_CONTACTS } from "@/lib/crisis-contacts";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { onCallEntryFixture } from "./helpers/on-call-entry-fixture";

const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/help",
  useRouter: () => ({ push: vi.fn(), replace: routerReplace, back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: true, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
}));

vi.mock("@/components/on-call/on-call-entry-editor", () => ({
  OnCallEntryEditor: (props: { open: boolean; entry: OnCallEntry | null }) =>
    props.open ? <div data-testid="mock-entry-editor">{props.entry?.title ?? "new entry"}</div> : null,
}));

const loginOwn = onCallEntryFixture({
  section: "logistics",
  title: "Demo logins, paging and remote access",
  details: { category: "Logins" },
  isOwn: true,
});
const onSiteOwn = onCallEntryFixture({
  section: "logistics",
  title: "Demo food after hours",
  details: { category: "Facilities", location: "Level 1" },
  isOwn: true,
});
const guideShared = onCallEntryFixture({
  section: "logistics",
  title: "Demo payslips and pay queries",
  details: { category: "Pay" },
  isOwn: false,
  isPersonal: false,
});
const workforceContact = onCallEntryFixture({
  section: "contacts",
  title: "Demo medical workforce unit",
  details: { kind: "role-explainer", role: "Medical workforce" },
  isOwn: true,
});

const entryState = vi.hoisted(() => ({
  entries: [] as OnCallEntry[],
  loading: false,
  isOffline: false,
  loadError: null as "offline" | "failed" | null,
  signedOut: false,
  demoMode: false,
  cachedAt: null as string | null,
  retry: vi.fn(),
}));

vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => entryState,
  cacheOnCallEntries: vi.fn(),
}));

beforeEach(() => {
  Object.assign(entryState, {
    entries: [loginOwn, onSiteOwn, guideShared, workforceContact],
    loading: false,
    isOffline: false,
    loadError: null,
    signedOut: false,
    demoMode: false,
    cachedAt: null,
  });
  routerReplace.mockClear();
  window.history.replaceState(null, "", "/admin/help");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = new Date("2026-09-26T05:00:00Z"); // a Saturday: always "after hours" in Perth

describe("AdminHelpPage", () => {
  it("puts every crisis line at the top, with 000 the only emergency-tone number", () => {
    render(<AdminHelpPage now={NOW} />);
    const crisis = screen.getByTestId("admin-help-crisis");
    for (const contact of WA_CRISIS_CONTACTS) {
      expect(within(crisis).getByText(contact.name)).toBeTruthy();
      const call = within(crisis).getByTestId(`admin-help-crisis-${contact.id}-call`);
      expect(call.getAttribute("href")).toBe(`tel:${contact.telephoneUri}`);
    }
    const emergencyDots = crisis.querySelectorAll('[data-testid$="-emergency-dot"]');
    expect(emergencyDots).toHaveLength(1);
    expect(within(crisis).getAllByText(/^Updated [A-Z][a-z]{2} \d{4}$/).length).toBeGreaterThan(0);
  });

  it("puts the crisis lines ahead of the Find in Help box and Add your own (M4)", () => {
    render(<AdminHelpPage now={NOW} />);
    const crisis = screen.getByTestId("admin-help-crisis");
    for (const later of [screen.getByTestId("admin-help-filter"), screen.getByTestId("admin-help-add")]) {
      expect(crisis.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("shows a skeleton, not 'Nothing here yet', in a section still loading (M2)", () => {
    Object.assign(entryState, { loading: true, entries: [] });
    render(<AdminHelpPage now={NOW} />);
    expect(screen.getByTestId("admin-help-guides-loading")).toBeTruthy();
    expect(screen.queryByText(/^Nothing here yet/)).toBeNull();
    expect(screen.getByTestId("admin-help-crisis")).toBeTruthy();
  });

  it("files own and shared rows into On site and Guides, each with its entry anchor", () => {
    render(<AdminHelpPage now={NOW} />);
    const onSite = screen.getByRole("region", { name: "On site" });
    // The title shows twice in On site now: its glance tile and its full row.
    expect(within(onSite).getByTestId("admin-help-on-site-list")).toHaveTextContent(onSiteOwn.title);
    expect(document.getElementById(`on-call-entry-${onSiteOwn.id}`)).not.toBeNull();

    const guides = screen.getByRole("region", { name: "Guides" });
    expect(within(guides).getByText(guideShared.title)).toBeTruthy();
    expect(within(guides).getByText(/^Shared by another doctor · /)).toBeTruthy();

    const contacts = screen.getByRole("region", { name: "Contacts" });
    expect(within(contacts).getByText(workforceContact.title)).toBeTruthy();
  });

  it("shows the after-hours line on On site on a weekend", () => {
    render(<AdminHelpPage now={NOW} />);
    expect(screen.getByTestId("admin-help-on-site-after-hours")).toBeTruthy();
  });

  it("filters with everyday words in its own box, never the main search, and never hides the crisis lines", () => {
    render(<AdminHelpPage now={NOW} />);
    const filter = screen.getByLabelText("Find in Help");
    expect(screen.getByTestId("admin-help-filter")).toContainElement(filter);
    expect(screen.queryByRole("button", { name: /voice|microphone|dictate/i })).toBeNull();

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fireEvent.change(filter, { target: { value: "hungry" } });
    expect(within(screen.getByTestId("admin-help-on-site-list")).getByText("Demo food after hours")).toBeTruthy();
    expect(screen.queryByText("Demo payslips and pay queries")).toBeNull();
    expect(screen.getByTestId("admin-help-crisis")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Work-mode redesign, owner request 6 Oct 2026: the search says how many rows it found, which
  // everyday words it also looked for, and says plainly when nothing but the crisis lines is left.
  it("says how many rows the search found, what else it looked for, and when nothing matched", () => {
    render(<AdminHelpPage now={NOW} />);
    const filter = screen.getByLabelText("Find in Help");
    fireEvent.change(filter, { target: { value: "hungry" } });
    expect(screen.getByTestId("admin-help-search-result")).toHaveTextContent("1 result");
    expect(screen.getByTestId("admin-help-also-matched")).toHaveTextContent(
      "Also looking for food, cafeteria, vending, meal, dinner and eat",
    );
    fireEvent.change(filter, { target: { value: "zebra" } });
    expect(screen.getByTestId("admin-help-search-result")).toHaveTextContent("0 results");
    expect(screen.getByTestId("admin-help-no-match")).toHaveTextContent("Crisis lines always show.");
    expect(screen.getByTestId("admin-help-crisis")).toBeTruthy();
  });

  it("refuses Add your own and Edit in demo mode, and says only the crisis numbers are real", () => {
    Object.assign(entryState, { demoMode: true });
    render(<AdminHelpPage now={NOW} />);
    expect(screen.queryByTestId("admin-help-add")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.getByTestId("admin-help-demo-note")).toHaveTextContent(
      "Crisis numbers are real. Other numbers are examples.",
    );
  });

  it("forwards an old login-row anchor to New job", () => {
    window.history.replaceState(null, "", `/admin/help#on-call-entry-${loginOwn.id}`);
    render(<AdminHelpPage now={NOW} />);
    expect(routerReplace).toHaveBeenCalledWith(`/admin/new-job#on-call-entry-${loginOwn.id}`);
  });

  it("offers Edit on the reader's own rows only, and an Add that is not the dark primary", () => {
    render(<AdminHelpPage now={NOW} />);
    expect(
      within(screen.getByRole("region", { name: "Guides" })).queryByRole("button", {
        name: `Edit ${guideShared.title}`,
      }),
    ).toBeNull();
    const onSite = screen.getByRole("region", { name: "On site" });
    expect(within(onSite).getByRole("button", { name: `Edit ${onSiteOwn.title}` })).toBeTruthy();
    expect(screen.getByTestId("admin-help-add").className).not.toContain("--command");
  });

  it("hides pinned numbers resolved from cached rows when entries failed to load", () => {
    window.localStorage.setItem(adminPinsStorageKey, JSON.stringify([onSiteOwn.id]));
    try {
      const view = render(<AdminHelpPage now={NOW} />);
      expect(screen.getByTestId("admin-help-pinned")).toHaveTextContent(onSiteOwn.title);
      view.unmount();
      Object.assign(entryState, { isOffline: true, loadError: "offline" });
      render(<AdminHelpPage now={NOW} />);
      expect(screen.getByTestId("admin-help-load-failed")).toBeTruthy();
      expect(screen.queryByTestId("admin-help-pinned")).toBeNull();
    } finally {
      window.localStorage.removeItem(adminPinsStorageKey);
    }
  });

  it("shows the load-failed state, not empty tabs, when entries failed to load", () => {
    Object.assign(entryState, { isOffline: true, loadError: "offline" });
    render(<AdminHelpPage now={NOW} />);
    expect(screen.getByTestId("admin-help-load-failed")).toBeTruthy();
    expect(screen.getByTestId("admin-help-crisis")).toBeTruthy();
  });
});

describe("AdminHelpPage layout (Admin polish, lane C)", () => {
  it("shows the same compact visible page title as Renewals", () => {
    render(<AdminHelpPage now={NOW} />);
    const heading = screen.getByRole("heading", { level: 1, name: "Help" });
    expect(heading.className).not.toContain("sr-only");
    expect(heading.className).toContain("text-2xl");
  });

  it("keeps every crisis line's words, in order, with the hours, caveat and month beneath a named 48px call link", () => {
    render(<AdminHelpPage now={NOW} />);
    const crisis = screen.getByTestId("admin-help-crisis");
    const rows = within(crisis).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual(
      WA_CRISIS_CONTACTS.map((contact) => `admin-help-crisis-${contact.id}`),
    );
    for (const contact of WA_CRISIS_CONTACTS) {
      const row = within(crisis).getByTestId(`admin-help-crisis-${contact.id}`);
      expect(row.textContent).toContain(contact.name);
      expect(row.textContent).toContain(contact.availability);
      if (contact.caveat) expect(within(row).getByText(contact.caveat)).toBeTruthy();
      const call = within(row).getByTestId(`admin-help-crisis-${contact.id}-call`);
      expect(call.getAttribute("aria-label")).toMatch(new RegExp(`^Call ${contact.name.replace(/[()]/g, "\\$&")}, `));
      expect(call.className).toContain("min-h-12");
      expect(call.className).toContain("min-w-12");
    }
  });

  it("puts a guide's More info link on its provenance line, keeping a 48px tap height", () => {
    const linked = onCallEntryFixture({
      section: "logistics",
      title: "Demo leave forms",
      details: { category: "Pay", url: "https://example.org/leave" },
      isOwn: true,
    });
    Object.assign(entryState, { entries: [linked] });
    render(<AdminHelpPage now={NOW} />);
    const link = screen.getByRole("link", { name: /More info/ });
    expect(link.parentElement?.textContent).toMatch(/^Yours · No date recorded·More info/);
    expect(link.className).toContain("min-h-tap");
  });

  it("shows Support's empty state as a quiet panel with the existing explanation, inventing no service", () => {
    render(<AdminHelpPage now={NOW} />);
    const empty = within(screen.getByRole("region", { name: "Support" })).getByTestId("admin-help-support-empty");
    expect(empty).toHaveTextContent("Nothing here yet");
    expect(empty).toHaveTextContent(
      "Crisis lines are above. Statewide support services will appear here, each with a link to its source.",
    );
  });

  it("shows On site at a glance: one tile per On site row, jumping to the full row, with a call link only for a number", () => {
    const switchboard = onCallEntryFixture({
      section: "logistics",
      title: "Demo switchboard",
      details: { category: "Facilities", phone: "(08) 9000 0099" },
      isOwn: true,
    });
    Object.assign(entryState, { entries: [onSiteOwn, switchboard, guideShared] });
    render(<AdminHelpPage now={NOW} />);
    const glance = screen.getByTestId("admin-help-on-site-glance");
    const tiles = within(glance).getAllByRole("listitem");
    expect(tiles).toHaveLength(2);

    const foodTile = within(glance).getByTestId(`admin-help-glance-entry-${onSiteOwn.id}`);
    expect(within(foodTile).getByRole("link").getAttribute("href")).toBe(`#on-call-entry-${onSiteOwn.id}`);
    expect(within(foodTile).queryByRole("link", { name: /^Call / })).toBeNull();

    const switchboardTile = within(glance).getByTestId(`admin-help-glance-entry-${switchboard.id}`);
    expect(switchboardTile).toHaveTextContent("9000 0099");
    const call = within(switchboardTile).getByRole("link", { name: /^Call Demo switchboard/ });
    expect(call.getAttribute("href")).toBe("tel:0890000099");
    expect(document.getElementById(`on-call-entry-${switchboard.id}`)).not.toBeNull();
    // The glance sits above the full list, inside On site.
    const onSite = screen.getByRole("region", { name: "On site" });
    expect(onSite).toContainElement(glance);
    expect(
      glance.compareDocumentPosition(screen.getByTestId("admin-help-on-site-list")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("draws no glance grid when there are no On site rows", () => {
    Object.assign(entryState, { entries: [guideShared] });
    render(<AdminHelpPage now={NOW} />);
    expect(screen.queryByTestId("admin-help-on-site-glance")).toBeNull();
  });
});
