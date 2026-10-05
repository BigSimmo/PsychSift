import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CmeDashboard } from "@/components/cme/cme-dashboard";
import { CmeLogPage } from "@/components/cme/cme-log-page";
import { CmeYearCheckPage } from "@/components/cme/cme-year-check-page";
import { createAustralianRanzcpPreset } from "@/lib/cme/presets";
import type { CmeEntry } from "@/lib/cme/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cme",
}));

afterEach(cleanup);

const SET = createAustralianRanzcpPreset(2026, "2026-01-05");

function entry(overrides: Partial<CmeEntry> & Pick<CmeEntry, "id">): CmeEntry {
  return {
    date: "2026-03-01",
    title: `Activity ${overrides.id}`,
    allocations: [{ category: "educational", hours: 2 }],
    reflection: "Useful.",
    costCents: null,
    transcribed: true,
    routineId: null,
    documentId: null,
    buckets: [],
    evidenceCount: 1,
    ...overrides,
  };
}

const ENTRIES = [
  entry({ id: "a", title: "Grand round" }),
  entry({ id: "b", title: "Peer review group", evidenceCount: 0, transcribed: false, reflection: "" }),
];

describe("year check page", () => {
  it("rings the confirmed domains, counts tagged activities and offers to tag an empty one", () => {
    render(
      <CmeYearCheckPage
        set={SET}
        entries={[
          entry({ id: "p1", buckets: ["Professionalism"] }),
          entry({ id: "p2", buckets: ["Professionalism", "Ethical practice"] }),
          entry({ id: "old", buckets: ["Culturally safe practice"], archivedAt: "2026-04-01T00:00:00Z" }),
        ]}
      />,
    );
    const ring = screen.getByTestId("cme-domains-ring-domains");
    expect(within(ring).getByRole("heading")).toHaveTextContent("Professional development domains · 2 of 4");
    expect(ring.querySelectorAll('path[data-filled="true"]')).toHaveLength(2);
    expect(ring).toHaveTextContent("Professionalism2 activities");
    // An archived activity does not count, so culturally safe practice still offers "Tag one".
    expect(within(ring).getByRole("link", { name: "Tag one for Culturally safe practice" })).toHaveAttribute(
      "href",
      "/cme/log?year=2026",
    );
    expect(within(ring).getAllByRole("link", { name: /^Tag one/ })).toHaveLength(2);
  });

  it("points to Renewals for the CPD home question, with its source", () => {
    render(<CmeYearCheckPage set={SET} entries={ENTRIES} />);
    const renewal = screen.getByTestId("cme-check-renewal");
    expect(renewal).toHaveTextContent("Your next renewal asks which CPD home you used in 2026");
    expect(within(renewal).getByRole("link", { name: "Open Renewals in Admin" })).toHaveAttribute(
      "href",
      "/admin/renewals",
    );
    expect(within(renewal).getByRole("link", { name: /Medical Board/ })).toHaveAttribute(
      "href",
      expect.stringContaining("medicalboard.gov.au"),
    );
  });

  it("says how many rows are done and states each status in words", async () => {
    const user = userEvent.setup();
    render(<CmeYearCheckPage set={SET} entries={ENTRIES} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^\d+ of 10 done$/);
    expect(screen.getByText(/It records what you checked and is not certification\./)).toBeInTheDocument();
    const evidence = screen.getByTestId("cme-check-row-evidence");
    expect(evidence).toHaveAttribute("data-ready", "false");
    expect(evidence).toHaveTextContent("Evidence kept for each activity — to do");
    // What counts and the fix now open in a named sheet from the row.
    expect(within(evidence).queryByRole("link")).toBeNull();
    await user.click(within(evidence).getByRole("button", { name: /Evidence kept for each activity/ }));
    const sheet = screen.getByTestId("cme-check-sheet");
    expect(screen.getByRole("dialog", { name: "Evidence kept for each activity" })).toBeInTheDocument();
    expect(within(sheet).getByText("Which activities")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: /^Peer review group/ })).toHaveAttribute("href", "/cme/log/b");
    expect(within(sheet).getByRole("link", { name: "Show them" })).toHaveAttribute(
      "href",
      "/cme/log?year=2026&fix=evidence",
    );
  });

  it("puts what needs the owner first and folds what is done, with a progress bar beside the count", async () => {
    const user = userEvent.setup();
    // Every activity reflected on and copied, so those two rows are done.
    const finished = ENTRIES.map((item) => ({ ...item, reflection: "Useful.", transcribed: true }));
    render(<CmeYearCheckPage set={SET} entries={finished} />);
    const needs = screen.getByTestId("cme-check-needs-you");
    const done = screen.getByTestId("cme-check-done");
    expect(
      within(needs)
        .getAllByRole("listitem")
        .every((row) => row.getAttribute("data-ready") === "false"),
    ).toBe(true);
    expect(
      within(done)
        .getAllByRole("listitem", { hidden: true })
        .every((row) => row.dataset.ready === "true"),
    ).toBe(true);
    expect(screen.getByRole("heading", { name: /^Needs you \(\d+\)$/ })).toBeInTheDocument();
    expect(done).not.toHaveAttribute("open");
    expect(done.querySelector("summary")).toHaveTextContent(/^Done \(\d+\)$/);
    expect(done.querySelector("summary")?.className).toMatch(/\bflex\b.*\bitems-center\b/);
    expect(screen.getByTestId("cme-check-progress")).toHaveAttribute("aria-hidden", "true");
    // A target lists what counts, with its own fix in the sheet footer.
    await user.click(within(screen.getByTestId("cme-check-row-total")).getByRole("button"));
    const sheet = screen.getByTestId("cme-check-sheet");
    expect(within(sheet).getByText(/^What counts \(2\)$/)).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Log an activity" })).toHaveAttribute("href", "/cme/new?year=2026");
    // The hand-over line stays.
    expect(screen.getByRole("link", { name: "annual summary" })).toHaveAttribute("href", "/cme/summary?year=2026");
  });
});

