/** @vitest-environment jsdom */

// AdminRenewalsPage: the Checklist built from the statewide Requirements
// catalogue, crossed with the reader's own recorded dates, plus a Personal
// tab for items that aren't on the catalogue. Final design, screens-v3.
//
// This is the checklist-based redesign of Renewals; it supersedes the
// band-grouped page `OnCallComplianceSection` drew, which this lane's report
// explains under "Deviations from task-6-brief.md". That component's own
// tests (`tests/on-call-compliance-page.dom.test.tsx`) are left in place,
// covering code that still exists and is still directly exercised there.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { complianceFixture, onCallEntryFixture } from "./helpers/on-call-entry-fixture";

vi.mock("@/lib/admin/download-file", () => ({ downloadTextFile: vi.fn() }));

// The page reads `?show=`, `?item=` and `?record=`; each test sets its own query.
// The real sign-in dialog needs the auth provider; only whether it opens matters here.
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="mock-sign-in-dialog" /> : null),
}));

const navigation = vi.hoisted(() => ({ query: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/renewals",
  useRouter: () => ({ push: vi.fn(), replace: navigation.replace, back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
import { downloadTextFile } from "@/lib/admin/download-file";

const storeState = vi.hoisted(() => ({
  entries: [] as OnCallEntry[],
  loading: false,
  isOffline: false,
  loadError: null as string | null,
  signedOut: false,
  demoMode: false,
  cachedAt: null as string | null,
}));

vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => storeState,
  cacheOnCallEntries: (entries: OnCallEntry[]) => {
    storeState.entries = entries;
  },
}));

import { AdminRenewalsPage } from "@/components/admin/admin-renewals-page";

const NOW = new Date("2026-09-26T04:00:00.000Z"); // Perth calendar day 26 Sep 2026

const WWC = complianceFixture(
  "Working with Children Check",
  { category: "checks", expiresOn: "2026-09-03", requirementId: "working-with-children-check" },
  { slug: "wwc" },
);
const ALS = complianceFixture(
  "ALS course certification",
  { category: "training", expiresOn: "2026-10-14", requirementId: "als-course-certification" },
  { slug: "als" },
);
const INDEMNITY = complianceFixture(
  "Indemnity insurance declaration",
  { category: "registration", expiresOn: "2026-11-30", requirementId: "professional-indemnity-insurance" },
  { slug: "indemnity" },
);
const REGISTRATION = complianceFixture(
  "Medical registration renewal",
  { category: "registration", expiresOn: "2027-08-30", requirementId: "medical-registration-renewal" },
  { slug: "med-reg" },
);

const ALL = [WWC, ALS, INDEMNITY, REGISTRATION];

beforeEach(() => {
  navigation.query = "";
  navigation.replace.mockReset();
  Object.assign(storeState, {
    entries: [...ALL],
    loading: false,
    isOffline: false,
    loadError: null,
    signedOut: false,
    demoMode: false,
    cachedAt: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

function renderPage() {
  render(<AdminRenewalsPage now={NOW} />);
}

/** Every row now shows in its kind group (5 Oct mock-up v2); kept so the older tests read the same. */
function showAllNotRecorded() {}

describe("AdminRenewalsPage — the checklist", () => {
  it("offers no write controls for demo entries", () => {
    storeState.demoMode = true;
    renderPage();
    expect(screen.queryByTestId("admin-renewals-add")).toBeNull();
    expect(screen.queryByTestId("admin-renewals-checklist-add-date-criminal-record-screening")).toBeNull();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-row-working-with-children-check"));
    expect(screen.queryByTestId("admin-renewals-item-sheet-renew")).toBeNull();
    expect(screen.queryByTestId("admin-renewals-item-sheet-not-for-this-job")).toBeNull();
  });

  it("disables calendar export when there are no dated events", () => {
    storeState.entries = [];
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByTestId("admin-renewals-calendar-all")).toBeDisabled();
  });
  it("groups by kind under All, each with its count, dated rows before unrecorded ones", () => {
    renderPage();
    const groups = screen.getByTestId("admin-renewals-checklist");
    const checks = within(groups).getByTestId("admin-renewals-checklist-group-checks");
    const training = within(groups).getByTestId("admin-renewals-checklist-group-training");
    expect(within(checks).getByText("Working with Children Check")).toBeInTheDocument();
    expect(within(training).getByText("ALS course certification")).toBeInTheDocument();
    // The dated row leads its group; unrecorded rows follow.
    const titles = within(checks)
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(titles[0]).toMatch(/Working with Children Check/);
    expect(within(checks).getAllByText("Not recorded yet").length).toBeGreaterThan(0);
  });

  it("puts the item to act on first in Renew next, with what comes after it", () => {
    renderPage();
    const card = screen.getByTestId("admin-renew-next");
    // WWC's date passed on 3 Sep, so it leads; ALS is inside its renewing window.
    expect(within(card).getByRole("heading", { name: "Working with Children Check" })).toBeInTheDocument();
    expect(screen.getByTestId("admin-renew-next-status")).toHaveTextContent("Date passed");
    expect(screen.getByTestId("admin-renew-next-date")).toHaveTextContent("Date passed 3 Sep 2026");
    expect(screen.getByTestId("admin-renew-next-then")).toHaveTextContent("ALS course certification");
  });

  it("says how many items have no date beside Nothing to renew right now", () => {
    storeState.entries = [
      complianceFixture("Registration", { requirementId: "medical-registration-renewal", expiresOn: "2028-09-30" }),
    ];
    renderPage();
    expect(screen.getByTestId("admin-renew-next-nothing-due")).toHaveTextContent("Nothing to renew right now");
    expect(screen.getByTestId("admin-renew-next-not-recorded").textContent).toMatch(
      /^\d+ items have no date recorded yet\.$/,
    );
  });

  it("filters the list from an at-a-glance count row, and a second tap clears it", () => {
    renderPage();
    const passed = screen.getByTestId("admin-renewals-summary-count-date-passed");
    expect(passed).toHaveTextContent("1");
    fireEvent.click(passed);
    expect(passed).toHaveAttribute("aria-pressed", "true");
    const list = within(screen.getByTestId("admin-renewals-checklist"));
    expect(list.getByText("Working with Children Check")).toBeInTheDocument();
    expect(list.queryByText("ALS course certification")).toBeNull();
    fireEvent.click(passed);
    expect(list.getByText("ALS course certification")).toBeInTheDocument();
  });

  it("draws urgency as grey shapes and words, with no red or amber anywhere on the page", () => {
    renderPage();
    expect(screen.getAllByText("Date passed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Start renewing").length).toBeGreaterThan(0);
    expect(document.body.innerHTML).not.toMatch(/--danger|--warning/);
  });

  it("marks the timeline by shape, not shade: a diamond for a passed date, a triangle otherwise (M8)", () => {
    renderPage();
    const timeline = screen.getByTestId("admin-renewals-summary-timeline");
    const marks = Array.from(timeline.querySelectorAll("[data-mark]")).map((mark) => mark.getAttribute("data-mark"));
    // WWC's date passed on 3 Sep; the others are still ahead.
    expect(marks).toContain("diamond");
    expect(marks).toContain("triangle");
    expect(timeline.querySelector("svg.lucide-diamond")).not.toBeNull();
    expect(timeline.querySelector("svg.lucide-triangle")).not.toBeNull();
  });

  it("filters the checklist to one kind", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-kind-checks"));
    const list = within(screen.getByTestId("admin-renewals-checklist"));
    expect(list.getByText("Working with Children Check")).toBeInTheDocument();
    expect(list.queryByText("ALS course certification")).toBeNull();
  });

  it("shows the confirmed rule and the source link", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-row-working-with-children-check"));
    const sheet = screen.getByTestId("admin-renewals-item-sheet");
    expect(within(sheet).getByText(/A WWC Card lasts three years/)).toBeInTheDocument();
    expect(within(sheet).getByText(/Source: WA Department of Communities/)).toBeInTheDocument();
    expect(within(sheet).getByTestId("admin-renewals-item-sheet-issuer-check-label")).toHaveTextContent(
      "No issuer check recorded",
    );
    expect(sheet.textContent ?? "").not.toMatch(/\bverified\b/i);
    expect(sheet.textContent ?? "").not.toMatch(/\bcompliant\b/i);
    // WWC's date (3 Sep) has passed: the sheet names it as passed everywhere, never "Renew by".
    expect(sheet.textContent ?? "").toMatch(/Date passed/);
    expect(sheet.textContent ?? "").not.toMatch(/Renew by/);
  });

  it("records and clears the issuer-check stamp without Renewed setting it", async () => {
    const stamped = {
      ...WWC,
      details: { ...(WWC.details as object), issuerCheckedOn: "2026-09-26" },
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ entry: stamped })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ entry: WWC })));
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-row-working-with-children-check"));
    fireEvent.click(screen.getByTestId("admin-renewals-item-sheet-issuer-check-record"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstBody.details.issuerCheckedOn).toBe("2026-09-26");
    expect(firstBody.lastVerifiedAt).toBe(WWC.lastVerifiedAt);
    expect(await screen.findByText(/Last checked with issuer · 26 Sep 2026 · by you/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-renewals-item-sheet-issuer-check-clear"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const clearBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(clearBody.details).not.toHaveProperty("issuerCheckedOn");
  });

  it("does not stamp issuerCheckedOn when Renewed saves alone", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ entry: { ...ALS, details: { ...(ALS.details as object), expiresOn: "2030-10-14" } } }),
        ),
      );
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-row-als-course-certification"));
    fireEvent.click(screen.getByTestId("admin-renewals-item-sheet-renew"));
    fireEvent.change(screen.getByLabelText("New expiry date"), { target: { value: "2030-10-14" } });
    fireEvent.click(screen.getByTestId("admin-renewed-save"));
    await screen.findByText("Marked renewed.");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.details).not.toHaveProperty("issuerCheckedOn");
    expect(body.lastVerifiedAt).toBe(ALS.lastVerifiedAt);
  });

  it("shows the unconfirmed line, not a rule, for a needs-checking item", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-row-professional-indemnity-insurance"));
    const sheet = screen.getByTestId("admin-renewals-item-sheet");
    expect(within(sheet).getByText("Rule to confirm")).toBeInTheDocument();
    expect(within(sheet).queryByText(/^Registration for medical practitioners/)).toBeNull();
  });

  it("links only the medical registration item to the CPD year check", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-row-medical-registration-renewal"));
    const link = screen.getByTestId("admin-renewals-cpd-link");
    expect(link.textContent).toBe("Open CPD year check");
    expect(link.getAttribute("href")).toBe("/cme/check");
  });
});

