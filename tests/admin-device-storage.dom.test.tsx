/** @vitest-environment jsdom */

// Spec review 5: Admin keeps no record content on the device, and the privacy assessment
// says so (pinned row ids, owner decision 2026-10-01, are the one exception). The static scan in
// tests/admin-design-contract.test.ts reads only Admin's own folders, but
// Renewals shares On Call's underlying entry-cache code, whose paths can
// reach `localStorage`. This drives those paths through the real Admin pages
// and fails if any record content is written to either storage area.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { complianceFixture, onCallEntryFixture } from "./helpers/on-call-entry-fixture";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/renewals",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: true, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
}));

vi.mock("@/lib/on-call/linked-documents", () => ({
  useOnCallLinkedDocuments: () => ({}),
  useOnCallLinkedDocumentsState: () => ({ documents: {}, loading: false }),
}));

const storeState = vi.hoisted(() => ({
  entries: [] as unknown[],
  loading: false,
  isOffline: false,
  loadError: null,
  signedOut: false,
  demoMode: false,
  cachedAt: null as string | null,
  retry: () => {},
}));

// Only the read is replaced. `cacheOnCallEntries` stays real, so a save or
// verify path that writes the cache is exercised as it runs in the app.
vi.mock("@/lib/on-call/entry-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/on-call/entry-store")>()),
  useOnCallEntries: () => storeState,
}));

import AdminHelpRoute from "@/app/(search-app)/admin/help/page";
import AdminNewJobRoute from "@/app/(search-app)/admin/new-job/page";
import AdminTodayRoute from "@/app/(search-app)/admin/page";
import AdminRenewalsRoute from "@/app/(search-app)/admin/renewals/page";

const REGISTRATION = complianceFixture(
  "Medical registration with a distinctive title",
  { category: "Registration", expiresOn: "2026-10-20", issuer: "Distinctive issuing body" },
  { slug: "registration" },
);
const CLEARANCE = complianceFixture(
  "Working with Children Check, distinctive",
  { category: "Clearances", expiresOn: "2027-03-01" },
  { slug: "clearance" },
);
const GUIDE = onCallEntryFixture({
  section: "logistics",
  title: "Distinctive payslip guide",
  details: { category: "Pay" },
  slug: "payslip-guide",
});
const ENTRIES: OnCallEntry[] = [REGISTRATION, CLEARANCE, GUIDE];

/** Every string an Admin row carries that a reader typed: the title and each text detail. */
const RECORD_CONTENT = ENTRIES.flatMap((entry) => [
  entry.title,
  ...Object.values(entry.details as Record<string, unknown>).filter(
    (value): value is string => typeof value === "string" && value.length > 8,
  ),
]);

let writes: { key: string; value: string }[] = [];

beforeEach(() => {
  storeState.entries = [...ENTRIES];
  writes = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
    writes.push({ key, value });
  });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ entries: [], signedOut: false }), { status: 200 }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function recordContentWritten(): string[] {
  return writes.flatMap(({ key, value }) =>
    RECORD_CONTENT.filter((text) => value.includes(text)).map((text) => `${key} <- "${text}"`),
  );
}

describe("Admin writes no record content to browser storage (spec review 5)", () => {
  it("opens a renewal for editing without recording it anywhere on the device", () => {
    render(<AdminRenewalsRoute />);
    // Neither fixture's title matches a catalogue item, so both live on the
    // Personal tab; opening each one's item sheet and then its "Renewed" date
    // sheet is Renewals' own edit path, replacing the old On Call Edit button.
    fireEvent.click(screen.getByRole("radio", { name: "Personal" }));
    for (const entry of [REGISTRATION, CLEARANCE]) {
      fireEvent.click(screen.getByTestId(`admin-renewals-personal-row-${entry.slug}`));
      fireEvent.click(screen.getByTestId("admin-renewals-item-sheet-renew"));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    }
    // Guard against a vacuous pass: the rows really were on the page.
    expect(screen.getByText(REGISTRATION.title)).toBeInTheDocument();
    expect(recordContentWritten()).toEqual([]);
  });

  it.each([
    ["Today", AdminTodayRoute],
    ["New job", AdminNewJobRoute],
    ["Help", AdminHelpRoute],
  ])("renders %s without writing record content", (_name, Route) => {
    render(<Route />);
    expect(recordContentWritten()).toEqual([]);
  });
});
