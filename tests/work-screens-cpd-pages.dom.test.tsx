/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_CME_ENTRIES, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/cme/evidence",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const download = vi.hoisted(() => ({ calls: [] as { name: string; content: string }[] }));
vi.mock("@/lib/admin/download-file", () => ({
  downloadTextFile: (content: string, name: string) => {
    download.calls.push({ name, content });
  },
}));

import { CpdEvidencePage } from "@/components/work-screens/cpd/cpd-evidence-page";
import { CpdExportPage } from "@/components/work-screens/cpd/cpd-export-page";

const base = DEMO_CME_ENTRIES[0]!;

function entry(over: Partial<CmeEntry> & { id: string; date: string }): CmeEntry {
  return { ...base, title: `Activity ${over.id}`, archivedAt: null, ...over } as CmeEntry;
}

const counted: CmeEntry[] = [
  entry({
    id: "edu",
    date: "2026-03-01",
    evidenceCount: 1,
    certificateCount: 1,
    allocations: [{ category: "educational", hours: 1 }] as CmeEntry["allocations"],
  }),
  entry({
    id: "rev",
    date: "2026-04-01",
    evidenceCount: 0,
    certificateCount: 0,
    allocations: [{ category: "reviewing", hours: 1 }] as CmeEntry["allocations"],
  }),
  entry({
    id: "out",
    date: "2026-05-01",
    evidenceCount: 0,
    certificateCount: 0,
    allocations: [{ category: "measuring", hours: 1 }] as CmeEntry["allocations"],
  }),
];