describe("AdminRenewalsPage — Add date on a not-recorded item", () => {
  it("opens the new-date sheet blank, with Save grey until a date is typed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          entry: {
            ...WWC,
            id: "00000000-0000-4000-8000-000000000099",
            slug: "criminal-record-screening",
            title: "Criminal record screening",
            details: {
              kind: "compliance",
              category: "checks",
              requirementId: "criminal-record-screening",
              expiresOn: "2027-01-01",
            },
          },
        }),
      ),
    );
    renderPage();
    showAllNotRecorded();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-add-date-criminal-record-screening"));
    const save = screen.getByTestId("admin-renewed-save");
    expect(save).toBeDisabled();
    const sheet = within(screen.getByTestId("admin-renewed-sheet"));
    fireEvent.change(sheet.getByLabelText("New expiry date"), { target: { value: "2027-01-01" } });
    expect(screen.getByText("Fri 1 Jan 2027")).toBeInTheDocument();
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/on-call/entries");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.details.requirementId).toBe("criminal-record-screening");
    expect(await screen.findByText("Marked renewed.")).toBeInTheDocument();
  });
});

describe("AdminRenewalsPage — Renewed, from the item sheet", () => {
  it("echoes the typed date and offers Add to my calendar once saved", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ entry: { ...ALS, details: { ...(ALS.details as object), expiresOn: "2030-10-14" } } }),
      ),
    );
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-row-als-course-certification"));
    fireEvent.click(screen.getByTestId("admin-renewals-item-sheet-renew"));
    expect(screen.getByText(/Renewed: ALS course certification/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New expiry date"), { target: { value: "2030-10-14" } });
    fireEvent.click(screen.getByTestId("admin-renewed-save"));
    await screen.findByText("Marked renewed.");
    fireEvent.click(screen.getByTestId("admin-renewed-calendar"));
    expect(downloadTextFile).toHaveBeenCalled();
  });
});

