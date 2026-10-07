/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cpdHomeFields } from "@/components/cme/cme-log-copy-fields";
import { CmeLogPage } from "@/components/cme/cme-log-page";
import { formatEntryForCpdHome } from "@/lib/cme/clipboard";
import { DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cme/log",
}));

const SET: CmeRequirementSet = { ...DEMO_CME_YEAR, year: 2026 };

function entry(overrides: Partial<CmeEntry> & Pick<CmeEntry, "id" | "date" | "title">): CmeEntry {
  return {
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

const ENTRIES: CmeEntry[] = [
  entry({
    id: "a",
    date: "2026-09-16",
    title: "Peer review group",
    allocations: [
      { category: "reviewing", hours: 1 },
      { category: "measuring", hours: 0.5 },
    ],
    reflection: "Brought a case.\nDiscussed follow-up.",
    costCents: 12_345,
  }),
  entry({ id: "b", date: "2026-08-02", title: "Grand round" }),
  entry({ id: "c", date: "2026-07-01", title: "Already copied", transcribed: true }),
];

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
});

/** After `userEvent.setup()`, which installs its own clipboard stub. */
function stubClipboard() {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true, writable: true });
});

function okFetch() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ entry: {} }), { status: 200 }));
}

async function openSheet(props: Partial<Parameters<typeof CmeLogPage>[0]> = {}) {
  const user = userEvent.setup();
  stubClipboard();
  render(<CmeLogPage entries={ENTRIES} set={SET} initialAttention="copy" today="2026-09-26" {...props} />);
  await user.click(screen.getByTestId("cme-log-copy-next"));
  return { user, sheet: screen.getByTestId("cme-log-copy-sheet") };
}

describe("cpdHomeFields", () => {
  it("splits the CPD-home text into its lines, keeping a multi-line reflection whole and never a cost", () => {
    const text = formatEntryForCpdHome(ENTRIES[0]!, SET);
    const fields = cpdHomeFields(text);
    expect(fields.map((field) => field.label)).toEqual([
      "Date",
      "Activity",
      "Hours",
      "Reviewing performance",
      "Measuring outcomes",
      "Year",
      "Reflection",
    ]);
    expect(fields.at(-1)?.value).toBe("Brought a case.\nDiscussed follow-up.");
    expect(fields.map((field) => `${field.label}: ${field.value}`).join("\n")).toBe(text);
    expect(text).not.toMatch(/123\.45|cost/i);
  });

  it("keeps a title that itself holds a colon", () => {
    const fields = cpdHomeFields("Date: 2026-01-01\nActivity: Webinar: sleep\nHours: 1\nYear: 2026");
    expect(fields[1]).toEqual({ label: "Activity", value: "Webinar: sleep" });
    expect(fields).toHaveLength(4);
  });
});