beforeEach(() => {
  download.calls = [];
  window.history.replaceState(null, "", "/cme/evidence");
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  };
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("CPD Evidence page", () => {
  it("in the demo, where evidence is not counted, never claims every activity has evidence", () => {
    render(<CpdEvidencePage entries={DEMO_CME_ENTRIES} year={2026} years={[2026, 2025]} demoMode />);
    expect(screen.getByTestId("cpd-evidence-all-done").textContent).toContain("None known to need evidence");
    expect(screen.queryByText("Every activity has evidence")).toBeNull();
    expect(screen.getByTestId("cpd-evidence-unknown-list")).toBeTruthy();
    expect(screen.queryByTestId("cpd-evidence-attach")).toBeNull();
  });

  it("an unconfigured year that already holds activities lists them rather than saying none were logged", () => {
    render(<CpdEvidencePage entries={counted} year={2026} years={[2026]} demoMode={false} unconfigured />);
    expect(screen.queryByTestId("cpd-evidence-empty")).toBeNull();
    expect(screen.getByTestId("cpd-evidence-needs-list")).toBeTruthy();
  });

  it("an empty demo year offers no setup or logging, because the demo is read-only", () => {
    render(<CpdEvidencePage entries={[]} year={2025} years={[2026, 2025]} demoMode unconfigured />);
    expect(screen.getByTestId("cpd-evidence-empty")).toBeTruthy();
    expect(screen.queryByTestId("cpd-evidence-setup")).toBeNull();
    expect(screen.queryByTestId("cpd-evidence-log")).toBeNull();
  });

  it("Has evidence with nothing to show says so rather than leaving a blank page", () => {
    render(
      <CpdEvidencePage
        entries={counted.slice(1)}
        year={2026}
        years={[2026]}
        demoMode={false}
        initialStatus="attached"
      />,
    );
    expect(screen.getByTestId("cpd-evidence-has-empty").textContent).toContain("No activity has evidence yet");
  });

  it("Attach evidence clears a filter that hides every activity needing it, and focuses the list", () => {
    render(
      <CpdEvidencePage entries={counted} year={2026} years={[2026]} demoMode={false} initialCategory="educational" />,
    );
    expect(screen.getByTestId("cpd-evidence-all-done").textContent).toContain("Nothing here needs evidence");
    fireEvent.click(screen.getByTestId("cpd-evidence-attach"));
    expect(screen.getByTestId("cpd-evidence-type-all").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("cpd-evidence-needs-list").querySelectorAll("li")).toHaveLength(2);
    expect(window.location.search).toBe("?year=2026");
    expect(document.activeElement?.getAttribute("aria-labelledby")).toBe("cpd-evidence-needs");
  });

  it("keeps the sort order in the address, and the year chips carry it", () => {
    render(<CpdEvidencePage entries={counted} year={2026} years={[2026, 2025]} demoMode={false} />);
    fireEvent.click(screen.getByTestId("cpd-evidence-order"));
    expect(window.location.search).toBe("?year=2026&order=oldest");
    expect(screen.getByRole("link", { name: "2025" }).getAttribute("href")).toBe(
      "/cme/evidence?year=2025&order=oldest",
    );
    const rows = screen.getByTestId("cpd-evidence-needs-list").querySelectorAll("a");
    expect([...rows].map((row) => row.getAttribute("data-testid"))).toEqual([
      "cpd-evidence-row-rev",
      "cpd-evidence-row-out",
    ]);
  });

  it("hides the log link when nothing needs evidence, so it never opens an empty filter", () => {
    render(<CpdEvidencePage entries={counted.slice(0, 1)} year={2026} years={[2026]} demoMode={false} />);
    expect(screen.queryByTestId("cpd-evidence-log-link")).toBeNull();
    expect(screen.getByText("Every activity has evidence")).toBeTruthy();
  });

  it("lets a very long title wrap instead of pushing the page sideways", () => {
    const long = "A".repeat(300);
    render(
      <CpdEvidencePage
        entries={[entry({ id: "long", date: "2026-06-01", title: long, evidenceCount: 0, certificateCount: 0 })]}
        year={2026}
        years={[2026]}
        demoMode={false}
      />,
    );
    const title = screen.getByText(long);
    expect(title.className).toContain("[overflow-wrap:anywhere]");
    expect(screen.getByTestId("cpd-evidence-counts").className).toContain("minmax(min(100%,6rem),1fr)");
  });
});

describe("CPD Export page", () => {
  const set = { ...DEMO_CME_YEAR, closedAt: null } as CmeRequirementSet;
  const props = {
    set,
    years: [2026],
    goalCount: 0,
    close: null,
    now: new Date("2026-10-07T04:00:00Z"),
    demoMode: false,
  };

  it("checks titles and reflections before the CSV is made, and saves only on Download anyway", () => {
    const entries = [
      entry({ id: "ok", date: "2026-03-01", title: "Grand round", reflection: "Useful." }),
      entry({ id: "bad", date: "2026-03-02", title: "Peer review", reflection: "Saw Mrs Smith in bed 12 today" }),
    ];
    render(<CpdExportPage {...props} entries={entries} />);
    const status = screen.getByTestId("cpd-export-saved");
    expect(status.getAttribute("role")).toBe("status");
    fireEvent.click(screen.getByTestId("cpd-export-csv"));
    expect(download.calls).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain("1 activity may hold a patient detail");
    expect(screen.getByTestId("cpd-export-flag-bad").getAttribute("href")).toBe("/cme/log/bad");
    fireEvent.click(screen.getByTestId("cpd-export-csv-anyway"));
    expect(download.calls.map((call) => call.name)).toEqual(["cme-2026.csv"]);
    expect(screen.queryByRole("alert")).toBeNull();
    // The live region was in the page before the words, so they are announced.
    expect(screen.getByTestId("cpd-export-saved")).toBe(status);
    expect(status.textContent).toBe("cme-2026.csv is downloading. Check your downloads.");
  });

  it("Not now closes the warning without saving", () => {
    render(
      <CpdExportPage
        {...props}
        entries={[entry({ id: "bad", date: "2026-03-02", title: "Review of Mrs Smith", reflection: "" })]}
      />,
    );
    fireEvent.click(screen.getByTestId("cpd-export-csv"));
    fireEvent.click(screen.getByTestId("cpd-export-csv-cancel"));
    expect(screen.queryByTestId("cpd-export-patient-check")).toBeNull();
    expect(download.calls).toHaveLength(0);
  });

  it("a fast double tap saves one file", () => {
    vi.useFakeTimers({ now: new Date("2026-10-07T04:00:00Z"), toFake: ["Date"] });
    try {
      render(<CpdExportPage {...props} entries={DEMO_CME_ENTRIES} />);
      const button = screen.getByTestId("cpd-export-csv");
      fireEvent.click(button);
      fireEvent.click(button);
      expect(download.calls).toHaveLength(1);
      act(() => {
        vi.setSystemTime(new Date("2026-10-07T04:00:02Z"));
      });
      fireEvent.click(button);
      expect(download.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves example records out of the saved file and matches the mockup's labels", () => {
    const entries = [
      entry({ id: "real", date: "2026-03-01", title: "Kept grand round", reflection: "" }),
      entry({ id: "example:1", date: "2026-03-02", title: "Made-up workshop", reflection: "" }),
    ];
    render(<CpdExportPage {...props} entries={entries} />);
    fireEvent.click(screen.getByTestId("cpd-export-csv"));
    expect(download.calls[0]!.content).toContain("Kept grand round");
    expect(download.calls[0]!.content).not.toContain("Made-up workshop");
    expect(screen.getByTestId("cpd-export-print").textContent).toBe("Save as PDF");
    expect(screen.getByTestId("cpd-export-copy-next").textContent).toContain("Copy to your CPD home");
  });
});
