import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ANSWER_PROVIDER_NOTICE_TEXT,
  AnswerProviderNotice,
} from "@/components/clinical-dashboard/answer-provider-notice";

/** The overseas-processing line under an answer (audit S3, 2026-10-13). */
describe("AnswerProviderNotice", () => {
  it("says where a question goes and asks for no patient details, as one quiet note", () => {
    render(<AnswerProviderNotice />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(
      "Questions are sent to an overseas AI service (OpenAI) to search and write answers. Don't include patient details.",
    );
    expect(note).toHaveTextContent(ANSWER_PROVIDER_NOTICE_TEXT);
    expect(note).toHaveAttribute("data-testid", "answer-provider-notice");
  });

  it("takes its own test id for the pre-submit copy on the home", () => {
    render(<AnswerProviderNotice testId="answer-provider-notice-home" />);
    expect(screen.getByRole("note")).toHaveAttribute("data-testid", "answer-provider-notice-home");
  });

  it("is mounted under the latest answer and on the Answer home, never in demo mode", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/ClinicalDashboard.tsx"), "utf8");
    expect(source.match(/<AnswerProviderNotice\b/g)).toHaveLength(2);
    // Before the first question: on the shared home, only in Answer mode, never in demo mode.
    expect(source).toMatch(
      /<SharedHomeEmptyState[\s\S]{0,800}searchMode === "answer" && !explicitDemoMode \? \(\s*<AnswerProviderNotice[^>]*answer-provider-notice-home/,
    );
    expect(source).toMatch(
      /explicitDemoMode \|\|\s*answer\.demoMode === true[^?]*\? null : \(\s*<AnswerProviderNotice/,
    );
  });
});