describe("copy to your CPD home, one at a time", () => {
  it("names the sheet, counts the queue and shows each field with its own Copy, never the cost", async () => {
    const { sheet } = await openSheet();
    expect(within(sheet).getByText("Copy to your CPD home")).toBeInTheDocument();
    expect(within(sheet).getByText("1 of 2")).toBeInTheDocument();
    const fields = within(sheet).getByTestId("cme-log-copy-fields");
    expect(within(fields).getByText("Peer review group")).toBeInTheDocument();
    expect(within(fields).getByRole("button", { name: "Copy Activity" })).toBeInTheDocument();
    expect(within(fields).getByRole("button", { name: "Copy Reflection" })).toBeInTheDocument();
    expect(sheet).not.toHaveTextContent(/123\.45|cost/i);
  });

  it("copies one field's value on its own, and everything as the full CPD-home text", async () => {
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByRole("button", { name: "Copy Activity" }));
    expect(writeText).toHaveBeenLastCalledWith("Peer review group");
    expect(within(sheet).getByRole("button", { name: "Activity copied" })).toBeInTheDocument();
    await user.click(within(sheet).getByTestId("cme-log-copy-all"));
    expect(writeText).toHaveBeenLastCalledWith(formatEntryForCpdHome(ENTRIES[0]!, SET));
  });

  it("says so when the clipboard fails and records nothing", async () => {
    const fetchMock = okFetch();
    writeText.mockRejectedValue(new Error("denied"));
    // The fallback path fails too.
    document.execCommand = vi.fn().mockReturnValue(false);
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByTestId("cme-log-copy-all"));
    expect(within(sheet).getByTestId("cme-log-copy-error")).toHaveTextContent("Could not copy");
    expect(within(sheet).getByTestId("cme-log-copy-all")).toHaveTextContent("Copy everything");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(sheet).getByText("1 of 2")).toBeInTheDocument();
  });

  it("skips without marking, then marks the next only when asked, and finishes honestly", async () => {
    const fetchMock = okFetch();
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByTestId("cme-log-copy-skip"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(sheet).getByText("2 of 2")).toBeInTheDocument();
    expect(within(sheet).getByTestId("cme-log-copy-fields")).toHaveTextContent("Grand round");

    await user.click(within(sheet).getByTestId("cme-log-copy-mark"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/cme/entries/b");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ transcribed: true });
    const finished = await within(sheet).findByTestId("cme-log-copy-finished");
    // One was skipped, so the sheet does not claim everything is copied.
    expect(finished).toHaveTextContent("1 activity not marked copied yet");
    expect(within(sheet).getByTestId("cme-log-copy-last")).toHaveTextContent("Grand round");
    await user.click(within(sheet).getByTestId("cme-log-copy-close"));
    await waitFor(() => expect(screen.queryByTestId("cme-log-copy-sheet")).toBeNull());
    expect(screen.getByTestId("cme-log-copy-done")).toHaveTextContent("Marked copied.");
  });

  it("says every activity is copied when none remain", async () => {
    okFetch();
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByTestId("cme-log-copy-mark"));
    await within(sheet).findByText("2 of 2");
    await user.click(within(sheet).getByTestId("cme-log-copy-mark"));
    expect(await within(sheet).findByTestId("cme-log-copy-finished")).toHaveTextContent(
      "Every activity is marked copied.",
    );
  });

  it("keeps the activity in place and says so when the copied stamp cannot be saved", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByTestId("cme-log-copy-mark"));
    expect(await within(sheet).findByTestId("cme-log-copy-error")).toHaveTextContent("could not be marked copied");
    expect(within(sheet).getByText("1 of 2")).toBeInTheDocument();
  });

  it("undo clears the stamp and returns to that activity", async () => {
    const fetchMock = okFetch();
    const { user, sheet } = await openSheet();
    await user.click(within(sheet).getByTestId("cme-log-copy-mark"));
    await within(sheet).findByText("2 of 2");
    await user.click(within(within(sheet).getByTestId("cme-log-copy-last")).getByRole("button", { name: "Undo" }));
    await within(sheet).findByText("1 of 2");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ transcribed: false });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("/api/cme/entries/a");
  });

  it("is read-only in the demo: nothing copies or saves, and it says why", async () => {
    const fetchMock = okFetch();
    const { user, sheet } = await openSheet({ demoMode: true });
    expect(within(sheet).getByTestId("cme-log-copy-demo")).toHaveTextContent(
      "Sign in to copy and track activities in your private CPD record.",
    );
    const mark = within(sheet).getByTestId("cme-log-copy-mark");
    expect(mark).toBeDisabled();
    expect(mark).not.toHaveAttribute("aria-disabled");
    expect(within(sheet).getByTestId("cme-log-copy-all")).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: "Copy Activity" })).toBeDisabled();
    // Skip saves nothing, so it still steps through.
    await user.click(within(sheet).getByTestId("cme-log-copy-skip"));
    expect(within(sheet).getByText("2 of 2")).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("log page structure", () => {
  it("wraps the category chip and the three status chips, in the mock-up's order, each with its count", () => {
    render(<CmeLogPage entries={ENTRIES} set={SET} today="2026-09-26" />);
    const chips = screen.getByTestId("cme-log-attention");
    expect(chips.parentElement?.className).toMatch(/\bflex-wrap\b/);
    expect(within(chips.parentElement!).getByTestId("cme-log-category-chip")).toHaveTextContent("All categories");
    expect(
      within(chips)
        .getAllByRole("button")
        .map((chip) => chip.textContent),
    ).toEqual(["Not marked copied2", "No reflection2", "No evidence0"]);
  });

  it("draws a twelve-month strip whose logged months jump to their section", () => {
    render(<CmeLogPage entries={ENTRIES} set={SET} today="2026-09-26" />);
    const strip = screen.getByRole("navigation", { name: "Jump to month" });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(12);
    const september = within(strip).getByRole("link", { name: "September, 1.5 hours, jump to month" });
    expect(september).toHaveAttribute("href", "#cme-log-month-anchor-2026-09");
    expect(september).toHaveAttribute("aria-current", "date");
    expect(document.getElementById("cme-log-month-anchor-2026-09")).toBe(screen.getByTestId("cme-log-month-2026-09"));
    // An empty month is never a dead link; a month still to come shows no figure.
    expect(within(strip).queryByRole("link", { name: /^June/ })).toBeNull();
    expect(strip).toHaveTextContent("June, 0 hours");
    expect(screen.getByTestId("cme-log-month-hours-2026-06")).toHaveTextContent("0");
    expect(strip).toHaveTextContent("October, still to come");
    expect(screen.getByTestId("cme-log-month-hours-2026-10")).toHaveTextContent("");
    expect(within(strip).getByRole("heading", { name: "Hours by month · tap to jump" })).toBeInTheDocument();
    // The bars add up to the year total at the right of the label.
    const bars = [...strip.querySelectorAll("[data-month-bar]")];
    expect(bars).toHaveLength(12);
    const sum = bars.reduce((acc, bar) => acc + Number(bar.getAttribute("data-hours")), 0);
    expect(screen.getByTestId("cme-log-month-total").querySelector("[aria-hidden]")?.textContent).toBe(`${sum}\u00a0h`);
    expect(screen.getByTestId("cme-log-month-total")).toHaveTextContent(`${sum} hours in 2026`);
    expect(screen.getByTestId("cme-log-month-hours-2026-09")).toHaveTextContent("1.5");
    // work-mode redesign, owner request 6 Oct 2026: pale bars, the current month the one
    // copper mark, set by data attribute for the area's own CSS.
    expect(strip.querySelector('[data-month-bar="2026-09"]')).toHaveAttribute("data-current");
    expect(strip.querySelector('[data-month-bar="2026-08"]')).not.toHaveAttribute("data-current");
  });

  it("offers the next uncopied activity from a plain note, naming MyCPD only for a RANZCP year", () => {
    const { unmount } = render(<CmeLogPage entries={ENTRIES} set={SET} today="2026-09-26" />);
    const note = screen.getByTestId("cme-log-copy-help");
    // work-mode redesign, owner request 6 Oct 2026: the mock-up's "3 not marked copied" strip.
    expect(note).toHaveTextContent("2 not marked copied to your CPD home");
    // work-mode redesign, owner request 6 Oct 2026: the mock-up's short strip line.
    expect(note).toHaveTextContent("Copy one, paste it into your CPD home");
    expect(note).not.toHaveTextContent(/MyCPD|RANZCP/);
    expect(within(note).getByRole("button", { name: "Copy next" })).toBeInTheDocument();
    unmount();
    render(
      <CmeLogPage
        entries={ENTRIES}
        set={{ ...SET, confirmedSource: "au-ranzcp-2026-v1; https://example.org/guide" }}
        today="2026-09-26"
      />,
    );
    const ranzcp = screen.getByTestId("cme-log-copy-help");
    expect(ranzcp).toHaveTextContent("2 not marked copied to MyCPD");
    expect(ranzcp).toHaveTextContent("Copy one, paste it into MyCPD");
  });

  it("pins each month header within its month on a surface token", () => {
    render(<CmeLogPage entries={ENTRIES} set={SET} today="2026-09-26" />);
    const header = screen.getByTestId("cme-log-month-header-2026-09");
    expect(header.className).toMatch(/\bsticky\b/);
    expect(header.className).toMatch(/\btop-0\b/);
    expect(header.className).toContain("bg-[color:var(--surface-raised)]"); // work-mode redesign, owner request 6 Oct 2026: work pages sit on white
  });

  it("keeps Download CSV and the annual summary reachable behind More", async () => {
    const user = userEvent.setup();
    render(<CmeLogPage entries={ENTRIES} set={SET} today="2026-09-26" />);
    expect(screen.queryByText("Download CSV")).toBeNull();
    await user.click(screen.getByRole("button", { name: "More log actions" }));
    const sheet = screen.getByTestId("cme-log-more-sheet");
    expect(within(sheet).getByRole("link", { name: "Download CSV" })).toHaveAttribute(
      "href",
      "/api/cme/export?year=2026",
    );
    expect(within(sheet).getByRole("link", { name: "Annual summary" })).toHaveAttribute(
      "href",
      "/cme/summary?year=2026",
    );
  });

  it("heads the To finish tab as To finish, not as the activity list", () => {
    render(<CmeLogPage entries={ENTRIES} set={SET} initialTab="finish" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("To finish");
    expect(screen.queryByText("Every activity you have recorded, by year.")).toBeNull();
    expect(screen.queryByRole("button", { name: "More log actions" })).toBeNull();
  });

  it("moves another year by number into the filter sheet when the server owns the year", async () => {
    const user = userEvent.setup();
    render(<CmeLogPage entries={ENTRIES} set={SET} navigationYears={[2026, 2025]} today="2026-09-26" />);
    expect(screen.queryByTestId("cme-log-year-jump")).toBeNull();
    await user.click(screen.getByTestId("cme-log-open-filters"));
    const sheet = screen.getByTestId("cme-log-filter-sheet");
    expect(within(sheet).getByTestId("cme-log-year-jump")).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Open another year")).toHaveValue(2026);
    expect(within(sheet).getByRole("link", { name: /^2025/ })).toHaveAttribute("href", "/cme/log?year=2025");
  });
});
