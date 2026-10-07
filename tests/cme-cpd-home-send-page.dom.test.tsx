/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CpdHomeEntryLink } from "@/components/cme/cpd-home/cpd-home-entry-link";
import { CpdHomeSendPage } from "@/components/cme/cpd-home/cpd-home-send-page";
import { CPD_HOME_SEND_STORAGE_KEY, clearAccountScopedBrowserStorage } from "@/lib/account-scoped-browser-state";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import * as clipboard from "@/lib/copy-to-clipboard";

const announcer = vi.hoisted(() => ({ announce: vi.fn() }));
vi.mock("@/components/ui/live-announcer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/live-announcer")>()),
  announce: announcer.announce,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cme/cpd-home",
  useSearchParams: () => new URLSearchParams(),
}));

const set: CmeRequirementSet = {
  year: 2026,
  confirmedOn: "2026-02-03",
  confirmedSource: "RANZCP",
  totalHours: 50,
  requirements: [],
};
const now = new Date("2026-10-06T05:00:00Z");

function entry(id: string, date: string, overrides: Partial<CmeEntry> = {}): CmeEntry {
  return {
    id,
    date,
    title: `Activity ${id}`,
    allocations: [{ category: "educational", hours: 1 }],
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
    ...overrides,
  };
}

const entries = [
  entry("a", "2026-01-15", { title: "Peer review group", allocations: [{ category: "reviewing", hours: 1.5 }] }),
  entry("b", "2026-10-02", { title: "Grand round", reflection: "Saw Mrs Smith on the ward" }),
  entry("c", "2026-09-22", { title: "Journal club" }),
];

function renderPage(props: Partial<Parameters<typeof CpdHomeSendPage>[0]> = {}) {
  return render(
    <CpdHomeSendPage set={set} entries={entries} availableYears={[2026]} demoMode={false} now={now} {...props} />,
  );
}

// The work-mode kit's buttons and label links take their 48px height from work-mode.css
// (`--spacing-tap`), not a utility class (work-mode redesign, owner request 6 Oct 2026).
const TAP = /\b(?:min-h-(?:12|13|tap)|size-(?:12|tap)|work-button|work-label__link)\b/;

/** Taps Download, waits for the rows to be checked, then taps Download file to save it. */
async function download() {
  fireEvent.click(screen.getByTestId("cpd-home-download"));
  fireEvent.click(await screen.findByTestId("cpd-home-download-ready"));
  return screen.findByTestId("cpd-home-added");
}

