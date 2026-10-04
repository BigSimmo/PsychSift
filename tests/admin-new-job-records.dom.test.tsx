/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_RECORDS_SECTIONS } from "@/components/admin/admin-page-sections";
import { AdminRecordsPage } from "@/components/admin/new-job/admin-records-page";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { complianceFixture, onCallEntryFixture } from "./helpers/on-call-entry-fixture";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/new-job/records",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const registration = complianceFixture(
  "Medical registration",
  { category: "Registration", expiresOn: "2027-09-30", issuingBody: "Ahpra" },
  { isOwn: true, isPersonal: true },
);
const payslipGuide = onCallEntryFixture({
  section: "logistics",
  title: "Payslips and pay queries",
  details: { category: "Pay" },
  isOwn: true,
  isPersonal: false,
});
const sharedGuide = onCallEntryFixture({
  section: "logistics",
  title: "Shared guide, not the reader's own",
  details: { category: "Pay" },
  isOwn: false,
  isPersonal: false,
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
}));

const NOW = new Date("2026-09-26T01:00:00Z");

beforeEach(() => {
  Object.assign(entryState, {
    entries: [registration, payslipGuide, sharedGuide],
    loading: false,
    isOffline: false,
    loadError: null,
    signedOut: false,
    demoMode: false,
    cachedAt: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminRecordsPage", () => {
  it("is an on-screen page, with a back link and no download", () => {
    render(<AdminRecordsPage now={NOW} />);
    expect(screen.getByTestId("admin-records-main")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Your Admin records" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /New job/ })).toBeTruthy();
  });

  it("says what to take for a site or job change, and what is not included", () => {
    render(<AdminRecordsPage now={NOW} />);
    expect(screen.getByTestId("admin-records-take-with-you")).toHaveTextContent(
      /registration numbers and renewal dates.*contacts and logins.*New job ticks.*Hospital files, patient information/i,
    );
  });

  it("shows only the reader's own records, grouped into Renewals, Admin and Contacts", () => {
    render(<AdminRecordsPage now={NOW} />);
    expect(screen.getByText(registration.title)).toBeTruthy();
    expect(screen.getByText(payslipGuide.title)).toBeTruthy();
    expect(screen.queryByText(sharedGuide.title)).toBeNull();
  });

  it("shows Copy and Print as visible secondary buttons at the top, with no ••• menu (Admin polish)", () => {
    render(<AdminRecordsPage now={NOW} />);
    const copy = screen.getByRole("button", { name: "Copy" });
    const print = screen.getByRole("button", { name: "Print" });
    expect(copy.className).not.toContain("--command");
    expect(print.className).not.toContain("--command");
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    const firstGroup = screen.getByRole("region", { name: "Renewals" });
    expect(copy.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers the in-page rail for the groups it renders, and names each group's count in its heading", () => {
    render(<AdminRecordsPage now={NOW} />);
    for (const section of ADMIN_RECORDS_SECTIONS) {
      if (section.id === "admin-records-new-job" || section.id === "admin-records-contacts") continue;
      expect(document.getElementById(section.id), section.id).not.toBeNull();
    }
    // No New job ticks or contacts in this fixture, so neither anchor is drawn.
    expect(document.getElementById("admin-records-new-job")).toBeNull();
    expect(document.getElementById("admin-records-contacts")).toBeNull();
    expect(screen.getByTestId("admin-records-renewals-count")).toHaveTextContent("· 1");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toContain("Renewals · 1");
  });

  it("folds a group of more than six rows behind Show all N, opens every group for printing, and folds again afterwards", () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<AdminRecordsPage now={NOW} />);
    const list = screen.getByTestId("admin-records-not-recorded-list");
    const total = Number(/\d+/.exec(screen.getByTestId("admin-records-not-recorded-count").textContent ?? "")?.[0]);
    expect(total).toBeGreaterThan(6);
    expect(list.querySelectorAll("li")).toHaveLength(6);
    const showAll = screen.getByTestId("admin-records-not-recorded-list-show-all");
    expect(showAll).toHaveTextContent(`Show all ${total}`);

    fireEvent.click(screen.getByTestId("admin-records-print"));
    expect(print).toHaveBeenCalled();
    expect(screen.getByTestId("admin-records-not-recorded-list").querySelectorAll("li")).toHaveLength(total);
    expect(screen.queryByTestId("admin-records-not-recorded-list-show-all")).toBeNull();

    // Printing finished (or the dialog was cancelled): the fold comes back.
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(screen.getByTestId("admin-records-not-recorded-list").querySelectorAll("li")).toHaveLength(6);
    expect(screen.getByTestId("admin-records-not-recorded-list-show-all")).toBeInTheDocument();

    // The browser's own Print (Ctrl+P) opens and refolds the same way.
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(screen.getByTestId("admin-records-not-recorded-list").querySelectorAll("li")).toHaveLength(total);
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(screen.getByTestId("admin-records-not-recorded-list").querySelectorAll("li")).toHaveLength(6);
    vi.unstubAllGlobals();
  });

  it("shows each renewal's date, what is not recorded yet, and copies the dates too", async () => {
    const writeText = vi.fn(async (text: string) => {
      void text;
    });
    Object.assign(navigator, { clipboard: { writeText } });
    render(<AdminRecordsPage now={NOW} />);
    expect(screen.getByText("Recorded as expiring 30 Sep 2027")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Not recorded yet" })).toBeTruthy();
    // An Admin guide is not a renewal: it never reads "Not recorded yet".
    expect(screen.getByTestId(`admin-records-row-${payslipGuide.id}`).textContent).not.toContain("Not recorded");
    fireEvent.click(screen.getByTestId("admin-records-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]?.[0]).toContain("Recorded as expiring 30 Sep 2027");
  });

  it("shows a skeleton while loading and a sign-in line when signed out, never 'Nothing recorded yet' (M2)", () => {
    Object.assign(entryState, { loading: true });
    const { unmount } = render(<AdminRecordsPage now={NOW} />);
    expect(screen.getByTestId("admin-records-loading")).toBeTruthy();
    expect(screen.queryByTestId("admin-records-copy")).toBeNull();
    expect(screen.queryByTestId("admin-records-empty")).toBeNull();
    unmount();
    Object.assign(entryState, { loading: false, signedOut: true, entries: [] });
    render(<AdminRecordsPage now={NOW} />);
    expect(screen.getByTestId("admin-records-signed-out")).toBeTruthy();
    expect(screen.queryByTestId("admin-records-copy")).toBeNull();
    expect(screen.queryByTestId("admin-records-print")).toBeNull();
    expect(screen.queryByTestId("admin-records-empty")).toBeNull();
  });

  it("shows the load-failed state when entries failed to load", () => {
    Object.assign(entryState, { isOffline: true, loadError: "offline" });
    render(<AdminRecordsPage now={NOW} />);
    expect(screen.getByTestId("admin-records-load-failed")).toBeTruthy();
  });
});
