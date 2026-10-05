/** @vitest-environment jsdom */

// Admin · Compliance: the doctor's grouped view of the same rows Renewals reads,
// with a next-job pass and an Excel export that never leaves the device.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { complianceFixture, onCallEntryFixture } from "./helpers/on-call-entry-fixture";

vi.mock("@/lib/admin/download-file", () => ({ downloadTextFile: vi.fn() }));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="mock-sign-in-dialog" /> : null),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/compliance",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const storeState = vi.hoisted(() => ({
  entries: [] as OnCallEntry[],
  loading: false,
  isOffline: false,
  loadError: null as string | null,
  signedOut: false,
  demoMode: false,
  cachedAt: null as string | null,
  retry: () => {},
}));
vi.mock("@/lib/on-call/entry-store", () => ({ useOnCallEntries: () => storeState }));

import { AdminCompliancePage } from "@/components/admin/admin-compliance-page";
import { downloadTextFile } from "@/lib/admin/download-file";

const NOW = new Date("2026-10-05T00:12:00.000Z");

function newJobStep(jobStartsOn: string): OnCallEntry {
  return onCallEntryFixture({
    section: "logistics",
    title: "Hospital email account",
    details: { category: "Logins", jobStartsOn },
  });
}

describe("AdminCompliancePage", () => {
  beforeEach(() => {
    Object.assign(storeState, { loading: false, isOffline: false, loadError: null, signedOut: false, demoMode: false });
    storeState.entries = [
      complianceFixture("Life support", { requirementId: "resuscitation-competence", expiresOn: "2026-09-28" }),
      complianceFixture("Fit test", { requirementId: "respirator-fit-testing", expiresOn: "2026-10-20" }),
      complianceFixture("Registration", { requirementId: "medical-registration-renewal", expiresOn: "2027-09-30" }),
      newJobStep("2026-11-02"),
    ];
    vi.mocked(downloadTextFile).mockClear();
  });
  afterEach(() => cleanup());

  it("shows the recorded count, grouped items in Renewals' words, and links each to Renewals", () => {
    render(<AdminCompliancePage now={NOW} />);
    expect(screen.getByTestId("admin-compliance-recorded").textContent).toMatch(/^3 of \d+ recorded/);
    expect(screen.getByTestId("admin-compliance-status-resuscitation-competence").textContent).toBe("Date passed");
    expect(screen.getByTestId("admin-compliance-item-respirator-fit-testing").getAttribute("href")).toBe(
      "/admin/renewals?item=respirator-fit-testing",
    );
    const text = document.body.textContent?.toLowerCase() ?? "";
    for (const banned of ["compliant", "valid", "expired", "lapsed"]) expect(text).not.toContain(banned);
  });

  it("names the next job's start date over the summary, and drops it when none is recorded", () => {
    render(<AdminCompliancePage now={NOW} />);
    expect(screen.getByText(/Before your next job, Mon 2 Nov 2026/)).toBeTruthy();
    cleanup();
    storeState.entries = storeState.entries.filter((entry) => entry.title !== "Hospital email account");
    render(<AdminCompliancePage now={NOW} />);
    expect(screen.getByText("Your requirements")).toBeTruthy();
  });

  it("names a date that runs out before the next job, which no status word shows", () => {
    render(<AdminCompliancePage now={NOW} />);
    const section = screen.getByTestId("admin-compliance-before-next-job");
    expect(section.textContent).toMatch(/To do before Mon 2 Nov 2026/);
    expect(
      within(screen.getByTestId("admin-compliance-todo-respirator-fit-testing")).getByText(
        "Your date ends 20 Oct 2026, before you start",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("admin-compliance-before-next-job-others").textContent).toMatch(
      /date passed or not recorded yet/,
    );
  });

  it("filters with chips: Needs action, then one status, and All brings everything back", () => {
    render(<AdminCompliancePage now={NOW} />);
    const all = screen.getByTestId("admin-compliance-filter-all");
    expect(all.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("admin-compliance-filter-date-passed"));
    expect(screen.queryByTestId("admin-compliance-item-medical-registration-renewal")).toBeNull();
    expect(screen.getByTestId("admin-compliance-item-resuscitation-competence")).toBeTruthy();
    fireEvent.click(screen.getByTestId("admin-compliance-filter-needs-action"));
    expect(screen.getByTestId("admin-compliance-item-respirator-fit-testing")).toBeTruthy();
    expect(screen.queryByTestId("admin-compliance-item-medical-registration-renewal")).toBeNull();
    fireEvent.click(all);
    expect(screen.getByTestId("admin-compliance-item-medical-registration-renewal")).toBeTruthy();
  });

  it("offers one Record dates action and an export row, and saves nothing itself", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AdminCompliancePage now={NOW} />);
    expect(screen.getByTestId("admin-compliance-record-dates").getAttribute("href")).toBe(
      "/admin/renewals?record=missing",
    );
    expect(screen.getByTestId("admin-compliance-export-link").getAttribute("href")).toBe("/admin/compliance/export");
    expect(downloadTextFile).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("shows the first-use page when nothing is recorded yet, never an empty all-clear", () => {
    storeState.entries = [];
    render(<AdminCompliancePage now={NOW} />);
    expect(screen.getByTestId("admin-compliance-first-use")).toBeTruthy();
    expect(screen.queryByTestId("admin-compliance-recorded")).toBeNull();
    expect(document.body.textContent).not.toMatch(/nothing due|all clear/i);
  });

  it("never says it has loaded when the records failed to load", () => {
    storeState.loadError = "failed";
    storeState.entries = [];
    render(<AdminCompliancePage now={NOW} />);
    expect(screen.getByTestId("admin-compliance-failed")).toBeTruthy();
    expect(screen.queryByTestId("admin-compliance-first-use")).toBeNull();
    expect(screen.queryByTestId("admin-compliance-ready")).toBeNull();
  });

  it("asks a signed-out reader to sign in and says the example records are made up in demo", () => {
    storeState.signedOut = true;
    const { unmount } = render(<AdminCompliancePage now={NOW} />);
    fireEvent.click(within(screen.getByTestId("admin-compliance-signed-out")).getByRole("button", { name: "Sign in" }));
    expect(screen.getByTestId("mock-sign-in-dialog")).toBeTruthy();
    unmount();
    storeState.signedOut = false;
    storeState.demoMode = true;
    render(<AdminCompliancePage now={NOW} />);
    expect(screen.getByTestId("admin-compliance-demo-notice")).toBeTruthy();
  });
});
