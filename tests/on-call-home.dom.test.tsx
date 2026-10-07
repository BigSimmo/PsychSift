/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import { type OnCallEntry } from "@/lib/on-call/entry-model";
import { readyHandbook } from "./helpers/on-call-handbook-fixtures";

/**
 * A Perth wall-clock instant, with the same arguments as `new Date(y, m, d, h)`
 * (month from 0). Working hours and "today" are read in the work time zone
 * (Perth by default), never the device's, so these tests no longer depend on
 * the zone the test runner happens to be in.
 */
const perthWall = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
  new Date(Date.UTC(year, month, day, hour - 8, minute, second));

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: true, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
}));

// The home asks the auth provider directly whether there is a session, because
// the entries API's `signedOut` flag cannot answer when its own request failed.
const authState = vi.hoisted(() => ({ status: "loading" as string }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => authState }));

// The Teaching page (the education view), where "Coming up" now lives, needs
// the section page's own collaborators stubbed, as its wiring test does.
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: () => null,
}));
vi.mock("@/lib/on-call/linked-documents", () => ({
  useOnCallLinkedDocuments: () => ({}),
  useOnCallLinkedDocumentsState: () => ({ documents: {}, loading: false }),
}));

// Now reads the hospital handbook and the roster. Neither is this file's
// subject, so both are a signed-in reader whose hospital has recorded nothing.
const handbook = vi.hoisted(() => ({ state: null as unknown as HospitalHandbookState }));
vi.mock("@/components/on-call/use-hospital-handbook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/on-call/use-hospital-handbook")>()),
  useHospitalHandbook: () => handbook.state,
}));
vi.mock("@/components/roster/use-roster-shifts", () => ({
  useRosterShifts: () => ({ status: "ready", shifts: [], latestImport: null, demoMode: false }),
}));

const storeState = vi.hoisted(() => ({
  entries: [] as OnCallEntry[],
  loading: false,
  isOffline: false,
  loadError: null as "offline" | "failed" | null,
  retry: vi.fn(),
  signedOut: false,
  demoMode: false,
  cachedAt: null as string | null,
}));

vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => storeState,
  cacheOnCallEntries: vi.fn(),
}));

// The "Right now, from your roster" block reads the team roster. Signed out by default, so it stays off Now.
type RosterReadState = {
  status: string;
  data: unknown;
  message: string | null;
  readAt: Date | null;
  reload: () => void;
};
const rosterReads = vi.hoisted(() => ({
  teams: { status: "signed-out", data: null, message: null, readAt: null, reload: () => undefined } as RosterReadState,
  overview: {
    status: "signed-out",
    data: null,
    message: null,
    readAt: null,
    reload: () => undefined,
  } as RosterReadState,
  assignments: {
    status: "signed-out",
    data: null,
    message: null,
    readAt: null,
    reload: () => undefined,
  } as RosterReadState,
}));
vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => rosterReads.teams,
  useRosterRead: (_serviceId: string | null, what: "overview" | "assignments") =>
    what === "overview" ? rosterReads.overview : rosterReads.assignments,
}));

const { OnCallHome } = await import("@/components/on-call/on-call-home");
const { OnCallSectionPage } = await import("@/components/on-call/on-call-section-page");
const { modeSecondaryNavigationRegistry } = await import("@/lib/mode-secondary-navigation");

const VERIFIED = new Date().toISOString();

/** A contact with a daytime and an after-hours number (synthetic 9000 00xx placeholders). */
function dualLineContact(): OnCallEntry {
  return {
    ...contact("bed-manager", "Bed manager", ["call-first"], "9000 0011"),
    details: { role: "Bed manager", phone: "9000 0011", afterHoursPhone: "9000 0012" },
  } as unknown as OnCallEntry;
}

/** The call link on a Your usual tile. */
function usualCallHref(slug: string): string | null {
  const tile = screen.getByTestId(`on-call-now-usual-${slug}`);
  return within(tile).getByRole("link").getAttribute("href");
}

