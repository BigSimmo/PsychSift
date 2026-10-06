/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const accountState = vi.hoisted(() => ({ isAuthenticated: true }));

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
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  // Renewals reads `?show=`, `?item=` and `?record=`; no parameters here.
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    isAuthenticated: accountState.isAuthenticated,
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
  }),
}));

const storeState = vi.hoisted(() => ({
  entries: [] as unknown[],
  loading: false,
  isOffline: false,
  signedOut: false,
  cachedAt: null as string | null,
}));

// A settled, empty hub. Without this the store starts `loading: true` and every
// section correctly renders its loading state instead of its empty one — which
// is the behaviour under test here.
vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => storeState,
  cacheOnCallEntries: vi.fn(),
}));

vi.mock("@/lib/on-call/linked-documents", () => ({
  useOnCallLinkedDocuments: () => ({}),
  useOnCallLinkedDocumentsState: () => ({ documents: {}, loading: false }),
}));

vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="on-call-account-setup-dialog-open" /> : null,
}));

import OnCallContactsRoute from "@/app/(search-app)/on-call/contacts/page";
import OnCallOrientationRoute from "@/app/(search-app)/on-call/orientation/page";
import OnCallPlaybookRoute from "@/app/(search-app)/on-call/playbook/page";
import OnCallReferralsRoute from "@/app/(search-app)/on-call/referrals/page";
import OnCallWhoIsWhoRoute from "@/app/(search-app)/on-call/who-is-who/page";
import AdminRenewalsRoute from "@/app/(search-app)/admin/renewals/page";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { ON_CALL_VIEW_TITLES, type OnCallPageView } from "@/components/on-call/on-call-section-identity";
import { ON_CALL_SECTIONS } from "@/lib/on-call/entry-model";
import { universalHeaderTrailingSlotId } from "@/lib/mode-home-composer";

type RouteCase = {
  view: OnCallPageView;
  title: string;
  Route: () => ReactElement;
};

const routes: RouteCase[] = [
  { view: "contacts", title: "Contacts", Route: OnCallContactsRoute },
  { view: "playbook", title: "Playbook", Route: OnCallPlaybookRoute },
  { view: "referrals", title: "Referrals", Route: OnCallReferralsRoute },
  { view: "orientation", title: "Orientation", Route: OnCallOrientationRoute },
  // No `education` row: its page forwards to Teaching's Week (spec §8). No `logistics`
  // row: On Call's Admin page moved to Admin > Help on 2026-09-26 (Admin update 1).
  { view: "who-is-who", title: "Who's who", Route: OnCallWhoIsWhoRoute },
  // Compliance is a view over `logistics` split on `details.kind`, exactly as
  // Who's who is a view over `contacts`. Since Admin update 1 it renders as
  // Admin > Renewals, which hosts the same view under Admin's chrome, so it is
  // still held to every check the older routes are held to.
  { view: "compliance", title: "Renewals", Route: AdminRenewalsRoute },
];

/** Admin > Renewals adds through a floating "+ Add" (Josh, 16:31Z), not the in-page button. */
function addTestId(route: RouteCase): string {
  return route.view === "compliance" ? "admin-renewals-add" : `on-call-${route.view}-add`;
}

// A contact verified today, so it sorts into an area group rather than the
// "needs checking" list and carries no verify control of its own. This fixture
// exists to test the edit affordance, not freshness.
const freshContact = {
  id: "00000000-0000-4000-8000-0000000000a1",
  section: "contacts" as const,
  slug: "switchboard",
  title: "Switchboard",
  subtitle: null,
  body: null,
  details: { role: "Switchboard operator", phone: "9999 9999", area: "Hospital" },
  linkedDocumentIds: [],
  tags: [],
  isPersonal: false,
  includeOnCard: true,
  sortOrder: 0,
  lastVerifiedAt: new Date().toISOString(),
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  // OnCallSectionPage now reads the entry store (task 11) for every section, so
  // every route render fetches. Stub it deterministically rather than letting a
  // real network attempt reach an unmocked relative URL from jsdom.
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ entries: [], signedOut: false }));
});

afterEach(() => {
  cleanup();
  accountState.isAuthenticated = true;
  storeState.entries = [];
  storeState.signedOut = false;
});

