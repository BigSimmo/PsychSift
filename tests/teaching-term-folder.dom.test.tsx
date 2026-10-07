/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const announcer = vi.hoisted(() => ({ announce: vi.fn() }));
vi.mock("@/components/ui/live-announcer", () => ({ announce: announcer.announce }));
vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));
vi.mock("@/components/teaching/teaching-nav-header", () => ({ TeachingNavHeader: () => null }));

import { TermFolderEntryLink } from "@/components/teaching/term-folder/term-folder-entry-link";
import { TermFolderPage } from "@/components/teaching/term-folder/term-folder-page";
import { ToastProvider } from "@/components/ui/toast";
import { TEACHING_TERM_TRACKER_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { sampleTermTracker } from "@/lib/teaching/term-tracker";

import { authState } from "./helpers/teaching-auth";
import { NOW, json, serveFetch, useTeachingTestClock } from "./helpers/teaching-fixtures";

// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock(NOW);

afterEach(() => {
  announcer.announce.mockClear();
  window.localStorage.clear();
});

const LOGBOOK = "/api/teaching?view=logbook";
const SUPERVISION = "/api/teaching/depth?view=supervision";

/** A signed-in doctor's own term on this phone (the shape the term tracker stores). */
function keepTermOnPhone() {
  window.localStorage.setItem(TEACHING_TERM_TRACKER_STORAGE_KEY, JSON.stringify(sampleTermTracker("2026-09-30")));
}

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
    expect(announcer.announce).toHaveBeenCalledWith("Opening print");
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
    await waitFor(() =>
      expect(screen.getByTestId("term-folder-footer")).toHaveTextContent(
        /Exported \d\d:\d\d · gaps listed in the file/,
      ),
    );
  });

  it("never says updated when both reads failed", async () => {
    keepTermOnPhone();
    serveFetch((url) => (url === LOGBOOK || url === SUPERVISION ? json(500, { error: "Down" }) : null));
    render(<TermFolderPage demoMode={false} termId={null} />);
    expect(await screen.findByTestId("term-folder-failed")).toHaveTextContent(
      "Check-ins and supervision logs did not load",
    );
    const footer = screen.getByTestId("term-folder-footer");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(footer).not.toHaveTextContent(/updated \d\d:\d\d/);
    expect(footer).toHaveTextContent("Check-ins and supervision logs didn't load");
    expect(screen.getByTestId("term-folder-failed")).toHaveTextContent("so those parts show as not updating");
  });

  it("reads again when the page comes back into view, and keeps the last good figures if that read fails", async () => {
    keepTermOnPhone();
    let fail = false;
    serveFetch((url) => {
      if (url === LOGBOOK) return fail ? json(500, { error: "Down" }) : json(200, { attendance: [] });
      if (url === SUPERVISION) return fail ? json(500, { error: "Down" }) : json(200, { pairings: [] });
      return null;
    });
    render(<TermFolderPage demoMode={false} termId={null} />);
    await waitFor(() => expect(screen.getByTestId("term-folder-footer")).toHaveTextContent(/updated \d\d:\d\d/));
    expect(screen.queryByTestId("term-folder-failed")).toBeNull();
    fail = true;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const note = await screen.findByTestId("term-folder-failed");
    expect(note).toHaveTextContent("keep their last good figures");
    expect(screen.getAllByText(/^As of \d\d:\d\d · /).length).toBeGreaterThan(0);
  });

  it("holds Export and Copy summary, with the reason, while the folder is still loading", async () => {
    keepTermOnPhone();
    serveFetch((url) => (url === LOGBOOK || url === SUPERVISION ? new Promise<Response>(() => {}) : null));
    render(<TermFolderPage demoMode={false} termId={null} />);
    const exportButton = await screen.findByTestId("term-folder-export-open");
    const copy = screen.getByTestId("term-folder-copy");
    const reason = "Still filling from your records. Export, copy or print once every part has loaded.";
    const print = vi.fn();
    vi.stubGlobal("print", print);
    const printButton = screen.getByTestId("term-folder-print");
    for (const button of [exportButton, copy, printButton]) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAccessibleDescription(reason);
    }
    fireEvent.click(exportButton);
    expect(screen.queryByTestId("term-folder-export")).toBeNull();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.click(copy);
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(printButton);
    expect(print).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("names the part that did not load in the footer, never updated for the lot", async () => {
    keepTermOnPhone();
    serveFetch((url) =>
      url === LOGBOOK ? json(500, { error: "Down" }) : url === SUPERVISION ? json(200, { pairings: [] }) : null,
    );
    render(<TermFolderPage demoMode={false} termId={null} />);
    expect(await screen.findByTestId("term-folder-failed")).toHaveTextContent("so that part shows as not updating");
    await waitFor(() =>
      expect(screen.getByTestId("term-folder-footer")).toHaveTextContent(
        /^Supervision logs updated \d\d:\d\d · Check-ins didn't load$/,
      ),
    );
  });

  it("has a visible way back to Term", async () => {
    render(<TermFolderPage demoMode termId={null} />);
    expect(await screen.findByTestId("term-folder-back")).toHaveAttribute("href", "/teaching/term");
    expect(screen.getByRole("link", { name: "Term" })).toBeVisible();
  });

  it("says in the copied demo summary that it is made up", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<TermFolderPage demoMode termId={null} />);
    fireEvent.click(await screen.findByTestId("term-folder-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect((writeText.mock.calls[0] as unknown as [string])[0].split("\n")[0]).toBe("Made-up demo, not your records.");
  });

  it("says inside the demo CSV that it is made up", async () => {
    render(<TermFolderPage demoMode termId={null} />);
    fireEvent.click(await screen.findByTestId("term-folder-export-open"));
    const href = decodeURIComponent((await screen.findByTestId("term-folder-csv")).getAttribute("href")!);
    expect(href).toMatch(
      /^data:text\/csv;charset=utf-8,\uFEFF"Made-up demo, not your records"\r\n"Term evidence folder"/,
    );
  });

  it("says a link to a term no longer on this phone shows another term", async () => {
    render(<TermFolderPage demoMode termId="deleted-term" />);
    expect(await screen.findByTestId("term-folder-missing-term")).toHaveTextContent(
      "That term is no longer on this phone. Showing Term 4 · Psychiatry.",
    );
  });

  it("copies a summary with no supervisor's name, the export's names-off default", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<TermFolderPage demoMode termId={null} />);
    fireEvent.click(await screen.findByTestId("term-folder-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text).toContain("Term 4 · Psychiatry evidence folder");
    expect(text).not.toContain("Supervisor:");
    expect(text).not.toContain("Dr Example");
  });

  it("starts the download before closing the sheet, and says it was exported once", async () => {
    render(
      <ToastProvider>
        <TermFolderPage demoMode termId={null} />
      </ToastProvider>,
    );
    fireEvent.click(await screen.findByTestId("term-folder-export-open"));
    const link = await screen.findByTestId("term-folder-csv");
    fireEvent.click(link);
    // Still on the page while the browser acts on the tap.
    expect(link).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("term-folder-footer")).toHaveTextContent(/Exported \d\d:\d\d/));
    expect(screen.queryByTestId("term-folder-export")).toBeNull();
    // The toast speaks: the page announcer does not say it a second time.
    expect(await screen.findByText("Term 4 · Psychiatry folder exported")).toBeInTheDocument();
    expect(announcer.announce).not.toHaveBeenCalledWith(expect.stringContaining("exported"));
  });

  it("lists the dates still to come this term", async () => {
    render(<TermFolderPage demoMode termId={null} />);
    const coming = await screen.findByTestId("term-folder-coming");
    expect(within(coming).getByText("Term ends")).toBeInTheDocument();
  });
});
