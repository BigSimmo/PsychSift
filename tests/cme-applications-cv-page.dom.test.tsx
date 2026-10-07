/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationsCvPage } from "@/components/cme/applications/applications-cv-page";
import { ToastProvider } from "@/components/ui/toast";
import { CPD_APPLICATIONS_STORAGE_KEY, TEACHING_TERM_TRACKER_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import type { CmeEntry } from "@/lib/cme/types";
import * as clipboard from "@/lib/copy-to-clipboard";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  usePathname: () => "/cme/applications/cv",
  useSearchParams: () => new URLSearchParams(),
}));

const teaching = vi.hoisted(() => ({
  value: {
    status: "ready" as string,
    data: {
      upcoming: [],
      taught: [
        {
          occurrenceId: "o1",
          serviceId: "s1",
          title: "Catatonia",
          startsAt: "2026-09-30T02:00:00.000Z",
          endsAt: "2026-09-30T03:00:00.000Z",
        },
      ],
    } as unknown,
    code: null,
    refreshing: false,
    retry: vi.fn(),
  },
}));
// The CV reads three Teaching endpoints: talks given, the attendance logbook and supervision.
const other = vi.hoisted(() => {
  const read = (data: unknown) => ({
    status: "ready" as string,
    data,
    code: null,
    refreshing: false,
    retry: (() => undefined) as () => void,
  });
  return { logbook: read({ attendance: [] }), supervision: read({ pairings: [] }) };
});
vi.mock("@/components/teaching/use-teaching-resource", () => ({
  useTeachingResource: (url: string | null) =>
    url?.includes("view=logbook")
      ? other.logbook
      : url?.includes("view=supervision")
        ? other.supervision
        : teaching.value,
}));

// Admin's records: only the registration renewal row matters to the CV.
const admin = vi.hoisted(() => ({
  state: {
    entries: [] as unknown[],
    loading: false,
    loadError: null as "offline" | "failed" | null,
    retry: (() => undefined) as () => void,
    demoMode: false,
  },
  expiresOn: undefined as string | undefined,
}));
vi.mock("@/lib/on-call/entry-store", () => ({ useOnCallEntries: () => admin.state }));
vi.mock("@/lib/admin/requirements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/requirements")>();
  return {
    ...actual,
    requirementChecklistRows: () =>
      admin.expiresOn
        ? [
            {
              item: { id: "medical-registration-renewal" },
              entry: {},
              expiresOn: admin.expiresOn,
              state: "needs-action",
            },
          ]
        : [],
  };
});

const now = new Date("2026-10-06T05:00:00Z");

function entry(id: string, date: string, overrides: Partial<CmeEntry> = {}): CmeEntry {
  return {
    id,
    date,
    title: `Activity ${id}`,
    allocations: [{ category: "educational", hours: 1 }],
    reflection: "Private reflection words",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
    ...overrides,
  };
}

const entries = [
  entry("e1", "2026-03-01"),
  entry("e2", "2026-04-01", { title: "Clozapine audit", allocations: [{ category: "measuring", hours: 4 }] }),
];

function renderCv(props: Partial<Parameters<typeof ApplicationsCvPage>[0]> = {}) {
  return render(
    <ToastProvider>
      <ApplicationsCvPage entries={entries} cpdFailed={false} demoMode={false} now={now} {...props} />
    </ToastProvider>,
  );
}

