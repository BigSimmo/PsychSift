/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CmeEntryPage } from "@/components/cme/cme-entry-page";
import { CmeLogPage } from "@/components/cme/cme-log-page";
import { DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";

// The quick-log button refreshes the page after a save.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cme",
}));

afterEach(cleanup);

const CLINICAL_STATUS_CLASS = /\b(?:bg|text|border|ring)-(?:red|amber|green|orange|rose|emerald|yellow)-/;
// 48 px, or 52 px for a two-line grouped-list row (the kit's min-h-13): both at or above the 48 px floor.
const TAP_TARGET_CLASS = /\bmin-h-(?:12|13|tap)\b/;
// The shared header's ellipsis is a 48 px square (`h-tap w-tap`), the same floor
// `tests/cme-visual-contract.dom.test.tsx` accepts.
const hasTapTarget = (className: string) =>
  TAP_TARGET_CLASS.test(className) || (/\bh-tap\b/.test(className) && /\bw-tap\b/.test(className));

/**
 * `DEMO_CME_ENTRIES` (Task 3) gives every entry a single allocation and
 * `routineId: null` throughout, so neither the multi-allocation "college
 * pill" behaviour nor the "Routine" pill has a real example to render
 * against. This fixture set exercises both shapes directly, plus a second
 * year, an entry with no evidence and no reflection, and an entry with a
 * cost — everything the brief's screen description calls for.
 */
const fixtureEntries: CmeEntry[] = [
  {
    id: "fx-1",
    date: "2026-09-16",
    title: "Journal club — treatment-resistant depression",
    allocations: [{ category: "educational", hours: 1 }],
    reflection: "Compared reading with colleagues afterwards.",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
  },
  {
    id: "fx-2",
    date: "2026-09-11",
    title: "Peer review group — September",
    allocations: [
      { category: "reviewing", hours: 1 },
      { category: "measuring", hours: 0.5 },
    ],
    reflection: "Brought a case for discussion.",
    costCents: 5_000,
    transcribed: true,
    routineId: "routine-1",
    documentId: "00000000-0000-4000-8000-000000000001",
    buckets: ["Peer review — September"],
  },
  {
    id: "fx-3",
    date: "2026-08-22",
    title: "RANZCP WA Branch training day",
    allocations: [{ category: "educational", hours: 5 }],
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
  },
  {
    id: "fx-4",
    date: "2025-11-03",
    title: "Audit — discharge planning review",
    allocations: [{ category: "measuring", hours: 1 }],
    reflection: "Reviewed a sample of discharge summaries with the team.",
    costCents: null,
    transcribed: true,
    routineId: null,
    documentId: null,
    buckets: [],
  },
];

const fixtureSet: CmeRequirementSet = { ...DEMO_CME_YEAR, year: 2026 };

function noClinicalStatusColour(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>("[class]")].filter((node) =>
    CLINICAL_STATUS_CLASS.test(node.className),
  );
}

