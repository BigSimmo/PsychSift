import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CmeAnnualSummary } from "@/components/cme/cme-annual-summary";
import { CmeDashboard } from "@/components/cme/cme-dashboard";
import { CmeEntryPage } from "@/components/cme/cme-entry-page";
import { CmeNewEntryRoute } from "@/components/cme/cme-new-entry-route";
import { CmeCategoryBar, CmePaceChart, hoursByCategory } from "@/components/cme/cme-progress-visuals";
import { CmeQuickLog } from "@/components/cme/cme-quick-log";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";

const navigation = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => navigation, usePathname: () => "/cme" }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigation.push.mockReset();
  navigation.refresh.mockReset();
  window.sessionStorage.clear();
});

const SET: CmeRequirementSet = {
  year: 2026,
  confirmedOn: "2026-01-02",
  confirmedSource: "Test fixture",
  totalHours: 50,
  requirements: [
    {
      id: "req-educational",
      label: "Educational activities",
      source: "national",
      spec: { shape: "hours-in-category", category: "educational", minimumHours: 12.5 },
      completedOn: null,
    },
    {
      id: "req-measuring",
      label: "Measuring outcomes",
      source: "national",
      spec: { shape: "hours-in-category", category: "measuring", minimumHours: 5 },
      completedOn: null,
    },
  ],
};

function entry(overrides: Partial<CmeEntry> & Pick<CmeEntry, "id" | "date">): CmeEntry {
  return {
    title: "Activity",
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

const ENTRIES: readonly CmeEntry[] = [
  entry({ id: "e1", date: "2026-02-10", allocations: [{ category: "educational", hours: 14 }] }),
  entry({ id: "e2", date: "2026-05-04", allocations: [{ category: "reviewing", hours: 6 }] }),
  entry({
    id: "e3",
    date: "2026-07-20",
    allocations: [
      { category: "reviewing", hours: 1 },
      { category: "measuring", hours: 1.5 },
    ],
  }),
  entry({
    id: "archived",
    date: "2026-03-01",
    archivedAt: "2026-03-02T00:00:00Z",
    allocations: [{ category: "measuring", hours: 20 }],
  }),
];

describe("the dashboard's progress picture", () => {
  it("keeps the coloured category bar off Today", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={new Date("2026-09-01T02:00:00Z")} />);
    expect(screen.queryByTestId("cme-category-bar")).toBeNull();
  });

  it("says each category's hours in words beside the category bar, leaving archived entries out", () => {
    render(<CmeCategoryBar entries={ENTRIES} targetHours={SET.totalHours} />);
    const legend = within(screen.getByTestId("cme-category-bar")).getByRole("list", { name: "Hours by category" });
    expect(legend).toHaveTextContent("Educational14 h");
    expect(legend).toHaveTextContent("Reviewing7 h");
    expect(legend).toHaveTextContent("Outcomes1.5 h");
    expect(hoursByCategory(ENTRIES)).toEqual({ educational: 14, reviewing: 7, measuring: 1.5 });
  });

  it("gives a requirement an open circle until it is met, and folds it under a tick once it is", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={new Date("2026-09-01T02:00:00Z")} />);
    const items = within(screen.getByTestId("cme-requirements")).getAllByRole("listitem");
    const rows = items.filter((item) => item.hasAttribute("data-met"));
    const educational = rows.find((item) => item.textContent?.startsWith("Educational activities"))!;
    const measuring = rows.find((item) => item.textContent?.startsWith("Measuring outcomes"))!;
    expect(educational).toHaveAttribute("data-met", "true");
    expect(educational.closest("details")).toBe(screen.getByTestId("cme-requirements-done"));
    expect(measuring).toHaveAttribute("data-met", "false");
    expect(measuring.querySelector(".rounded-full")).not.toBeNull();
  });

  it("says each category's hours in words in the summary, in CPD's indigo shades, leaving archived entries out", () => {
    render(<CmeDashboard set={SET} entries={ENTRIES} now={new Date("2026-09-01T02:00:00Z")} />);
    const legend = within(screen.getByTestId("cme-year-summary")).getByRole("list", { name: "Hours by category" });
    expect(legend).toHaveTextContent("Educational14 h");
    expect(legend).toHaveTextContent("Reviewing performance7 h");
    expect(legend).toHaveTextContent("Measuring outcomes1.5 h");
    const bar = screen.getByTestId("cme-summary-bar");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    // work-mode redesign, owner request 6 Oct 2026: the hero's own shades of the same indigo.
    expect(bar.innerHTML).toMatch(/--cme-(?:hero-)?cat-1/);
    expect(bar.innerHTML).not.toMatch(/--tone-(rose|purple|green|red|amber)/);
  });
});

