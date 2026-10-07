import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CmeRoutinesPage, type CmeRoutinesPageProps } from "@/components/cme/cme-routines-page";
import { CmeRoutinesRoute } from "@/components/cme/cme-routines-route";
import type { CmeRoutine } from "@/lib/cme/routines";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

afterEach(() => {
  vi.restoreAllMocks();
  navigation.push.mockReset();
  navigation.refresh.mockReset();
});

/** 28 September 2026, 10:00 Perth. */
const NOW = new Date("2026-09-28T02:00:00Z");

const dueRoutine: CmeRoutine = {
  id: "r1",
  title: "Supervision",
  cadence: "monthly",
  usualHours: 1,
  usualAllocations: [{ category: "reviewing", hours: 1 }],
  nextDue: "2026-09-28",
  archivedAt: null,
};

const notYetDueRoutine: CmeRoutine = {
  id: "r2",
  title: "Journal club",
  cadence: "quarterly",
  usualHours: 1.5,
  usualAllocations: [],
  nextDue: "2026-12-01",
  archivedAt: null,
};

const archivedRoutine: CmeRoutine = {
  id: "r3",
  title: "Retired peer-review group",
  cadence: "weekly",
  usualHours: 0.5,
  usualAllocations: [],
  nextDue: "2026-09-01",
  archivedAt: "2026-06-01T00:00:00Z",
};

function renderPage(overrides: Partial<CmeRoutinesPageProps> = {}) {
  const onLogDueRoutine = vi.fn();
  const onLogRoutine = vi.fn();
  const onNewRoutine = vi.fn();
  const utils = render(
    <CmeRoutinesPage
      routines={[dueRoutine, notYetDueRoutine, archivedRoutine]}
      now={NOW}
      onLogDueRoutine={onLogDueRoutine}
      onLogRoutine={onLogRoutine}
      onNewRoutine={onNewRoutine}
      {...overrides}
    />,
  );
  return { ...utils, onLogDueRoutine, onLogRoutine, onNewRoutine };
}

/** Every button or link painted with the dark command fill — the "one primary per screen" check (spec §5). */
function commandFilled(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, a[href]")].filter((node) =>
    node.className.includes("bg-[color:var(--command)]"),
  );
}