describe("Log", () => {
  it("shows unfinished records in the To finish address, apart from activities", () => {
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} initialTab="finish" />);
    expect(screen.getByTestId("cme-log-page")).toBeInTheDocument();
    expect(screen.queryByTestId("cme-log-row-fx-1")).toBeNull();
    expect(screen.queryByTestId("cme-log-search")).toBeNull();
    expect(screen.queryByTestId("cme-quick-log-button")).toBeNull();
  });
  it("says so when a saved activity could not be linked to its missed session", () => {
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} justSaved missedLinkFailed />);
    expect(screen.getByTestId("cme-log-missed-unlinked")).toHaveTextContent(
      "could not be linked to the missed session",
    );
  });

  it("offers a year choice per year the log holds data for, from the year picker", async () => {
    const user = userEvent.setup();
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} />);
    // The year lives in a sheet; the year picker beside "Log an activity" says which year is showing.
    expect(screen.queryByTestId("cme-log-year-tabs")).toBeNull();
    expect(screen.getByTestId("cme-log-open-filters")).toHaveTextContent("2026");
    await user.click(screen.getByTestId("cme-log-open-filters"));
    const years = screen.getByRole("navigation", { name: "Select year" });
    expect(years).toHaveAttribute("data-testid", "cme-log-year-tabs");
    expect(within(years).getByRole("button", { name: /^2026/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(years).getByRole("button", { name: /^2025/ }));
    expect(screen.getByText("Audit — discharge planning review")).toBeInTheDocument();
    expect(screen.queryByText("Journal club — treatment-resistant depression")).toBeNull();
    expect(screen.getByTestId("cme-log-open-filters")).toHaveTextContent("2025");
  });

  it("groups entries by month, most recent month first", () => {
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent ?? "");
    const septemberIndex = headings.findIndex((text) => text.includes("September"));
    const augustIndex = headings.findIndex((text) => text.includes("August"));
    expect(septemberIndex).toBeGreaterThanOrEqual(0);
    expect(augustIndex).toBeGreaterThan(septemberIndex);
  });

  it("searches across titles and reflections, not just titles", async () => {
    const user = userEvent.setup();
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} />);
    await user.type(screen.getByLabelText(/search your log/i), "discussion");
    expect(screen.getByText("Peer review group — September")).toBeInTheDocument();
    expect(screen.queryByText("Journal club — treatment-resistant depression")).toBeNull();
  });

  it("filters by category from the category chip, without hiding the month grouping's own job", async () => {
    const user = userEvent.setup();
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} />);
    // The categories live in a sheet behind one chip that names the one in force.
    expect(screen.queryByRole("radio", { name: "Measuring outcomes" })).toBeNull();
    expect(screen.getByTestId("cme-log-category-chip")).toHaveTextContent("All categories");
    await user.click(screen.getByTestId("cme-log-category-chip"));
    const sheet = screen.getByTestId("cme-log-filter-sheet");
    expect(within(sheet).queryByTestId("cme-log-year-tabs")).toBeNull();
    const category = within(sheet).getByTestId("cme-log-filter");
    await user.click(within(category).getByRole("button", { name: /measuring outcomes/i }));
    expect(screen.getByTestId("cme-log-category-chip")).toHaveTextContent("Measuring outcomes");
    expect(screen.getByText("Peer review group — September")).toBeInTheDocument();
    expect(screen.queryByText("Journal club — treatment-resistant depression")).toBeNull();
    expect(screen.queryByText("RANZCP WA Branch training day")).toBeNull();
  });

  it("starts a category deep link already filtered and exposes the same choice in the filter sheet", async () => {
    const user = userEvent.setup();
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} initialCategory="measuring" />);
    expect(screen.getByText("Peer review group — September")).toBeInTheDocument();
    expect(screen.queryByText("Journal club — treatment-resistant depression")).toBeNull();
    await user.click(screen.getByTestId("cme-log-category-chip"));
    const sheet = screen.getByTestId("cme-log-filter-sheet");
    expect(within(sheet).getByRole("button", { name: /measuring outcomes/i })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(sheet).getByRole("button", { name: /educational activities/i }));
    expect(screen.getByText("Journal club — treatment-resistant depression")).toBeInTheDocument();
  });

  it("shows cross-year records only when the owner-scoped all-years read is available", async () => {
    const user = userEvent.setup();
    render(
      <CmeLogPage
        entries={fixtureEntries.filter((entry) => entry.date.startsWith("2026"))}
        allYearsEntries={fixtureEntries}
        set={fixtureSet}
      />,
    );
    expect(screen.queryByText("Audit — discharge planning review")).toBeNull();
    await user.click(screen.getByTestId("cme-log-open-filters"));
    await user.click(screen.getByRole("button", { name: /all years · 4/i }));
    expect(screen.getByText("Audit — discharge planning review")).toBeInTheDocument();
  });

  it("keeps the selected year available when the cross-year read fails", async () => {
    const user = userEvent.setup();
    render(<CmeLogPage entries={fixtureEntries.slice(0, 3)} set={fixtureSet} allYearsFailed />);
    expect(screen.getByText("All years could not be loaded. This year is still available.")).toBeInTheDocument();
    await user.click(screen.getByTestId("cme-log-open-filters"));
    expect(within(screen.getByTestId("cme-log-filter-sheet")).queryByRole("button", { name: /all years/i })).toBeNull();
  });

  it("opens the copy sheet from Copy the next one, and marks and undoes only on the owner's say-so", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ entry: { transcribed: true } }), { status: 200 }));
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} initialAttention="copy" />);
    await user.click(screen.getByTestId("cme-log-copy-next"));
    const sheet = screen.getByTestId("cme-log-copy-sheet");
    expect(within(sheet).getByText("Copy to your CPD home")).toBeInTheDocument();
    await user.click(within(sheet).getByTestId("cme-log-copy-all"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Journal club — treatment-resistant depression"));
    // A copy alone never stamps the record.
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(sheet).getByTestId("cme-log-copy-mark"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/cme/entries/fx-1");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ transcribed: true });
    await user.click(within(screen.getByTestId("cme-log-copy-last")).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ transcribed: false });
    fetchMock.mockRestore();
    removeClipboard();
  });

  it("keeps a row to what is known or missing: no routine chip, source link, copied tick or evidence count", () => {
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} today="2026-09-26" />);
    const row = screen.getByTestId("cme-log-row-fx-2").closest("li") as HTMLElement;
    expect(within(row).queryByText("Routine")).toBeNull();
    expect(within(row).queryByText("Source link")).toBeNull();
    expect(within(row).queryByText("Copied")).toBeNull();
    expect(row).not.toHaveTextContent(/evidence file/i);
  });

  it("links every row to its own entry screen", () => {
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} />);
    expect(screen.getByTestId("cme-log-row-fx-1")).toHaveAttribute("href", "/cme/log/fx-1");
    expect(screen.getByTestId("cme-log-row-fx-2")).toHaveAttribute("href", "/cme/log/fx-2");
  });

  it("puts Log an activity beside the year picker — a standing way to add a new entry", () => {
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} />);
    expect(screen.getByTestId("cme-log-new-entry")).toHaveAttribute("href", "/cme/new?year=2026");
  });

  it("shows a guided empty state rather than a blank list when the year has nothing logged", () => {
    render(<CmeLogPage entries={[]} set={fixtureSet} />);
    expect(screen.getByTestId("cme-log-empty")).toBeInTheDocument();
  });

  it("paints no clinical status colour anywhere on the page", () => {
    const { container } = render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} />);
    expect(noClinicalStatusColour(container).map((node) => node.className)).toEqual([]);
  });

  it("gives every interactive element a 48px tap target class", () => {
    const { container } = render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} />);
    const interactive = [
      ...container.querySelectorAll<HTMLElement>("button, a[href], [role='button'], [role='tab'], [role='radio']"),
    ];
    expect(interactive.length).toBeGreaterThan(0);
    const short = interactive.filter((node) => !TAP_TARGET_CLASS.test(node.className));
    expect(short.map((node) => node.textContent?.trim() || node.getAttribute("aria-label"))).toEqual([]);
  });

  it("lists only activities known to have no evidence under Missing evidence", () => {
    const counted: CmeEntry = {
      ...fixtureEntries[0]!,
      id: "counted-none",
      title: "Demo counted none",
      evidenceCount: 0,
    };
    const unknown: CmeEntry = {
      ...fixtureEntries[0]!,
      id: "never-counted",
      title: "Demo never counted",
      evidenceCount: undefined,
    };
    render(<CmeLogPage entries={[counted, unknown]} set={fixtureSet} initialAttention="evidence" />);
    expect(screen.getByText("Demo counted none")).toBeInTheDocument();
    expect(screen.queryByText("Demo never counted")).not.toBeInTheDocument();
  });
});

