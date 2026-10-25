import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AnswerCard, AnswerFooter, DoseLine, answerClipboardText, type DoseRow } from "@/components/ui/answer-card";
import type { AnswerState, OverdueSource } from "@/components/ui/answer-state";
import { DateDisplay } from "@/components/ui/date-display";
import { MissingValue, type MissingValueReason } from "@/components/ui/missing-value";
import { RetrievalStateBanner } from "@/components/ui/retrieval-state-banner";
import {
  VerificationNotice,
  recordedUnknownVerificationNoticeStateKeysForTests,
  recordUnknownVerificationNoticeStateForTests,
  resetRecordedUnknownVerificationNoticeStatesForTests,
} from "@/components/ui/verification-notice";
import { formatClinicalDate } from "@/lib/source-metadata";

const readyState: AnswerState = { kind: "ready", sourceCount: 4 };

const overdue: OverdueSource[] = [
  {
    sourceId: "doc-1",
    title: "WA Clozapine Protocol",
    locator: "p. 12",
    reviewDueOn: "2025-11-01",
    status: "review_due",
  },
  { sourceId: "doc-2", title: "RANZCP Guideline", reviewDueOn: null, status: "review_due" },
];

describe("MissingValue", () => {
  it("names the four kinds of absence instead of rendering a dash", () => {
    const { rerender } = render(<MissingValue reason="not_recorded" />);
    expect(screen.getByTestId("missing-value")).toHaveTextContent("Not recorded");

    rerender(<MissingValue reason="not_applicable" />);
    expect(screen.getByTestId("missing-value")).toHaveTextContent("Not applicable");

    rerender(<MissingValue reason="unknown" />);
    expect(screen.getByTestId("missing-value")).toHaveTextContent("Unknown");

    rerender(<MissingValue reason="extraction_failed" />);
    expect(screen.getByTestId("missing-value")).toHaveTextContent("Unable to extract");
  });

  it("never abbreviates to a dash, even at cell density", () => {
    render(<MissingValue reason="not_recorded" density="cell" />);
    const node = screen.getByTestId("missing-value");
    expect(node.textContent).toBe("Not recorded");
    expect(node.textContent).not.toBe("-");
    expect(node.textContent).not.toBe("—");
  });

  it("falls back to Unknown for an unrecognised reason rather than throwing", () => {
    // Enum resilience (SPEC §7): an off-vocabulary reason arriving from data must
    // degrade, not unmount the tree.
    const reason = "withheld" as unknown as "unknown";
    expect(() => render(<MissingValue reason={reason} />)).not.toThrow();
    expect(screen.getByTestId("missing-value")).toHaveTextContent("Unknown");
  });

  it("rejects inherited object keys so toString cannot render as a React child", () => {
    const reason = "toString" as unknown as MissingValueReason;
    expect(() => render(<MissingValue reason={reason} />)).not.toThrow();
    expect(screen.getByTestId("missing-value")).toHaveTextContent("Unknown");
  });
});

