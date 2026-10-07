/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContractEndPage } from "@/components/admin/contract/contract-end-page";
import {
  BOTH_REMINDERS_ON,
  CONTRACT_ASKED_TAG_PREFIX,
  CONTRACT_END_SLUG_PREFIX,
  reminderFields,
} from "@/lib/admin/contract-end";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { complianceFixture } from "./helpers/on-call-entry-fixture";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/contract",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.value),
}));

const search = vi.hoisted(() => ({ value: "" }));

const account = vi.hoisted(() => ({ isAuthenticated: true }));
vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    isAuthenticated: account.isAuthenticated,
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
  }),
}));

vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: () => <div data-testid="account-setup-dialog" />,
}));

vi.mock("@/components/roster/use-roster-team", () => ({
  useRosterTeams: () => ({ status: "ready", data: { teams: [], sample: false } }),
  useRosterRead: () => ({ status: "idle", data: null }),
}));

const copyText = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>(async () => undefined));
vi.mock("@/lib/copy-to-clipboard", () => ({ copyTextToClipboard: (text: string) => copyText(text) }));

const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/download-file", () => ({
  downloadTextFile: (...args: unknown[]) => download(...args),
}));

const entryState = vi.hoisted(() => ({
  entries: [] as OnCallEntry[],
  loading: false,
  isOffline: false,
  loadError: null as "offline" | "failed" | null,
  signedOut: false,
  demoMode: false,
  cachedAt: null as string | null,
  retry: vi.fn(),
}));

const cacheOnCallEntries = vi.hoisted(() => vi.fn());
vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => entryState,
  cacheOnCallEntries: (entries: OnCallEntry[]) => cacheOnCallEntries(entries),
}));

const END = "2027-01-31";
const NOW = new Date("2026-10-06T01:00:00Z");

function contractRow(tags: string[] = []): OnCallEntry {
  const fields = reminderFields(END, BOTH_REMINDERS_ON);
  return complianceFixture(
    "Contract end",
    { category: "Personal", expiresOn: END, leadTimeDays: fields.leadTimeDays, provenance: "typed" },
    { slug: `${CONTRACT_END_SLUG_PREFIX}abc123`, tags: [...fields.tags, ...tags] },
  );
}

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let leavePayload: unknown = { leave: [] };
let failWrites = false;

