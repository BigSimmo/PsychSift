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
    expect(screen.getByText(/Status and counts only|No assessment content/)).toBeInTheDocument();
    const csv = screen.getByTestId("term-folder-csv");
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
});
