/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminNewJobPage } from "@/components/admin/admin-new-job-page";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import { complianceFixture, onCallEntryFixture } from "./helpers/on-call-entry-fixture";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/new-job",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: true, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
}));

vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: () => null,
}));

vi.mock("@/components/on-call/on-call-entry-editor", () => ({
  OnCallEntryEditor: (props: { open: boolean; entry: OnCallEntry | null }) =>
    props.open ? <div data-testid="mock-entry-editor">{props.entry?.title ?? "new entry"}</div> : null,
}));

const loginOwn = onCallEntryFixture({
  section: "logistics",
  title: "Demo logins, paging and remote access",
  details: { category: "Logins" },
  isOwn: true,
  isPersonal: false,
});
const loginShared = onCallEntryFixture({
  section: "logistics",
  title: "Demo shared systems access",
  details: { category: "Systems" },
  isOwn: false,
  isPersonal: false,
});
const jobContact = onCallEntryFixture({
  section: "contacts",
  title: "Demo medical workforce unit",
  details: { role: "Medical workforce", phone: "(08) 9000 0012" },
  isOwn: true,
  isPersonal: false,
});

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

const cacheOnCallEntries = vi.fn();
vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => entryState,
  cacheOnCallEntries: (entries: OnCallEntry[]) => cacheOnCallEntries(entries),
}));

