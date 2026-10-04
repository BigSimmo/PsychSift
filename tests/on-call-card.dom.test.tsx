/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OnCallCard } from "@/components/on-call/on-call-card";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call/card",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: true, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
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
}));

// The sign-in dialog reaches for the real AuthProvider, which this file has no
// business standing up: the subject here is which entries reach paper.
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: () => null,
}));

const NOW = new Date("2026-09-04T00:00:00.000Z");
// Twelve months minus a day: still inside the review interval.
const FRESH = new Date("2025-09-05T00:00:00.000Z").toISOString();
// Exactly twelve months. The boundary counts as overdue — a year-old number is
// not "still fine today" — so this entry must not reach the card.
const EXACTLY_TWELVE_MONTHS = new Date("2025-09-04T00:00:00.000Z").toISOString();

function entry(overrides: Partial<OnCallEntry> & { id: string; slug: string; title: string }): OnCallEntry {
  return {
    section: "contacts",
    subtitle: null,
    body: null,
    details: { phone: "9111 2222" },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: true,
    sortOrder: 0,
    lastVerifiedAt: FRESH,
    ...overrides,
  };
}

function renderCard(entries: OnCallEntry[], overrides: Partial<typeof storeState> = {}) {
  Object.assign(storeState, { entries, loading: false, isOffline: false, signedOut: false, cachedAt: null }, overrides);
  return render(<OnCallCard now={NOW} />);
}

afterEach(() => {
  cleanup();
  Object.assign(storeState, { entries: [], loading: false, isOffline: false, signedOut: false, cachedAt: null });
});

describe("the printed essentials card", () => {
  it("prints a fresh flagged entry", () => {
    renderCard([entry({ id: "a", slug: "switch", title: "Hospital switchboard" })]);
    expect(screen.getByTestId("on-call-card-entry-switch")).toBeTruthy();
    expect(screen.getByText("Hospital switchboard")).toBeTruthy();
  });

  it("keeps a stale entry off the page entirely, flag or no flag", () => {
    renderCard([
      entry({ id: "a", slug: "switch", title: "Hospital switchboard" }),
      entry({ id: "b", slug: "old-ward", title: "Ward 4B", lastVerifiedAt: "2020-01-01T00:00:00.000Z" }),
    ]);
    expect(screen.getByTestId("on-call-card-entry-switch")).toBeTruthy();
    expect(screen.queryByTestId("on-call-card-entry-old-ward")).toBeNull();
    expect(screen.queryByText("Ward 4B")).toBeNull();
  });

  it("treats an entry never verified as unfit for paper", () => {
    renderCard([entry({ id: "a", slug: "never", title: "Unchecked number", lastVerifiedAt: null })]);
    expect(screen.queryByTestId("on-call-card-entry-never")).toBeNull();
    expect(screen.getByTestId("on-call-card-empty")).toBeTruthy();
  });

  it("treats exactly twelve months as overdue, not as the last fresh day", () => {
    renderCard([entry({ id: "a", slug: "boundary", title: "Boundary", lastVerifiedAt: EXACTLY_TWELVE_MONTHS })]);
    expect(screen.queryByTestId("on-call-card-entry-boundary")).toBeNull();
  });

  it("keeps a personal number off a page that may be left on a desk", () => {
    renderCard([entry({ id: "a", slug: "mine", title: "My mobile", isPersonal: true })]);
    expect(screen.queryByTestId("on-call-card-entry-mine")).toBeNull();
  });

  it("omits an entry nobody flagged for the card", () => {
    renderCard([entry({ id: "a", slug: "unflagged", title: "Some number", includeOnCard: false })]);
    expect(screen.queryByTestId("on-call-card-entry-unflagged")).toBeNull();
  });

  it("carries the confidential print frame and its printed-at stamp", () => {
    renderCard([entry({ id: "a", slug: "switch", title: "Hospital switchboard" })]);
    const output = screen.getByTestId("on-call-card-output");
    expect(output).toBeTruthy();
    expect(screen.getByTestId("on-call-card-group-contacts")).toBeTruthy();
    expect(output.textContent).toContain("Printed");
  });

  it("shows a QR that points at the live pocket card once the page is in the browser", async () => {
    renderCard([entry({ id: "a", slug: "switch", title: "Hospital switchboard" })]);
    const qr = await screen.findByTestId("on-call-card-qr");
    expect(qr.getAttribute("data-qr-value")).toMatch(/\/on-call\/card$/);
  });

  /**
   * Regression, 2026-09-19. `CARD_NUMBER_FIELDS` read `phone`,
   * `afterHoursPhone`, `pager` and `fax` — and not `extension`. A ward stores
   * its number in `extension` and nothing else, so all three demo wards, every
   * one of them flagged `includeOnCard`, printed as a title and a subtitle with
   * no number anywhere on the card.
   *
   * It is the same omission `on-call-contacts-section.tsx` already fixed and
   * left a comment about; the card never got the fix, and no test looked. Which
   * matters most here of anywhere: the card is the one artefact that leaves the
   * app, and a phone list with the numbers missing is not a degraded card, it
   * is a blank sheet of paper with headings on it.
   */
  it("prints a ward extension, which is the only number a ward row has", () => {
    renderCard([
      entry({
        id: "a",
        slug: "ward-one",
        title: "Ward One",
        subtitle: "Nurses' station",
        details: { role: "Ward nurses' station", extension: "0001" },
      }),
    ]);
    const row = screen.getByTestId("on-call-card-entry-ward-one");
    expect(row.textContent).toContain("0001");
    expect(row.textContent).toContain("Ext");
  });

  it("shows a playbook step's body instead of claiming no number is on file", () => {
    renderCard([
      entry({
        id: "a",
        slug: "escalation",
        title: "Escalation order",
        section: "playbook",
        details: {},
        body: "Registrar first, then the consultant on the roster.",
      }),
    ]);
    const row = screen.getByTestId("on-call-card-entry-escalation");
    expect(row.textContent).toContain("Registrar first");
    expect(row.textContent).not.toContain("No number on file");
  });

  it("does not assert an empty card while the first fetch is still running", () => {
    renderCard([], { loading: true });
    expect(screen.queryByTestId("on-call-card-empty")).toBeNull();
    expect(screen.getByTestId("on-call-card-loading")).toBeTruthy();
  });

  /**
   * Regression, 2026-09-24. The card linked every number with its own
   * `tel:` helper, so a pager ID, a ward extension and a fax number were all
   * tap-to-call links that would ring the digits on the public network. Only
   * a direct or after-hours number may be dialled from the on-screen card.
   */
  it("never makes a pager, extension or fax number a tap-to-call link", () => {
    renderCard([
      entry({
        id: "a",
        slug: "reg",
        title: "Psychiatry registrar",
        details: { phone: "0891112222", pager: "4410", extension: "5521", fax: "0893334444" },
      }),
    ]);
    const row = screen.getByTestId("on-call-card-entry-reg");
    const hrefs = [...row.querySelectorAll("a[href^='tel:']")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["tel:0891112222"]);
    expect(row.textContent).toContain("Pager: 4410");
    expect(row.textContent).toContain("Ext: 5521");
    expect(row.textContent).toContain("Fax: 0893334444");
  });
});
