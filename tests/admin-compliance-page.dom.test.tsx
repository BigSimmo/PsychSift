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

  it("splits the next job into what carries over and what is still to do", () => {
    render(<AdminCompliancePage now={NOW} />);
    const card = screen.getByTestId("admin-compliance-next-job");
    expect(within(card).getByText(/Starts .*2 Nov/)).toBeTruthy();
    expect(screen.getByTestId("admin-compliance-next-job-counts").textContent).toMatch(
      /1 carry over · \d+ still to do/,
    );
    expect(
      within(screen.getByTestId("admin-compliance-todo-respirator-fit-testing")).getByText(
        "Your date ends 20 Oct 2026, before you start",
      ),
    ).toBeTruthy();
  });

  it("signposts New job when no start date is recorded", () => {
    storeState.entries = storeState.entries.filter((entry) => entry.title !== "Hospital email account");
    render(<AdminCompliancePage now={NOW} />);
    expect(screen.queryByTestId("admin-compliance-next-job")).toBeNull();
    expect(within(screen.getByTestId("admin-compliance-next-job-empty")).getByRole("link").getAttribute("href")).toBe(
      "/admin/new-job",
    );
  });

  it("filters to one status from the summary, and Show all clears it", () => {
    render(<AdminCompliancePage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-compliance-count-date-passed"));
    expect(screen.getByTestId("admin-compliance-count-date-passed").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("admin-compliance-item-medical-registration-renewal")).toBeNull();
    expect(screen.getByTestId("admin-compliance-item-resuscitation-competence")).toBeTruthy();
    fireEvent.click(screen.getByTestId("admin-compliance-show-all"));
    expect(screen.getByTestId("admin-compliance-item-medical-registration-renewal")).toBeTruthy();
  });

  it("saves an .xlsx to the device and sends nothing", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AdminCompliancePage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-compliance-export-excel"));
    const [content, name, type] = vi.mocked(downloadTextFile).mock.calls[0] ?? [];
    expect(content).toBeInstanceOf(Uint8Array);
    expect(name).toBe("Compliance 2026-10-05.xlsx");
    expect(type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
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
