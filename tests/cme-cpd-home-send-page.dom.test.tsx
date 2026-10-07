/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CpdHomeEntryLink } from "@/components/cme/cpd-home/cpd-home-entry-link";
import { CpdHomeSendPage } from "@/components/cme/cpd-home/cpd-home-send-page";
import { CPD_HOME_SEND_STORAGE_KEY, clearAccountScopedBrowserStorage } from "@/lib/account-scoped-browser-state";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import * as clipboard from "@/lib/copy-to-clipboard";

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

const TAP = /\b(?:min-h-(?:12|13|tap)|size-(?:12|tap))\b/;

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
    fireEvent.click(screen.getByTestId("cpd-home-download"));
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
    fireEvent.click(screen.getByTestId("cpd-home-download"));
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
      fireEvent.click(screen.getByTestId("cpd-home-copy-all"));
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

  it("says so when the browser refuses the download, and changes nothing", () => {
    createObjectURL.mockImplementation(() => {
      throw new Error("blocked");
    });
    renderPage();
    fireEvent.click(screen.getByTestId("cpd-home-download"));
    expect(screen.getByTestId("cpd-home-failure").textContent).toContain("Nothing was changed");
    expect(localStorage.getItem(CPD_HOME_SEND_STORAGE_KEY)).toBeNull();
  });

  it("shows an empty state with a way to log the first activity", () => {
    renderPage({ entries: [] });
    expect(screen.getByTestId("cpd-home-empty").textContent).toContain("Nothing to send yet");
    expect(screen.getByTestId("cpd-home-log-first").getAttribute("href")).toBe("/cme/new");
  });

  it("keeps nothing in the sample, and forgets the list at an account change", () => {
    const { unmount } = renderPage({ demoMode: true });
    expect(screen.getByTestId("cpd-home-privacy").textContent).toContain("Sample record");
    fireEvent.click(screen.getByTestId("cpd-home-download"));
    fireEvent.click(screen.getByTestId("cpd-home-added"));
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