describe("Send to AMA CPD Home", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    createObjectURL = vi.fn(() => "blob:cpd");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("says first that CPD Home's import format is not checked, and draws the hand-off", () => {
    renderPage();
    expect(screen.getByTestId("cpd-home-format").textContent).toContain("Format to be confirmed with AMA CPD Home");
    expect(screen.getByTestId("cpd-home-handoff").getAttribute("aria-label")).toBe(
      "Your log of 3 activities goes into a CSV file. What AMA CPD Home can import is not checked yet.",
    );
    fireEvent.click(screen.getByTestId("cpd-home-check-toggle"));
    expect(screen.getByText(/Whether CPD Home imports a file at all/)).toBeTruthy();
    expect(screen.getByTestId("cpd-home-no-files").textContent).toContain("None yet");
  });

  it("makes the file on the device, lists it, and marks it added with Undo", async () => {
    renderPage();
    await download();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    const text = await blob.text();
    expect(text).toContain("Peer review group");
    // Reflections are left out by default.
    expect(text).not.toContain("Mrs Smith");
    const sheet = screen.getByTestId("cpd-home-saved-sheet");
    expect(sheet.textContent).toContain("cpd-log-2026.csv");
    expect(sheet.textContent).toContain("Only you can tell if it worked");
    fireEvent.click(within(sheet).getByTestId("cpd-home-added"));
    const stored = JSON.parse(localStorage.getItem(CPD_HOME_SEND_STORAGE_KEY)!);
    expect(stored.files[0]).toMatchObject({ rows: 3, entryIds: ["a", "c", "b"] });
    expect(stored.files[0].addedAt).not.toBeNull();
    // Nothing but ids and counts is kept.
    expect(localStorage.getItem(CPD_HOME_SEND_STORAGE_KEY)).not.toContain("Peer review");
    expect(screen.getByTestId("cpd-home-history").textContent).toContain("Added");
  });

  it("offers only what is new since the last file marked added", () => {
    localStorage.setItem(
      CPD_HOME_SEND_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        files: [
          {
            id: "f1",
            year: 2026,
            madeAt: "2026-10-01T05:00:00.000Z",
            name: "cpd-log-2026.csv",
            rows: 2,
            entryIds: ["a", "c"],
            includeReflections: false,
            addedAt: "2026-10-01T06:00:00.000Z",
          },
        ],
      }),
    );
    renderPage();
    expect(screen.getByText(/new since your last file/)).toBeTruthy();
    // Short labels with the count in the count column, so the control fits at 320 px. The date stays in the name.
    const fresh = screen.getByRole("radio", { name: "New (1 new since 1 Oct)" });
    expect(fresh.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "All (3 activities in 2026)" })).toBeTruthy();
    const list = screen.getByTestId("cpd-home-activity-list");
    expect(within(list).getAllByTestId("cpd-home-activity")).toHaveLength(1);
    expect(list.textContent).toContain("Grand round");
    expect(screen.getByTestId("cpd-home-download").textContent).toBe("Download 1 row");
  });

  it("holds back a reflection that reads like a patient detail, even when reflections are on", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("cpd-home-reflections"));
    expect(screen.getByTestId("cpd-home-reflections").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("cpd-home-withheld").textContent).toContain("1 reflection left out");
    await download();
    const text = await (createObjectURL.mock.calls[0]![0] as Blob).text();
    expect(text).toContain("Reflection");
    expect(text).not.toContain("Mrs Smith");
  });

  it("copies one activity and all of them", async () => {
    const copy = vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue();
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getAllByTestId("cpd-home-copy-one")[0]!);
    });
    expect(copy).toHaveBeenLastCalledWith(expect.stringContaining("Activity: Grand round"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy all" }));
    });
    const all = copy.mock.calls.at(-1)![0];
    expect(all.split("\n\n")).toHaveLength(3);
    expect(all).not.toContain("Reflection");
  });

  it("lets the doctor choose activities, and refuses an empty choice", () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Choose" }));
    expect(screen.getByTestId("cpd-home-download").hasAttribute("disabled")).toBe(true);
    const rows = screen.getAllByTestId("cpd-home-choose-row");
    fireEvent.click(rows[0]!);
    expect(rows[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("cpd-home-download").textContent).toBe("Download 1 row");
  });

  it("never makes a partial file when an activity is missing hours", () => {
    renderPage({ entries: [...entries, entry("z", "2026-05-01", { title: "No hours yet", allocations: [] })] });
    expect(screen.getByTestId("cpd-home-problems").textContent).toContain("No hours yet");
    fireEvent.click(screen.getByTestId("cpd-home-download"));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByTestId("cpd-home-saved-sheet")).toBeNull();
  });

  it("says so when the browser refuses the download, changes nothing, and tries again", async () => {
    createObjectURL.mockImplementation(() => {
      throw new Error("blocked");
    });
    renderPage();
    fireEvent.click(screen.getByTestId("cpd-home-download"));
    fireEvent.click(await screen.findByTestId("cpd-home-download-ready"));
    const failure = await screen.findByTestId("cpd-home-failure");
    expect(failure.textContent).toContain("No file was made");
    expect(failure.textContent).toContain("Nothing was changed");
    expect(screen.queryByTestId("cpd-home-saved-sheet")).toBeNull();
    expect(localStorage.getItem(CPD_HOME_SEND_STORAGE_KEY)).toBeNull();
    createObjectURL.mockImplementation(() => "blob:cpd");
    fireEvent.click(within(failure).getByTestId("cpd-home-try-again"));
    fireEvent.click(await screen.findByTestId("cpd-home-download-ready"));
    await screen.findByTestId("cpd-home-added");
    expect(screen.queryByTestId("cpd-home-failure")).toBeNull();
    expect(JSON.parse(localStorage.getItem(CPD_HOME_SEND_STORAGE_KEY)!).files).toHaveLength(1);
  });

  it("checks every row with a progress bar, and Cancel makes no file", async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      entry(`m${index}`, `2026-0${(index % 9) + 1}-1${index % 10}`, { title: `Session ${index}` }),
    );
    renderPage({ entries: many });
    fireEvent.click(screen.getByTestId("cpd-home-download"));
    const sheet = screen.getByTestId("cpd-home-saved-sheet");
    expect(sheet.textContent).toContain("Making your file");
    expect(sheet.textContent).toContain("Checking each row has a date, hours, a category and a safe title");
    const bar = within(sheet).getByTestId("cpd-home-progress");
    expect(bar.getAttribute("max")).toBe("25");
    expect(bar.getAttribute("value")).toBe("0");
    // The page's strip and the sheet's both show the file being made.
    for (const strip of screen.getAllByTestId("cpd-home-handoff"))
      expect(strip.getAttribute("aria-label")).toContain("being made");
    // A second tap while it is being made does nothing.
    expect(screen.getByTestId("cpd-home-download").hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(within(sheet).getByTestId("cpd-home-progress").getAttribute("value")).toBe("10"));
    fireEvent.click(within(sheet).getByTestId("cpd-home-cancel"));
    expect(screen.queryByTestId("cpd-home-saved-sheet")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(localStorage.getItem(CPD_HOME_SEND_STORAGE_KEY)).toBeNull();
  });

  it("starts the download only from a tap, and offers Download again", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("cpd-home-download"));
    const ready = await screen.findByTestId("cpd-home-download-ready");
    // The rows are checked, but nothing is downloaded or recorded until the doctor taps.
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByTestId("cpd-home-saved-sheet").textContent).toContain("File ready");
    expect(localStorage.getItem(CPD_HOME_SEND_STORAGE_KEY)).toBeNull();
    fireEvent.click(ready);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const sheet = screen.getByTestId("cpd-home-saved-sheet");
    // It never claims the file is saved, only that the browser should have saved it.
    expect(sheet.textContent).not.toContain("File saved");
    expect(sheet.textContent).toContain("Your browser should have saved it");
    fireEvent.click(within(sheet).getByTestId("cpd-home-download-again"));
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(CPD_HOME_SEND_STORAGE_KEY)!).files).toHaveLength(1);
  });

  it("keeps an activity whose title looks like a patient detail out of the file and every copy", async () => {
    const copy = vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue();
    renderPage({ entries: [...entries, entry("p", "2026-08-01", { title: "Reviewed a 34yo F with psychosis" })] });
    const problems = screen.getByTestId("cpd-home-problems");
    expect(problems.textContent).toContain("Title looks like a patient detail");
    // The flagged words are not repeated in the problem list.
    expect(problems.textContent).not.toContain("34yo");
    expect(problems.textContent).toContain("Activity on Sat 1 Aug 2026");
    fireEvent.click(screen.getByTestId("cpd-home-download"));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(screen.queryByTestId("cpd-home-download-ready")).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByTestId("cpd-home-held-title").getAttribute("href")).toBe("/cme/log/p?edit=1");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy all" }));
    });
    const all = copy.mock.calls.at(-1)![0];
    expect(all).not.toContain("34yo");
    expect(all.split("\n\n")).toHaveLength(3);
    fireEvent.click(screen.getByTestId("cpd-home-preview"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("cpd-home-copy-table"));
    });
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it("lists every file of the year behind Show older, so an older one can still be marked added", () => {
    const files = Array.from({ length: 7 }, (_, index) => ({
      id: `f${index}`,
      year: 2026,
      madeAt: `2026-09-0${index + 1}T05:00:00.000Z`,
      name: `cpd-log-2026-chosen-2026-09-0${index + 1}.csv`,
      rows: 1,
      entryIds: ["a"],
      includeReflections: false,
      addedAt: null,
    }));
    localStorage.setItem(CPD_HOME_SEND_STORAGE_KEY, JSON.stringify({ version: 1, files }));
    renderPage();
    expect(screen.getAllByTestId("cpd-home-file")).toHaveLength(5);
    fireEvent.click(screen.getByTestId("cpd-home-show-older-files"));
    expect(screen.getAllByTestId("cpd-home-file")).toHaveLength(7);
    fireEvent.click(screen.getAllByTestId("cpd-home-mark-added").at(-1)!);
    const stored = JSON.parse(localStorage.getItem(CPD_HOME_SEND_STORAGE_KEY)!);
    expect(stored.files.find((file: { id: string }) => file.id === "f6").addedAt).not.toBeNull();
  });

  it("goes back to the CPD summary, where its link lives, even with nothing to send", () => {
    const { unmount } = renderPage();
    expect(screen.getByTestId("cpd-feature-back").getAttribute("href")).toBe("/cme/summary");
    unmount();
    renderPage({ entries: [] });
    expect(screen.getByTestId("cpd-feature-back").getAttribute("href")).toBe("/cme/summary");
  });

  it("says the import format is not confirmed, with its source pending", () => {
    renderPage();
    const row = screen.getByTestId("cpd-home-import-format");
    expect(row.textContent).toContain("Not confirmed yet");
    expect(row.textContent).toContain("Source pending");
  });

  it("shows the preview dates the Australian way", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("cpd-home-preview"));
    const table = screen.getByRole("table");
    const dates = within(table)
      .getAllByRole("cell")
      .map((cell) => cell.textContent)
      .filter((text) => /^\w{3} \d/.test(text ?? ""));
    expect(dates).toContain("Thu 15 Jan");
    expect(table.textContent).not.toContain("2026-01-15");
  });

  it("says a file is not made because some activities need fixing first", () => {
    renderPage({ entries: [...entries, entry("p", "2026-08-01", { title: "Reviewed a 34yo F with psychosis" })] });
    fireEvent.click(screen.getByTestId("cpd-home-download"));
    expect(announcer.announce).toHaveBeenCalledWith("No file was made. Some activities need fixing first.");
  });

  it("waits for a connection before the full export, and offers it again once online", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderPage();
    const offline = screen.getByTestId("cpd-home-full-export");
    expect(offline.tagName).toBe("BUTTON");
    expect((offline as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("cpd-home-full-export-note").textContent).toContain("Needs a connection");
    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByTestId("cpd-home-full-export").getAttribute("href")).toBe("/api/cme/export?year=2026");
  });

  it("says when this browser is not keeping changes", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("refused", "SecurityError");
    });
    renderPage();
    expect(screen.getByTestId("cpd-home-privacy").textContent).toContain(
      "This browser is not keeping changes. They last until you leave the page.",
    );
  });

  it("shows an empty state with a way to log the first activity", () => {
    renderPage({ entries: [] });
    expect(screen.getByTestId("cpd-home-empty").textContent).toContain("Nothing to send yet");
    expect(screen.getByTestId("cpd-home-log-first").getAttribute("href")).toBe("/cme/new");
  });

  it("keeps nothing in the sample, and forgets the list at an account change", async () => {
    const { unmount } = renderPage({ demoMode: true });
    expect(screen.getByTestId("cpd-home-privacy").textContent).toContain("Sample record");
    fireEvent.click(await download());
    expect(localStorage.getItem(CPD_HOME_SEND_STORAGE_KEY)).toBeNull();
    unmount();
    localStorage.setItem(CPD_HOME_SEND_STORAGE_KEY, JSON.stringify({ version: 1, files: [] }));
    act(() => clearAccountScopedBrowserStorage());
    expect(localStorage.getItem(CPD_HOME_SEND_STORAGE_KEY)).toBeNull();
  });

  it("gives every control a 48px tap target, and no status colour classes", () => {
    const { container } = renderPage();
    const short = [...container.querySelectorAll<HTMLElement>("button, a[href]")].filter(
      (node) => !TAP.test(node.className),
    );
    expect(short.map((node) => node.outerHTML.slice(0, 80))).toEqual([]);
    expect(container.innerHTML).not.toMatch(/\b(?:bg|text|border)-(?:red|amber|green)-\d/);
  });

  it("exports an entry link to the page", () => {
    render(<CpdHomeEntryLink year={2026} />);
    expect(screen.getByTestId("cpd-home-entry-link").getAttribute("href")).toBe("/cme/cpd-home?year=2026");
  });
});
