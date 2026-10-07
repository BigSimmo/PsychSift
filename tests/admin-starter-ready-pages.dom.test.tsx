/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReadyForDayOnePage } from "@/components/admin/ready/ready-for-day-one-page";
import { StarterPackPage } from "@/components/admin/starter/starter-pack-page";
import { BOTH_REMINDERS_ON, CONTRACT_END_SLUG_PREFIX, reminderFields } from "@/lib/admin/contract-end";
import { STARTER_DATE_SLUG_PREFIX } from "@/lib/admin/starter-pack";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { complianceFixture, onCallEntryFixture } from "./helpers/on-call-entry-fixture";

const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/new-job/starter",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.value),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: true, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
}));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));

const copyText = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>(async () => undefined));
vi.mock("@/lib/copy-to-clipboard", () => ({ copyTextToClipboard: (text: string) => copyText(text) }));

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
  // Like the real store, each read is its own snapshot, so a closure kept from an earlier render goes stale.
  useOnCallEntries: () => ({ ...entryState }),
  cacheOnCallEntries: (entries: OnCallEntry[]) => cacheOnCallEntries(entries),
}));

const NOW = new Date("2026-10-06T01:00:00Z");
type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

function contractRow() {
  const fields = reminderFields("2027-01-31", BOTH_REMINDERS_ON);
  return complianceFixture(
    "Contract end",
    { category: "Personal", expiresOn: "2027-01-31", leadTimeDays: fields.leadTimeDays },
    { slug: `${CONTRACT_END_SLUG_PREFIX}c1`, tags: fields.tags },
  );
}
const visaRow = () =>
  complianceFixture(
    "Visa",
    { requirementId: "img-visa-requirements", expiresOn: "2027-01-14" },
    { slug: `${STARTER_DATE_SLUG_PREFIX}v1` },
  );

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

beforeEach(() => {
  Object.assign(entryState, {
    entries: [],
    loading: false,
    isOffline: false,
    loadError: null,
    signedOut: false,
    demoMode: false,
  });
  search.value = "";
  calls = [];
  copyText.mockClear();
  cacheOnCallEntries.mockClear();
  setOnline(true);
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: input, method, body });
      if (method === "DELETE") return new Response(null, { status: 204 });
      const entry = { ...onCallEntryFixture({ section: "logistics" }), ...(body as object), isOwn: true };
      return new Response(JSON.stringify({ entry }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setOnline(true);
});