beforeEach(() => {
  Object.assign(entryState, {
    entries: [],
    loading: false,
    isOffline: false,
    loadError: null,
    signedOut: false,
    demoMode: false,
    cachedAt: null,
  });
  account.isAuthenticated = true;
  search.value = "";
  calls = [];
  leavePayload = { leave: [] };
  failWrites = false;
  cacheOnCallEntries.mockClear();
  copyText.mockClear();
  download.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: input, method, body });
      if (input.startsWith("/api/roster/leave")) return new Response(JSON.stringify(leavePayload), { status: 200 });
      if (failWrites) return new Response(JSON.stringify({ error: "Server said no." }), { status: 500 });
      if (method === "DELETE") return new Response(null, { status: 204 });
      const base = entryState.entries[0] ?? contractRow();
      const id = input.split("/").pop() ?? base.id;
      const entry = {
        ...base,
        ...(body as object),
        id: method === "POST" ? "11111111-1111-4111-8111-111111111111" : id,
        isOwn: true,
      };
      return new Response(JSON.stringify({ entry }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ContractEndPage", () => {
  it("asks for the end date on first use and lists what you get", () => {
    render(<ContractEndPage now={NOW} />);
    expect(screen.getByTestId("admin-contract-first")).toBeTruthy();
    expect(screen.getByText("Two reminder dates")).toBeTruthy();
    // Nothing delivers a bell alert for these yet, so the page promises only Admin Today and the calendar.
    expect(screen.getByTestId("admin-contract-first")).toHaveTextContent("it shows on Admin Today and here");
    expect(screen.getByTestId("admin-contract-first")).not.toHaveTextContent(/you get a reminder|we will remind/i);
    expect(screen.getByTestId("admin-contract-add")).toBeTruthy();
  });

  it("asks a signed-out reader to sign in and saves nothing", () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    Object.assign(entryState, { signedOut: true });
    render(<ContractEndPage now={NOW} />);
    expect(screen.getByTestId("admin-contract-signed-out").textContent).toContain("Nothing is saved on this phone");
    // And it really saves nothing: no write to the server, and nothing on the device.
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("shows the load failure rather than an empty tracker", () => {
    Object.assign(entryState, { loadError: "failed" });
    render(<ContractEndPage now={NOW} />);
    expect(screen.getByTestId("admin-contract-load-failed")).toBeTruthy();
    expect(screen.queryByTestId("admin-contract-first")).toBeNull();
  });

  it("adds an end date, keeps Save off until it is valid, and offers Undo", async () => {
    render(<ContractEndPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-contract-add"));
    const save = screen.getByTestId("admin-contract-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("admin-contract-end"), { target: { value: "2026-01-01" } });
    expect((screen.getByTestId("admin-contract-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("admin-contract-end"), { target: { value: END } });
    expect(screen.getByTestId("admin-contract-end-echo").textContent).toBe("Sun 31 Jan 2027");
    fireEvent.click(screen.getByTestId("admin-contract-save"));
    await waitFor(() => expect(screen.getByTestId("admin-contract-undo")).toBeTruthy());
    const post = calls.find((call) => call.method === "POST");
    expect(post?.url).toBe("/api/on-call/entries");
    expect((post?.body as { details: { expiresOn: string } }).details.expiresOn).toBe(END);
    expect(cacheOnCallEntries).toHaveBeenCalled();
  });

  it("holds Save while the note carries a patient detail", () => {
    render(<ContractEndPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-contract-add"));
    fireEvent.change(screen.getByTestId("admin-contract-end"), { target: { value: END } });
    fireEvent.change(screen.getByTestId("admin-contract-note"), { target: { value: "Bed 12 patient MRN 1234567" } });
    expect(screen.getByTestId("admin-contract-note-problem")).toBeTruthy();
    expect((screen.getByTestId("admin-contract-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the tracker: end date, days left, strip and reminder line", () => {
    entryState.entries = [contractRow()];
    render(<ContractEndPage now={NOW} />);
    expect(screen.getByTestId("admin-contract-end-date").textContent).toBe("Sun 31 Jan 2027");
    expect(screen.getByTestId("admin-contract-days").textContent).toContain("117");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Ends Sunday 31 January 2027");
    expect(screen.getByTestId("admin-contract-panel").textContent).toContain("First reminder Sat 31 Oct 2026");
    expect(screen.getByTestId("admin-contract-foot").textContent).toContain("not a check");
  });

  it("draws a reached reminder as a filled bell, never a tick", () => {
    entryState.entries = [contractRow()];
    render(<ContractEndPage now={new Date("2026-11-05T01:00:00Z")} />);
    const mark = screen.getByTestId("admin-contract-strip-mark-three-months");
    expect(mark.querySelector(".lucide-check")).toBeNull();
    expect(mark.querySelector(".lucide-bell")).not.toBeNull();
  });

  it("turns the 6 week reminder off, then puts it back with Undo", async () => {
    const row = contractRow();
    entryState.entries = [row];
    render(<ContractEndPage now={NOW} />);
    const sixWeeks = screen.getByTestId("admin-contract-switch-six-weeks");
    expect(sixWeeks.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sixWeeks);
    await waitFor(() => expect(screen.getByTestId("admin-contract-undo").textContent).toContain("6 week reminder off"));
    const patch = calls.find((call) => call.method === "PATCH");
    expect((patch?.body as { tags: string[] }).tags).toContain("contract-reminder-6-weeks-off");
    fireEvent.click(within(screen.getByTestId("admin-contract-undo")).getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(2));
    expect((calls[calls.length - 1]?.body as { tags: string[] }).tags).not.toContain("contract-reminder-6-weeks-off");
  });

  it("opens a question, copies it, and marks it as asked", async () => {
    entryState.entries = [contractRow()];
    render(<ContractEndPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-contract-question-untaken-leave"));
    expect(screen.getByTestId("admin-contract-question-text").textContent).toContain("annual leave I have not taken");
    fireEvent.click(screen.getByTestId("admin-contract-question-copy"));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(expect.stringContaining("annual leave")));
    fireEvent.click(screen.getByTestId("admin-contract-question-mark"));
    await waitFor(() => expect(screen.getByTestId("admin-contract-undo").textContent).toContain("Marked as asked"));
    const patch = calls.find((call) => call.method === "PATCH");
    expect((patch?.body as { tags: string[] }).tags).toContain(`${CONTRACT_ASKED_TAG_PREFIX}untaken-leave`);
  });

  it("shows Asked, waiting on a marked question and counts it", () => {
    entryState.entries = [contractRow([`${CONTRACT_ASKED_TAG_PREFIX}training-program`])];
    render(<ContractEndPage now={NOW} />);
    expect(screen.getByTestId("admin-contract-asked-training-program").textContent).toBe("Asked, waiting");
    expect(screen.queryByTestId("admin-contract-asked-parental-leave")).toBeNull();
    expect(screen.getByText("· 1 of 6 asked")).toBeTruthy();
  });

  it("builds the Workforce message from open questions only, with no parental dates", async () => {
    entryState.entries = [contractRow([`${CONTRACT_ASKED_TAG_PREFIX}training-program`])];
    render(<ContractEndPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-contract-ask-open"));
    expect((screen.getByTestId("admin-contract-ask-training-program") as HTMLInputElement).checked).toBe(false);
    // The plan for parental leave is the doctor's to share: never ticked to start with, and said so.
    expect((screen.getByTestId("admin-contract-ask-parental-leave") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("admin-contract-ask-parental-note")).toHaveTextContent("Only if you want to ask");
    const preview = screen.getByTestId("admin-contract-ask-preview").textContent ?? "";
    expect(preview).toContain("My contract ends Sun 31 Jan 2027");
    expect(preview).not.toContain("whole training program");
    expect(preview).not.toContain("parental");
    fireEvent.click(screen.getByTestId("admin-contract-ask-parental-leave"));
    expect(screen.getByTestId("admin-contract-ask-preview").textContent).toContain("parental leave");
    fireEvent.click(screen.getByTestId("admin-contract-ask-copy"));
    await waitFor(() => expect(copyText).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("admin-contract-ask-mark"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-contract-undo").textContent).toContain("3 questions marked as asked"),
    );
  });

  it("disables Copy when no question is chosen", () => {
    entryState.entries = [contractRow()];
    render(<ContractEndPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-contract-ask-open"));
    for (const id of ["training-program", "parental-leave", "untaken-leave", "in-writing"]) {
      const box = screen.getByTestId(`admin-contract-ask-${id}`) as HTMLInputElement;
      if (box.checked) fireEvent.click(box);
    }
    expect((screen.getByTestId("admin-contract-ask-copy") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("admin-contract-ask-empty")).toBeTruthy();
  });

  it("saves a new contract, moves the reminders, and asks Start fresh or Keep answers", async () => {
    entryState.entries = [contractRow([`${CONTRACT_ASKED_TAG_PREFIX}in-writing`])];
    render(<ContractEndPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-contract-renew-row"));
    fireEvent.change(screen.getByTestId("admin-contract-renew-end"), { target: { value: "2026-12-01" } });
    expect((screen.getByTestId("admin-contract-renew-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("admin-contract-renew-end"), { target: { value: "2028-01-31" } });
    expect(screen.getByTestId("admin-contract-renew-points").textContent).toContain("Sun 31 Oct 2027");
    expect(screen.getByTestId("admin-contract-renew-fresh").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("admin-contract-renew-keep"));
    expect(screen.getByTestId("admin-contract-renew-foot").textContent).toContain("stay marked as asked");
    fireEvent.click(screen.getByTestId("admin-contract-renew-save"));
    await waitFor(() => expect(screen.getByTestId("admin-contract-undo").textContent).toContain("Reminders moved"));
    const patch = calls.find((call) => call.method === "PATCH");
    expect((patch?.body as { tags: string[] }).tags).toContain(`${CONTRACT_ASKED_TAG_PREFIX}in-writing`);
  });

  it("lists Roster leave that falls before the end", async () => {
    entryState.entries = [contractRow()];
    leavePayload = {
      leave: [
        { id: "a", kind: "annual", startsOn: "2026-10-10", endsOn: "2026-10-10", status: "approved" },
        { id: "b", kind: "pd_leave", startsOn: "2026-11-09", endsOn: "2026-11-13", status: "planned" },
        { id: "c", kind: "annual", startsOn: "2027-03-01", endsOn: "2027-03-05", status: "planned" },
      ],
    };
    render(<ContractEndPage now={NOW} />);
    const leave = await screen.findByText("Professional development");
    expect(leave).toBeTruthy();
    expect(screen.getByText("Sat 10 Oct 2026")).toBeTruthy();
    expect(screen.queryByText(/Mon 1 Mar 2027/)).toBeNull();
  });

  it("says Roster leave could not load rather than none", async () => {
    entryState.entries = [contractRow()];
    leavePayload = null;
    vi.mocked(fetch).mockImplementationOnce(async () => new Response("no", { status: 500 }));
    render(<ContractEndPage now={NOW} />);
    expect(await screen.findByTestId("admin-contract-leave-failed")).toBeTruthy();
  });

  it("opens the question a link names, such as the parental leave card's", () => {
    entryState.entries = [contractRow()];
    search.value = "question=parental-leave";
    render(<ContractEndPage now={NOW} />);
    expect(screen.getByTestId("admin-contract-question-text").textContent).toContain("parental leave");
  });

  it("downloads a calendar file named contract-end.ics", () => {
    entryState.entries = [contractRow()];
    render(<ContractEndPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-contract-calendar"));
    expect(download).toHaveBeenCalledWith(
      expect.stringContaining("BEGIN:VCALENDAR"),
      "contract-end.ics",
      "text/calendar",
    );
  });

  it("keeps example records read only, with the calendar still offered", () => {
    Object.assign(entryState, { demoMode: true, entries: [contractRow()] });
    render(<ContractEndPage now={NOW} />);
    expect(screen.queryByTestId("admin-contract-edit")).toBeNull();
    expect(screen.getByTestId("admin-contract-calendar-hero")).toBeTruthy();
    expect(screen.getByTestId("admin-contract-switch-six-weeks").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByTestId("admin-contract-question-in-writing"));
    expect(screen.queryByTestId("admin-contract-question-mark")).toBeNull();
  });

  it("goes back to Admin Today, and offers sign-in when example records are shown to nobody signed in", () => {
    Object.assign(entryState, { demoMode: true, entries: [] });
    account.isAuthenticated = false;
    try {
      render(<ContractEndPage now={NOW} />);
      expect(screen.getByTestId("admin-contract-back").getAttribute("href")).toBe("/admin");
      expect(screen.getByTestId("admin-contract-read-only").textContent).toContain("Sign in to track");
      expect(screen.queryByTestId("account-setup-dialog")).toBeNull();
      fireEvent.click(screen.getByTestId("admin-contract-sign-in"));
      expect(screen.getByTestId("account-setup-dialog")).toBeTruthy();
    } finally {
      account.isAuthenticated = true;
    }
  });

  it("says why a failed save did not land", async () => {
    entryState.entries = [contractRow()];
    failWrites = true;
    render(<ContractEndPage now={NOW} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("admin-contract-switch-three-months"));
    });
    expect((await screen.findByTestId("admin-contract-error")).textContent?.length).toBeGreaterThan(0);
    expect(screen.queryByTestId("admin-contract-undo")).toBeNull();
  });
});