describe("DateDisplay", () => {
  it("renders a <time> element carrying the machine value", () => {
    render(<DateDisplay value="2026-03-14" kind="review" />);
    const time = screen.getByText("14/03/2026");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", "2026-03-14");
  });

  it("agrees with formatClinicalDate so provenance strings and elements cannot drift", () => {
    render(<DateDisplay value="2026-03-14" kind="review" />);
    expect(screen.getByText(formatClinicalDate("2026-03-14"))).toBeInTheDocument();
  });

  it("never renders a relative companion for a review date", () => {
    render(<DateDisplay value="2020-01-01" kind="review" relative />);
    expect(screen.queryByTestId("date-display-relative")).not.toBeInTheDocument();
  });

  it("renders an explicit phrase for an absent value", () => {
    render(<DateDisplay value={null} kind="review" missingReason="not_recorded" />);
    expect(screen.getByTestId("missing-value")).toHaveTextContent("Not recorded");
  });

  it("degrades an unparseable value to Unknown without throwing", () => {
    expect(() => render(<DateDisplay value="not-a-date" kind="event" />)).not.toThrow();
    expect(screen.getByTestId("missing-value")).toHaveTextContent("Unknown");
  });

  it("never invents a time for a date-only generation stamp", () => {
    // "2026-03-14" carries no time. Printing "14/03/2026, 08:00" on a provenance
    // strip states a precision that was never recorded.
    render(<DateDisplay value="2026-03-14" kind="generated" />);
    const node = screen.getByTestId("date-display");
    expect(node).toHaveTextContent("14/03/2026");
    expect(node.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it("keeps the time on a generation stamp that actually carries one", () => {
    render(<DateDisplay value="2026-03-14T02:00:00.000Z" kind="generated" />);
    expect(screen.getByTestId("date-display").textContent).toMatch(/\d{2}:\d{2}/);
  });

  it("rejects impossible calendar dates that JavaScript would silently roll forward", () => {
    // new Date("2026-02-30") becomes 2 March; provenance must say Unknown instead.
    render(<DateDisplay value="2026-02-30" kind="review" />);
    expect(screen.getByTestId("missing-value")).toHaveTextContent("Unknown");
  });

  it("accepts a real leap-day calendar date", () => {
    render(<DateDisplay value="2024-02-29" kind="review" />);
    expect(screen.getByTestId("date-display")).toHaveTextContent("29/02/2024");
    expect(screen.queryByTestId("missing-value")).not.toBeInTheDocument();
  });
});

describe("VerificationNotice", () => {
  it("carries the verification disclaimer even when the answer is ready", () => {
    render(<VerificationNotice state="ready" />);
    // "ready" is not "verified" — the disclaimer is unconditional.
    expect(screen.getByTestId("verification-notice")).toHaveTextContent(/verify/i);
  });

  it("defaults to the complete wording without rendering a compact substitute", () => {
    render(<VerificationNotice state="ready" />);

    expect(screen.getByTestId("verification-notice-full")).toHaveTextContent(
      "AI-generated from the cited sources. Verify every clinical claim against the linked source before acting on it.",
    );
    expect(screen.queryByTestId("verification-notice-compact")).not.toBeInTheDocument();
  });

  it("keeps a fixed compact clinical instruction visible on phones while retaining the full wording", () => {
    render(<VerificationNotice state="partial_retrieval" presentation="responsive-compact" />);

    const compact = screen.getByTestId("verification-notice-compact");
    const full = screen.getByTestId("verification-notice-full");
    expect(compact).toHaveTextContent(
      "AI-generated from incomplete sources and may omit guidance. Verify against cited sources before acting.",
    );
    expect(compact.className).toContain("sm:hidden");
    expect(compact.className).toContain("print:hidden");
    expect(full).toHaveTextContent(/Some sources for this question were unavailable/i);
    expect(full.className).toContain("hidden");
    expect(full.className).toContain("sm:block");
    expect(full.className).toContain("print:block");
  });

  it("holds the compact instruction at every width in inline presentation, and still prints the full wording", () => {
    render(<VerificationNotice state="source_only" attribution="extractive" presentation="inline" />);

    const compact = screen.getByTestId("verification-notice-compact");
    const full = screen.getByTestId("verification-notice-full");
    expect(compact).toHaveTextContent(
      "Copied from cited sources without model synthesis. Verify against the cited sources before acting.",
    );
    // No `sm:hidden`: unlike responsive-compact, the quiet line is what a desktop
    // reader gets too. Print is the one medium that still receives the full block.
    expect(compact.className).not.toContain("sm:hidden");
    expect(compact.className).toContain("print:hidden");
    expect(full.className).toContain("hidden");
    expect(full.className).toContain("print:block");
    expect(full).toHaveTextContent(/without model synthesis/i);
  });

  it("keeps the warning mark on a caution state even when the notice is quietened", () => {
    const { container, unmount } = render(<VerificationNotice state="ungrounded" presentation="inline" />);
    // A caution must stay distinguishable from a routine notice. Quieting the
    // presentation may not flatten the two into the same grey line.
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByTestId("verification-notice").className).toContain("--warning");
    unmount();

    render(<VerificationNotice state="ready" presentation="inline" />);
    expect(screen.getByTestId("verification-notice").className).not.toContain("--warning");
  });

  it("preserves attribution and every state-specific instruction in responsive compact wording", () => {
    const cases = [
      ["ready", "model", /AI-generated.*Verify every clinical claim against the cited sources before acting/i],
      ["stale_evidence", "model", /some cited sources are overdue.*Re-verify every clinical claim/i],
      ["partial_retrieval", "model", /incomplete sources and may omit guidance.*Verify against cited sources/i],
      [
        "ungrounded",
        "model",
        /Sources could not be shown to support every claim.*Check each dose, number, timing and threshold before acting/i,
      ],
      [
        "source_only",
        "extractive",
        /Copied from cited sources without model synthesis.*Verify against the cited sources/i,
      ],
      ["stale_evidence", "extractive", /Copied from cited sources; some are overdue.*Re-verify every clinical claim/i],
      [
        "partial_retrieval",
        "extractive",
        /Copied from incomplete sources and may omit guidance.*Verify against cited sources/i,
      ],
      [
        "ungrounded",
        "extractive",
        /Sources could not be shown to support every claim.*Check each dose, number, timing and threshold before acting/i,
      ],
    ] as const;

    for (const [state, attribution, expected] of cases) {
      const { unmount } = render(
        <VerificationNotice state={state} attribution={attribution} presentation="responsive-compact" />,
      );
      expect(screen.getByTestId("verification-notice-compact"), `${state}:${attribution}`).toHaveTextContent(expected);
      unmount();
    }
  });

  it("uses the complete wording for print even when responsive compact was requested", () => {
    render(<VerificationNotice state="ready" medium="print" presentation="responsive-compact" />);

    expect(screen.queryByTestId("verification-notice-compact")).not.toBeInTheDocument();
    expect(screen.getByTestId("verification-notice-full")).toHaveTextContent(/against the linked source/i);
  });

  it("uses a different approved wording for each state", () => {
    const wording = new Set<string>();
    for (const state of ["ready", "stale_evidence", "partial_retrieval", "ungrounded", "source_only"] as const) {
      const { unmount } = render(<VerificationNotice state={state} />);
      wording.add(screen.getByTestId("verification-notice").textContent ?? "");
      unmount();
    }
    expect(wording.size).toBe(5);
  });

  it("wears the caution role for an ungrounded answer, matching the live Review source match", () => {
    // #207. The product paints this caution amber today; adoption must not
    // demote it to the neutral informational role.
    render(<VerificationNotice state="ungrounded" />);
    const notice = screen.getByTestId("verification-notice");
    expect(notice.className).toContain("var(--warning)");
    expect(notice.className).not.toContain("var(--danger)");
  });

  it("tells an ungrounded answer's reader to confirm the numbers in the passages", () => {
    render(<VerificationNotice state="ungrounded" />);
    const notice = screen.getByTestId("verification-notice");
    expect(notice).toHaveTextContent(/could not be shown to support/i);
    expect(notice).toHaveTextContent(/dose/i);
    // Never an accusation the checks cannot support: unsupported is not refuted.
    expect(notice).not.toHaveTextContent(/incorrect|wrong|false/i);
  });

  it("never claims a model wrote an extractive answer, in any state that outranks source_only", () => {
    // #228. #207 precedence puts stale_evidence, partial_retrieval and
    // ungrounded above source_only, so an extractive answer reports one of those
    // kinds. Keying the provenance clause on the kind announced "AI-generated"
    // directly above the Source-only disclosure saying no model wrote it — two
    // contradictory claims about the one fact that decides how the answer is
    // weighed.
    for (const state of ["stale_evidence", "partial_retrieval", "ungrounded"] as const) {
      const { unmount } = render(<VerificationNotice state={state} attribution="extractive" />);
      const notice = screen.getByTestId("verification-notice");
      expect(notice, `${state} must not claim model authorship`).not.toHaveTextContent(/AI-generated/i);
      expect(notice).toHaveTextContent(/without model synthesis/i);
      // The state's own instruction survives; only the provenance clause moves.
      expect(notice).toHaveTextContent(/verify|confirm|re-verify/i);
      unmount();
    }
  });

  it("keeps the model attribution by default so an un-widened caller is unchanged", () => {
    render(<VerificationNotice state="ungrounded" />);
    expect(screen.getByTestId("verification-notice")).toHaveTextContent(/AI-generated/i);
  });

  it("wears the caution role for stale evidence and never the danger role", () => {
    render(<VerificationNotice state="stale_evidence" />);
    const notice = screen.getByTestId("verification-notice");
    expect(notice.className).toContain("var(--warning)");
    expect(notice.className).not.toContain("var(--danger)");
  });

  it("offers a lay-reader variant with different words from the clinician one", () => {
    const { unmount } = render(<VerificationNotice state="stale_evidence" audience="clinician" />);
    const clinician = screen.getByTestId("verification-notice").textContent;
    unmount();

    render(<VerificationNotice state="stale_evidence" audience="plain" />);
    expect(screen.getByTestId("verification-notice").textContent).not.toBe(clinician);
  });

  it("never names a model or a vendor in any approved wording", () => {
    for (const audience of ["clinician", "plain"] as const) {
      for (const state of ["ready", "stale_evidence", "partial_retrieval", "ungrounded", "source_only"] as const) {
        const { unmount } = render(<VerificationNotice state={state} audience={audience} />);
        const text = screen.getByTestId("verification-notice").textContent ?? "";
        expect(text).not.toMatch(/openai|gpt|claude|gemini|\d+%/i);
        unmount();
      }
    }
  });

  it("stamps the print variant with who printed it and when", () => {
    render(<VerificationNotice state="ready" medium="print" printedAt="2026-03-14T02:00:00.000Z" printedBy="Dr Sim" />);
    expect(screen.getByTestId("verification-notice-print-stamp")).toHaveTextContent("Dr Sim");
  });

  it("is not a live region — the announcement is LiveAnnouncer's job", () => {
    render(<VerificationNotice state="stale_evidence" />);
    expect(screen.getByTestId("verification-notice")).not.toHaveAttribute("aria-live");
  });

  it("does not claim every cited source is overdue in the stale wording", () => {
    // The banner one line below reports the exact fraction; this line must not
    // contradict it by asserting totality.
    render(<VerificationNotice state="stale_evidence" />);
    expect(screen.getByTestId("verification-notice")).toHaveTextContent(/some of which are past their review date/i);
  });

  it("falls back to the most cautionary wording for an unrecognised state, never to ready", () => {
    // Failing open to the neutral variant on a verification notice would weaken
    // the one disclaimer a clinician reads before acting.
    const state = "provenance_unavailable" as unknown as "ready";
    render(<VerificationNotice state={state} presentation="responsive-compact" />);
    const notice = screen.getByTestId("verification-notice");
    expect(notice).toHaveTextContent(/could not be established/i);
    expect(notice).toHaveTextContent(/unverified/i);
    expect(screen.getByTestId("verification-notice-compact")).toHaveTextContent(
      /check every clinical claim against the cited sources before acting/i,
    );
    expect(notice.className).toContain("var(--warning)");
  });

  it("bounds unknown-state diagnostic records and re-logs evicted keys", () => {
    resetRecordedUnknownVerificationNoticeStatesForTests();
    const initialKeys = Array.from({ length: 32 }, (_, index) => `unknown:${index}`);

    for (const key of initialKeys) {
      expect(recordUnknownVerificationNoticeStateForTests(key)).toBe(true);
    }
    expect(recordUnknownVerificationNoticeStateForTests(initialKeys[0])).toBe(false);
    expect(recordedUnknownVerificationNoticeStateKeysForTests()).toEqual(initialKeys);

    expect(recordUnknownVerificationNoticeStateForTests("unknown:32")).toBe(true);
    expect(recordedUnknownVerificationNoticeStateKeysForTests()).toHaveLength(32);
    expect(recordedUnknownVerificationNoticeStateKeysForTests()).toEqual([...initialKeys.slice(1), "unknown:32"]);

    expect(recordUnknownVerificationNoticeStateForTests(initialKeys[0])).toBe(true);
    expect(recordedUnknownVerificationNoticeStateKeysForTests()).toHaveLength(32);
    expect(recordedUnknownVerificationNoticeStateKeysForTests()).toEqual([
      ...initialKeys.slice(2),
      "unknown:32",
      initialKeys[0],
    ]);
    resetRecordedUnknownVerificationNoticeStatesForTests();
  });
});

describe("RetrievalStateBanner", () => {
  it("collapses overdue source details into a compact review-due tab", async () => {
    render(<RetrievalStateBanner state={{ kind: "stale_evidence", overdue, sourceCount: 5 }} onOpenSource={vi.fn()} />);
    const toggle = screen.getByTestId("retrieval-state-stale-toggle");
    expect(toggle).toHaveTextContent(/Review due\s*· 2 sources/);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(panel).toHaveAttribute("hidden");
    expect(screen.queryAllByTestId("retrieval-state-overdue-row")).toHaveLength(2);

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("hidden");
    expect(screen.getByText("2 of 5 sources for this answer are past their review date.")).toBeVisible();
    expect(screen.getAllByTestId("retrieval-state-overdue-row")).toHaveLength(2);
  });

  it("states totality when every cited source is overdue", async () => {
    render(<RetrievalStateBanner state={{ kind: "stale_evidence", overdue, sourceCount: 2 }} onOpenSource={vi.fn()} />);
    await userEvent.click(screen.getByTestId("retrieval-state-stale-toggle"));
    expect(screen.getByText("Every source for this answer is past its review date.")).toBeVisible();
  });

  it("states totality rather than 'N of 0' when sourceCount underflows the overdue list", async () => {
    render(<RetrievalStateBanner state={{ kind: "stale_evidence", overdue, sourceCount: 0 }} onOpenSource={vi.fn()} />);
    await userEvent.click(screen.getByTestId("retrieval-state-stale-toggle"));
    expect(screen.getByText(/Every source for this answer/)).toBeVisible();
    expect(screen.getByTestId("retrieval-state-banner")).not.toHaveTextContent("of 0");
  });

  it("gives every overdue source a one-click route back to the cited page", async () => {
    const onOpenSource = vi.fn();
    render(
      <RetrievalStateBanner state={{ kind: "stale_evidence", overdue, sourceCount: 2 }} onOpenSource={onOpenSource} />,
    );

    await userEvent.click(screen.getByTestId("retrieval-state-stale-toggle"));
    await userEvent.click(screen.getByRole("button", { name: "Open WA Clozapine Protocol, p. 12" }));
    expect(onOpenSource).toHaveBeenCalledWith("doc-1", "p. 12");
  });

  it("says an overdue source has no recorded review date rather than hiding the row", async () => {
    render(<RetrievalStateBanner state={{ kind: "stale_evidence", overdue, sourceCount: 2 }} onOpenSource={vi.fn()} />);

    await userEvent.click(screen.getByTestId("retrieval-state-stale-toggle"));
    const rows = screen.getAllByTestId("retrieval-state-overdue-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[1] as HTMLElement).getByTestId("missing-value")).toHaveTextContent("Not recorded");
  });

  it("explains why a source-only answer is still safe to read", () => {
    render(<RetrievalStateBanner state={{ kind: "source_only", reason: "quality_gate" }} onOpenSource={vi.fn()} />);
    const banner = screen.getByTestId("retrieval-state-banner");
    expect(banner).toHaveTextContent(/drawn directly from the cited sources rather than summarised by a model/i);
    // The tier is inferred from the routing mode and the extractive builder
    // composes sections, so verbatim fidelity is not a claim this surface can make.
    expect(banner.textContent).not.toMatch(/nothing has been paraphrased/i);
  });

  it("distinguishes a superseded source from one merely due for review", async () => {
    render(
      <RetrievalStateBanner
        state={{
          kind: "stale_evidence",
          sourceCount: 4,
          overdue: [
            { sourceId: "doc-1", title: "Withdrawn Protocol", reviewDueOn: "2024-01-01", status: "outdated" },
            { sourceId: "doc-2", title: "RANZCP Guideline", reviewDueOn: "2025-11-01", status: "review_due" },
          ],
        }}
        onOpenSource={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId("retrieval-state-stale-toggle");
    // Collapsed, the chip is the only text on screen, so it must not soften the superseded one.
    expect(toggle).toHaveTextContent(/Superseded \/ review due\s*· 2 sources/);
    await userEvent.click(toggle);
    expect(screen.getByText(/including 1 that has been superseded/)).toBeVisible();
    const rows = screen.getAllByTestId("retrieval-state-overdue-row");
    expect(rows[0]).toHaveAttribute("data-status", "outdated");
    expect(rows[0]).toHaveTextContent(/superseded/i);
    // Shape, not colour: the slashed ring differs from the half ring.
    expect(within(rows[0] as HTMLElement).getByTestId("status-mark")).toHaveAttribute("data-status", "outdated");
    expect(within(rows[1] as HTMLElement).getByTestId("status-mark")).toHaveAttribute("data-status", "review_due");
  });

  it("says Superseded, not Review due, on the collapsed chip when every overdue source was replaced", () => {
    render(
      <RetrievalStateBanner
        state={{
          kind: "stale_evidence",
          sourceCount: 1,
          overdue: [{ sourceId: "doc-1", title: "Withdrawn Protocol", reviewDueOn: "2024-01-01", status: "outdated" }],
        }}
        onOpenSource={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId("retrieval-state-stale-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent(/Superseded\s*· 1 source/);
    expect(toggle).not.toHaveTextContent(/review due/i);
  });

  it("refuses a stale state that names no overdue source", () => {
    // "0 of 3 sources are past their review date" is a caution arguing against
    // itself. This state has a producer, so an empty list is a defect there.
    expect(() =>
      render(
        <RetrievalStateBanner state={{ kind: "stale_evidence", sourceCount: 3, overdue: [] }} onOpenSource={vi.fn()} />,
      ),
    ).toThrow(/stale_evidence requires a non-empty/i);
  });

  it("distinguishes a failed generation from a failed quality check", () => {
    const { unmount } = render(
      <RetrievalStateBanner state={{ kind: "source_only", reason: "generation_failed" }} onOpenSource={vi.fn()} />,
    );
    const failed = screen.getByTestId("retrieval-state-headline").textContent;
    unmount();

    render(<RetrievalStateBanner state={{ kind: "source_only", reason: "quality_gate" }} onOpenSource={vi.fn()} />);
    expect(screen.getByTestId("retrieval-state-headline").textContent).not.toBe(failed);
  });

  it("refuses a partial state that names no missing source", () => {
    // An unnamed gap is a data defect upstream, and inventing "0 sources
    // unavailable" copy would mask it.
    expect(() =>
      render(
        <RetrievalStateBanner
          state={{ kind: "partial_retrieval", retrieved: 3, requested: 5, missing: [] }}
          onOpenSource={vi.fn()}
        />,
      ),
    ).toThrow(/partial_retrieval requires a non-empty/i);
  });

  it("lists missing sources as unavailable rows rather than omitting them", () => {
    render(
      <RetrievalStateBanner
        state={{
          kind: "partial_retrieval",
          retrieved: 3,
          requested: 5,
          missing: [
            { sourceId: "doc-9", title: "Perth Health Formulary" },
            { sourceId: "doc-10", title: "Lithium Monitoring Standard", locator: "p. 3" },
          ],
        }}
        onOpenSource={vi.fn()}
      />,
    );

    expect(screen.getByTestId("retrieval-state-headline")).toHaveTextContent("2 of 5 sources unavailable.");
    expect(screen.getAllByTestId("retrieval-state-missing-row")).toHaveLength(2);
  });

  it("names the signal that made an answer ungrounded, one reason at a time", () => {
    // #207. Four distinct headlines, so the banner says which check fired rather
    // than emitting one vague caution for every ungrounded cause.
    const headlines = new Set<string>();
    for (const reason of ["grounded_false", "confidence_unsupported", "unverified_numeric", "weak_evidence"] as const) {
      const { unmount } = render(
        <RetrievalStateBanner state={{ kind: "ungrounded", reason, sourceCount: 3 }} onOpenSource={vi.fn()} />,
      );
      headlines.add(screen.getByTestId("retrieval-state-headline").textContent ?? "");
      unmount();
    }
    expect(headlines.size).toBe(4);
  });

  it("gives an ungrounded answer the caution treatment and the read-the-passages instruction", () => {
    render(
      <RetrievalStateBanner
        state={{ kind: "ungrounded", reason: "unverified_numeric", sourceCount: 2 }}
        onOpenSource={vi.fn()}
      />,
    );

    const banner = screen.getByTestId("retrieval-state-banner");
    expect(banner).toHaveAttribute("data-state", "ungrounded");
    expect(banner).toHaveAccessibleName("Source match status");
    expect(banner).toHaveTextContent(/were not found in the cited sources/i);
    expect(banner).toHaveTextContent(/read the cited passages/i);
    // Source-currency amber, never danger red — this is not clinical hazard.
    expect(banner.className).toContain("warning");
    expect(banner.className).not.toContain("danger");
  });

  it("is a labelled group, not a landmark, and not a live region", () => {
    render(<RetrievalStateBanner state={{ kind: "source_only", reason: "quality_gate" }} onOpenSource={vi.fn()} />);
    const banner = screen.getByTestId("retrieval-state-banner");
    expect(banner).toHaveAttribute("role", "group");
    expect(banner).toHaveAccessibleName("How this answer was produced");
    expect(banner).not.toHaveAttribute("aria-live");
  });
});

describe("AnswerCard", () => {
  it("renders the system verification wording above the prose", () => {
    render(
      <AnswerCard state={readyState} verification={{ state: "ready", sourceCount: 4 }} support="strong">
        <p>Titrate slowly.</p>
      </AnswerCard>,
    );

    const card = screen.getByTestId("answer-card");
    expect(within(card).getByTestId("verification-notice")).toBeInTheDocument();
    expect(card).toHaveAttribute("data-state", "ready");
  });

  it("shows no retrieval banner for a ready answer", () => {
    render(
      <AnswerCard state={readyState} verification={{ state: "ready" }} support="strong">
        <p>Titrate slowly.</p>
      </AnswerCard>,
    );
    expect(screen.queryByTestId("retrieval-state-banner")).not.toBeInTheDocument();
  });

  it("renders an ungrounded answer as structurally degraded, never as a plain ready card", () => {
    // #207: the adoption failure this guards is a silent one — the card renders,
    // the prose is fine, and the caution the product shows today is simply gone.
    //
    // Narrowed 3 Aug 2026 (#227 over #207). What #207 protects is that the caution
    // survives, not that a *banner* carries it. For `ungrounded` the notice states it
    // in words and the banner only restates it, so the assertion now pins the two
    // channels that genuinely carry the state and pins the duplicate OUT — a banner
    // reappearing here is the #227 regression, measured at 147px of phone scroll
    // against a budget of 8.
    render(
      <AnswerCard
        support="strong"
        state={{ kind: "ungrounded", reason: "grounded_false", sourceCount: 2 }}
        verification={{ state: "ungrounded", sourceCount: 2 }}
        onOpenSource={vi.fn()}
      >
        <p>Titrate slowly.</p>
      </AnswerCard>,
    );

    const card = screen.getByTestId("answer-card");
    expect(card).toHaveAttribute("data-state", "ungrounded");
    expect(within(card).getByTestId("verification-notice")).toHaveAttribute("data-state", "ungrounded");
    expect(within(card).queryByTestId("retrieval-state-banner")).not.toBeInTheDocument();
  });

  it("keeps the banner for the two kinds that say something the notice cannot", () => {
    // `stale_evidence` names WHICH sources are overdue; `partial_retrieval` names HOW
    // MUCH was missed. Neither is derivable from the notice wording, so these two are
    // exactly where the duplicate is not a duplicate (#227).
    const { unmount } = render(
      <AnswerCard
        support="strong"
        state={{
          kind: "stale_evidence",
          sourceCount: 1,
          overdue: [
            {
              sourceId: "doc-1",
              title: "WA Clozapine Protocol",
              locator: "p. 12",
              reviewDueOn: "2025-11-01",
              status: "review_due",
            },
          ],
        }}
        verification={{ state: "stale_evidence" }}
        onOpenSource={vi.fn()}
      >
        <p>Titrate slowly.</p>
      </AnswerCard>,
    );
    expect(screen.getByTestId("retrieval-state-banner")).toHaveAttribute("data-state", "stale_evidence");
    unmount();

    render(
      <AnswerCard
        support="strong"
        state={{
          kind: "partial_retrieval",
          retrieved: 2,
          requested: 3,
          missing: [{ sourceId: "doc-9", title: "Missing guideline" }],
        }}
        verification={{ state: "partial_retrieval", sourceCount: 3 }}
        onOpenSource={vi.fn()}
      >
        <p>Titrate slowly.</p>
      </AnswerCard>,
    );
    expect(screen.getByTestId("retrieval-state-banner")).toHaveAttribute("data-state", "partial_retrieval");
  });

  it("still carries the caution for source_only without a second rendering of it", () => {
    render(
      <AnswerCard
        support="strong"
        state={{ kind: "source_only", reason: "quality_gate" }}
        verification={{ state: "source_only" }}
        onOpenSource={vi.fn()}
      >
        <p>Titrate slowly.</p>
      </AnswerCard>,
    );
    const card = screen.getByTestId("answer-card");
    expect(card).toHaveAttribute("data-state", "source_only");
    expect(within(card).getByTestId("verification-notice")).toHaveAttribute("data-state", "source_only");
    expect(within(card).queryByTestId("retrieval-state-banner")).not.toBeInTheDocument();
  });

  it("raises the banner for a degraded answer and wires its re-verification route", async () => {
    const onOpenSource = vi.fn();
    render(
      <AnswerCard
        support="strong"
        state={{
          kind: "stale_evidence",
          sourceCount: 1,
          overdue: [
            {
              sourceId: "doc-1",
              title: "WA Clozapine Protocol",
              locator: "p. 12",
              reviewDueOn: "2025-11-01",
              status: "review_due",
            },
          ],
        }}
        verification={{ state: "stale_evidence" }}
        onOpenSource={onOpenSource}
      >
        <p>Titrate slowly.</p>
      </AnswerCard>,
    );

    await userEvent.click(screen.getByTestId("retrieval-state-stale-toggle"));
    await userEvent.click(screen.getByRole("button", { name: "Open WA Clozapine Protocol, p. 12" }));
    expect(onOpenSource).toHaveBeenCalledWith("doc-1", "p. 12");
  });

  it("allows the live content owner to relocate stale status without duplicating it", () => {
    render(
      <AnswerCard
        support="strong"
        state={{
          kind: "stale_evidence",
          sourceCount: 1,
          overdue: [
            {
              sourceId: "doc-1",
              title: "WA Clozapine Protocol",
              reviewDueOn: "2025-11-01",
              status: "review_due",
            },
          ],
        }}
        verification={{ state: "stale_evidence" }}
        retrievalStatePlacement="content"
        onOpenSource={vi.fn()}
      >
        <p>Titrate slowly.</p>
      </AnswerCard>,
    );

    expect(screen.queryByTestId("retrieval-state-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("verification-notice")).toHaveAttribute("data-state", "stale_evidence");
  });

  it("wires every declared action", async () => {
    const onActivate = vi.fn();
    render(
      <AnswerCard
        support="strong"
        state={readyState}
        verification={{ state: "ready" }}
        actions={[{ id: "copy", label: "Copy answer", onActivate }]}
      >
        <p>Titrate slowly.</p>
      </AnswerCard>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  // A "medium"-trust answer covers the case where a HIGH-RISK claim rests on
  // evidence whose authority was never reviewed. It reaches the card as
  // `{ kind: "ready" }` - the same state as a fully verified answer - because
  // `weakEvidence` only covers "unsupported" and "low". The support label is the
  // one thing that separates them, so it must always render and must differ.
  it("always states support strength, and distinguishes supported from strong", () => {
    const { unmount } = render(
      <AnswerCard state={readyState} verification={{ state: "ready" }} support="strong">
        <p>Titrate slowly.</p>
      </AnswerCard>,
    );
    const strong = screen.getByTestId("answer-card-support");
    expect(strong).toHaveTextContent("Strong support");
    unmount();

    render(
      <AnswerCard state={readyState} verification={{ state: "ready" }} support="supported">
        <p>Titrate slowly.</p>
      </AnswerCard>,
    );
    const supported = screen.getByTestId("answer-card-support");
    expect(supported).toHaveTextContent("Supported");
    expect(supported.textContent).not.toBe(strong.textContent);
    // Not colour-alone: the distinction survives greyscale and forced-colors.
    expect(supported).toHaveAttribute("data-support", "supported");
  });
});

describe("answerClipboardText", () => {
  it("carries the degraded caveat out of the app with the copied text", () => {
    const text = answerClipboardText({
      body: "Start at 12.5 mg.",
      state: { kind: "stale_evidence", sourceCount: 3, overdue },
    });

    expect(text).toContain("Start at 12.5 mg.");
    expect(text).toContain("2 of 3 cited sources are past their review date");
  });

  it("never states that zero sources are stale on an answer flagged stale", () => {
    const text = answerClipboardText({
      body: "Start at 12.5 mg.",
      state: { kind: "stale_evidence", sourceCount: 3, overdue: [] },
    });

    expect(text).not.toContain("0 of 3");
    expect(text).toContain("some cited sources are past their review date");
  });

  it("attributes and instructs verification even on a ready answer", () => {
    // A copied answer loses the banner, the notice and the links. Clinical prose
    // with nothing attached reads in a record as though a clinician endorsed it.
    const text = answerClipboardText({ body: "Start at 12.5 mg.", state: readyState });
    expect(text).toContain("AI-generated from the cited sources.");
    expect(text).toContain("Verify against the linked source documents before clinical use.");
  });

  it("names the source-only answer as unsynthesised rather than AI-generated", () => {
    const text = answerClipboardText({
      body: "Start at 12.5 mg.",
      state: { kind: "source_only", reason: "quality_gate" },
    });
    expect(text).toContain("Assembled directly from the cited sources without model synthesis.");
    expect(text).not.toContain("AI-generated");
  });

  it("carries an ungrounded caveat out of the app, naming the check that fired", () => {
    // #207 medico-legal case: an unsupported answer pasted into a record with no
    // caveat reads as endorsed clinical text, and the banner does not travel.
    const caveats = new Set<string>();
    for (const reason of ["grounded_false", "confidence_unsupported", "unverified_numeric", "weak_evidence"] as const) {
      const text = answerClipboardText({
        body: "Start at 12.5 mg.",
        state: { kind: "ungrounded", reason, sourceCount: 2 },
      });
      expect(text).toContain("Start at 12.5 mg.");
      expect(text).toMatch(/^Caveat: /m);
      expect(text).toMatch(/verify every (clinical claim|number, dose, route, timing and threshold)/i);
      caveats.add(text);
    }
    expect(caveats.size).toBe(4);
  });

  it("enumerates the cited sources with their links", () => {
    const text = answerClipboardText({
      body: "Start at 12.5 mg.",
      state: readyState,
      sources: [{ title: "WA Clozapine Protocol", locator: "p. 12", href: "/documents/doc-1" }],
    });

    expect(text).toContain("Sources for review:");
    expect(text).toContain("- WA Clozapine Protocol, p. 12 — /documents/doc-1");
  });

  it("omits provenance when no metadata was supplied", () => {
    // Synthesising an all-Unknown audit line would assert a governance read
    // that never happened.
    const text = answerClipboardText({ body: "Start at 12.5 mg.", state: readyState });
    expect(text).not.toContain("Designation:");
    expect(text).not.toContain("Review status:");
  });

  it("appends provenance through the single audit-line implementation when metadata is supplied", () => {
    const text = answerClipboardText({
      body: "Start at 12.5 mg.",
      state: readyState,
      metadata: { document_status: "current", review_date: "2026-01-01" },
    });
    // clipboardProvenanceLine() stays the one implementation of the audit line.
    expect(text).toContain("Designation:");
    expect(text).toContain("Review status:");
  });

  it("suppresses the single-document provenance line when it would contradict the caveat", () => {
    // `metadata` describes one document. "1 of 6 cited sources are past their
    // review date" followed by "Review status: Current" reads as a correction.
    const text = answerClipboardText({
      body: "Start at 12.5 mg.",
      state: { kind: "stale_evidence", sourceCount: 6, overdue: [overdue[0] as OverdueSource] },
      metadata: { document_status: "current", review_date: "2026-01-01" },
    });

    expect(text).toContain("1 of 6 cited sources are past their review date");
    expect(text).not.toContain("Review status:");
  });

  it("adds no degraded caveat to a ready answer", () => {
    expect(answerClipboardText({ body: "Start at 12.5 mg.", state: readyState })).not.toContain("Caveat:");
  });
});

describe("DoseLine", () => {
  const rows: DoseRow[] = [
    {
      id: "clozapine",
      drug: "Clozapine",
      qualifier: "Treatment-resistant schizophrenia",
      dose: { value: "12.5", unit: "mg" },
      frequency: "nocte",
      route: "oral",
      maximum: { value: "900", unit: "mg/day" },
      source: { sourceId: "doc-1", title: "WA Clozapine Protocol", locator: "p. 12" },
      status: "review_due",
    },
  ];

  it("marks an overdue row in three channels, not colour alone", () => {
    render(<DoseLine rows={rows} onOpenSource={vi.fn()} />);

    const row = screen.getByTestId("dose-row");
    // 1. the amber inset rule
    expect(row.className).toContain("var(--rule-warning)");
    // 2. the words
    expect(within(row).getByTestId("dose-row-overdue")).toHaveTextContent("Source review overdue");
    // 3. the non-colour shape mark
    expect(within(row).getByTestId("status-mark")).toHaveAttribute("data-status", "review_due");
  });

  it("says superseded, not review overdue, for a withdrawn source", () => {
    // The half ring reads "partway through its life". A superseded guideline is
    // not partway through anything.
    render(
      <DoseLine
        rows={[{ ...(rows[0] as DoseRow), status: "outdated", source: rows[0]!.source! }]}
        onOpenSource={vi.fn()}
      />,
    );

    const row = screen.getByTestId("dose-row");
    expect(row).toHaveAttribute("data-status", "outdated");
    expect(within(row).getByTestId("dose-row-overdue")).toHaveTextContent("Source superseded");
    expect(within(row).getByTestId("status-mark")).toHaveAttribute("data-status", "outdated");
  });

  it("renders a current row without the overdue caution", () => {
    render(<DoseLine rows={[{ ...(rows[0] as DoseRow), status: "current" }]} onOpenSource={vi.fn()} />);
    const row = screen.getByTestId("dose-row");
    expect(row).not.toHaveAttribute("data-overdue");
    expect(within(row).queryByTestId("dose-row-overdue")).not.toBeInTheDocument();
  });

  it("composes Quantity rather than reimplementing dose typography", () => {
    render(<DoseLine rows={rows} onOpenSource={vi.fn()} />);
    expect(screen.getAllByTestId("quantity-value")[0]).toHaveTextContent("12.5");
    expect(screen.getAllByTestId("quantity-unit")[0]).toHaveTextContent("mg");
  });

  it("opens the cited page from the row", async () => {
    const onOpenSource = vi.fn();
    render(<DoseLine rows={rows} onOpenSource={onOpenSource} />);

    await userEvent.click(screen.getByRole("button", { name: "Open WA Clozapine Protocol, p. 12" }));
    expect(onOpenSource).toHaveBeenCalledWith("doc-1", "p. 12");
  });
});

describe("AnswerFooter", () => {
  it("renders review and generation dates from machine values", () => {
    render(
      <AnswerFooter publisher="RANZCP" version="3.1" reviewDate="2026-03-14" generatedAt="2026-03-14T02:00:00.000Z" />,
    );

    const footer = screen.getByTestId("answer-footer");
    expect(within(footer).getAllByTestId("date-display")).toHaveLength(2);
    expect(footer).toHaveTextContent("14/03/2026");
  });

  it("says an absent field is absent instead of dropping it", () => {
    render(<AnswerFooter publisher="RANZCP" />);

    const footer = screen.getByTestId("answer-footer");
    expect(footer).toHaveTextContent("Version");
    expect(within(footer).getAllByTestId("missing-value").length).toBeGreaterThanOrEqual(1);
  });
});