describe("AdminRenewalsPage — Not for this job", () => {
  it("moves the item to its own section, updates the count, and offers Undo", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            entry: { ...INDEMNITY, details: { ...(INDEMNITY.details as object), notForThisJob: true } },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ entry: INDEMNITY })));
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-row-professional-indemnity-insurance"));
    fireEvent.click(screen.getByTestId("admin-renewals-item-sheet-not-for-this-job"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-renewals-checklist-not-for-this-job-row-indemnity")).toBeInTheDocument(),
    );
    expect(screen.getByText(/not for this job/)).toBeInTheDocument();
    expect(screen.getByTestId("admin-renewals-undo-bar")).toBeInTheDocument();
    // It shows once, in its own section — not also as "Not recorded yet" above.
    expect(screen.queryByTestId("admin-renewals-checklist-row-professional-indemnity-insurance")).toBeNull();

    fireEvent.click(within(screen.getByTestId("admin-renewals-undo-bar")).getByText("Undo"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByTestId("admin-renewals-checklist-not-for-this-job-row-indemnity")).toBeNull(),
    );
  });
});

describe("AdminRenewalsPage — Personal tab", () => {
  it("shows the empty state when nothing is off-catalogue", () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Personal" }));
    expect(screen.getByText("No personal renewals")).toBeInTheDocument();
    expect(screen.getByTestId("admin-renewals-personal-empty-add")).toBeInTheDocument();
  });

  it("lists an entry that matches no catalogue item", () => {
    storeState.entries = [
      ...ALL,
      complianceFixture("A car I lease for work", { category: "Personal", expiresOn: "2027-01-01" }),
    ];
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Personal" }));
    expect(screen.getByText("A car I lease for work")).toBeInTheDocument();
    expect(screen.queryByText("Working with Children Check")).toBeNull();
  });

  it("never lists the reader's rows from other On Call sections, or their logistics guides", () => {
    storeState.entries = [
      ...ALL,
      onCallEntryFixture({ section: "contacts", title: "Ward 4 switchboard", details: {} }),
      onCallEntryFixture({ section: "playbook", title: "Agitation first steps", details: {} }),
      onCallEntryFixture({ section: "logistics", title: "Staff car park", details: { category: "Facilities" } }),
    ];
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Personal" }));
    expect(screen.getByText("No personal renewals")).toBeInTheDocument();
    expect(screen.queryByText("Ward 4 switchboard")).toBeNull();
    expect(screen.queryByText("Agitation first steps")).toBeNull();
    expect(screen.queryByText("Staff car park")).toBeNull();
  });

  it("creates a new personal renewal from the Add sheet", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          entry: complianceFixture(
            "Car registration",
            { category: "Personal", expiresOn: "2027-02-01" },
            { slug: "car-rego" },
          ),
        }),
      ),
    );
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-add"));
    expect(screen.getByTestId("admin-quick-add-save")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Car registration" } });
    fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: "2027-02-01" } });
    expect(screen.getByTestId("admin-quick-add-save")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("admin-quick-add-save"));
    await waitFor(() => expect(screen.queryByTestId("admin-quick-add-sheet")).toBeNull());
  });
});