describe("on-call section routes", () => {
  it("covers every declared on-call page, in order — the five sections with a page, then the two views over one", () => {
    // Fails loudly if a section is added to the data model without a route case
    // here, rather than leaving the new section silently unguarded. Who's who and
    // Compliance are not stored sections — they are `contacts` and `logistics`
    // rows behind `details.kind` — so they are named separately rather than
    // folded into the model's list.
    // Education forwards to Teaching's Week (spec §8, tests/teaching-on-call-relocation.dom.test.tsx);
    // `logistics` redirects to Admin > Help (tests/admin-foundations.dom.test.tsx).
    expect(routes.map((route) => route.view)).toEqual([
      ...ON_CALL_SECTIONS.filter((section) => section !== "education" && section !== "logistics"),
      "who-is-who",
      "compliance",
    ]);

    // The same guard for the half of this mode the model's list cannot see. A
    // view over an existing section costs no migration, which is exactly why one
    // can be built and shipped without anything here noticing: Compliance was.
    // Every page the identity map names must appear above, section or not — except
    // "education" (forwards to Teaching's Week) and "logistics" (redirects to Admin > Help).
    const declaredViews: string[] = Object.keys(ON_CALL_VIEW_TITLES).filter(
      (view) => view !== "education" && view !== "logistics",
    );
    expect(routes.map((route) => route.view as string).sort()).toEqual(declaredViews.sort());
  });

  it("titles every route from the shared identity map, so no page invents its own name", () => {
    // Except Compliance, which Admin hosts as "Renewals" (Admin update 1).
    for (const route of routes) {
      expect(route.title).toBe(route.view === "compliance" ? "Renewals" : ON_CALL_VIEW_TITLES[route.view]);
    }
  });

  it.each(routes.map((route) => [route.title, route] as const))(
    "%s renders exactly one first-level heading naming the section",
    (_title, route) => {
      render(<route.Route />);
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 1, name: route.title })).toBeInTheDocument();
    },
  );

  it.each(routes.map((route) => [route.title, route] as const))(
    "%s renders an anchor, with the shared in-page scroll margin, for every declared section",
    (_title, route) => {
      const { container } = render(<route.Route />);

      if (route.view === "compliance") {
        // Renewals (Admin update 1) has no in-page nav rail and no anchor: it
        // is a plain tabbed page, not a scroll-and-jump section list. Its own
        // section structure is the Checklist/Personal radio switch, with the
        // Checklist tab's requirements summary as the equivalent landmark.
        expect(screen.getByRole("radiogroup", { name: "Renewals" })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Checklist" })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Personal" })).toBeInTheDocument();
        expect(screen.getByTestId("admin-renewals-summary")).toBeInTheDocument();
        return;
      }

      // The entries list is the only anchor every view declares now. There was
      // an "overview" one until the hero above the list was removed: an
      // eyebrow, a display-size title and a paragraph, all under a sticky
      // header already naming the page. Nothing jumped to it — the header's
      // list is built from the page's GROUPS — so it anchored a block whose
      // only remaining job was to push the first contact below the fold.
      for (const anchorId of [`on-call-${route.view}-entries`]) {
        const anchor = container.querySelector(`#${CSS.escape(anchorId)}`);
        expect(anchor, `${route.title}: no element renders an anchor for "${anchorId}"`).not.toBeNull();
        expect(anchor?.className, `${route.title}: "${anchorId}" has no in-page scroll margin`).toContain(inPageAnchor);
      }
    },
  );

  it.each(routes.filter((route) => route.view !== "contacts").map((route) => [route.title, route] as const))(
    "%s shows its own empty state and a way to add to it",
    (_title, route) => {
      accountState.isAuthenticated = true;
      render(<route.Route />);

      // The five stored sections here once shared a placeholder "search the
      // hub" empty state, because only Contacts was wired to the store — so the
      // pages could not show entries and offered no way to create one. Each now
      // renders its own section component and its own add control, and the two
      // views over a section (Who's who, Compliance) are held to the same bar.
      if (route.view === "compliance") {
        // Renewals' Checklist tab always lists the full statewide requirements
        // catalogue, so it is never literally empty; the Personal tab is the
        // page's real "nothing recorded yet" state, with its own add action.
        fireEvent.click(screen.getByRole("radio", { name: "Personal" }));
        const empty = screen.getByTestId("admin-renewals-personal-empty");
        expect(empty).toBeTruthy();
        expect(within(empty).getByRole("button", { name: "Add a renewal" })).toBeInTheDocument();
        // One add control per page: Renewals' floating button replaces the in-page one.
        expect(screen.getAllByTestId(addTestId(route))).toHaveLength(1);
        expect(screen.queryByTestId("admin-renewals-signed-out")).toBeNull();
        return;
      }

      expect(screen.getByTestId(`on-call-${route.view}-empty`)).toBeTruthy();
      expect(screen.getByTestId(addTestId(route))).toBeTruthy();
      expect(screen.queryByTestId(`on-call-${route.view}-signed-out`)).toBeNull();
    },
  );

  // Contacts is wired to the real entry store and editor (task 11): a signed-in
  // reader with no entries yet gets the section's own "add one" action, rather
  // than the other five sections' placeholder "search the hub" empty state.
  it("Contacts offers 'Add contact' for a signed-in reader with no entries yet", () => {
    accountState.isAuthenticated = true;
    render(<OnCallContactsRoute />);

    const empty = screen.getByTestId("on-call-contacts-empty");
    expect(within(empty).getByRole("button", { name: "Add contact" })).toBeInTheDocument();
    expect(within(empty).queryByRole("link", { name: "Search On Call" })).toBeNull();
    expect(screen.queryByTestId("on-call-contacts-signed-out")).toBeNull();
  });

  // Signed out means signed out again. The 2026-09-04 owner decision served
  // every shared entry to anonymous callers and this page dropped its sign-in
  // state to match; the 2026-09-26 decision reverses the anonymous read, so the
  // server sends a signed-out reader nothing. Drawn as the section's own empty
  // state, that read as a wiped hub, so the page says why and offers sign-in.
  it.each(routes.map((route) => [route.title, route] as const))(
    "%s tells a signed-out reader to sign in, rather than showing an empty section",
    (_title, route) => {
      accountState.isAuthenticated = false;
      storeState.signedOut = true;
      render(<route.Route />);

      // The generic section name is still shown, as it always was.
      expect(screen.getByRole("heading", { level: 1, name: route.title })).toBeInTheDocument();

      if (route.view === "compliance") {
        // Renewals words its own signed-out state for its own content, rather
        // than inheriting On Call's "your hospital's On Call numbers" wording.
        const signedOut = screen.getByTestId("admin-renewals-signed-out");
        expect(signedOut).toHaveTextContent("Sign in to see your renewals");
        expect(screen.queryByTestId("admin-renewals-summary")).toBeNull();
        expect(screen.queryByTestId(addTestId(route))).toBeNull();
        expect(screen.queryByTestId("on-call-account-setup-dialog-open")).toBeNull();
        fireEvent.click(within(signedOut).getByRole("button", { name: "Sign in" }));
        expect(screen.getByTestId("on-call-account-setup-dialog-open")).toBeInTheDocument();
        return;
      }

      const signedOut = screen.getByTestId(`on-call-${route.view}-signed-out`);
      expect(signedOut).toHaveTextContent("Sign in to see shared On Call entries");
      expect(screen.queryByTestId(`on-call-${route.view}-empty`)).toBeNull();
      expect(screen.queryByTestId(addTestId(route))).toBeNull();

      // The button is the existing account dialog, not a dead end.
      expect(screen.queryByTestId("on-call-account-setup-dialog-open")).toBeNull();
      fireEvent.click(within(signedOut).getByRole("button", { name: "Sign in" }));
      expect(screen.getByTestId("on-call-account-setup-dialog-open")).toBeInTheDocument();
    },
  );

  // The on-device example preview is the one thing a signed-out reader can
  // have entries from, and it must still render as a list.
  it("Contacts shows an entry to a signed-out reader with no edit control on it", () => {
    accountState.isAuthenticated = false;
    storeState.signedOut = true;
    storeState.entries = [freshContact];
    render(<OnCallContactsRoute />);

    expect(screen.getByTestId("on-call-contact-row-switchboard")).toBeInTheDocument();
    expect(screen.queryByTestId("on-call-contact-edit-switchboard")).toBeNull();
  });

  // The paired assertion. Removing the wall must not remove editing for the
  // owner, which is what an over-eager deletion of the gate would do.
  it("Contacts offers the edit control on that same entry once signed in", () => {
    accountState.isAuthenticated = true;
    storeState.entries = [freshContact];
    render(<OnCallContactsRoute />);

    expect(screen.getByTestId("on-call-contact-row-switchboard")).toBeInTheDocument();
    expect(screen.getByTestId("on-call-contact-edit-switchboard")).toBeInTheDocument();
  });
});

describe("Admin > Renewals header menu", () => {
  it("is named Renewals, and leaves adding to the one floating control", () => {
    // The menu's trigger is portalled into the universal header's trailing slot,
    // which renders nothing when the host element is absent.
    const slot = document.createElement("div");
    slot.id = universalHeaderTrailingSlotId;
    document.body.append(slot);
    try {
      render(<AdminRenewalsRoute />);
      // Renewals renders no On Call-style ellipsis page menu in the universal
      // header's trailing slot. Its two occasional page-level actions sit in
      // the page's own "More actions" menu beside the title (owner-approved
      // Admin redesign, 2026-10-01), and adding is left entirely to the one
      // floating "+ Add" control (Josh, 16:31Z).
      expect(screen.queryByTestId("on-call-page-menu-trigger")).toBeNull();
      expect(screen.getByRole("heading", { level: 1, name: "Renewals" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      expect(screen.getByRole("button", { name: "Copy for workforce" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add all to my calendar" })).toBeInTheDocument();
      expect(screen.queryByTestId("on-call-page-menu-add")).toBeNull();
      expect(screen.getAllByTestId("admin-renewals-add")).toHaveLength(1);
    } finally {
      slot.remove();
    }
  });
});
