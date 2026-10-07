import { cleanup, render, screen, within } from "@testing-library/react";
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
/** A fixed day inside SET's CPD year, so the rule tests do not depend on the real date. */
const RULE_NOW = new Date("2026-09-28T02:00:00.000Z");

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
    // work-mode redesign, owner request 6 Oct 2026: the mockup's "2 of 4", without the overclaiming "covered".
    expect(within(ring).getByRole("heading")).toHaveTextContent(/^Activities per domain · 2 of 4$/);
    expect(ring.querySelectorAll('path[data-filled="true"]')).toHaveLength(2);
    expect(ring).toHaveTextContent("Professionalism2 activities");
    // An archived activity does not count, so culturally safe practice still offers "Tag one".
    expect(within(ring).getByRole("link", { name: "Tag one for Culturally safe practice" })).toHaveAttribute(
      "href",
      "/cme/log?year=2026",
    );
    expect(within(ring).getAllByRole("link", { name: /^Tag one/ })).toHaveLength(2);
  });

  it("points to Renewals for the CPD home question, under the rule's source", () => {
    render(<CmeYearCheckPage set={SET} entries={ENTRIES} />);
    const renewal = screen.getByTestId("cme-check-renewal");
    expect(renewal).toHaveTextContent("Your next renewal asks which CPD home you used in 2026");
    expect(renewal).toHaveTextContent("Renewals are in Admin");
    expect(renewal).toHaveAttribute("href", "/admin/renewals");
    const rule = screen.getByTestId("cme-check-rule");
    expect(within(rule).getByRole("link", { name: /Medical Board · checked Oct 2026/ })).toHaveAttribute(
      "href",
      expect.stringContaining("medicalboard.gov.au"),
    );
  });

  it("says how many checks are done with one part per check, and states each status in words", () => {
    render(<CmeYearCheckPage set={SET} entries={ENTRIES} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Year check for 2026");
    expect(screen.getByTestId("cme-check-count")).toHaveTextContent(/^\d+ of 10 checks done$/);
    const progress = screen.getByTestId("cme-check-progress");
    expect(progress).toHaveAttribute("aria-hidden", "true");
    expect(progress.children).toHaveLength(10);
    const evidence = screen.getByTestId("cme-check-row-evidence");
    expect(evidence).toHaveTextContent("Evidence kept for each activity — to do");
    expect(evidence).toHaveTextContent("1 activity with no evidence attached");
    expect(within(evidence).getByRole("link", { name: "Show: Evidence kept for each activity" })).toHaveAttribute(
      "href",
      // The new work mode (the test default) sends this to CPD Evidence; the classic mode keeps Log's filter.
      "/cme/evidence?year=2026",
    );
    expect(screen.getByTestId("cme-check-row-copied")).toHaveTextContent("1 activity not marked copied");
  });

  it("groups confirmed targets apart from record-keeping, open rows first, figures against each target", () => {
    const finished = ENTRIES.map((item) => ({ ...item, reflection: "Useful.", transcribed: true }));
    render(<CmeYearCheckPage set={SET} entries={finished} />);
    const targets = screen.getByTestId("cme-check-targets");
    expect(within(targets).getByRole("heading")).toHaveTextContent(
      "Targets you confirmed · RANZCP starting set, 5 Jan",
    );
    const ids = within(targets)
      .getAllByRole("listitem")
      .map((row) => row.dataset.testid);
    expect(ids).toEqual([
      "cme-check-row-total",
      "cme-check-row-requirement-educational",
      "cme-check-row-requirement-combined",
      "cme-check-row-requirement-peer-review",
      "cme-check-row-requirement-domains",
      "cme-check-row-requirement-self-evaluation",
      "cme-check-row-requirement-plan",
    ]);
    expect(screen.getByTestId("cme-check-row-total")).toHaveTextContent("4 h logged, 46 h to go");
    expect(screen.getByTestId("cme-check-row-requirement-combined")).toHaveTextContent(
      "0 of 25 h, at least 5 h in each",
    );
    expect(screen.getByTestId("cme-check-row-requirement-peer-review")).toHaveTextContent("0 of 10 h");
    expect(screen.getByTestId("cme-check-row-requirement-domains")).toHaveTextContent("4 of 4 have nothing yet");
    expect(screen.getByTestId("cme-check-row-requirement-educational")).toHaveTextContent("4 of 12.5 h");
    expect(
      within(screen.getByTestId("cme-check-row-requirement-self-evaluation")).getByRole("link", {
        name: "Mark done: Annual self-evaluation",
      }),
    ).toHaveAttribute("href", "/cme/setup");
    expect(
      within(screen.getByTestId("cme-check-row-total")).getByRole("link", { name: "Log: 50 hours in total" }),
    ).toHaveAttribute("href", "/cme/new?year=2026");
    // Reflection and copying are done: a grey tick, no action.
    const records = screen.getByTestId("cme-check-records");
    expect(within(records).getByRole("heading")).toHaveTextContent("Your own record-keeping checks");
    const reflection = screen.getByTestId("cme-check-row-reflection");
    expect(reflection).toHaveTextContent("A reflection on each activity — done");
    expect(within(reflection).queryByRole("link")).toBeNull();
    // The done rows sit after the open ones.
    const recordIds = within(records)
      .getAllByRole("listitem")
      .map((row) => row.dataset.testid);
    expect(recordIds).toEqual(["cme-check-row-evidence", "cme-check-row-reflection", "cme-check-row-copied"]);
  });

  it("marks a reached hours target with its figure and moves it below the open ones", () => {
    const many = [entry({ id: "big", allocations: [{ category: "educational", hours: 16 }] })];
    render(<CmeYearCheckPage set={SET} entries={many} />);
    expect(screen.getByTestId("cme-check-row-requirement-educational")).toHaveTextContent(
      "Educational activities — done16 of 12.5 h · reached",
    );
    const ids = within(screen.getByTestId("cme-check-targets"))
      .getAllByRole("listitem")
      .map((row) => row.dataset.testid);
    expect(ids.at(-1)).toBe("cme-check-row-requirement-educational");
  });

  it("hands over through the annual summary as text links, with no separate hours-by-category list", () => {
    render(<CmeYearCheckPage set={SET} entries={ENTRIES} goalCount={3} />);
    const summary = screen.getByTestId("cme-check-summary");
    expect(summary).toHaveTextContent("2 activities · 4 h · 3 goals");
    expect(summary).toHaveTextContent("A personal record, not proof you meet the standard.");
    expect(within(summary).getByRole("link", { name: "Save as PDF" })).toHaveAttribute(
      "href",
      "/cme/summary?year=2026",
    );
    expect(within(summary).getByRole("link", { name: "Download CSV" })).toHaveAttribute(
      "href",
      "/api/cme/export?year=2026",
    );
    expect(within(summary).queryByRole("button")).toBeNull();
    // The mock-up's Report has no hours-by-category list: the Year page carries those figures.
    expect(screen.queryByTestId("cme-check-categories")).toBeNull();
  });

  it("never links the account's CSV while example records show", () => {
    render(<CmeYearCheckPage set={SET} entries={ENTRIES} demoMode />);
    const summary = screen.getByTestId("cme-check-summary");
    expect(within(summary).queryByRole("link", { name: "Download CSV" })).toBeNull();
    expect(within(summary).getByRole("button", { name: "Download CSV" })).toBeInTheDocument();
    expect(summary.querySelector('a[href^="/api/cme/export"]')).toBeNull();
  });

  it("lists covered domains first and names RANZCP as their source", () => {
    render(
      <CmeYearCheckPage
        set={SET}
        entries={[entry({ id: "d", buckets: ["Ethical practice"] })]}
        now={new Date("2026-10-05T02:00:00Z")}
      />,
    );
    const ring = screen.getByTestId("cme-domains-ring-domains");
    const domains = within(ring)
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(domains[0]).toMatch(/^Ethical practice1/);
    expect(within(ring).getByRole("link", { name: "RANZCP" })).toHaveAttribute(
      "href",
      "https://www.ranzcp.org/cpd-program-membership/cpd-program/cpd-overview",
    );
  });

  it("offers closing from 17 December, in PsychSift only, and links to the summary once open", () => {
    const { unmount } = render(<CmeYearCheckPage set={SET} entries={ENTRIES} now={new Date("2026-10-05T02:00:00Z")} />);
    const close = screen.getByTestId("cme-check-close");
    expect(close).toHaveTextContent("From Thu 17 Dec. Closes the year in PsychSift only, not in MyCPD.");
    expect(within(close).queryByRole("link")).toBeNull();
    expect(screen.getByTestId("cme-check-note")).toHaveTextContent(
      "You can add one when you close the year, from Thu 17 Dec.",
    );
    unmount();
    render(<CmeYearCheckPage set={SET} entries={ENTRIES} now={new Date("2026-12-20T02:00:00Z")} />);
    expect(within(screen.getByTestId("cme-check-close")).getByRole("link", { name: "Close" })).toHaveAttribute(
      "href",
      "/cme/summary?year=2026#cme-year-close-heading",
    );
    expect(within(screen.getByTestId("cme-check-note")).getByRole("link", { name: "Add a note" })).toBeInTheDocument();
  });

  it("shows the CPD rule read-only: none ticked when the training record was not read", () => {
    const { unmount } = render(<CmeYearCheckPage set={SET} entries={ENTRIES} now={RULE_NOW} />);
    for (const id of ["everyone", "trainee", "intern"]) {
      expect(screen.getByTestId(`cme-check-rule-${id}`)).not.toHaveTextContent("your rule");
    }
    const note = screen.getByTestId("cme-check-rule-note");
    expect(note).toHaveTextContent("Not signed off");
    expect(note).toHaveTextContent("empty or was not read here, so no rule is ticked");
    expect(within(note).getByRole("link", { name: "Check your training record" })).toHaveAttribute(
      "href",
      "/cme/training",
    );
    unmount();
    const stage = { id: "s3", kind: "stage" as const, label: "Stage 3", startsOn: "2026-02-01", endsOn: null, fte: 1 };
    render(
      <CmeYearCheckPage
        set={SET}
        entries={ENTRIES}
        now={RULE_NOW}
        trainingPosition={{
          stage,
          rotation: null,
          rotationIndex: null,
          rotationCount: 0,
          onBreak: false,
          breakPeriod: null,
        }}
      />,
    );
    expect(screen.getByTestId("cme-check-rule-trainee")).toHaveTextContent("your rule");
    expect(screen.getByTestId("cme-check-rule-everyone")).not.toHaveTextContent("your rule");
  });

  it("shows the standard rule when the record has no current stage, even on a break", () => {
    const breakPeriod = {
      id: "b1",
      kind: "break" as const,
      label: "Leave",
      startsOn: "2026-02-01",
      endsOn: null,
      fte: 0,
    };
    render(
      <CmeYearCheckPage
        set={SET}
        entries={ENTRIES}
        now={RULE_NOW}
        trainingPosition={{
          stage: null,
          rotation: null,
          rotationIndex: null,
          rotationCount: null,
          onBreak: true,
          breakPeriod,
        }}
      />,
    );
    expect(screen.getByTestId("cme-check-rule-everyone")).toHaveTextContent("Everyone else — your rule");
    expect(screen.getByTestId("cme-check-rule-everyone")).toHaveTextContent("50 h a year");
    expect(screen.getByTestId("cme-check-rule-trainee")).not.toHaveTextContent("your rule");
  });

  it("ticks no rule for a break inside a stage, or for a year other than the current one", () => {
    const stage = { id: "s3", kind: "stage" as const, label: "Stage 3", startsOn: "2026-02-01", endsOn: null, fte: 1 };
    const breakPeriod = {
      id: "b1",
      kind: "break" as const,
      label: "Leave",
      startsOn: "2026-09-01",
      endsOn: null,
      fte: 0,
    };
    const { unmount } = render(
      <CmeYearCheckPage
        set={SET}
        entries={ENTRIES}
        now={RULE_NOW}
        trainingPosition={{ stage, rotation: null, rotationIndex: null, rotationCount: 0, onBreak: true, breakPeriod }}
      />,
    );
    for (const id of ["everyone", "trainee", "intern"]) {
      expect(screen.getByTestId(`cme-check-rule-${id}`)).not.toHaveTextContent("your rule");
    }
    expect(screen.getByTestId("cme-check-rule-note")).toHaveTextContent("a break within Stage 3 today");
    unmount();

    // A 2026 report read in 2027: today's training record says nothing about 2026.
    render(
      <CmeYearCheckPage
        set={SET}
        entries={ENTRIES}
        now={new Date("2027-03-01T02:00:00.000Z")}
        trainingPosition={{
          stage,
          rotation: null,
          rotationIndex: null,
          rotationCount: 0,
          onBreak: false,
          breakPeriod: null,
        }}
      />,
    );
    expect(screen.getByTestId("cme-check-rule-trainee")).not.toHaveTextContent("your rule");
    expect(screen.getByTestId("cme-check-rule-note")).toHaveTextContent("Your rule for 2026 is not worked out here");
  });

  it("links to Set up and Customise", () => {
    render(<CmeYearCheckPage set={SET} entries={ENTRIES} />);
    expect(screen.getByTestId("cme-check-setup")).toHaveAttribute("href", "/cme/setup?year=2026");
    expect(screen.getByTestId("cme-check-setup")).toHaveTextContent(
      "50 h total · RANZCP starting set, confirmed 5 Jan",
    );
    expect(screen.getByTestId("cme-check-customise")).toHaveAttribute("href", "/cme/customise");
  });
});

describe("year check when evidence was not counted", () => {
  it("shows the evidence row as not checked, with no link to fix it", () => {
    const uncounted = ENTRIES.map((item) => ({ ...item, evidenceCount: undefined }));
    render(<CmeYearCheckPage set={SET} entries={uncounted} />);
    const evidence = screen.getByTestId("cme-check-row-evidence");
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
    expect(screen.getByTestId("cme-calendar-link")).toHaveTextContent("17 Dec: You can close your 2026 CPD year");
    const reminder = screen.getByTestId("cme-reporting-reminder");
    expect(reminder).toHaveAttribute("href", "/cme/log?year=2025&copy=todo");
    expect(reminder).toHaveTextContent("3 activities from 2025 not marked copied to MyCPD");
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