describe("the pace chart", () => {
  it("states the even pace as a number, never as ahead or behind", () => {
    render(
      <CmePaceChart
        entries={[entry({ id: "big", date: "2026-01-05", allocations: [{ category: "educational", hours: 40 }] })]}
        year={2026}
        targetHours={50}
        todayIndex={60}
      />,
    );
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "40 hours logged so far. An even pace to 50 hours by 31 December would be about 8 by today.",
    );
  });
});

describe("quick log", () => {
  it("opens from the Year page's own Log an activity button, with no floating + Log beside it", async () => {
    const user = userEvent.setup();
    render(
      <>
        <CmeDashboard set={SET} entries={ENTRIES} now={new Date("2026-09-01T02:00:00Z")} />
        <CmeQuickLog set={SET} entries={ENTRIES} />
      </>,
    );
    // One filled button for logging: the page's own; the floating one stays away.
    await waitFor(() => expect(screen.queryByTestId("cme-quick-log-button")).toBeNull());
    const log = screen.getByTestId("cme-log-activity");
    await user.click(log);
    expect(await screen.findByTestId("cme-quick-log-sheet")).toBeInTheDocument();
    // The panel opened in place: nothing navigated to the full page.
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("keeps save in the fixed sheet footer and accepts Ctrl+Enter from the form", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ entry: { id: "keyboard-entry" } }), { status: 201 }));
    render(<CmeQuickLog set={SET} />);
    await user.click(screen.getByTestId("cme-quick-log-button"));
    const sheet = await screen.findByTestId("cme-quick-log-sheet");
    const footer = within(sheet).getByTestId("cme-quick-log-actions");
    expect(within(footer).getByRole("button", { name: "Save entry" })).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText(/what was it/i), "Keyboard seminar");
    await user.click(within(sheet).getByRole("button", { name: "1" }));
    await user.click(within(sheet).getByRole("button", { name: "Educational" }));
    await user.type(within(sheet).getByLabelText("Reflection"), "Compared the guidance.");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).title).toBe("Keyboard seminar");
  });

  it("keeps an incomplete activity as an account draft from the sheet footer", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ draft: { id: "draft-1" } }), { status: 201 }));
    render(<CmeQuickLog set={SET} />);
    await user.click(screen.getByTestId("cme-quick-log-button"));
    const sheet = await screen.findByTestId("cme-quick-log-sheet");
    await user.type(within(sheet).getByLabelText(/what was it/i), "Unfinished seminar");
    await user.click(within(sheet).getByRole("button", { name: "Keep as draft" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/cme/drafts", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).payload.title).toBe("Unfinished seminar");
    expect(navigation.push).toHaveBeenCalledWith("/cme/log?tab=finish#cme-drafts");
  });

  it("opens the entry form in a panel, saves with one request, and says it landed", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ entry: { id: "new" } }), { status: 201 }));
    render(<CmeQuickLog set={SET} />);

    await user.click(screen.getByTestId("cme-quick-log-button"));
    const sheet = await screen.findByTestId("cme-quick-log-sheet");
    await user.type(within(sheet).getByLabelText(/what was it/i), "Grand round");
    await user.click(within(sheet).getByRole("button", { name: "1" }));
    await user.click(within(sheet).getByRole("button", { name: "Educational" }));
    await user.click(within(sheet).getByRole("button", { name: /save entry/i }));

    await waitFor(() => expect(screen.getByTestId("cme-quick-log-saved")).toHaveTextContent("Saved to your log."));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ title: "Grand round", allocations: [{ category: "educational", hours: 1 }] });
    expect(typeof body.requestId).toBe("string");
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("cme-quick-log-sheet")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/cme/entries/new", { method: "DELETE" });
  });

  it("fills the recent title and hours without saving", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(
      <CmeQuickLog
        set={SET}
        entries={[entry({ id: "recent", date: "2026-09-01", title: "Synthetic seminar" })]}
        nowIso="2026-09-26T02:00:00Z"
      />,
    );
    await user.click(screen.getByTestId("cme-quick-log-button"));
    const sheet = await screen.findByTestId("cme-quick-log-sheet");
    await user.click(within(sheet).getByRole("button", { name: /synthetic seminar/i }));
    expect(within(sheet).getByLabelText(/what was it/i)).toHaveValue("Synthetic seminar");
    expect(within(sheet).getByRole("button", { name: /save entry/i })).not.toHaveAttribute("aria-disabled", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the panel open with the reason when the save fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "The record could not be saved yet." }), { status: 503 }),
    );
    render(<CmeQuickLog set={SET} />);
    await user.click(screen.getByTestId("cme-quick-log-button"));
    const sheet = await screen.findByTestId("cme-quick-log-sheet");
    await user.type(within(sheet).getByLabelText(/what was it/i), "Grand round");
    await user.click(within(sheet).getByRole("button", { name: "1" }));
    await user.click(within(sheet).getByRole("button", { name: "Educational" }));
    await user.click(within(sheet).getByRole("button", { name: /save entry/i }));
    expect(await within(sheet).findByText("The record could not be saved yet.")).toBeInTheDocument();
    expect(within(sheet).getByLabelText(/what was it/i)).toHaveValue("Grand round");
    expect(navigation.refresh).not.toHaveBeenCalled();
  });
});

