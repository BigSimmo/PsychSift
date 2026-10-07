/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("@/components/teaching/use-teaching-resource", () => ({
  useTeachingResource: () => teaching.value,
}));

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
    expect(cv.textContent).toContain("2026: 5 h logged, 2 activities");
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

  it("gives every control a 48px tap target", () => {
    const { container } = renderCv();
    const short = [...container.querySelectorAll<HTMLElement>("button, a[href]")].filter(
      (node) => !/\b(?:min-h-(?:12|13|tap)|size-(?:12|tap))\b/.test(node.className),
    );
    expect(short.map((node) => node.outerHTML.slice(0, 80))).toEqual([]);
  });

  it("prints only the CV through the device's print screen", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderCv();
    fireEvent.click(screen.getByTestId("applications-cv-pdf"));
    expect(print).toHaveBeenCalled();
  });
});
