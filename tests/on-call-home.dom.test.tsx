/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HospitalHandbookState } from "@/components/on-call/use-hospital-handbook";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import { type OnCallEntry } from "@/lib/on-call/entry-model";
import { readyHandbook } from "./helpers/on-call-handbook-fixtures";

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

// The page menu drags in the whole navigation chrome, which is covered by its
// own tests. This file is about what the home lays out, and in what order — but
// the menu is also where the home's notification list is handed off, so the
// stub records the props it was given rather than discarding them. It still
// renders nothing, so nothing else in this file changes.
const menuProps = vi.hoisted(() => ({ last: null as { notifications?: readonly { title: string }[] } | null }));
vi.mock("@/components/on-call/on-call-page-menu", () => ({
  OnCallPageMenu: (props: { notifications?: readonly { title: string }[] }) => {
    menuProps.last = props;
    return null;
  },
}));

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

  it("leaves the pocket card to the pages sheet, which lists it", () => {
    storeState.entries = [contact("reg", "After-hours registrar", ["call-first"], "9000 0030")];

    const { container } = render(<OnCallHome />);

    expect(container.querySelector('a[href="/on-call/card"]')).toBeNull();
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
    render(<OnCallHome now={new Date(2026, 8, 16, 9, 0, 0)} />);

    expect(usualCallHref("bed-manager")).toMatch(/90000011$/);
  });

  it("dials the after-hours number at 22:00, which is when this page is read", () => {
    storeState.entries = [dualLineContact()];

    // The same Wednesday at 22:00 local.
    render(<OnCallHome now={new Date(2026, 8, 16, 22, 0, 0)} />);

    expect(usualCallHref("bed-manager")).toMatch(/90000012$/);
    // Named for what it is, so the screen never shows a number under the wrong
    // label.
    expect(screen.getByTestId("on-call-now-usual-bed-manager")).toHaveTextContent(/after hours/i);
  });

  it("rolls a weekly session forward on the Teaching page rather than going blank once its date passes", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // Months after the stored anchor of 8 January.
      vi.setSystemTime(new Date(2026, 8, 16, 9, 0, 0));
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
      vi.setSystemTime(new Date(2026, 8, 16, 16, 55, 0));
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
      expect(screen.getByTestId("on-call-now-usual-bed-manager")).toHaveTextContent(/after hours/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds a clock a caller pinned, so a test or a print view is not moved under it", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 8, 16, 16, 55, 0));
      storeState.entries = [dualLineContact()];

      render(<OnCallHome now={new Date(2026, 8, 16, 9, 0, 0)} />);
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

describe("what the home raises on its own", () => {
  function complianceRow(expiresOn: string, lastVerifiedAt: string): OnCallEntry {
    return {
      id: "bls",
      slug: "bls",
      section: "logistics",
      title: "Basic life support",
      subtitle: null,
      body: null,
      details: { kind: "compliance", expiresOn },
      linkedDocumentIds: [],
      tags: [],
      isPersonal: true,
      includeOnCard: false,
      sortOrder: 0,
      lastVerifiedAt,
    } as unknown as OnCallEntry;
  }

  it("reads the page's own clock, so a pinned moment is honoured", () => {
    // The defect this exists for (Codex, 2026-09-22). The list was derived with
    // a fresh `new Date()` and memoised on `[entries]` alone. That ignored
    // `pinnedNow` outright — a caller standing at a chosen moment was answered
    // from the process clock — and it never re-ran on a page nobody is
    // touching, so the ward strip could move to the after-hours number while
    // the badge went on counting from whenever the page was opened.
    //
    // Pinned to 2025, a date recorded for 2026-01-01 has NOT passed. Derived
    // from the real clock it has, and this row would be raised.
    const pinned = new Date("2025-01-01T09:00:00+08:00");
    storeState.entries = [complianceRow("2026-01-01", "2025-01-01T00:00:00.000Z")];
    storeState.signedOut = false;

    render(<OnCallHome now={pinned} />);

    expect(menuProps.last?.notifications).toEqual([]);
  });

  it("raises a requirement whose recorded date has passed at that same moment", () => {
    // The other half: with the clock moved past the recorded date, the same
    // row IS raised. Without this, the test above would pass on a list that is
    // simply always empty.
    const pinned = new Date("2026-06-01T09:00:00+08:00");
    storeState.entries = [complianceRow("2026-01-01", "2026-05-30T00:00:00.000Z")];
    storeState.signedOut = false;

    render(<OnCallHome now={pinned} />);

    expect(menuProps.last?.notifications?.map((item) => item.title)).toEqual(["Basic life support"]);
  });

  it("leaves out a reminder type the owner snoozed, until the snooze date", () => {
    // Settings, Notifications, Reminders: compliance dates snoozed until 5 June.
    const pinned = new Date("2026-06-01T09:00:00+08:00");
    storeState.entries = [complianceRow("2026-01-01", "2026-05-30T00:00:00.000Z")];
    window.localStorage.setItem(
      "clinical-kb-preferences",
      JSON.stringify({ reminders: { types: { "compliance-dates": { snoozedUntil: "2026-06-05" } } } }),
    );
    try {
      render(<OnCallHome now={pinned} />);
      expect(menuProps.last?.notifications).toEqual([]);
      cleanup();
      render(<OnCallHome now={new Date("2026-06-05T09:00:00+08:00")} />);
      expect(menuProps.last?.notifications?.map((item) => item.title)).toEqual(["Basic life support"]);
    } finally {
      window.localStorage.removeItem("clinical-kb-preferences");
    }
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