describe("log it again", () => {
  const original = entry({
    id: "orig",
    date: "2026-03-10",
    title: "Monthly peer review",
    allocations: [{ category: "reviewing", hours: 1.5 }],
    reflection: "Last month's own reflection",
    costCents: 2500,
    buckets: [],
  });

  it("links a saved entry to a new entry copied from it, from the activity's actions", async () => {
    const user = userEvent.setup();
    render(<CmeEntryPage entryId="orig" entries={[original]} set={SET} />);
    await user.click(screen.getByRole("button", { name: "Open activity actions" }));
    expect(await screen.findByTestId("cme-entry-log-again")).toHaveAttribute("href", "/cme/new?year=2026&repeat=orig");
  });

  it("copies the title and hours but not the reflection or cost", () => {
    render(<CmeNewEntryRoute repeatOf={original} set={SET} />);
    expect(screen.getByTestId("cme-entry-repeat-notice")).toBeInTheDocument();
    expect(screen.getByLabelText(/what was it/i)).toHaveValue("Monthly peer review");
    expect(within(screen.getByRole("group", { name: "Hours" })).getByRole("button", { name: "1.5" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Reviewing" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Reflection")).toHaveValue("");
    expect(screen.getByLabelText(/what it cost/i)).toHaveValue("");
  });
});

describe("annual summary PDF", () => {
  it("names the file after the year while the print screen is open, then puts the title back", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      expect(document.title).toBe("CPD annual summary 2026");
      window.dispatchEvent(new Event("afterprint"));
    });
    document.title = "Summary | CPD";
    render(<CmeAnnualSummary set={SET} entries={ENTRIES} />);
    screen.getByTestId("cme-summary-save-pdf").click();
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.title).toBe("Summary | CPD");
  });
});