type ClipboardStub = { writeText: ReturnType<typeof vi.fn> };

function stubClipboard(writeText: ReturnType<typeof vi.fn>): ClipboardStub {
  const clipboard = { writeText };
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true, writable: true });
  return clipboard;
}

function removeClipboard() {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true, writable: true });
}

describe("Server-backed year navigation", () => {
  it("uses the server-selected year after query navigation instead of retaining the previous client year", () => {
    const { rerender } = render(
      <CmeLogPage
        entries={fixtureEntries.filter((entry) => entry.date.startsWith("2026"))}
        set={fixtureSet}
        navigationYears={[2026, 2025]}
      />,
    );
    expect(screen.getByText(/Journal club — treatment-resistant depression/i)).toBeInTheDocument();
    const set2025 = { ...fixtureSet, year: 2025 };
    rerender(
      <CmeLogPage
        entries={fixtureEntries.filter((entry) => entry.date.startsWith("2025"))}
        set={set2025}
        navigationYears={[2026, 2025]}
      />,
    );
    expect(screen.getByText(/Audit — discharge planning review/i)).toBeInTheDocument();
    expect(screen.queryByText(/Journal club — treatment-resistant depression/i)).toBeNull();
  });
});

describe("One entry", () => {
  afterEach(removeClipboard);

  it("shows every allocation with its category pill", () => {
    render(<CmeEntryPage entryId="fx-2" entries={fixtureEntries} set={fixtureSet} />);
    const section = screen.getByTestId("cme-entry-allocations");
    expect(within(section).getByText("Reviewing performance")).toBeInTheDocument();
    expect(within(section).getByText("Measuring outcomes")).toBeInTheDocument();
  });

  it("shows the reflection in the owner's own words", () => {
    render(<CmeEntryPage entryId="fx-2" entries={fixtureEntries} set={fixtureSet} />);
    expect(screen.getByText("Brought a case for discussion.")).toBeInTheDocument();
  });

  it("shows a guided empty state rather than nothing when there is no reflection yet", () => {
    render(<CmeEntryPage entryId="fx-3" entries={fixtureEntries} set={fixtureSet} />);
    expect(screen.getByTestId("cme-entry-reflection-empty")).toBeInTheDocument();
  });

  it("shows the evidence row, attached or not", () => {
    render(<CmeEntryPage entryId="fx-2" entries={fixtureEntries} set={fixtureSet} />);
    expect(screen.getByTestId("cme-entry-evidence")).toHaveTextContent(/source document is linked/i);

    cleanup();
    render(<CmeEntryPage entryId="fx-1" entries={fixtureEntries} set={fixtureSet} />);
    expect(screen.getByTestId("cme-entry-evidence-empty")).toBeInTheDocument();
  });

  it("shows the cost row, or says plainly that nothing was recorded", () => {
    render(<CmeEntryPage entryId="fx-1" entries={fixtureEntries} set={fixtureSet} />);
    expect(screen.getByTestId("cme-entry-cost")).toHaveTextContent(/not recorded/i);

    cleanup();
    render(<CmeEntryPage entryId="fx-2" entries={fixtureEntries} set={fixtureSet} />);
    expect(screen.getByTestId("cme-entry-cost")).toHaveTextContent("$50.00");
  });

  it("copies the portal text and marks the entry transcribed, never the other way around", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const onCopied = vi.fn();
    render(<CmeEntryPage entryId="fx-1" entries={fixtureEntries} set={fixtureSet} onCopied={onCopied} />);

    expect(screen.getByTestId("cme-entry-transcribed-status")).toHaveTextContent(/not yet copied/i);
    await user.click(screen.getByRole("button", { name: /copy for your cpd home/i }));

    await waitFor(() =>
      expect(screen.getByTestId("cme-entry-transcribed-status")).toHaveTextContent(
        /copied to your clipboard for your cpd home/i,
      ),
    );
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Date: 2026-09-16"));
    expect(onCopied).toHaveBeenCalledWith("fx-1");
  });

  it("never puts the entry's cost on the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<CmeEntryPage entryId="fx-2" entries={fixtureEntries} set={fixtureSet} />);

    await user.click(screen.getByRole("button", { name: /copy for your cpd home/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copiedText = writeText.mock.calls[0]?.[0] as string;
    expect(copiedText).not.toMatch(/50\.00|cost/i);
  });

  it("distinguishes a successful clipboard copy from a failed persisted copy stamp", async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    render(
      <CmeEntryPage
        entryId="fx-1"
        entries={fixtureEntries}
        set={fixtureSet}
        onCopied={vi.fn().mockRejectedValue(new Error("offline"))}
      />,
    );
    await user.click(screen.getByRole("button", { name: /copy for your cpd home/i }));
    await waitFor(() =>
      expect(screen.getByTestId("cme-entry-transcribed-status")).toHaveTextContent(
        /copied to your clipboard, but this record could not be marked/i,
      ),
    );
  });

  it("says plainly when an entry cannot be found, rather than crashing", () => {
    render(<CmeEntryPage entryId="does-not-exist" entries={fixtureEntries} set={fixtureSet} />);
    expect(screen.getByTestId("cme-entry-not-found")).toBeInTheDocument();
  });

  it("paints no clinical status colour anywhere on the page", () => {
    const { container } = render(<CmeEntryPage entryId="fx-2" entries={fixtureEntries} set={fixtureSet} />);
    expect(noClinicalStatusColour(container).map((node) => node.className)).toEqual([]);
  });

  it("gives every interactive element a 48px tap target class", () => {
    const { container } = render(<CmeEntryPage entryId="fx-1" entries={fixtureEntries} set={fixtureSet} />);
    const interactive = [...container.querySelectorAll<HTMLElement>("button, a[href], [role='button']")];
    expect(interactive.length).toBeGreaterThan(0);
    const short = interactive.filter((node) => !hasTapTarget(node.className));
    expect(short.map((node) => node.textContent?.trim() || node.getAttribute("aria-label"))).toEqual([]);
  });
});

