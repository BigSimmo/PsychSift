/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RosterGrid } from "@/lib/roster/import/grid";
import { ON_CALL_SHIFT_IMPORT_MAX, type OnCallShift } from "@/lib/roster/shifts/model";
import { perthWallToIso } from "@/lib/roster/shifts/perth-time";

/*
 * Roster's import flow: pick a file, say which row is you, see only what
 * changes, and choose each unknown code before Save. Every roster here is
 * invented ("Example Hospital", "Dr Alex Example").
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/roster/shifts",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { RosterShiftsPage } from "@/components/roster/roster-shifts-page";

type Handler = (init?: RequestInit) => Response | Promise<Response>;
const routes = new Map<string, Handler>();
let fetchMock: ReturnType<typeof vi.fn>;
const now = new Date("2026-10-05T01:00:00.000Z"); // 09:00 Monday in Perth

const DAY_CODE = { D: { kind: "day", start: "08:00", end: "16:30" } };

function gridWithCodes(codes: string[]): RosterGrid {
  const dates = codes.map((_, index) => `2026-10-${String(12 + index).padStart(2, "0")}`);
  return {
    dates,
    rows: [
      { name: "Dr Sam Example", cells: codes.map(() => "N") },
      { name: "Dr Alex Example", cells: codes },
    ],
  };
}
function mockShifts(shifts: OnCallShift[]) {
  routes.set("GET /api/roster/shifts", () => Response.json({ shifts, latestImport: null }));
}
let serverSettings: Record<string, unknown> = {};
function mockSettings(settings: Record<string, unknown>) {
  serverSettings = settings;
}
function mockReadFile(grid: RosterGrid) {
  routes.set("POST /api/roster/read-file", () => Response.json({ grid }));
}
function fetchCalls(url: string, method: string) {
  return fetchMock.mock.calls.filter(([input, init]) => String(input) === url && (init?.method ?? "GET") === method);
}
async function importFile(name: string, content = "roster") {
  // Shifts offers Import in its Roster tools list, or as the first step when there are no shifts yet.
  fireEvent.click((await screen.findAllByRole("button", { name: /Import a roster file/ }))[0]!);
  const input = await screen.findByTestId("roster-import-file");
  fireEvent.change(input, { target: { files: [new File([content], name)] } });
}
async function chooseRow(name: string) {
  fireEvent.click(await screen.findByRole("button", { name }));
}
async function chooseCode(code: string, meaning: "Day off") {
  fireEvent.click(await screen.findByRole("button", { name: `Choose ${code}` }));
  fireEvent.click(within(await screen.findByTestId("roster-code-chooser")).getByRole("button", { name: meaning }));
}

beforeEach(() => {
  routes.clear();
  mockShifts([]);
  mockSettings({ calendarShifts: false, rowName: null, codes: { "": DAY_CODE } });
  routes.set("GET /api/roster/settings", () => Response.json({ settings: serverSettings }));
  routes.set("PUT /api/roster/settings", (init) => {
    serverSettings = { ...serverSettings, ...JSON.parse(String(init?.body)) };
    return Response.json({ settings: serverSettings });
  });
  routes.set("POST /api/roster/shifts", (init) => {
    const body = JSON.parse(String(init?.body)) as { shifts: Array<Omit<OnCallShift, "id">> };
    return Response.json({ shifts: body.shifts.map((item, index) => ({ ...item, id: `saved-${index}` })) });
  });
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const handler = routes.get(`${init?.method ?? "GET"} ${String(input)}`);
    return handler ? handler(init) : Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Roster import flow", () => {
  it("keeps Save disabled until every unknown code is chosen", async () => {
    mockReadFile(gridWithCodes(["D", "ADO"]));
    render(<RosterShiftsPage now={now} />);
    await importFile("oct.xlsx");
    await chooseRow("Dr Alex Example");
    expect(screen.getByRole("button", { name: /Save/ })).toBeDisabled();
    expect(screen.getByTestId("roster-import-unknown")).toHaveTextContent("Used on 1 day");
    await chooseCode("ADO", "Day off");
    expect(screen.getByRole("button", { name: /Save/ })).toBeEnabled();

    // The row and the code are remembered on the server, never on the device.
    const puts = fetchCalls("/api/roster/settings", "PUT").map(([, init]) => JSON.parse(String(init?.body)));
    expect(puts).toContainEqual({ rowName: "Dr Alex Example" });
    expect(puts).toContainEqual({ codes: { "": { ...DAY_CODE, ADO: { kind: "off" } } } });
  });

  it("never saves codes over settings that did not load, which would wipe the stored ones", async () => {
    routes.set("GET /api/roster/settings", () => Response.json({ error: "Unavailable" }, { status: 503 }));
    mockReadFile(gridWithCodes(["ADO"]));
    render(<RosterShiftsPage now={now} />);
    await importFile("oct.xlsx");
    await chooseRow("Dr Alex Example");
    await chooseCode("ADO", "Day off");
    expect(screen.getByRole("button", { name: /Save/ })).toBeEnabled();
    const puts = fetchCalls("/api/roster/settings", "PUT").map(([, init]) => JSON.parse(String(init?.body)));
    expect(puts.some((put) => "codes" in put)).toBe(false);
  });

  it("skips Which row is you when the remembered name is in the file, and sends only the grid's shifts", async () => {
    mockSettings({ calendarShifts: false, rowName: "Example, Alex", codes: { "": DAY_CODE } });
    mockReadFile(gridWithCodes(["D", "OFF", "D"]));
    render(<RosterShiftsPage now={now} />);
    await importFile("oct.xlsx");
    expect(await screen.findByTestId("roster-import-found")).toHaveTextContent("oct.xlsx · 2 shifts found");
    expect(screen.queryByTestId("roster-import-rows")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save 2 shifts" }));
    await waitFor(() => expect(fetchCalls("/api/roster/shifts", "POST")).toHaveLength(1));
    const body = JSON.parse(String(fetchCalls("/api/roster/shifts", "POST")[0]?.[1]?.body));
    expect(body).toMatchObject({ format: "xlsx", workplace: null, fileName: "oct.xlsx" });
    expect(body).toMatchObject({ windowStart: "2026-10-12", windowEnd: "2026-10-14" });
    expect(body.shifts.map((item: { kind: string }) => item.kind)).toEqual(["day", "day"]);
    expect(JSON.stringify(body)).not.toContain("Sam Example");
  });

  it("shows only what changes, the old value struck through, and how many are unchanged", async () => {
    const stored = (date: string, start: string, end: string): OnCallShift => ({
      id: `s-${date}`,
      startsAt: perthWallToIso(date, start)!,
      endsAt: perthWallToIso(date, end)!,
      title: "Day",
      location: null,
      sourceUid: null,
      kind: "day",
      source: "import",
      seriesId: null,
      workplace: "Example Hospital",
    });
    mockShifts([stored("2026-10-12", "08:00", "16:30"), stored("2026-10-13", "09:00", "17:00")]);
    mockSettings({ calendarShifts: false, rowName: "Dr Alex Example", codes: { "Example Hospital": DAY_CODE } });
    mockReadFile(gridWithCodes(["D", "D", "D"]));
    render(<RosterShiftsPage now={now} />);
    await importFile("oct.xlsx");
    const changes = await screen.findByTestId("roster-import-changes");
    expect(within(changes).getAllByTestId("roster-import-change")).toHaveLength(2);
    expect(changes.querySelector("s")).toHaveTextContent("Day 09:00–17:00");
    expect(changes).toHaveTextContent("New · Day 08:00–16:30");
    expect(screen.getByTestId("roster-import-unchanged")).toHaveTextContent("1 unchanged");
  });

  it("says a scanned PDF can't be read", async () => {
    routes.set("POST /api/roster/read-file", () => Response.json({ error: { code: "scanned" } }, { status: 422 }));
    render(<RosterShiftsPage now={now} />);
    await importFile("scan.pdf");
    expect(await screen.findByText("Can't read this PDF. Try the Excel version.")).toBeInTheDocument();
  });

  it("reads a CSV roster on the device and saves only the parsed shifts", async () => {
    render(<RosterShiftsPage now={now} />);
    const csv = [
      "date,start,end,role,site,notes",
      "2026-10-06,21:00,08:00,Night registrar,Example Hospital,handover from Dr Example",
    ].join("\n");
    await importFile("roster.csv", csv);
    fireEvent.click(await screen.findByRole("button", { name: "Save 1 shift" }));
    await waitFor(() => expect(fetchCalls("/api/roster/shifts", "POST")).toHaveLength(1));
    expect(fetchCalls("/api/roster/read-file", "POST")).toHaveLength(0);
    const sent = String(fetchCalls("/api/roster/shifts", "POST")[0]?.[1]?.body);
    expect(JSON.parse(sent)).toMatchObject({ format: "csv", windowStart: "2026-10-06", windowEnd: "2026-10-06" });
    expect(sent).not.toContain("Dr Example");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("reads a grid-shaped CSV through the same grid as Excel", async () => {
    mockSettings({ calendarShifts: false, rowName: "Dr Alex Example", codes: { "": DAY_CODE } });
    render(<RosterShiftsPage now={now} />);
    await importFile("roster.csv", ["Name,Mon 12 Oct,Tue 13 Oct,Wed 14 Oct", "Dr Alex Example,D,,D"].join("\n"));
    expect(await screen.findByTestId("roster-import-found")).toHaveTextContent("2 shifts found");
  });

  it("refuses a file that is not a roster", async () => {
    render(<RosterShiftsPage now={now} />);
    await importFile("notes.txt", "hello");
    expect(await screen.findByText("Choose a PDF, Excel, CSV or calendar file.")).toBeInTheDocument();
    expect(fetchCalls("/api/roster/read-file", "POST")).toHaveLength(0);
  });
});

describe("Roster import flow, a file over the shift cap", () => {
  function icsWithShifts(count: number): string {
    const events = Array.from({ length: count }, (_, index) => {
      const day = new Date(Date.UTC(2026, 9, 12 + index, 0, 0, 0));
      const stamp = (date: Date) =>
        date
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}/, "");
      const end = new Date(day.getTime() + 8 * 60 * 60 * 1000);
      return [
        "BEGIN:VEVENT",
        `UID:shift-${index}`,
        `DTSTART:${stamp(day)}`,
        `DTEND:${stamp(end)}`,
        "SUMMARY:Example Hospital day",
        "END:VEVENT",
      ].join("\n");
    });
    return ["BEGIN:VCALENDAR", ...events, "END:VCALENDAR"].join("\n");
  }

  it("says how many shifts were left out and offers no Save", async () => {
    render(<RosterShiftsPage now={now} />);
    await importFile("roster.ics", icsWithShifts(ON_CALL_SHIFT_IMPORT_MAX + 5));
    expect(
      await screen.findByText(
        `Only the first ${ON_CALL_SHIFT_IMPORT_MAX} shifts were read; 5 more were left out. Export a shorter date range.`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    expect(fetchCalls("/api/roster/shifts", "POST")).toHaveLength(0);
  });

  it("still reads a file under the cap", async () => {
    render(<RosterShiftsPage now={now} />);
    await importFile("roster.ics", icsWithShifts(3));
    expect(await screen.findByRole("button", { name: "Save 3 shifts" })).toBeEnabled();
  });
});