describe("year check when evidence was not counted", () => {
  it("shows the evidence row as not checked, with no link to fix it", () => {
    const uncounted = ENTRIES.map((item) => ({ ...item, evidenceCount: undefined }));
    render(<CmeYearCheckPage set={SET} entries={uncounted} />);
    const evidence = screen.getByTestId("cme-check-row-evidence");
    expect(evidence).toHaveAttribute("data-ready", "false");
    expect(evidence).toHaveAttribute("data-not-checked", "true");
    expect(evidence).toHaveTextContent("Evidence kept for each activity — not checked");
    expect(evidence).toHaveTextContent("Not checked");
    expect(within(evidence).queryByRole("link")).toBeNull();
    expect(evidence).not.toHaveTextContent(/Every activity has a certificate/);
  });
});

describe("dashboard shortcuts", () => {
  it("links to the year check and the calendar, and reminds about last year's copies", () => {
    render(
      <CmeDashboard
        set={SET}
        entries={ENTRIES}
        now={new Date("2026-02-10T02:00:00Z")}
        reportingReminder={{ year: 2025, notCopied: 3, closesOn: "2026-03-01" }}
      />,
    );
    expect(screen.getByTestId("cme-year-check-link")).toHaveAttribute("href", "/cme/check?year=2026");
    expect(screen.getByTestId("cme-calendar-link")).toHaveTextContent("18 Dec 2026: You can close your 2026 CPD year");
    const reminder = screen.getByTestId("cme-reporting-reminder");
    expect(reminder).toHaveAttribute("href", "/cme/log?year=2025&copy=todo");
    expect(reminder).toHaveTextContent("3 activities from 2025 not yet copied to MyCPD.");
    expect(reminder).toHaveTextContent("closes on 1 March");
  });
});

describe("log attention filters", () => {
  it("opens already narrowed to activities not yet copied", () => {
    render(<CmeLogPage set={SET} entries={ENTRIES} initialAttention="copy" />);
    expect(screen.getByTestId("cme-log-attention-copy")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("cme-log-copy-help")).toBeInTheDocument();
    expect(screen.queryByTestId("cme-log-row-a")).toBeNull();
    expect(screen.getByTestId("cme-log-row-b")).toBeInTheDocument();
  });
});