describe("Log rows, grouped by month", () => {
  const TODAY = "2026-09-26";

  it("puts each month in one hairline list under its header, with a light total", () => {
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} today={TODAY} />);
    const september = screen.getByTestId("cme-log-month-2026-09");
    expect(within(september).getAllByRole("list")).toHaveLength(1);
    expect(within(september).getAllByRole("listitem")).toHaveLength(2);
    const total = within(september).getByText("2.5 h");
    expect(total.textContent).toBe("2.5 h");
    expect(total.className).toMatch(/\bfont-normal\b/);
    expect(total.className).toMatch(/\bnormal-case\b/);
    // The total sits beside the eyebrow, never inside it, so it can never inherit uppercase.
    expect(within(september).getByRole("heading", { level: 2 })).not.toHaveTextContent("2.5");
  });

  it("reads a row as its title, then the category dot, the category and what is missing, with the hours", () => {
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} today={TODAY} />);
    const row = screen.getByTestId("cme-log-row-fx-3").closest("li") as HTMLElement;
    expect(row).toHaveTextContent("RANZCP WA Branch training day");
    // The date column shows "22 / Aug"; the full date with its weekday is read aloud.
    expect(row).toHaveTextContent("Sat 22 Aug");
    expect(row).toHaveTextContent("Educational · No reflection · Not marked copied");
    expect(row.querySelector("[class*='--cme-cat-1']")).not.toBeNull();
    expect(row.textContent).toContain("5h");
    const journal = screen.getByTestId("cme-log-row-fx-1").closest("li") as HTMLElement;
    expect(journal).toHaveTextContent("Wed 16 Sep");
    expect(journal).toHaveTextContent("Educational · Not marked copied");
    expect(journal.textContent).toContain("1h");
    const peer = screen.getByTestId("cme-log-row-fx-2").closest("li") as HTMLElement;
    expect(peer).toHaveTextContent("Reviewing performance + Measuring outcomes · Marked copied");
    expect(peer.textContent).toContain("1.5h");
  });

  it("says No evidence only when the log has counted none, never when the count is unknown", () => {
    const entries: CmeEntry[] = [
      { ...fixtureEntries[0]!, id: "none", evidenceCount: 0 },
      { ...fixtureEntries[1]!, id: "some", evidenceCount: 2 },
      { ...fixtureEntries[2]!, id: "unknown" },
    ];
    render(<CmeLogPage entries={entries} set={fixtureSet} today={TODAY} />);
    const none = screen.getByTestId("cme-log-row-none").closest("li") as HTMLElement;
    // Grey words on the row's second line, never a filled chip.
    expect(none).toHaveTextContent("Educational · No evidence · Not marked copied");
    expect(screen.getByTestId("cme-log-row-some").closest("li")).not.toHaveTextContent("No evidence");
    expect(screen.getByTestId("cme-log-row-unknown").closest("li")).not.toHaveTextContent("No evidence");
  });

  it("adds the year to a date only when it is not this year", () => {
    render(
      <CmeLogPage
        entries={fixtureEntries.filter((entry) => entry.date.startsWith("2025"))}
        set={{ ...fixtureSet, year: 2025 }}
        navigationYears={[2026, 2025]}
        today={TODAY}
      />,
    );
    expect(screen.getByTestId("cme-log-row-fx-4").closest("li")).toHaveTextContent("Mon 3 Nov 2025");
  });

  it("makes Log an activity the page's one filled button, in CPD indigo, with no floating Log", () => {
    const { container } = render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} today={TODAY} />);
    const filled = [...container.querySelectorAll<HTMLElement>("button, a[href]")].filter(
      (node) =>
        node.className.includes("bg-[color:var(--command)]") ||
        node.className.includes("bg-[color:var(--clinical-accent)]"),
    );
    expect(filled.map((node) => node.getAttribute("data-testid"))).toEqual(["cme-log-new-entry"]);
    expect(screen.getByTestId("cme-log-new-entry")).toHaveTextContent("Log an activity");
    expect(screen.queryByTestId("cme-quick-log-button")).toBeNull();
  });

  it("reminds the owner to keep patient details out of reflections, beside the archived link", async () => {
    const user = userEvent.setup();
    render(<CmeLogPage entries={fixtureEntries} set={fixtureSet} today={TODAY} />);
    expect(screen.getByTestId("cme-log-privacy-reminder")).toHaveTextContent(
      "Reflections are yours: leave out patient names, dates of birth and record numbers.",
    );
    await user.click(screen.getByTestId("cme-log-show-archived"));
    expect(screen.getByTestId("cme-log-show-archived")).toHaveTextContent("Back to active activities");
    expect(screen.getByTestId("cme-log-empty")).toHaveTextContent("No archived activities in 2026.");
  });
});
