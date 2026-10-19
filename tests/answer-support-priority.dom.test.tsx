import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AnswerUtilityActions } from "@/components/clinical-dashboard/evidence-panels";

/**
 * The answer surface's utilities and the routes that replaced the support card.
 *
 * The answer support card and its priority function were retired on
 * 2026-09-25 (#51975R, owner decision): the card left the answer surface on
 * 2026-08-31, and the pair then had no caller in `src/` while their behaviour
 * was still being cited as a live clinical rule. The five cases that pinned the
 * priority function went with them, and so did the assertion that the surface
 * no longer mounts the card, which the compiler now enforces on its own. The
 * grounding caution the card restated lives in the answer-limitations chip and
 * its panel (pinned below) and in the support chip, pinned by the source-only
 * journey in `tests/ui-smoke.spec.ts`.
 */

describe("AnswerUtilityActions · feedback on a clean answer", () => {
  it("reaches Report a problem through the thumb down, beside Copy with sources", async () => {
    const user = userEvent.setup();
    render(
      <AnswerUtilityActions
        copied={false}
        onCopy={() => undefined}
        pendingFeedback={null}
        onSubmitFeedback={() => undefined}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^Cop(?:y|ied) with sources: answer and source status$/ }),
    ).toBeInTheDocument();

    const report = screen.getByTestId("answer-feedback-trigger");
    expect(report).toHaveAccessibleName("Report a problem with this answer");
    // A dialog opener, not an in-flow disclosure: as a disclosure this list
    // opened partly behind the fixed phone composer and could not scroll itself
    // clear without hiding the phone chrome (see the comment on the Sheet).
    expect(report).toHaveAttribute("aria-haspopup", "dialog");
    expect(report).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("answer-review-panel")).not.toBeInTheDocument();

    await user.click(report);
    expect(report).toHaveAttribute("aria-expanded", "true");
    const sheet = await screen.findByTestId("answer-feedback-sheet");
    // The sheet asks the question in its own header, so the panel inside it
    // does not ask it a second time.
    expect(within(sheet).getByText("What is wrong with this answer?")).toBeInTheDocument();
    const panel = within(sheet).getByTestId("answer-review-panel");
    expect(panel).toHaveAttribute("data-tone", "problems");
    expect(panel).toHaveAttribute("data-chrome", "bare");
    expect(within(panel).queryByText("What is wrong with this answer?")).not.toBeInTheDocument();
    // The affirmative option is the thumb up, not an entry in a list opened to
    // report a fault — offering it here is a mis-click that records the
    // opposite of what the reader meant.
    expect(within(panel).queryByRole("button", { name: /Verified/ })).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Wrong source/ })).toBeInTheDocument();
  });

  it("closes the sheet on submission so the outcome notice is reachable", async () => {
    // The dashboard reports every outcome — success, network failure, an expired
    // feedback token, and synthetic demo answers — through the page-level notice
    // alone, which renders outside this portaled modal. Leaving the sheet open
    // puts that notice behind the backdrop with the page inert, so the tap reads
    // as having done nothing. Codex P2 on PR #2541; it did not exist while the
    // list was an in-flow disclosure.
    const user = userEvent.setup();
    const onSubmitFeedback = vi.fn();
    render(
      <AnswerUtilityActions
        copied={false}
        onCopy={() => undefined}
        pendingFeedback={null}
        onSubmitFeedback={onSubmitFeedback}
      />,
    );

    const report = screen.getByTestId("answer-feedback-trigger");
    await user.click(report);
    const sheet = await screen.findByTestId("answer-feedback-sheet");
    await user.click(within(sheet).getByRole("button", { name: /Wrong source/ }));

    expect(onSubmitFeedback).toHaveBeenCalledTimes(1);
    expect(onSubmitFeedback).toHaveBeenCalledWith("wrong_source");
    await waitFor(() => expect(screen.queryByTestId("answer-feedback-sheet")).not.toBeInTheDocument());
    expect(report).toHaveAttribute("aria-expanded", "false");
  });

  it("routes the clinical-points sheet from the points rail now that the support card is gone", () => {
    const surface = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/answer-result-surface.tsx"),
      "utf8",
    );
    expect(surface).toContain("<AnswerUtilityActions");
    // The support card was removed on 2026-08-31. The header chip that replaced
    // it became the Key points rail (named Clinical points until 2026-09-04), moved to the seam
    // between the answer and its sources. The rail is therefore the ONLY route
    // to the findings sheet, so every pill must stay a button.
    expect(surface).toContain('data-testid="answer-clinical-points"');
    expect(surface).toContain('"answer-safety-findings-trigger"');
    expect(surface).toContain("onClick={openSafetyFindings}");
    // Grouped by kind, in severity order, because a finding carries no short
    // title — only a label and the whole passage.
    expect(surface).toContain("groupSafetyFindingsByKind");
    // The rail renders at the seam, not in the status chip row.
    expect(surface).toContain("clinicalPoints={clinicalPointsRail}");
    expect(surface).toContain("const answerMetaChips = null;");
    // Focus returns to the pill that opened the sheet, not to the first pill in
    // the rail. `returnFocusRef` alone cannot express that when the rail has one
    // button per kind, and getting it wrong also scrolls a horizontal rail out
    // from under the reader.
    expect(surface).toContain("resolveReturnFocusTarget={resolveSafetyReturnFocus}");
    expect(surface).toContain("safetyOpenerRef.current = event.currentTarget;");
    expect(surface).toContain("opener?.isConnected");
    // The governed verification wording moved below the answer with it, and the
    // surface must render it itself once it takes placement from the card.
    expect(surface).toContain('verificationPlacement="content"');
    expect(surface).toContain("<VerificationNotice {...answerVerification} />");
  });

  it("keeps the overdue-sources control inside the answer-limitations disclosure", () => {
    // Owner decision, 2026-09-01: the control that names WHICH cited sources are
    // past their review date moved out of the answer body and into the
    // disclosure, with the other statements about this answer's evidence.
    const surface = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/answer-result-surface.tsx"),
      "utf8",
    );
    const content = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/answer-content.tsx"),
      "utf8",
    );

    // Gone from the answer body, and its props with it.
    expect(content).not.toContain("<RetrievalStateBanner");
    expect(content).not.toContain("onOpenStateSource");

    // Present in the disclosure, and rendered before the warnings so the
    // governed caution leads what the reader sees on opening it.
    expect(surface).toContain("<RetrievalStateBanner");
    const detailStart = surface.indexOf('id="answer-limitations-detail"');
    const sourceOnlyInDetail = surface.indexOf('data-testid="answer-limitation-source-only"');
    const bannerInDetail = surface.indexOf("{overdueSourcesBanner}");
    const warningsInDetail = surface.indexOf("renderModel.warnings.map");
    expect(detailStart).toBeGreaterThan(-1);
    // Severity order inside the panel: provenance, then which sources are
    // overdue, then the rest.
    expect(sourceOnlyInDetail).toBeGreaterThan(detailStart);
    expect(bannerInDetail).toBeGreaterThan(sourceOnlyInDetail);
    expect(warningsInDetail).toBeGreaterThan(bannerInDetail);

    // The governed extractive wording is looked up, never reworded at the call
    // site. The strings themselves are pinned in answer-source-marks.dom.test.tsx.
    expect(surface).toContain('compactVerificationWordingFor(answerState.kind, "extractive")');

    // The disclosure must survive on an overdue-only answer, or moving the
    // banner in here would delete it outright rather than relocate it — and on a
    // source-only answer carrying no other warning, or folding the Source-only
    // pill in here would delete that notice outright.
    expect(surface).toContain("renderModel.warnings.length > 0 || overdueSourcesBanner || sourceOnly");
    // And the chip that opens it must exist for both of those answers too.
    expect(surface).toContain('const answerReviewDue = answerState.kind === "stale_evidence";');
    expect(surface).toContain("renderModel.warnings.length > 0 || answerReviewDue || sourceOnly");

    // The chip's label must keep ALL THREE parts. Since the Source-only pill was
    // folded into this disclosure the label is the only thing on the default
    // view that says no model wrote the answer AND that a cited source is
    // overdue — `VerificationNotice` is `hidden print:flex` on a source-only
    // answer — so a warning count must never replace either prefix, and a
    // currency warning must never be counted as one of the limitations.
    expect(surface).toContain('"Source-only"');
    expect(surface).toContain('"Review due"');
    expect(surface).toContain("isCurrencyReviewWarning");
    const labelStart = surface.indexOf("const answerLimitationsChipLabel");
    expect(labelStart).toBeGreaterThan(-1);
    const label = surface.slice(labelStart, labelStart + 400);
    expect(label).toContain('"Source-only"');
    expect(label).toContain('"Review due"');
    expect(label).toContain("answerGapWarningCount");
  });
});

describe("AnswerUtilityActions · Log as CPD", () => {
  it("links to a new CME entry when the answer cites a source", () => {
    render(<AnswerUtilityActions copied={false} onCopy={() => undefined} cpdHref="/cme/new?title=Guideline" />);
    const link = screen.getByTestId("answer-log-cpd");
    expect(link).toHaveAttribute("href", "/cme/new?title=Guideline");
    expect(link).toHaveTextContent("Log as CPD");
  });

  it("is absent when nothing was cited", () => {
    render(<AnswerUtilityActions copied={false} onCopy={() => undefined} />);
    expect(screen.queryByTestId("answer-log-cpd")).not.toBeInTheDocument();
  });
});