describe("StarterPackPage", () => {
  it("finds Pager from the word from home", () => {
    render(<StarterPackPage now={NOW} />);
    fireEvent.change(screen.getByTestId("admin-starter-word-search"), { target: { value: "bleep" } });
    const words = screen.getByTestId("admin-starter-words").textContent ?? "";
    expect(words).toContain("Pager");
    expect(words).toContain("You searched “bleep”");
  });

  it("shows the ladder in order and offices with no numbers", () => {
    render(<StarterPackPage now={NOW} />);
    expect(screen.getByTestId("admin-starter-ladder").textContent).toMatch(
      /You.*registrar.*consultant.*on call.*Head of department/s,
    );
    expect(screen.getByTestId("admin-starter-offices").textContent).not.toMatch(/\d/);
  });

  it("raises the visa clash alert and points to a migration agent, not advice", () => {
    entryState.entries = [visaRow(), contractRow()];
    render(<StarterPackPage now={NOW} />);
    const clash = screen.getByTestId("admin-starter-clash").textContent ?? "";
    expect(clash).toContain("Your visa date is before your contract end");
    expect(clash).toContain("registered migration agent");
    expect(screen.getByTestId("admin-starter-date-visa-end")).toBeTruthy();
    expect(screen.getByTestId("admin-starter-date-contract")).toBeTruthy();
  });

  it("adds a date with a reminder, then offers Undo that deletes it", async () => {
    render(<StarterPackPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-starter-add-first"));
    fireEvent.click(screen.getByTestId("admin-starter-kind-visa-end"));
    fireEvent.change(screen.getByTestId("admin-starter-date-date"), { target: { value: "2027-01-14" } });
    fireEvent.click(screen.getByTestId("admin-starter-date-save"));
    await waitFor(() => expect(screen.getByTestId("admin-starter-undo").textContent).toContain("Visa end saved"));
    expect(calls.find((call) => call.method === "POST")?.url).toBe("/api/on-call/entries");
    fireEvent.click(screen.getByTestId("admin-starter-undo-undo"));
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
  });

  it("keeps a change made during the ten seconds when Undo removes the new date", async () => {
    const view = render(<StarterPackPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-starter-add-first"));
    fireEvent.click(screen.getByTestId("admin-starter-kind-visa-end"));
    fireEvent.change(screen.getByTestId("admin-starter-date-date"), { target: { value: "2027-01-14" } });
    fireEvent.click(screen.getByTestId("admin-starter-date-save"));
    await waitFor(() => expect(screen.getByTestId("admin-starter-undo")).toBeTruthy());
    const firstWrite = cacheOnCallEntries.mock.calls[0]?.[0] as OnCallEntry[];
    const saved = firstWrite[firstWrite.length - 1]!;
    // Something else lands in the entries before Undo is pressed.
    const other = contractRow();
    entryState.entries = [saved, other];
    view.rerender(<StarterPackPage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-starter-undo-undo"));
    await waitFor(() => expect(cacheOnCallEntries).toHaveBeenCalledTimes(2));
    const afterUndo = cacheOnCallEntries.mock.calls[1]?.[0] as OnCallEntry[];
    expect(afterUndo.map((entry) => entry.id)).toEqual([other.id]);
  });

  it("suggests a missing word as a copied note, after the patient-detail catch", async () => {
    render(<StarterPackPage now={NOW} />);
    fireEvent.change(screen.getByTestId("admin-starter-word-search"), { target: { value: "zzqx" } });
    expect(screen.getByTestId("admin-starter-words-empty")).toBeTruthy();
    expect((screen.getByTestId("admin-starter-suggest-word") as HTMLInputElement).value).toBe("zzqx");
    fireEvent.change(screen.getByTestId("admin-starter-suggest-word"), { target: { value: "Mr Smith bed 4" } });
    expect(screen.getByTestId("admin-starter-suggest-problem")).toBeTruthy();
    expect((screen.getByTestId("admin-starter-suggest-copy") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("admin-starter-suggest-word"), { target: { value: "tea trolley" } });
    expect(screen.queryByTestId("admin-starter-suggest-problem")).toBeNull();
    expect((screen.getByTestId("admin-starter-suggest-copy") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("admin-starter-suggest-copy"));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(expect.stringContaining('"tea trolley"')));
  });

  it("says offline honestly while the words still work", () => {
    setOnline(false);
    render(<StarterPackPage now={NOW} />);
    expect(screen.getByTestId("admin-starter-offline").textContent).toContain("Adding a date needs a connection");
    expect(screen.getByTestId("admin-starter-words")).toBeTruthy();
  });
});

describe("ReadyForDayOnePage", () => {
  const startRow = () =>
    onCallEntryFixture({
      section: "logistics",
      title: "Email account",
      details: { category: "Logins", jobStartsOn: "2026-11-02" },
    });

  it("draws the readiness bar with words and the start date", () => {
    entryState.entries = [
      startRow(),
      complianceFixture("Registration", { requirementId: "medical-registration-renewal", expiresOn: "2027-09-30" }),
      contractRow(),
    ];
    render(<ReadyForDayOnePage now={NOW} />);
    expect(screen.getByTestId("admin-ready-bar").getAttribute("aria-label")).toMatch(/^2 of 8 recorded/);
    expect(screen.getByTestId("admin-ready-starts").textContent).toContain("Starts Mon 2 Nov 2026");
    expect(screen.getByTestId("admin-ready-item-medical-registration-renewal")).toBeTruthy();
    // Nine segments in the fixed order on every card, the ones not counted greyed in place.
    const segments = Array.from(screen.getByTestId("admin-ready-bar").children);
    expect(segments).toHaveLength(9);
    expect(segments[7]?.getAttribute("data-state")).toBe("left-out");
  });

  it("will not copy example records as a status, and says why", () => {
    Object.assign(entryState, { demoMode: true });
    entryState.entries = [startRow()];
    render(<ReadyForDayOnePage now={NOW} />);
    const copy = screen.getByTestId("admin-ready-copy");
    expect(copy).toHaveAttribute("aria-disabled", "true");
    expect(copy).toHaveAccessibleDescription(/example records/);
    fireEvent.click(copy);
    expect(copyText).not.toHaveBeenCalled();
  });

  it("links to sharing with Medical Workforce", () => {
    entryState.entries = [startRow()];
    render(<ReadyForDayOnePage now={NOW} />);
    expect(screen.getByTestId("admin-ready-sharing-link")).toHaveAttribute("href", "/admin/sharing");
    expect(screen.getByTestId("admin-ready-workforce-note")).not.toHaveTextContent("not built");
  });

  it("copies status words only for Medical Workforce", async () => {
    entryState.entries = [
      startRow(),
      complianceFixture("Registration", { requirementId: "medical-registration-renewal", expiresOn: "2027-09-30" }),
    ];
    render(<ReadyForDayOnePage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-ready-copy"));
    await waitFor(() => expect(copyText).toHaveBeenCalled());
    const text = copyText.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Medical registration: Recorded");
    expect(text).not.toContain("2027");
  });

  it("previews exactly what Medical Workforce gets", () => {
    entryState.entries = [startRow()];
    render(<ReadyForDayOnePage now={NOW} />);
    fireEvent.click(screen.getByTestId("admin-ready-preview-open"));
    expect(screen.getByTestId("admin-ready-preview-text").textContent).toContain("Not checked with issuers");
  });

  it("asks for sign-in rather than showing an empty card", () => {
    Object.assign(entryState, { signedOut: true });
    render(<ReadyForDayOnePage now={NOW} />);
    expect(screen.getByTestId("admin-ready-signed-out")).toBeTruthy();
    expect(screen.queryByTestId("admin-ready-bar")).toBeNull();
  });

  it("shows a load failure rather than a bar of gaps", () => {
    Object.assign(entryState, { loadError: "failed" });
    render(<ReadyForDayOnePage now={NOW} />);
    expect(screen.getByTestId("admin-ready-load-failed")).toBeTruthy();
    expect(screen.queryByTestId("admin-ready-bar")).toBeNull();
  });
});
