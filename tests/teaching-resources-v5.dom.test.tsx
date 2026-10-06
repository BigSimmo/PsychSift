/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));

import { examPrepRow, resourceTypeWords, thisWeekMeta, weekDayWord } from "@/components/teaching/resources-model";
import { TeachingExamPrep } from "@/components/teaching/teaching-exam-prep";
import { sampleExamPrep, studyHeatmap, studyMinutesSince } from "@/lib/teaching/term-tracker";

import { NB, NOW, TEAM_A, json, serveFetch, useTeachingTestClock } from "./helpers/teaching-fixtures";

// `useTeachingTestClock` only registers Vitest's beforeEach/afterEach; its name trips the hooks heuristic.
// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock(NOW);

const TODAY = "2026-10-06";
const EXAM = "55555555-5555-4555-8555-555555555555";

describe("the v5 Resources rows", () => {
  it("reads PDF from the link itself, never for a recording or a library document", () => {
    expect(resourceTypeWords({ kind: "reading", url: "https://example.org/a/handout.PDF" })).toBe("PDF");
    expect(resourceTypeWords({ kind: "link", url: "https://example.org/slides" })).toBe("Link");
    expect(resourceTypeWords({ kind: "recording", url: "https://example.org/talk.pdf" })).toBe("Recording");
    expect(resourceTypeWords({ kind: "slides", url: "not a link" })).toBe("Slides");
  });

  it("says the session's day, 'yours' only for the presenter, and never a page count", () => {
    expect(weekDayWord(TODAY, TODAY)).toBe("today");
    expect(weekDayWord("2026-10-07", TODAY)).toBe("Wednesday");
    const handout = { kind: "reading" as const, url: "https://example.org/handout.pdf" };
    expect(thisWeekMeta(handout, { dateKey: TODAY, isPresenter: false }, TODAY)).toBe("PDF · today");
    expect(
      thisWeekMeta({ kind: "link", url: "https://example.org/jc" }, { dateKey: TODAY, isPresenter: true }, TODAY),
    ).toBe("Link · today · yours");
    expect(thisWeekMeta({ ...handout, catchUp: true }, { dateKey: "2026-10-05", isPresenter: false }, TODAY)).toBe(
      "PDF · Monday · catch-up",
    );
    expect(thisWeekMeta(handout, null, TODAY)).toBe("PDF");
  });
});

describe("the made-up exam year", () => {
  it("matches the mock-up: 111 days, week 6 of 22, nine days in a row, 55.5 h, its five topics", () => {
    const sample = sampleExamPrep(TODAY);
    expect(examPrepRow(sample, TODAY)).toEqual({
      title: "Written exam in 111 days",
      meta: `Study plan week 6${NB}of 22 · 9 days in a row`,
    });
    const weeks = studyHeatmap(sample.study, TODAY);
    expect(studyMinutesSince(sample.study, weeks[0][0].date, TODAY)).toBe(55.5 * 60);
    expect(sample.topics.map((topic) => [topic.name, topic.percent])).toEqual([
      ["Past papers", 60],
      ["Critical appraisal", 45],
      ["Psychotherapy", 30],
      ["Old age psychiatry", 20],
      ["Child and adolescent", 0],
    ]);
  });
});

describe("My exam prep", () => {
  it("links to the organisers' exam prep collection with its count, and keeps Change on the study group row", async () => {
    serveFetch((url) =>
      url.startsWith("/api/teaching/resources?action=resources.read&weekStart=")
        ? json(200, {
            forThisWeek: [],
            collections: [{ collectionId: EXAM, serviceId: TEAM_A, name: "Exam prep", count: 9 }],
            recordingsCount: 0,
            savedCount: 0,
          })
        : null,
    );
    render(<TeachingExamPrep demoMode />);
    const row = await screen.findByTestId("teaching-exam-collection");
    expect(row.querySelector("a")).toHaveAttribute("href", `/teaching/resources/${EXAM}`);
    expect(row.textContent).toContain("Exam prep collection");
    expect(row.textContent).toContain(`9${NB}items from organisers`);
    expect(screen.getByRole("button", { name: "Change study group: Practice questions" })).toBeInTheDocument();
    expect(
      screen.getByText("Do not add patient details. Stays on this device and is not backed up."),
    ).toBeInTheDocument();
  });

  it("falls back to Teaching resources when no exam collection can be read", async () => {
    serveFetch(() => null);
    render(<TeachingExamPrep demoMode />);
    expect(await screen.findByRole("link", { name: /Teaching resources/ })).toHaveAttribute(
      "href",
      "/teaching/resources",
    );
    expect(screen.queryByTestId("teaching-exam-collection")).toBeNull();
  });
});