beforeEach(() => {
  Object.assign(entryState, {
    entries: [loginOwn, loginShared, jobContact],
    loading: false,
    isOffline: false,
    loadError: null,
    signedOut: false,
    demoMode: false,
    cachedAt: null,
  });
  cacheOnCallEntries.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = new Date("2026-09-26T01:00:00Z");

describe("AdminNewJobPage", () => {
  it("shows sign-in rather than empty New job records when signed out", () => {
    Object.assign(entryState, { signedOut: true, entries: [] });
    render(<AdminNewJobPage now={NOW} />);
    expect(screen.getByTestId("admin-new-job-signed-out")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByText("Nothing recorded yet.")).toBeNull();
  });

  it("renders the own login row under Before with its entry anchor", () => {
    render(<AdminNewJobPage now={NOW} />);
    const row = document.getElementById(`on-call-entry-${loginOwn.id}`);
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getAllByText(loginOwn.title).length).toBeGreaterThan(0);
  });

  it("leads to Ready for day one and the starter pack from Before", () => {
    render(<AdminNewJobPage now={NOW} />);
    const before = document.getElementById("admin-new-job-before") as HTMLElement;
    expect(within(before).getByTestId("admin-ready-entry")).toHaveAttribute("href", "/admin/new-job/ready");
    expect(within(before).getByTestId("admin-starter-entry")).toHaveAttribute("href", "/admin/new-job/starter");
  });

  it("shows the shared login row read-only, with no edit control or tick", () => {
    render(<AdminNewJobPage now={NOW} />);
    expect(screen.getByText(/^Shared by another doctor · /)).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Edit ${loginShared.title}` })).toBeNull();
    const sharedRow = screen.getByTestId(`admin-new-job-step-${loginShared.slug}`);
    expect(within(sharedRow).queryByRole("checkbox")).toBeNull();
  });

  it("shows the job's contacts with short in-hospital numbers", () => {
    render(<AdminNewJobPage now={NOW} />);
    expect(screen.getByText(jobContact.title)).toBeTruthy();
    const link = screen.getByRole("link", { name: "9000 0012" });
    expect(link.getAttribute("href")).toBe("tel:0890000012");
  });

  it("shows no week timings anywhere on the page", () => {
    render(<AdminNewJobPage now={NOW} />);
    expect(screen.queryByText(/week \d/i)).toBeNull();
  });

  it("shows N of M done once, beside the Logins and access label, over a framed list", () => {
    render(<AdminNewJobPage now={NOW} />);
    expect(screen.getByTestId("admin-new-job-progress").textContent).toBe("0 of 1 done");
    // The label is not repeated in a second progress line above it.
    expect(screen.queryByText(/Logins and access:/)).toBeNull();
    expect(screen.queryByTestId("admin-new-job-logins-left")).toBeNull();
    expect(screen.getByTestId("admin-new-job-logins").className).toContain("border");
  });

  it("ticks an own step as a real saved toggle, with Undo", async () => {
    const saved = { ...loginOwn, details: { category: "Logins", done: true } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ entry: saved }), { status: 200 }));
    render(<AdminNewJobPage now={NOW} />);
    const checkbox = screen.getByTestId(`admin-new-job-step-${loginOwn.slug}-checkbox`);
    fireEvent.click(checkbox);
    await waitFor(() => expect(cacheOnCallEntries).toHaveBeenCalled());
    expect(screen.getByTestId("admin-new-job-undo")).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/on-call/entries/${loginOwn.id}`,
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("preserves a typed start date after a failed save so it can be retried", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline"));
    render(<AdminNewJobPage now={NOW} />);
    const input = screen.getByTestId("admin-new-job-start-input").querySelector("input")!;
    fireEvent.change(input, { target: { value: "2026-11-02" } });
    fireEvent.click(screen.getByTestId("admin-new-job-start-save"));
    await waitFor(() => expect(screen.getByTestId("admin-new-job-error")).toHaveTextContent("Offline"));
    expect(input).toHaveValue("2026-11-02");
    expect(screen.getByTestId("admin-new-job-start-save")).not.toBeDisabled();
  });

  it("keeps showing a stored start date a month after it (Today's week-long window does not apply here, M17)", () => {
    const started = { ...loginOwn, details: { category: "Logins", jobStartsOn: "2026-08-26" } } as OnCallEntry;
    Object.assign(entryState, { entries: [started, loginShared, jobContact] });
    render(<AdminNewJobPage now={NOW} />);
    expect(screen.getByTestId("admin-new-job-start-line").textContent).toContain("Starts Wed 26 Aug 2026");
  });

  it("shows a skeleton while loading, never 'Nothing here yet' (M2)", () => {
    Object.assign(entryState, { loading: true, entries: [] });
    render(<AdminNewJobPage now={NOW} />);
    expect(screen.getByTestId("admin-new-job-loading")).toBeTruthy();
    expect(screen.queryByText(/^Nothing here yet/)).toBeNull();
    expect(screen.queryByText("Nothing recorded yet.")).toBeNull();
  });

  it("shows the load-failed state, not empty rows, when entries failed to load", () => {
    Object.assign(entryState, { isOffline: true, loadError: "offline" });
    render(<AdminNewJobPage now={NOW} />);
    expect(screen.getByTestId("admin-new-job-load-failed")).toBeTruthy();
    expect(screen.queryByText(loginOwn.title)).toBeNull();
  });

  it("lists what to take for a site or job change, and ends with a link to Your Admin records (M16)", () => {
    render(<AdminNewJobPage now={NOW} />);
    const notice = screen.getByTestId("admin-new-job-leaving-notice");
    expect(notice).toHaveTextContent("Changing site or starting a new job?");
    expect(screen.getByTestId("admin-new-job-leaving-checklist")).toHaveTextContent(
      "Registration numbers and renewal dates",
    );
    const link = screen.getByTestId("admin-new-job-records-link");
    expect(link.getAttribute("href")).toBe("/admin/new-job/records");
  });
});

describe("AdminNewJobPage layout (Admin polish, lane C)", () => {
  it("shows the same compact visible page title as Renewals", () => {
    render(<AdminNewJobPage now={NOW} />);
    const heading = screen.getByRole("heading", { level: 1, name: "New job" });
    expect(heading.className).not.toContain("sr-only");
    expect(heading.className).toContain("text-2xl");
  });

  it("lays a row with no tick flush, with no empty 48px gutter", () => {
    render(<AdminNewJobPage now={NOW} />);
    const sharedRow = screen.getByTestId(`admin-new-job-step-${loginShared.slug}`);
    expect(sharedRow.querySelector(".w-12")).toBeNull();
    expect(within(sharedRow).queryByTestId(`admin-new-job-step-${loginShared.slug}-done`)).toBeNull();
  });

  it("marks a done row it cannot tick with a quiet read-only Done, never a checkbox", () => {
    const sharedDone = { ...loginShared, details: { category: "Systems", done: true } } as OnCallEntry;
    Object.assign(entryState, { entries: [loginOwn, sharedDone, jobContact] });
    render(<AdminNewJobPage now={NOW} />);
    const row = screen.getByTestId(`admin-new-job-step-${sharedDone.slug}`);
    expect(within(row).queryByRole("checkbox")).toBeNull();
    expect(within(row).getByTestId(`admin-new-job-step-${sharedDone.slug}-done`)).toHaveTextContent("Done");
  });

  it("explains a start date that cannot be set: sign in when signed out", () => {
    Object.assign(entryState, { signedOut: true, entries: [] });
    render(<AdminNewJobPage now={NOW} />);
    expect(screen.getByTestId("admin-new-job-start-line")).toHaveTextContent("No start date set");
    expect(screen.getByRole("button", { name: "Sign in to set your start date" })).toBeTruthy();
    expect(screen.queryByTestId("admin-new-job-start-input")).toBeNull();
  });

  it("explains a start date that cannot be set: example records are read-only", () => {
    Object.assign(entryState, { demoMode: true });
    render(<AdminNewJobPage now={NOW} />);
    expect(screen.getByTestId("admin-new-job-start-demo")).toHaveTextContent("Example records are read-only");
    expect(screen.queryByRole("button", { name: "Sign in to set your start date" })).toBeNull();
    expect(screen.queryByTestId("admin-new-job-start-input")).toBeNull();
  });

  it("says nothing about why while loading", () => {
    Object.assign(entryState, { loading: true, entries: [] });
    render(<AdminNewJobPage now={NOW} />);
    expect(screen.queryByTestId("admin-new-job-start-demo")).toBeNull();
    expect(screen.queryByTestId("admin-new-job-start-signed-out")).toBeNull();
  });

  it("merges the Leaving explanation and the records link into one tappable card", () => {
    render(<AdminNewJobPage now={NOW} />);
    const link = screen.getByTestId("admin-new-job-records-link");
    expect(link).toContainElement(screen.getByTestId("admin-new-job-leaving-notice"));
    expect(link).toHaveTextContent("Changing site or starting a new job?");
    expect(link).toHaveTextContent("Your Admin records");
    expect(link).toHaveTextContent("Registration numbers and renewal dates");
  });

  it("signposts the paperwork still to do before the start date, from the same pass Compliance reads", () => {
    entryState.entries = [
      { ...loginOwn, details: { category: "Logins", jobStartsOn: "2026-11-02" } } as OnCallEntry,
      complianceFixture("Fit test", { requirementId: "respirator-fit-testing", expiresOn: "2026-10-20" }),
    ];
    render(<AdminNewJobPage now={NOW} />);
    const signpost = screen.getByTestId("admin-new-job-paperwork");
    expect(signpost.getAttribute("href")).toBe("/admin/compliance");
    expect(signpost).toHaveTextContent("Paperwork for your next job");
    expect(screen.getByTestId("admin-new-job-paperwork-count").textContent).toMatch(
      /^\d+ to do before you start, in Compliance$/,
    );
    expect(screen.getByTestId("admin-new-job-paperwork-names")).toHaveTextContent(/^Before 2 Nov 2026: /);
    expect(signpost).toHaveTextContent("Dates you entered, not a check. Your service's list may differ.");
  });

  it("never says nothing to do: an open renewal window after the start still counts", () => {
    // Start 10 Nov; registration ends 20 Nov, so its window is open but it runs past the start.
    entryState.entries = [
      { ...loginOwn, details: { category: "Logins", jobStartsOn: "2026-11-10" } } as OnCallEntry,
      ...ADMIN_REQUIREMENTS_CATALOGUE.map((item) =>
        complianceFixture(item.title, {
          requirementId: item.id,
          expiresOn: item.id === "medical-registration-renewal" ? "2026-11-20" : "2028-01-01",
        }),
      ),
    ];
    render(<AdminNewJobPage now={new Date("2026-10-25T01:00:00Z")} />);
    expect(screen.getByTestId("admin-new-job-paperwork-count")).toHaveTextContent(
      "Nothing due before you start, on the dates you recorded",
    );
    expect(screen.getByTestId("admin-new-job-paperwork-also")).toHaveTextContent(
      "1 needs action in Compliance overall.",
    );
    expect(document.body.textContent).not.toMatch(/Nothing to do/);
  });

  it("says one item needs action in the singular, and never shows a zero count", () => {
    // No start date recorded: the signpost counts what needs action now.
    entryState.entries = ADMIN_REQUIREMENTS_CATALOGUE.map((item) =>
      complianceFixture(item.title, {
        requirementId: item.id,
        expiresOn: item.id === "medical-registration-renewal" ? "2026-11-20" : "2028-01-01",
      }),
    );
    const { unmount } = render(<AdminNewJobPage now={new Date("2026-10-25T01:00:00Z")} />);
    expect(screen.getByTestId("admin-new-job-paperwork-count")).toHaveTextContent("1 needs action, in Compliance");
    unmount();
    entryState.entries = ADMIN_REQUIREMENTS_CATALOGUE.map((item) =>
      complianceFixture(item.title, { requirementId: item.id, expiresOn: "2028-01-01" }),
    );
    render(<AdminNewJobPage now={new Date("2026-10-25T01:00:00Z")} />);
    expect(screen.getByTestId("admin-new-job-paperwork-count")).toHaveTextContent(
      "Nothing needs action on the dates you recorded",
    );
  });

  it("keeps the credential pack as a quiet text link under Leaving", () => {
    render(<AdminNewJobPage now={NOW} />);
    expect(screen.queryByTestId("admin-new-job-credential-pack-link")).toBeNull();
    expect(screen.getByTestId("admin-new-job-leaving-pack-link").getAttribute("href")).toBe("/admin/new-job/pack");
  });
});
