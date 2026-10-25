import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DeveloperClinicalAnswerFailuresPage from "@/app/(admin)/admin/developer-hub/clinical-answer-failures/page";

// PanelPageShell's back control is a ContextualBackLink, which calls
// next/navigation's useRouter for its history-aware click handler. Outside an
// app-router tree that throws, so every render here needs the router mocked.
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/developer-hub/clinical-answer-failures",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

/**
 * The derivation is mocked so this file stays a *page* contract — what is
 * rendered for a given set of failures. Its correctness (which items count, and
 * the whole-token matching that keeps a nested case id off the screen) is owned
 * by `tests/developer-clinical-answer-failures.test.ts`.
 */
const failures = vi.hoisted(() => ({
  value: [] as {
    item: {
      id: string;
      priority: string;
      type: string;
      summary: string;
      detail: string;
      source: string;
      added: string;
    };
    cases: { id: string; question: string }[];
  }[],
}));

vi.mock("@/lib/developer-area/clinical-answer-failures", () => ({
  resolveClinicalAnswerFailures: () => failures.value,
  referencedQuestionCount: (list: { cases: { id: string }[] }[]) =>
    new Set(list.flatMap((failure) => failure.cases.map((testCase) => testCase.id))).size,
}));

function failure(id: string, summary: string, cases: { id: string; question: string }[]) {
  return {
    item: { id, priority: "P2", type: "issue", summary, detail: "", source: "", added: "2026-08-22" },
    cases,
  };
}

afterEach(() => {
  failures.value = [];
});

describe("developer clinical answer failures page", () => {
  it("renders inside the shared shell and stamps the ledger as its source", async () => {
    render(await DeveloperClinicalAnswerFailuresPage());
    expect(screen.getByTestId("developer-clinical-answer-failures")).toBeInTheDocument();
    expect(screen.getByTestId("developer-clinical-answer-failures-back")).toHaveAttribute(
      "href",
      "/admin/developer-hub",
    );
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Ledger/);
  });

  it("shows the clinical question in words, not only its case id", async () => {
    // The id is what makes the match checkable; the question is the only part a
    // reader can act on. Losing the question would leave a page of slugs.
    failures.value = [
      failure("#J8SJQ9", "Metabolic monitoring returns a stub", [
        {
          id: "quality-antipsychotic-metabolic-monitoring",
          question: "What metabolic monitoring is required for antipsychotics?",
        },
      ]),
    ];
    render(await DeveloperClinicalAnswerFailuresPage());

    const entry = screen.getByTestId("developer-clinical-answer-failure-#J8SJQ9");
    expect(entry).toHaveTextContent("What metabolic monitoring is required for antipsychotics?");
    expect(entry).toHaveTextContent("quality-antipsychotic-metabolic-monitoring");
    expect(entry).toHaveTextContent("Metabolic monitoring returns a stub");
  });

  it("counts items and referenced questions separately, because one item can name several", async () => {
    failures.value = [
      failure("#S4R2W3", "Two questions answer with a bare title list", [
        { id: "quality-agitation-im-route", question: "Q1" },
        { id: "quality-duress-pathway", question: "Q2" },
      ]),
    ];
    render(await DeveloperClinicalAnswerFailuresPage());

    expect(screen.getByTestId("developer-clinical-answer-failures-count-items")).toHaveTextContent("1");
    expect(screen.getByTestId("developer-clinical-answer-failures-count-questions")).toHaveTextContent("2");
  });

  /**
   * Raised in review of PR #2498. An item names a case for more than one reason
   * — `#J8SJQ9` names the discharge-documentation case as the contrast that
   * legitimately answers with a source pointer — so the page must not present a
   * named question as a question proven broken. This pins the wording that keeps
   * the claim at the level the data supports.
   */
  it("presents named questions as references rather than as verdicts", async () => {
    failures.value = [
      failure("#J8SJQ9", "Metabolic monitoring returns a stub", [
        { id: "quality-antipsychotic-metabolic-monitoring", question: "What metabolic monitoring is required?" },
        { id: "quality-discharge-documentation", question: "What discharge documentation is required?" },
      ]),
    ];
    const { container } = render(await DeveloperClinicalAnswerFailuresPage());
    const text = container.textContent ?? "";

    expect(screen.getByTestId("developer-clinical-answer-failure-#J8SJQ9")).toHaveTextContent(
      "Questions this item names",
    );
    expect(text).toMatch(/not a verdict on each question/);
    expect(text).toMatch(/name a question as the contrast that is behaving correctly/);
    expect(screen.getByTestId("developer-clinical-answer-failures-count-questions")).toHaveTextContent(
      "questions referenced",
    );
  });

  /**
   * The empty state is the dangerous one on this page: it is the reading that
   * looks like good news. It must say what it does not know, in words, rather
   * than render a blank container that an empty list and a failed load would
   * both produce.
   */
  it("says what an empty list does not prove", async () => {
    render(await DeveloperClinicalAnswerFailuresPage());

    const empty = screen.getByTestId("developer-clinical-answer-failures-empty");
    expect(empty).toHaveTextContent(/No open ledger item names a clinical eval question/);
    expect(empty).toHaveTextContent(/not the answer engine being proven well/);
  });

  it("states the limits of its own coverage above the list, not as a footnote", async () => {
    failures.value = [failure("#J8SJQ9", "A failure", [{ id: "quality-duress-pathway", question: "Q" }])];
    const { container } = render(await DeveloperClinicalAnswerFailuresPage());

    const text = container.textContent ?? "";
    expect(text).toMatch(/narrower thing than a picture of answer quality/);
    // The caveat has to precede the evidence it qualifies; a reader who stops
    // after the first entry must already have read it.
    expect(text.indexOf("narrower thing")).toBeLessThan(text.indexOf("A failure"));
  });
});