function recurringSession(): OnCallEntry {
  return {
    id: "journal-club",
    slug: "journal-club",
    section: "education",
    title: "Journal club",
    subtitle: null,
    body: null,
    // Anchored months in the past on purpose: before recurrence, this block went
    // blank the afternoon the stored date passed and stayed blank until someone
    // edited the entry by hand.
    details: {
      nextOccurrence: "Thursday 1pm",
      nextOccurrenceDate: "2026-01-08",
      recurrenceRule: { frequency: "weekly" },
      presenter: "Registrar",
      topics: [],
    },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: VERIFIED,
  } as unknown as OnCallEntry;
}

function staleContact(slug: string, title: string): OnCallEntry {
  return { ...contact(slug, title, [], "9000 0099"), lastVerifiedAt: null } as unknown as OnCallEntry;
}

function contact(slug: string, title: string, tags: string[], phone: string): OnCallEntry {
  return {
    id: slug,
    slug,
    section: "contacts",
    title,
    subtitle: null,
    body: null,
    details: { role: title, phone },
    linkedDocumentIds: [],
    tags,
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: VERIFIED,
  } as unknown as OnCallEntry;
}

beforeEach(() => {
  window.localStorage.clear();
  authState.status = "loading";
  handbook.state = readyHandbook([]);
  storeState.entries = [];
  storeState.loading = false;
  storeState.isOffline = false;
  storeState.loadError = null;
  storeState.signedOut = false;
  storeState.demoMode = false;
});

afterEach(cleanup);