describe("CV that fills itself", () => {
  beforeEach(() => {
    localStorage.clear();
    teaching.value.status = "ready";
    other.logbook = { ...other.logbook, status: "ready", data: { attendance: [] }, retry: vi.fn() };
    other.supervision = { ...other.supervision, status: "ready", data: { pairings: [] }, retry: vi.fn() };
    admin.state = { ...admin.state, loading: false, loadError: null, retry: vi.fn() };
    admin.expiresOn = undefined;
    localStorage.setItem(
      TEACHING_TERM_TRACKER_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        currentTermId: "t1",
        terms: [
          {
            id: "t1",
            number: 2,
            unit: "Adult inpatient",
            site: "Example Hospital",
            startsOn: "2026-08-03",
            endsOn: "2027-01-29",
            supervisor: "Dr Moss",
            milestones: {
              start: { dueOn: "2026-08-10", doneOn: null },
              mid: { dueOn: "2026-10-30", doneOn: null },
              end: { dueOn: "2027-01-22", doneOn: null },
            },
            goals: [],
            toRaise: [],
            meeting: null,
          },
        ],
        epas: [],
        targets: null,
      }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("fills from terms, teaching given and CPD, and never copies a reflection or supervisor", async () => {
    const copy = vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue();
    renderCv();
    const cv = screen.getByTestId("applications-cv");
    expect(cv.textContent).toContain("Adult inpatient, Example Hospital");
    expect(cv.textContent).toContain("Catatonia");
    expect(cv.textContent).toContain("2026: 5\u00a0h logged, 2 activities");
    expect(cv.textContent).toContain("Clozapine audit");
    await act(async () => {
      fireEvent.click(screen.getByTestId("applications-cv-copy"));
    });
    const text = copy.mock.calls[0]![0];
    expect(text).toContain("Curriculum vitae");
    expect(text).not.toContain("Private reflection");
    expect(text).not.toContain("Dr Moss");
    expect(screen.getByText("CV copied as plain text")).toBeTruthy();
  });

  it("hides a line from copies, keeps it on the device, and shows it again", async () => {
    const copy = vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue();
    renderCv();
    const catatonia = screen
      .getAllByTestId("applications-cv-line")
      .find((line) => line.textContent?.includes("Catatonia"))!;
    const hide = catatonia.querySelector<HTMLButtonElement>("[data-testid='applications-cv-hide']")!;
    fireEvent.click(hide);
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(localStorage.getItem(CPD_APPLICATIONS_STORAGE_KEY)!).hiddenCvLines).toEqual(["talk:o1"]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("applications-cv-copy"));
    });
    expect(copy.mock.calls[0]![0]).not.toContain("Catatonia");
    expect(screen.getByText("CV copied as plain text, 1 line hidden")).toBeTruthy();
    fireEvent.click(hide);
    expect(hide.getAttribute("aria-pressed")).toBe("false");
  });

  it("leaves a patient-like talk or activity title out of the copy and the print, with a way to fix it", async () => {
    const copy = vi.spyOn(clipboard, "copyTextToClipboard").mockResolvedValue();
    teaching.value.data = {
      upcoming: [],
      taught: [
        {
          occurrenceId: "o2",
          serviceId: "s1",
          title: "Case presentation: pt JS 45M",
          startsAt: "2026-04-01T02:00:00.000Z",
          endsAt: "2026-04-01T03:00:00.000Z",
        },
      ],
    };
    renderCv({
      entries: [
        entry("e3", "2026-05-01", {
          title: "Case review of Mr Smith 45M, UMRN 1234567",
          allocations: [{ category: "measuring", hours: 2 }],
        }),
      ],
    });
    const held = screen.getAllByTestId("applications-cv-line").filter((line) => line.dataset.cvHeld === "true");
    expect(held).toHaveLength(2);
    // Print leaves out every line marked hidden.
    for (const line of held) expect(line.getAttribute("data-cv-hidden")).toBe("true");
    expect(within(held[1]!).getByRole("link").getAttribute("href")).toBe("/cme/log/e3?edit=1");
    await act(async () => {
      fireEvent.click(screen.getByTestId("applications-cv-copy"));
    });
    const text = copy.mock.calls[0]![0];
    expect(text).not.toContain("pt JS");
    expect(text).not.toContain("Mr Smith");
    expect(screen.getByText("CV copied as plain text. 2 left out, the title looks like a patient detail")).toBeTruthy();
    teaching.value.data = {
      upcoming: [],
      taught: [
        {
          occurrenceId: "o1",
          serviceId: "s1",
          title: "Catatonia",
          startsAt: "2026-09-30T02:00:00.000Z",
          endsAt: "2026-09-30T03:00:00.000Z",
        },
      ],
    };
  });

  it("shows a hidden line in full-strength text with the word Hidden, not faded", () => {
    renderCv();
    const catatonia = screen
      .getAllByTestId("applications-cv-line")
      .find((line) => line.textContent?.includes("Catatonia"))!;
    fireEvent.click(catatonia.querySelector<HTMLButtonElement>("[data-testid='applications-cv-hide']")!);
    expect(catatonia.innerHTML).not.toContain("opacity-50");
    expect(catatonia.textContent).toContain("Hidden");
  });

  it("Undo after saving the statement puts back the statement only", () => {
    renderCv();
    fireEvent.click(screen.getByTestId("applications-cv-statement"));
    fireEvent.change(screen.getByTestId("applications-statement-text"), {
      target: { value: "I enjoy teaching juniors." },
    });
    fireEvent.click(screen.getByTestId("applications-statement-save"));
    const catatonia = screen
      .getAllByTestId("applications-cv-line")
      .find((line) => line.textContent?.includes("Catatonia"))!;
    fireEvent.click(catatonia.querySelector<HTMLButtonElement>("[data-testid='applications-cv-hide']")!);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    const stored = JSON.parse(localStorage.getItem(CPD_APPLICATIONS_STORAGE_KEY)!);
    expect(stored.statement).toBe("");
    expect(stored.hiddenCvLines).toEqual(["talk:o1"]);
  });

  it("goes back to Job applications, its parent", () => {
    renderCv();
    expect(screen.getByTestId("cpd-feature-back").getAttribute("href")).toBe("/cme/applications");
    expect(screen.getByTestId("cpd-feature-back").textContent).toContain("Job applications");
  });

  it("narrows to this year", () => {
    renderCv({ entries: [...entries, entry("old", "2024-05-01")] });
    expect(screen.getByTestId("applications-cv").textContent).not.toContain("2024:");
    fireEvent.click(screen.getByTestId("applications-cv-range-all"));
    expect(screen.getByTestId("applications-cv").textContent).toContain("2024:");
    expect(screen.getByTestId("applications-cv-range-all").getAttribute("aria-pressed")).toBe("true");
  });

  it("takes a personal statement only in the doctor's words, and refuses patient details", () => {
    renderCv();
    fireEvent.click(screen.getByTestId("applications-cv-statement"));
    fireEvent.change(screen.getByTestId("applications-statement-text"), { target: { value: "I cared for Mrs Smith" } });
    expect(screen.getByTestId("applications-statement-problem")).toBeTruthy();
    expect(screen.getByTestId("applications-statement-save").hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByTestId("applications-statement-text"), {
      target: { value: "I enjoy teaching juniors." },
    });
    fireEvent.click(screen.getByTestId("applications-statement-save"));
    expect(screen.getByTestId("applications-cv").textContent).toContain("I enjoy teaching juniors.");
  });

  it("says when CPD or Teaching did not load, never showing zero hours, and retries", () => {
    teaching.value.status = "error";
    renderCv({ cpdFailed: true });
    expect(screen.getByTestId("applications-cv-cpd-failed").textContent).toContain("did not load");
    expect(screen.getByTestId("applications-cv").textContent).not.toContain("h logged");
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(refresh).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[1]!);
    expect(teaching.value.retry).toHaveBeenCalled();
  });

  it("shows an empty state with ways to fill it", () => {
    localStorage.clear();
    const saved = teaching.value.data;
    teaching.value.data = { upcoming: [], taught: [] };
    try {
      renderCv({ entries: [] });
      expect(screen.getByTestId("applications-cv-empty").textContent).toContain("Nothing to fill it with yet");
      expect(screen.getByRole("link", { name: "Log an activity" }).getAttribute("href")).toBe("/cme/new");
      expect(screen.getByRole("link", { name: "Set up your term" }).getAttribute("href")).toBe("/teaching/term");
    } finally {
      teaching.value.data = saved;
    }
  });

  it("adds Admin's registration date, teaching attended and registrars supervised, each marked with its source", () => {
    admin.expiresOn = "2027-09-30";
    other.logbook = {
      ...other.logbook,
      data: {
        attendance: [
          { occurrenceId: "a1", startsAt: "2026-03-04T01:00:00.000Z" },
          { occurrenceId: "a2", startsAt: "2026-05-04T01:00:00.000Z" },
        ],
      },
    };
    other.supervision = {
      ...other.supervision,
      data: {
        pairings: [
          {
            pairingId: "p1",
            access: "supervisor",
            registrarName: "Dr Example Registrar",
            startsOn: "2026-02-02",
            endsOn: "2026-08-01",
          },
          { pairingId: "p2", access: "registrar", registrarName: "Me", startsOn: "2026-02-02", endsOn: "2026-08-01" },
        ],
      },
    };
    renderCv();
    const cv = screen.getByTestId("applications-cv");
    expect(cv.textContent).toContain("Renewal date you recorded: 30 Sep 2027");
    expect(cv.textContent).toContain("2 sessions recorded in 2026");
    expect(cv.textContent).toContain("Supervisor to 1 registrar");
    // A registrar's name never reaches the CV.
    expect(cv.textContent).not.toContain("Dr Example Registrar");
    for (const source of ["From Admin", "From Teaching", "From Assessments", "From CPD"])
      expect(screen.getAllByRole("img", { name: source }).length).toBeGreaterThan(0);
  });

  it("says when Admin did not load, and retries it", () => {
    admin.state = { ...admin.state, loadError: "failed" };
    renderCv();
    const problem = screen.getByTestId("applications-cv-admin-failed");
    expect(problem.textContent).toContain("registration date is not shown");
    fireEvent.click(within(problem).getByRole("button", { name: "Try again" }));
    expect(admin.state.retry).toHaveBeenCalled();
    expect(screen.getByTestId("applications-cv").textContent).not.toContain("Medical registration");
  });

  it("retries only the Teaching reads that failed", () => {
    other.logbook = { ...other.logbook, status: "offline" };
    renderCv();
    const problem = screen.getByTestId("applications-cv-teaching-failed");
    expect(problem.textContent).toContain("offline");
    fireEvent.click(within(problem).getByRole("button", { name: "Try again" }));
    expect(other.logbook.retry).toHaveBeenCalled();
    expect(teaching.value.retry).not.toHaveBeenCalled();
  });

  it("gives every control a 48px tap target", () => {
    const { container } = renderCv();
    // The kit's buttons take their 48px height from work-mode.css (work-mode redesign, owner request 6 Oct 2026).
    const short = [...container.querySelectorAll<HTMLElement>("button, a[href]")].filter(
      (node) => !/\b(?:min-h-(?:12|13|tap)|size-(?:12|tap)|work-button)\b/.test(node.className),
    );
    expect(short.map((node) => node.outerHTML.slice(0, 80))).toEqual([]);
  });

  it("keeps a focused row control clear of the sticky Copy and Save as PDF dock", () => {
    renderCv();
    // The phone focus rule in globals.css reads this as the focused control's bottom scroll margin.
    expect(screen.getByTestId("applications-cv").className).toContain(
      "[--phone-focus-bottom-clearance:calc(5.5rem+max(0.875rem,var(--safe-area-bottom)))]",
    );
  });

  it("prints only the CV through the device's print screen", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderCv();
    fireEvent.click(screen.getByTestId("applications-cv-pdf"));
    expect(print).toHaveBeenCalled();
  });
});
