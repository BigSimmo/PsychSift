/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));
vi.mock("@/components/teaching/teaching-nav-header", () => ({ TeachingNavHeader: () => null }));

import { TermFolderEntryLink } from "@/components/teaching/term-folder/term-folder-entry-link";
import { TermFolderPage } from "@/components/teaching/term-folder/term-folder-page";

import { authState } from "./helpers/teaching-auth";
import { NOW, json, serveFetch, useTeachingTestClock } from "./helpers/teaching-fixtures";

// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock(NOW);

describe("term evidence folder page", () => {
  it("fills the made-up demo from the shipped records, with a meter read in words", async () => {
    render(<TermFolderPage demoMode termId={null} />);
    const card = await screen.findByTestId("term-folder-card");
    const meter = within(card).getByRole("img");
    expect(meter.getAttribute("aria-label")).toMatch(/^7\sparts: /);
    expect(screen.getByText(/Made-up demo\. Nothing here is your data/)).toBeInTheDocument();
    expect(screen.getByTestId("term-folder-not-kept")).toHaveTextContent("Assessment forms");
    expect(screen.getAllByText(/Status and counts only|No assessment content/).length).toBeGreaterThan(0);
    // Work-mode redesign, owner request 6 Oct 2026: Export opens a sheet (choose parts, names off, gaps first).
    fireEvent.click(screen.getByTestId("term-folder-export-open"));
    const csv = await screen.findByTestId("term-folder-csv");
    expect(csv.getAttribute("href")).toMatch(/^data:text\/csv/);
    expect(csv.getAttribute("download")).toMatch(/\.csv$/);
  });

  it("prints and says so", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<TermFolderPage demoMode termId={null} />);
    fireEvent.click(await screen.findByRole("button", { name: /Print/ }));
    expect(print).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("asks a signed-in doctor with no term to set one up first", async () => {
    serveFetch((url) => (url.startsWith("/api/teaching") ? json(200, { attendance: [], pairings: [] }) : null));
    render(<TermFolderPage demoMode={false} termId={null} />);
    const empty = await screen.findByTestId("term-folder-no-term");
    expect(within(empty).getByRole("link", { name: "Set up your term" })).toHaveAttribute("href", "/teaching/term");
  });

  it("falls back to the made-up demo when signed out", async () => {
    authState.status = "signed_out";
    render(<TermFolderPage demoMode={false} termId={null} />);
    expect(await screen.findByTestId("term-folder-card")).toBeInTheDocument();
    expect(screen.getByText(/Made-up demo/)).toBeInTheDocument();
  });

  it("is linked from the Term page", () => {
    render(<TermFolderEntryLink />);
    expect(screen.getByRole("link", { name: /Evidence folder/ })).toHaveAttribute("href", "/teaching/term/folder");
  });

  it("exports from a sheet with names off by default, then says when it was exported", async () => {
    render(<TermFolderPage demoMode termId={null} />);
    fireEvent.click(await screen.findByTestId("term-folder-export-open"));
    const sheet = await screen.findByTestId("term-folder-export");
    const names = within(sheet).getByRole("switch", { name: /Include names/ });
    expect(names).not.toBeChecked();
    const before = decodeURIComponent(within(sheet).getByTestId("term-folder-csv").getAttribute("href")!);
    expect(before).toContain("Left out (names off)");
    expect(before.indexOf('"Gaps · ')).toBeLessThan(before.indexOf('"Part","Status","Detail"'));
    fireEvent.click(names);
    const after = decodeURIComponent(within(sheet).getByTestId("term-folder-csv").getAttribute("href")!);
    expect(after).not.toContain("Left out (names off)");
    fireEvent.click(within(sheet).getByRole("switch", { name: /Teaching sessions/ }));
    expect(decodeURIComponent(within(sheet).getByTestId("term-folder-csv").getAttribute("href")!)).not.toContain(
      "Teaching sessions this term",
    );
    fireEvent.click(within(sheet).getByTestId("term-folder-csv"));
    expect(await screen.findByTestId("term-folder-footer")).toHaveTextContent(
      /Exported \d\d:\d\d · gaps listed in the file/,
    );
  });

  it("lists the dates still to come this term", async () => {
    render(<TermFolderPage demoMode termId={null} />);
    const coming = await screen.findByTestId("term-folder-coming");
    expect(within(coming).getByText("Term ends")).toBeInTheDocument();
  });
});