describe("On Call home layout", () => {
  it("mounts the Right now block from the team roster, with a link to every role", async () => {
    const at = Date.now();
    const ready = (data: unknown): RosterReadState => ({
      status: "ready",
      data,
      message: null,
      readAt: new Date(at),
      reload: () => undefined,
    });
    rosterReads.teams = ready({
      teams: [{ serviceId: "10000000-0000-4000-8000-00000000000a", name: "Ward 4", enabled: true, role: "member" }],
      actorId: null,
    });
    rosterReads.overview = ready({ latestPublication: null, managers: [] });
    rosterReads.assignments = ready({
      assignments: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          userId: "00000000-0000-4000-8000-100000000001",
          name: "Dr Tran Nguyen",
          grade: "registrar",
          siteId: null,
          siteName: null,
          startsAt: new Date(at - 60 * 60_000).toISOString(),
          endsAt: new Date(at + 60 * 60_000).toISOString(),
          shiftCode: "D",
          kind: "day",
        },
      ],
    });
    try {
      render(<OnCallHome />);
      const block = await screen.findByTestId("on-call-roster-right-now");
      expect(block).toHaveTextContent("Right now, from your roster");
      expect(within(block).getByRole("link", { name: "All roles" })).toHaveAttribute("href", "/on-call/whos-on/roster");
    } finally {
      const signedOut: RosterReadState = {
        status: "signed-out",
        data: null,
        message: null,
        readAt: null,
        reload: () => undefined,
      };
      rosterReads.teams = signedOut;
      rosterReads.overview = signedOut;
      rosterReads.assignments = signedOut;
    }
  });

  it("leaves the roster block off Now when there is no team roster to read", async () => {
    render(<OnCallHome />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("on-call-roster-right-now")).toBeNull();
  });

  it("puts Your usual above the footer group, because last shift predicts this shift", () => {
    storeState.entries = [contact("reg", "After-hours registrar", ["call-first"], "9000 0030")];

    render(<OnCallHome />);

    const usual = screen.getByTestId("on-call-home-recent");
    const footer = screen.getByTestId("on-call-now-footer");
    // Node.DOCUMENT_POSITION_FOLLOWING === 4: `footer` comes after `usual`.
    expect(usual.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps ward chips off Now; wards live on Find (#8RWKA0 moves with them)", () => {
    // Lane B's Find test carries the no-truncation check for ward rows.
    storeState.entries = [contact("demo-emergency", "Demo Emergency Department", ["ward"], "9000 0010")];

    const { container } = render(<OnCallHome />);

    expect(screen.queryByTestId("on-call-home-wards")).toBeNull();
    expect(container.querySelector('[data-testid^="on-call-home-ward-"]')).toBeNull();
  });

  it("gives an empty hub a first run block rather than a grid of zeroes", () => {
    storeState.entries = [];

    render(<OnCallHome />);

    expect(screen.getByTestId("on-call-home-first-run")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Contacts/i })).toBeInTheDocument();
  });

  it("does not show the first run block while the hub is still loading", () => {
    storeState.entries = [];
    storeState.loading = true;

    render(<OnCallHome />);

    expect(screen.queryByTestId("on-call-home-first-run")).toBeNull();
  });

  // Regression, 2026-09-24: "Nothing pinned to call first" showed during the
  // first load, before any entry had arrived to be pinned or not. Your usual
  // inherits the rule: while the entries load it holds its space instead.
  it("does not claim Your usual is empty while the hub is still loading", () => {
    storeState.loading = true;
    render(<OnCallHome />);
    expect(screen.queryByTestId("on-call-now-usual-empty")).toBeNull();
    expect(screen.getByTestId("on-call-now-usual-outlines")).toBeInTheDocument();
  });

  // Regression, 2026-09-24: a failed fetch with nothing saved on the device
  // showed "Your On Call hub is empty", as if the reader's numbers were gone.
  it("says the entries could not be loaded, with a retry, instead of calling the hub empty", () => {
    storeState.entries = [];
    storeState.isOffline = true;
    storeState.loadError = "failed";
    render(<OnCallHome />);
    const failed = screen.getByTestId("on-call-load-failed");
    expect(failed).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByTestId("on-call-home-first-run")).toBeNull();
    screen.getByRole("button", { name: /try again/i }).click();
    expect(storeState.retry).toHaveBeenCalled();
  });

  it("tells a new reader how to start Your usual", () => {
    storeState.entries = [contact("switch", "Switchboard", [], "9000 0000")];

    render(<OnCallHome />);

    const empty = screen.getByTestId("on-call-now-usual-empty");
    // The call-first step is a tick box, so the hint names it, not the tag.
    expect(empty).toHaveTextContent('tick "Call first on the home"');
    expect(empty).not.toHaveTextContent('"call-first"');
  });

  it("hides that hint once an entry is ticked Call first", () => {
    storeState.entries = [contact("reg", "After-hours registrar", ["call-first"], "9000 0030")];

    render(<OnCallHome />);

    expect(screen.getByTestId("on-call-now-usual-reg")).toHaveTextContent("After-hours registrar");
    expect(screen.queryByTestId("on-call-now-usual-empty")).toBeNull();
  });

  it("keeps the pocket card on the page and in the pages sheet", () => {
    storeState.entries = [contact("reg", "After-hours registrar", ["call-first"], "9000 0030")];

    const { container } = render(<OnCallHome />);

    expect(container.querySelector('a[href="/on-call/card"]')).not.toBeNull();
    expect(modeSecondaryNavigationRegistry["on-call"].some((entry) => entry.href === "/on-call/card")).toBe(true);
  });

  it("carries no search box: Now is for ringing, and Find searches", () => {
    // Amendment r6, Task 2: "no search box on Now". The box searched only this
    // mode's own entries; Find now holds that job.
    storeState.entries = [contact("reg", "After-hours registrar", ["call-first"], "9000 0030")];

    render(<OnCallHome />);

    expect(screen.queryByTestId("on-call-search")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("dials the daytime number from Your usual during the working day", () => {
    storeState.entries = [dualLineContact()];

    // A Wednesday at 09:00 local.
    render(<OnCallHome now={perthWall(2026, 8, 16, 9, 0, 0)} />);

    expect(usualCallHref("bed-manager")).toMatch(/90000011$/);
  });

  it("dials the after-hours number at 22:00, which is when this page is read", async () => {
    storeState.entries = [dualLineContact()];

    // The same Wednesday at 22:00 local.
    render(<OnCallHome now={perthWall(2026, 8, 16, 22, 0, 0)} />);

    expect(usualCallHref("bed-manager")).toMatch(/90000012$/);
    // The round tile prints no number, so it can never show one under the
    // wrong label: the call link names the digits it actually rings.
    const tile = screen.getByTestId("on-call-now-usual-bed-manager");
    expect(within(tile).getByRole("link")).toHaveAccessibleName("Call Bed manager, 9 0 0 0, 0 0 1 2");
    expect(tile).not.toHaveTextContent(/9000 0011/);
    // Its dialling details show the same after-hours number.
    await userEvent.click(within(tile).getByRole("button", { name: /Dialling details/ }));
    expect(screen.getByTestId("on-call-now-usual-bed-manager-sheet-number")).toHaveTextContent("9000 0012");
  });

  it("rolls a weekly session forward on the Teaching page rather than going blank once its date passes", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // Months after the stored anchor of 8 January.
      vi.setSystemTime(perthWall(2026, 8, 16, 9, 0, 0));
      storeState.entries = [recurringSession()];

      render(<OnCallSectionPage view="education" />);

      const strip = within(screen.getByTestId("on-call-home-upcoming")).getByTestId("on-call-home-teaching-strip");
      expect(strip).toHaveTextContent("Journal club");
      // A date, never a countdown: it has to be checkable against a roster.
      expect(strip).toHaveTextContent(/Sep/);
      expect(screen.getByTestId("on-call-home-teaching-next-badge")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing about overdue entries, which are the developer hub's business", () => {
    // Removed on the owner's instruction 2026-09-16: a reader opening this page
    // is mid-shift and looking for a number, and overdue entries are a
    // maintenance fact. They are reported at
    // /mockups/development/on-call-freshness instead. This test exists so a
    // later "helpful" restoration goes red rather than shipping.
    storeState.entries = [staleContact("ward-4b", "Ward 4B")];

    render(<OnCallHome />);

    expect(screen.queryByTestId("on-call-home-stale")).toBeNull();
    expect(screen.queryByText(/needs? checking/i)).toBeNull();
  });

  it("moves to the after-hours number when 17:00 passes on a page nobody has touched", () => {
    // Codex P1 on PR #2806. React re-renders on state changes, and a phone lying
    // on a desk produces none, so a home opened at 16:55 went on offering the
    // daytime desk line all night. That is the wrong-number failure this whole
    // change exists to prevent, arriving by a different route.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(perthWall(2026, 8, 16, 16, 55, 0));
      storeState.entries = [dualLineContact()];

      render(<OnCallHome />);
      expect(usualCallHref("bed-manager")).toMatch(/90000011$/);

      // Nothing is clicked, scrolled or typed. Only the clock moves. The page wakes at
      // least once a minute (cover and ladder windows), so step minute by minute and let
      // each wake re-render and schedule the next, as it would on a phone left open.
      for (let minute = 0; minute < 6; minute += 1) {
        act(() => {
          vi.advanceTimersByTime(60 * 1000);
        });
      }

      expect(usualCallHref("bed-manager")).toMatch(/90000012$/);
      const tile = screen.getByTestId("on-call-now-usual-bed-manager");
      expect(within(tile).getByRole("link")).toHaveAccessibleName("Call Bed manager, 9 0 0 0, 0 0 1 2");
      expect(tile).not.toHaveTextContent(/9000 0011/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds a clock a caller pinned, so a test or a print view is not moved under it", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(perthWall(2026, 8, 16, 16, 55, 0));
      storeState.entries = [dualLineContact()];

      render(<OnCallHome now={perthWall(2026, 8, 16, 9, 0, 0)} />);
      act(() => {
        vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      });

      expect(usualCallHref("bed-manager")).toMatch(/90000011$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts a dated teaching card inside Coming up on the Teaching page, as the browser board test looks for", () => {
    // A standing double for `tests/ui-on-call-boards.spec.ts` "dates the next
    // teaching session with a weekday". That spec went red on PR #2806 because
    // the card's test id moved from `on-call-home-upcoming-` to
    // `on-call-home-teaching-` when the row became a strip, and nothing offline
    // covered it. Same corpus, same nesting, same weekday assertion, no browser;
    // the module now opens the Teaching page rather than the home (plan C25).
    storeState.entries = [...DEMO_ON_CALL_ENTRIES];

    render(<OnCallSectionPage view="education" />);

    const comingUp = screen.getByTestId("on-call-home-upcoming");
    const cards = comingUp.querySelectorAll('[data-testid^="on-call-home-teaching-"]');
    expect(cards.length).toBeGreaterThan(0);
    // A date a reader can check against a roster, never a countdown.
    expect(cards[0]).toHaveTextContent(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
  });
});

describe("Now's links after the My Work move and the v6 rebuild", () => {
  // On 2026-09-26 the admin pages moved off this home to My Work (`/my-work`).
  // "Check these" and "Calendar" left the tool row, and Orientation, Teaching,
  // Admin and Compliance left the tile grid. The v6 rebuild then removed the
  // tool row and the tile grid themselves: the pill's pages sheet lists every
  // page and the mode switcher reaches My Work. First night keeps its one link
  // here, in the footer group, because it is that page's only way in.

  it("keeps First night one tap away, and neither Check these nor Calendar", () => {
    storeState.entries = [...DEMO_ON_CALL_ENTRIES];
    render(<OnCallHome />);

    const footer = screen.getByTestId("on-call-now-footer");
    expect(within(footer).getByTestId("on-call-home-first-night")).toHaveAttribute("href", "/on-call/first-night");

    expect(screen.queryByTestId("on-call-home-tools")).toBeNull();
    expect(screen.queryByTestId("on-call-home-check")).toBeNull();
    expect(screen.queryByTestId("on-call-home-calendar")).toBeNull();
    expect(within(footer).queryByText("Check these")).toBeNull();
  });

  it("draws no tile grid; the pill's pages sheet lists the pages", () => {
    storeState.entries = [...DEMO_ON_CALL_ENTRIES];
    const { container } = render(<OnCallHome />);

    expect(screen.queryByTestId("on-call-home-sections")).toBeNull();
    expect(container.querySelector('[data-testid^="on-call-home-tile-"]')).toBeNull();
    const pages = modeSecondaryNavigationRegistry["on-call"].map((entry) => entry.href);
    for (const href of ["/on-call/call", "/on-call/playbook", "/on-call/refer", "/on-call/find"]) {
      expect(pages).toContain(href);
    }
  });
});

describe("the example-content module", () => {
  // `OnCallDemoContentControl` renders nothing when signed out or in demo mode,
  // so the module around it must not render either. The demo case is not
  // hypothetical: in demo mode the example corpus IS the entries, so every slug
  // carries the `demo-` prefix and the "is any example content loaded?" test is
  // true for every reader. Gated on that alone, the public demo home — and the
  // home every `ui-*.spec.ts` renders — grew an "Example content" heading with
  // nothing underneath it.
  it("is absent in demo mode, where the corpus is the content and there is nothing to remove", () => {
    storeState.entries = [...DEMO_ON_CALL_ENTRIES];
    storeState.demoMode = true;

    render(<OnCallHome />);

    expect(screen.queryByTestId("on-call-home-example-content")).toBeNull();
    expect(screen.queryByText("Example content")).toBeNull();
  });

  it("offers a signed-out reader no example-content control, because the page shows the sample itself", () => {
    // Changed 2026-10-04. Signed out, the hook now supplies an invented sample
    // from memory, so the "Preview with example content" control (which wrote
    // the corpus into this device's cache) is gone, and the account-writing
    // controls would only 401.
    storeState.entries = [];
    storeState.signedOut = true;

    render(<OnCallHome />);

    expect(screen.queryByTestId("on-call-demo-preview-start")).toBeNull();
    expect(screen.queryByTestId("on-call-demo-content-load")).toBeNull();
    expect(screen.queryByTestId("on-call-demo-content-remove")).toBeNull();
  });

  // 2026-09-26: shared entries are for signed-in users only, so the server sends
  // a signed-out reader nothing. "Your On Call hub is empty" would be a claim
  // about a hub they cannot see.
  it("tells a signed-out reader to sign in instead of calling the hub empty", () => {
    storeState.entries = [];
    storeState.signedOut = true;

    render(<OnCallHome />);

    const signedOut = screen.getByTestId("on-call-home-signed-out");
    expect(signedOut).toHaveTextContent("Sign in to see shared On Call entries");
    expect(signedOut).toHaveTextContent("Check the service before using a number.");
    expect(within(signedOut).getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByTestId("on-call-home-first-run-empty")).toBeNull();
  });

  it("is present for the signed-in owner whose account actually holds the rows", async () => {
    // Guard the two tests above: if the module never rendered at all they would
    // pass on a component that had simply been deleted.
    //
    // The owner-scoped answer has to be supplied, because that is now the only
    // thing that decides this. The entries in view do not: the shared read
    // returns every non-personal row across all accounts.
    storeState.entries = [...DEMO_ON_CALL_ENTRIES];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ loaded: DEMO_ON_CALL_ENTRIES.length, total: DEMO_ON_CALL_ENTRIES.length }),
    }) as unknown as typeof fetch;

    try {
      render(<OnCallHome />);
      expect(await screen.findByTestId("on-call-home-example-content")).toBeInTheDocument();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stays absent while the owner-scoped answer is still unknown", async () => {
    // A labelled HomeModule whose only child has decided to render nothing is
    // a heading with an empty body. That shipped once already, caught before
    // push; it is pinned here because the failure mode is invisible in the
    // markup a component test usually asserts on.
    storeState.entries = [...DEMO_ON_CALL_ENTRIES];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    try {
      render(<OnCallHome />);
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      expect(screen.queryByTestId("on-call-home-example-content")).toBeNull();
      expect(screen.queryByText("Example content")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("On Call home tools after the header ellipsis left", () => {
  it("does not put a page-menu trigger in the header slot", () => {
    render(<OnCallHome now={new Date("2026-06-01T09:00:00+08:00")} />);
    expect(screen.queryByTestId("on-call-page-menu-trigger")).toBeNull();
  });

  it("keeps My shifts, Pocket card, and Calendar on the page footer", () => {
    render(<OnCallHome now={new Date("2026-06-01T09:00:00+08:00")} />);
    expect(screen.getByTestId("on-call-now-footer-shifts").getAttribute("href")).toBe("/roster");
    expect(screen.getByTestId("on-call-now-footer-card").getAttribute("href")).toBe("/on-call/card");
    // Amended for the work-mode redesign wiring audit (owner request 6 Oct 2026):
    // straight to the real page, not through the /on-call/calendar redirect.
    expect(screen.getByTestId("on-call-now-footer-calendar").getAttribute("href")).toBe("/roster/calendar");
  });
});

describe("the example-content module when the entries request fails", () => {
  it("still offers no control when the browser knows there is no session", () => {
    // The defect this exists for, found while Josh could not see the block on
    // the live site. `useOnCallEntries().signedOut` starts false and is only
    // ever set by a SUCCESSFUL response, so a request that fails — no signal, a
    // rate limit, a 500 — leaves it false for good. The page then treats an
    // anonymous reader as possibly signed in, asks the owner-scoped count
    // endpoint, gets a 401, and renders nothing: no control and no
    // explanation, on a page that is already empty.
    //
    // `AuthProvider` resolves the session locally and needs no network, and the
    // preview it unlocks writes only to this device. Either source saying
    // "signed out" is enough.
    storeState.entries = [];
    storeState.signedOut = false; // the server never got to say
    storeState.isOffline = true;
    authState.status = "signed_out";

    render(<OnCallHome />);

    expect(screen.queryByTestId("on-call-demo-preview-start")).toBeNull();
    expect(screen.queryByTestId("on-call-demo-content-load")).toBeNull();
  });

  it("treats an expired session the same way", () => {
    storeState.entries = [];
    storeState.signedOut = false;
    authState.status = "expired";

    render(<OnCallHome />);

    expect(screen.queryByTestId("on-call-demo-preview-start")).toBeNull();
  });

  it("does NOT guess while the session is still being resolved", () => {
    // An unknown session must not be answered with a guess. `loading` and
    // `error` leave the decision to the server's flag, which is what the
    // signed-in reader's Load/Remove control is keyed on — offering a preview
    // to someone who is about to turn out to be signed in would flip the
    // control out from under them a moment later.
    storeState.entries = [];
    storeState.signedOut = false;
    authState.status = "loading";

    render(<OnCallHome />);

    expect(screen.queryByTestId("on-call-demo-preview-start")).toBeNull();
  });
});
