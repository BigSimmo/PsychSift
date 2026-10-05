/** @vitest-environment jsdom */

// Admin · Compliance · Export (5 Oct mock-up v2, screen 14): a personal Excel
// copy built in the page and saved on the device. Nothing is uploaded.

import ExcelJS from "exceljs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { complianceFixture } from "./helpers/on-call-entry-fixture";

vi.mock("@/lib/admin/download-file", () => ({ downloadTextFile: vi.fn() }));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="mock-sign-in-dialog" /> : null),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/compliance/export",
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

import { AdminComplianceExportPage } from "@/components/admin/admin-compliance-export-page";
import { downloadTextFile } from "@/lib/admin/download-file";

const NOW = new Date("2026-10-05T00:12:00.000Z");

describe("AdminComplianceExportPage", () => {
  beforeEach(() => {
    Object.assign(storeState, { loading: false, isOffline: false, loadError: null, signedOut: false, demoMode: false });
    storeState.entries = [
      complianceFixture("Life support", { requirementId: "resuscitation-competence", expiresOn: "2026-09-28" }),
      complianceFixture("Fit test", { requirementId: "respirator-fit-testing", expiresOn: "2026-10-20" }),
      complianceFixture("Registration", { requirementId: "medical-registration-renewal", expiresOn: "2027-09-30" }),
    ];
    vi.mocked(downloadTextFile).mockClear();
  });
  afterEach(() => cleanup());

  it("previews the rule and its source by default and lets the reader add or drop columns", () => {
    render(<AdminComplianceExportPage now={NOW} />);
    const preview = screen.getByTestId("admin-compliance-export-preview");
    const headers = () =>
      within(preview)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent);
    expect(headers()).toEqual(["Item", "Group", "Status", "Date you recorded", "Rule", "Source"]);
    fireEvent.click(screen.getByTestId("admin-compliance-export-column-group"));
    expect(headers()).toEqual(["Item", "Status", "Date you recorded", "Rule", "Source"]);
    expect(screen.getByTestId("admin-compliance-export-column-count")).toHaveTextContent("5 of 8");
  });

  it("narrows to the next 60 days, passed dates included and undated items left out", () => {
    render(<AdminComplianceExportPage now={NOW} />);
    fireEvent.click(screen.getByRole("radio", { name: "Next 60 days" }));
    expect(screen.getByTestId("admin-compliance-export-count")).toHaveTextContent("2 rows");
    const preview = screen.getByTestId("admin-compliance-export-preview");
    expect(within(preview).getByText("Resuscitation competence check")).toBeTruthy();
    expect(within(preview).queryByText("Medical registration renewal")).toBeNull();
  });

  it("never reads as all clear when no recorded date falls in the next 60 days", () => {
    storeState.entries = [];
    render(<AdminComplianceExportPage now={NOW} />);
    fireEvent.click(screen.getByRole("radio", { name: "Next 60 days" }));
    expect(screen.getByTestId("admin-compliance-export-empty").textContent).toMatch(
      /^No recorded dates fall in the next 60 days\. \d+ items have no date recorded yet\./,
    );
    expect(screen.getByTestId("admin-compliance-export-save")).toBeDisabled();
  });

  it("saves an .xlsx on the device with the Items and About this file sheets, and sends nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AdminComplianceExportPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-compliance-export-save"));
    const [content, name, type] = vi.mocked(downloadTextFile).mock.calls[0] ?? [];
    expect(content).toBeInstanceOf(Uint8Array);
    expect(name).toBe("Compliance 2026-10-05.xlsx");
    expect(type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((content as Uint8Array).buffer as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Items", "About this file"]);
    expect(workbook.getWorksheet("Items")?.getRow(1).values).toEqual([
      undefined,
      "Item",
      "Group",
      "Status",
      "Date you recorded",
      "Rule",
      "Source",
    ]);
    const about = (workbook.getWorksheet("About this file")?.getSheetValues() ?? []).flat().join(" ");
    expect(about).toContain("Range: every item.");
    expect(about).toContain("Columns left out: Before your next job, Source checked.");
    expect(about).toContain("It does not mean anyone has checked your records");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("offers no save when loading failed, and asks a signed-out reader to sign in", () => {
    storeState.loadError = "failed";
    const { unmount } = render(<AdminComplianceExportPage now={NOW} />);
    expect(screen.getByTestId("admin-compliance-export-failed")).toBeTruthy();
    expect(screen.queryByTestId("admin-compliance-export-save")).toBeNull();
    unmount();
    storeState.loadError = null;
    storeState.signedOut = true;
    render(<AdminComplianceExportPage now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByTestId("mock-sign-in-dialog")).toBeTruthy();
  });
});