describe("Routines", () => {
  it("saves a routine, then one-tap logs a due routine with Undo", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/cme/routines" && init?.method === "POST") {
        return new Response(JSON.stringify({ routine: dueRoutine }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/cme/entries" && init?.method === "POST") {
        return new Response(JSON.stringify({ entry: { id: "entry-one-tap" } }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/cme/entries/entry-one-tap" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response("unexpected", { status: 500 });
    });
    render(<CmeRoutinesRoute nowIso={NOW.toISOString()} initialRoutines={[]} demoMode={false} />);
    await user.click(screen.getByRole("button", { name: /new routine/i }));
    await user.type(screen.getByLabelText(/routine name/i), "Supervision");
    await user.click(screen.getByRole("button", { name: /save routine/i }));
    expect(fetchMock).toHaveBeenCalledWith("/api/cme/routines", expect.objectContaining({ method: "POST" }));
    await user.click(screen.getByRole("button", { name: /^log 1\.0 h for supervision$/i }));
    expect(navigation.push).not.toHaveBeenCalled();
    await screen.findByTestId("cme-quick-log-saved");
    expect(screen.getByTestId("cme-quick-log-saved")).toHaveTextContent("Saved to your log.");
    const entryBody = JSON.parse(
      String(fetchMock.mock.calls.find(([url]) => String(url) === "/api/cme/entries")?.[1]?.body),
    );
    expect(entryBody).toMatchObject({
      title: "Supervision",
      routineId: "r1",
      allocations: [{ category: "reviewing", hours: 1 }],
    });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/cme/entries/entry-one-tap", { method: "DELETE" }));
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("opens the form when a due routine has no usual category split", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const noSplit: CmeRoutine = { ...dueRoutine, usualAllocations: [] };
    render(<CmeRoutinesRoute nowIso={NOW.toISOString()} initialRoutines={[noSplit]} demoMode={false} />);
    await user.click(screen.getByRole("button", { name: /^log 1\.0 h for supervision$/i }));
    expect(navigation.push).toHaveBeenCalledWith("/cme/new?routine=r1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the editor open with an error when a save returns an empty 2xx body", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    render(<CmeRoutinesRoute nowIso={NOW.toISOString()} initialRoutines={[]} demoMode={false} />);
    await user.click(screen.getByRole("button", { name: /new routine/i }));
    await user.type(screen.getByLabelText(/routine name/i), "Supervision");
    await user.click(screen.getByRole("button", { name: /save routine/i }));
    expect(await screen.findByText("Could not save this routine.")).toBeInTheDocument();
    expect(screen.getByLabelText(/routine name/i)).toHaveValue("Supervision");
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("still sends the save when navigator.onLine reports offline but the API is reachable", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ routine: dueRoutine }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<CmeRoutinesRoute nowIso={NOW.toISOString()} initialRoutines={[]} demoMode={false} />);
    await user.click(screen.getByRole("button", { name: /new routine/i }));
    await user.type(screen.getByLabelText(/routine name/i), "Supervision");
    await user.click(screen.getByRole("button", { name: /save routine/i }));
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/cme/routines", expect.objectContaining({ method: "POST" }));
    expect(await screen.findByRole("button", { name: /^log 1\.0 h for supervision$/i })).toBeInTheDocument();
  });

  it("takes the next due day as dd/mm/yyyy, with no browser date box", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ routine: dueRoutine }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<CmeRoutinesRoute nowIso={NOW.toISOString()} initialRoutines={[]} demoMode={false} />);
    await user.click(screen.getByRole("button", { name: /new routine/i }));
    await user.type(screen.getByLabelText(/routine name/i), "Supervision");
    await user.type(screen.getByLabelText("Next due"), "1/12/2026");
    await user.click(screen.getByRole("button", { name: /save routine/i }));
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      title: "Supervision",
      nextDue: "2026-12-01",
    });
  });

  // Regression, 2026-09-24: the form opened above the list, out of sight on a
  // phone, with a second h1. It now takes focus when it opens.
  it("moves focus to the routine form when it opens, under the page's one h1", async () => {
    const user = userEvent.setup();
    render(<CmeRoutinesRoute nowIso={NOW.toISOString()} initialRoutines={[]} demoMode={false} />);
    await user.click(screen.getByRole("button", { name: /new routine/i }));
    const heading = screen.getByRole("heading", { level: 2, name: "New routine" });
    expect(heading).toHaveFocus();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("puts a due routine at the top, under Due today, with a one-tap log button", () => {
    renderPage();
    const list = screen.getByTestId("cme-routines-list");
    const rows = within(list).getAllByRole("listitem");
    const due = screen.getByTestId("cme-routines-due-row");
    expect(rows[0]).toBe(due);
    expect(within(due).getByText("Supervision")).toBeInTheDocument();
    // work-mode redesign, owner request 6 Oct 2026: the group heading says Due today, not a chip.
    expect(within(list).getByRole("heading", { level: 2, name: "Due today · 1" })).toBeInTheDocument();
    expect(within(due).getByRole("button", { name: "Log 1.0 h for Supervision" })).toBeInTheDocument();
  });

  it("shows a due routine once, not again under a second heading", () => {
    renderPage();
    expect(screen.getAllByText("Supervision")).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 2, name: "Due now" })).toBeNull();
  });

  it("hands a due Log N h tap to onLogDueRoutine — the route saves; the page does not fetch", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { onLogDueRoutine, onLogRoutine } = renderPage();
    await user.click(screen.getByRole("button", { name: "Log 1.0 h for Supervision" }));
    expect(onLogDueRoutine).toHaveBeenCalledTimes(1);
    expect(onLogDueRoutine).toHaveBeenCalledWith({
      routineId: "r1",
      date: "2026-09-28",
      title: "Supervision",
      hours: 1,
      allocations: [{ category: "reviewing", hours: 1 }],
    });
    expect(onLogRoutine).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says in plain words that due Log saves with Undo", () => {
    renderPage();
    expect(screen.getByTestId("cme-routines-confirmation-note")).toHaveTextContent(
      /saves that activity straight away/i,
    );
    expect(screen.getByTestId("cme-routines-confirmation-note")).toHaveTextContent(/Undo/i);
    expect(screen.getByTestId("cme-routines-confirmation-note")).toHaveTextContent(
      /nothing is recorded from attendance/i,
    );
    // work-mode redesign, owner request 6 Oct 2026: a short hint under the list, as the mock-up draws it, not a fold.
    expect(screen.queryByTestId("cme-routines-how")).toBeNull();
  });

  it("lists every active routine with its next-due date", () => {
    renderPage();
    const list = screen.getByTestId("cme-routines-list");
    expect(within(list).getByText("Journal club")).toBeInTheDocument();
    expect(within(list).getByText(/Next due 1 Dec 2026/)).toBeInTheDocument();
  });

  it("lets the owner log a routine that is not yet due, from the general list", async () => {
    const user = userEvent.setup();
    const { onLogRoutine, onLogDueRoutine } = renderPage();
    await user.click(screen.getByRole("button", { name: "Log now for Journal club" }));
    expect(onLogRoutine).toHaveBeenCalledWith({
      routineId: "r2",
      date: "2026-09-28",
      title: "Journal club",
      hours: 1.5,
      allocations: [],
    });
    expect(onLogDueRoutine).not.toHaveBeenCalled();
  });

  it("gives two due routines with identical usual hours distinct accessible names", () => {
    const otherDueRoutine: CmeRoutine = {
      id: "r4",
      title: "Peer review group",
      cadence: "monthly",
      usualHours: 1,
      usualAllocations: [],
      nextDue: "2026-09-28",
      archivedAt: null,
    };
    renderPage({ routines: [dueRoutine, otherDueRoutine] });
    const due = screen.getAllByTestId("cme-routines-due-row");
    expect(due).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Log 1.0 h for Supervision" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log 1.0 h for Peer review group" })).toBeInTheDocument();
  });

  it("never lists an archived routine as due or coming up, only under Archived", () => {
    renderPage();
    // work-mode redesign, owner request 6 Oct 2026: archived routines sit in their own group to restore.
    expect(within(screen.getByTestId("cme-routines-list")).queryByText("Retired peer-review group")).toBeNull();
    expect(
      within(screen.getByTestId("cme-routines-archived")).getByText("Retired peer-review group"),
    ).toBeInTheDocument();
  });

  it("offers a New routine control", async () => {
    const user = userEvent.setup();
    const { onNewRoutine } = renderPage();
    await user.click(screen.getByRole("button", { name: /new routine/i }));
    expect(onNewRoutine).toHaveBeenCalledTimes(1);
  });

  it("shows a plain empty state when there are no routines yet", () => {
    renderPage({ routines: [] });
    expect(screen.getByTestId("cme-routines-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("cme-routines-due-row")).toBeNull();
    expect(screen.queryByTestId("cme-routines-list")).toBeNull();
    // Still offered — a routine with no data yet is still not a reason to hide the control.
    expect(screen.getByRole("button", { name: /new routine/i })).toBeInTheDocument();
  });

  it("says nothing is due, in words, when nothing is", () => {
    renderPage({ routines: [notYetDueRoutine] });
    expect(screen.queryByTestId("cme-routines-due-row")).toBeNull();
    expect(screen.getByTestId("cme-routines-due-empty")).toHaveTextContent(/nothing is due/i);
  });

  it("keeps every tappable control at the 48px tap-target floor", () => {
    const { container } = renderPage();
    const interactive = [...container.querySelectorAll("button, a[href]")];
    expect(interactive.length).toBeGreaterThan(0);
    for (const node of interactive) {
      expect(node.className).toMatch(/\bmin-h-(?:12|tap)\b/);
    }
  });

  it("paints no clinical status colour anywhere on the screen", () => {
    const { container } = renderPage();
    const offenders = [...container.querySelectorAll<HTMLElement>("[class]")].filter((node) =>
      /\b(?:bg|text|border|ring)-(?:red|amber|green|orange|rose|emerald|yellow)-/.test(node.className),
    );
    expect(offenders.map((node) => node.className)).toEqual([]);
  });

  it("draws no dark button on the list: Log, Log now, Edit and New routine are all outlined", () => {
    const { container } = renderPage({ onEditRoutine: vi.fn() });
    expect(commandFilled(container)).toEqual([]);
    expect(screen.getByRole("button", { name: "Log 1.0 h for Supervision" })).toHaveTextContent("Log 1.0 h");
    expect(screen.getByRole("button", { name: "Log now for Journal club" })).toHaveTextContent("Log now");
    expect(screen.getByRole("button", { name: "Edit Journal club" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new routine/i })).toBeInTheDocument();
  });

  it("draws Due today and Coming up as groups of rows", () => {
    renderPage();
    const list = screen.getByTestId("cme-routines-list");
    // work-mode redesign, owner request 6 Oct 2026: two groups, as the mock-up draws them.
    expect(within(list).getByRole("heading", { level: 2, name: "Coming up" })).toBeInTheDocument();
    expect(within(list).getAllByRole("list")).toHaveLength(2);
    // The due routine and the not-yet-due one, once each; the archived routine is still left out.
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getAllByTestId("cme-routines-due-row")).toHaveLength(1);
  });

  it("keeps Save routine as the one dark button while the routine form is open", async () => {
    const user = userEvent.setup();
    render(
      <CmeRoutinesRoute nowIso={NOW.toISOString()} initialRoutines={[dueRoutine, notYetDueRoutine]} demoMode={false} />,
    );
    await user.click(screen.getByRole("button", { name: /new routine/i }));
    expect(commandFilled(document.body).map((node) => node.textContent?.trim())).toEqual(["Save routine"]);
  });
});