describe("AdminRenewalsPage — Copy for workforce and Add all to my calendar", () => {
  it("copies cover-sheet text that names gaps and never says verified", async () => {
    const writeText = vi.fn(async (text: string) => {
      void text;
    });
    Object.assign(navigator, { clipboard: { writeText } });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByTestId("admin-renewals-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = String(writeText.mock.calls[0]?.[0]);
    expect(text).toMatch(/^Dates as I recorded them, copied .+; not checked with issuers\n/);
    expect(text).toContain("Not recorded yet · missing proof");
    expect(text).not.toMatch(/\bverified\b/i);
    expect(text).not.toMatch(/\bcompliant\b/i);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("downloads one calendar file for every dated renewal", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByTestId("admin-renewals-calendar-all"));
    expect(downloadTextFile).toHaveBeenCalledWith(
      expect.stringContaining("BEGIN:VCALENDAR"),
      "renewals.ics",
      "text/calendar;charset=utf-8",
    );
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("AdminRenewalsPage — a deep link to one entry (I3)", () => {
  it("puts the entry anchor on its checklist row", () => {
    renderPage();
    const row = screen.getByTestId("admin-renewals-checklist-row-als-course-certification");
    expect(row.closest(`#on-call-entry-${ALS.id}`)).not.toBeNull();
  });

  it("opens that entry's detail sheet when the page loads with its hash, so Today's Renewed is two taps", () => {
    window.history.replaceState(null, "", `/admin/renewals#on-call-entry-${ALS.id}`);
    renderPage();
    const sheet = screen.getByTestId("admin-renewals-item-sheet");
    expect(within(sheet).getByText("ALS course certification")).toBeInTheDocument();
    expect(within(sheet).getByTestId("admin-renewals-item-sheet-renew").textContent).toBe("Renewed");
  });

  it("opens a personal renewal on the Personal tab", () => {
    const car = complianceFixture("A car I lease for work", { category: "Personal", expiresOn: "2027-01-01" });
    storeState.entries = [...ALL, car];
    window.history.replaceState(null, "", `/admin/renewals#on-call-entry-${car.id}`);
    renderPage();
    expect(screen.getByRole("tab", { name: "Personal" }).getAttribute("aria-selected")).toBe("true");
    expect(within(screen.getByTestId("admin-renewals-item-sheet")).getAllByText("A car I lease for work").length).toBe(
      1,
    );
  });

  it("ignores a hash for a row that is not the reader's renewal", () => {
    window.history.replaceState(null, "", "/admin/renewals#on-call-entry-00000000-0000-4000-8000-00000000ffff");
    renderPage();
    expect(screen.queryByTestId("admin-renewals-item-sheet")).toBeNull();
  });
});

describe("AdminRenewalsPage — Not for this job on an item never recorded (I4)", () => {
  it("creates a minimal private row with no date, and Undo deletes it", async () => {
    const created = complianceFixture(
      "IMG visa requirements",
      { category: "job", requirementId: "img-visa-requirements", notForThisJob: true },
      { slug: "img-visa-new", id: "00000000-0000-4000-8000-0000000000aa" },
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ entry: created }, 201))
      .mockResolvedValueOnce(jsonResponse({ deleted: true, id: created.id }));
    renderPage();
    showAllNotRecorded();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-row-img-visa-requirements"));
    fireEvent.click(screen.getByTestId("admin-renewals-item-sheet-not-for-this-job"));

    await waitFor(() =>
      expect(screen.getByTestId("admin-renewals-checklist-not-for-this-job-row-img-visa-new")).toBeInTheDocument(),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/on-call/entries");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.details).toEqual({
      kind: "compliance",
      category: "job",
      requirementId: "img-visa-requirements",
      notForThisJob: true,
    });
    expect(body.details.expiresOn).toBeUndefined();
    expect(body.isPersonal).toBe(true);

    fireEvent.click(within(screen.getByTestId("admin-renewals-undo-bar")).getByText("Undo"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/on-call/entries/${created.id}`);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
    await waitFor(() =>
      expect(screen.queryByTestId("admin-renewals-checklist-not-for-this-job-row-img-visa-new")).toBeNull(),
    );
    expect(screen.getByTestId("admin-renewals-checklist-row-img-visa-requirements")).toBeInTheDocument();
  });
});

describe("AdminRenewalsPage — failed saves are never silent (I5)", () => {
  const flaggedIndemnity = {
    ...INDEMNITY,
    details: { ...(INDEMNITY.details as object), notForThisJob: true },
  } as OnCallEntry;

  it("shows a neutral notice with Retry when Move back fails, and Retry sends it again", async () => {
    storeState.entries = [WWC, ALS, flaggedIndemnity, REGISTRATION];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ error: "Service unavailable." }, 503))
      .mockResolvedValueOnce(jsonResponse({ entry: INDEMNITY }));
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-move-back-indemnity"));
    const notice = await screen.findByTestId("admin-renewals-action-failed");
    expect(notice.textContent).toMatch(/Couldn.t move .*Indemnity insurance declaration/);
    fireEvent.click(within(notice).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("admin-renewals-action-failed")).toBeNull());
    expect(screen.queryByTestId("admin-renewals-checklist-not-for-this-job-row-indemnity")).toBeNull();
  });

  it("keeps the Undo bar, says the undo failed, and offers Retry", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ entry: flaggedIndemnity }))
      .mockResolvedValueOnce(jsonResponse({ error: "Service unavailable." }, 503));
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-row-professional-indemnity-insurance"));
    fireEvent.click(screen.getByTestId("admin-renewals-item-sheet-not-for-this-job"));
    const bar = await screen.findByTestId("admin-renewals-undo-bar");
    fireEvent.click(within(bar).getByText("Undo"));
    await waitFor(() => expect(within(bar).getByText(/Undo didn.t save/)).toBeInTheDocument());
    expect(within(bar).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByTestId("admin-renewals-checklist-not-for-this-job-row-indemnity")).toBeInTheDocument();
  });

  it("keeps the Undo bar for ten seconds (M9)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ entry: flaggedIndemnity }));
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-row-professional-indemnity-insurance"));
    fireEvent.click(screen.getByTestId("admin-renewals-item-sheet-not-for-this-job"));
    await screen.findByTestId("admin-renewals-undo-bar");
    await act(() => vi.advanceTimersByTimeAsync(7_000));
    expect(screen.getByTestId("admin-renewals-undo-bar")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(3_500));
    expect(screen.queryByTestId("admin-renewals-undo-bar")).toBeNull();
  });
});

// Every catalogue item none of the four fixtures records.
const NOT_RECORDED_COUNT = ADMIN_REQUIREMENTS_CATALOGUE.length - ALL.length;

describe("AdminRenewalsPage — header menu", () => {
  it("keeps Copy for workforce and Add all to my calendar behind More actions", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Renewals" })).toBeInTheDocument();
    expect(screen.queryByTestId("admin-renewals-copy")).toBeNull();
    expect(screen.queryByTestId("admin-renewals-calendar-all")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = within(screen.getByTestId("admin-renewals-menu"));
    expect(menu.getByTestId("admin-renewals-copy")).toHaveTextContent("Copy for workforce");
    expect(menu.getByTestId("admin-renewals-calendar-all")).toHaveTextContent("Add all to my calendar");
  });

  it("shows the copy text to copy by hand when the clipboard refuses", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByTestId("admin-renewals-copy"));
    expect(await screen.findByLabelText("Text to copy for workforce")).toBeInTheDocument();
    expect(screen.getByTestId("admin-renewals-copy")).toHaveTextContent("Couldn't copy");
  });
});

describe("AdminRenewalsPage — readable timeline, wrapping chips, short Not recorded group", () => {
  it("names each timeline row in full, with three-letter months and a Today line", () => {
    renderPage();
    const timeline = screen.getByTestId("admin-renewals-summary-timeline");
    expect(within(timeline).getAllByText("Working with Children Check").length).toBeGreaterThan(0);
    const months = within(timeline).getByTestId("admin-renewals-summary-timeline-months");
    expect(months.children).toHaveLength(12);
    expect(months.children[0]?.textContent).toBe("Sep");
    expect(months.children[1]?.textContent).toBe("Oct");
    expect(timeline.querySelector("[data-today-line]")).not.toBeNull();
    expect(within(timeline).getByText("Today")).toBeInTheDocument();
    // A words-only equivalent for screen readers.
    const list = within(timeline).getByRole("list", { name: "Coming up in the next twelve months" });
    expect(list.textContent).toMatch(/Working with Children Check: 3 Sep 2026.*Date passed/);
  });

  it("wraps the kind chips instead of scrolling them sideways", () => {
    renderPage();
    const chips = screen.getByTestId("admin-renewals-kind");
    expect(chips.className).toContain("flex-wrap");
    expect(chips.className).not.toContain("overflow-x-auto");
  });

  it("marks unconfirmed rules with Rule to confirm in the list", () => {
    renderPage();
    const needsChecking = ADMIN_REQUIREMENTS_CATALOGUE.filter((item) => item.status === "needs-checking");
    if (needsChecking.length > 0) {
      const list = within(screen.getByTestId("admin-renewals-checklist"));
      expect(list.getAllByText("Rule to confirm").length).toBeGreaterThan(0);
      expect(list.queryByText("Check with your service")).toBeNull();
    }
  });

  it("offers Record dates when editable, and says why not on example records", () => {
    renderPage();
    expect(screen.getByTestId("admin-renewals-record-dates")).toHaveTextContent("Record dates");
    cleanup();
    storeState.demoMode = true;
    renderPage();
    expect(screen.queryByTestId("admin-renewals-record-dates")).toBeNull();
    expect(screen.getByTestId("admin-renewals-record-dates-note")).toHaveTextContent("Example records are read-only");
  });

  it("Record dates steps through the not-recorded items", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-record-dates"));
    const sheet = within(screen.getByTestId("admin-renewals-record-sheet"));
    expect(sheet.getByText(`1 of ${NOT_RECORDED_COUNT}`)).toBeInTheDocument();
  });
});

describe("AdminRenewalsPage — detail sheet", () => {
  it("draws its groups on one surface, with no bordered card inside the sheet", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-row-working-with-children-check"));
    const groups = screen.getByTestId("admin-renewals-item-sheet-groups");
    expect(groups.querySelector("div.rounded-lg.border")).toBeNull();
    const source = within(groups).getByRole("link", { name: /Source: WA Department of Communities/ });
    expect(source.getAttribute("target")).toBe("_blank");
  });

  it("renders Open CPD year check as a real, underlined link", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("admin-renewals-checklist-row-medical-registration-renewal"));
    const link = screen.getByRole("link", { name: "Open CPD year check" });
    expect(link.getAttribute("href")).toBe("/cme/check");
    expect(link.className).toMatch(/(^|\s)underline(\s|$)/);
  });
});

describe("AdminRenewalsPage — the URL contract", () => {
  it("?show=date-passed filters the Checklist, personal renewals included, with a Clear that removes it", () => {
    const car = complianceFixture(
      "A car I lease for work",
      { category: "Personal", expiresOn: "2026-08-01" },
      { slug: "car" },
    );
    storeState.entries = [...ALL, car];
    navigation.query = "show=date-passed&item=";
    renderPage();
    const notice = screen.getByTestId("admin-renewals-show-notice");
    expect(notice).toHaveTextContent("Showing: Date passed · 2");
    const list = within(screen.getByTestId("admin-renewals-show-list"));
    expect(list.getByText("Working with Children Check")).toBeInTheDocument();
    expect(list.getByText("A car I lease for work")).toBeInTheDocument();
    expect(list.queryByText("ALS course certification")).toBeNull();
    expect(screen.queryByTestId("admin-renewals-kind")).toBeNull();
    expect(screen.queryByTestId("admin-renewals-checklist")).toBeNull();

    fireEvent.click(within(notice).getByRole("button", { name: "Clear" }));
    expect(navigation.replace).toHaveBeenCalledWith("/admin/renewals?item=", { scroll: false });
  });

  it("?show=due-90 lists the rows due within 90 days, and Clear with no other params returns to the bare path", () => {
    navigation.query = "show=due-90";
    renderPage();
    expect(screen.getByTestId("admin-renewals-show-notice")).toHaveTextContent("Showing: Due in 90 days · 2");
    const list = within(screen.getByTestId("admin-renewals-show-list"));
    expect(list.getByText("ALS course certification")).toBeInTheDocument();
    expect(list.getByText("Indemnity insurance declaration")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("admin-renewals-show-clear"));
    expect(navigation.replace).toHaveBeenCalledWith("/admin/renewals", { scroll: false });
  });

  it("?show=not-recorded lists every unrecorded item and offers Record dates", () => {
    navigation.query = "show=not-recorded";
    renderPage();
    expect(screen.getByTestId("admin-renewals-show-notice")).toHaveTextContent(
      `Showing: Not recorded · ${NOT_RECORDED_COUNT}`,
    );
    expect(within(screen.getByTestId("admin-renewals-show-list")).getAllByRole("listitem")).toHaveLength(
      NOT_RECORDED_COUNT,
    );
    fireEvent.click(screen.getByTestId("admin-renewals-show-record-dates"));
    expect(screen.getByTestId("admin-renewals-record-sheet")).toBeInTheDocument();
  });

  it("ignores an unknown ?show value", () => {
    navigation.query = "show=everything";
    renderPage();
    expect(screen.queryByTestId("admin-renewals-show")).toBeNull();
    expect(screen.getByTestId("admin-renewals-checklist")).toBeInTheDocument();
  });

  it("?item=<entry id> opens that entry's detail sheet", () => {
    navigation.query = `item=${ALS.id}`;
    renderPage();
    const sheet = within(screen.getByTestId("admin-renewals-item-sheet"));
    expect(sheet.getByText("ALS course certification")).toBeInTheDocument();
    expect(sheet.getByTestId("admin-renewals-item-sheet-renew")).toHaveTextContent("Renewed");
  });

  it("?item=<catalogue item id> opens that item's sheet, even never recorded", () => {
    navigation.query = "item=criminal-record-screening";
    renderPage();
    const sheet = within(screen.getByTestId("admin-renewals-item-sheet"));
    expect(sheet.getByTestId("admin-renewals-item-sheet-renew")).toHaveTextContent("Add date");
  });

  it("ignores an ?item that names nothing of the reader's", () => {
    navigation.query = "item=not-a-real-thing";
    renderPage();
    expect(screen.queryByTestId("admin-renewals-item-sheet")).toBeNull();
  });

  it("?record=missing opens Record missing dates", () => {
    navigation.query = "record=missing";
    renderPage();
    expect(
      within(screen.getByTestId("admin-renewals-record-sheet")).getByText(`1 of ${NOT_RECORDED_COUNT}`),
    ).toBeInTheDocument();
  });

  it("?record=missing on example records says they are read-only", () => {
    storeState.demoMode = true;
    navigation.query = "record=missing";
    renderPage();
    const sheet = within(screen.getByTestId("admin-renewals-record-sheet"));
    expect(sheet.getByText("Example records are read-only.")).toBeInTheDocument();
    expect(sheet.queryByTestId("admin-renewals-record-sheet-save")).toBeNull();
  });

  it("?record=missing opens again, ready to save, once signing in from its sheet succeeds", () => {
    storeState.signedOut = true;
    storeState.entries = [];
    navigation.query = "record=missing";
    const view = render(<AdminRenewalsPage now={NOW} />);
    fireEvent.click(
      within(screen.getByTestId("admin-renewals-record-sheet")).getByTestId("admin-renewals-record-sheet-sign-in"),
    );
    expect(screen.queryByTestId("admin-renewals-record-sheet")).toBeNull();
    Object.assign(storeState, { signedOut: false, entries: [...ALL] });
    view.rerender(<AdminRenewalsPage now={NOW} />);
    const sheet = within(screen.getByTestId("admin-renewals-record-sheet"));
    expect(sheet.getByTestId("admin-renewals-record-sheet-save")).toBeInTheDocument();
    expect(sheet.queryByText("Sign in to record dates.")).toBeNull();
  });

  it("?show=not-recorded offers no Record dates when only a personal renewal is undated", () => {
    storeState.entries = [
      ...ADMIN_REQUIREMENTS_CATALOGUE.map((item) =>
        complianceFixture(item.title, { category: "registration", expiresOn: "2027-08-30", requirementId: item.id }),
      ),
      complianceFixture("Personal undated", { category: "training" }),
    ];
    navigation.query = "show=not-recorded";
    renderPage();
    expect(screen.getByTestId("admin-renewals-show-notice")).toHaveTextContent("Showing: Not recorded · 1");
    expect(screen.queryByTestId("admin-renewals-show-record-dates")).toBeNull();
  });

  it("?record=missing when signed out asks to sign in", () => {
    storeState.signedOut = true;
    storeState.entries = [];
    navigation.query = "record=missing";
    renderPage();
    const sheet = within(screen.getByTestId("admin-renewals-record-sheet"));
    expect(sheet.getByText("Sign in to record dates.")).toBeInTheDocument();
    fireEvent.click(sheet.getByTestId("admin-renewals-record-sheet-sign-in"));
    expect(screen.getByTestId("mock-sign-in-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-renewals-record-sheet")).toBeNull();
  });
});
