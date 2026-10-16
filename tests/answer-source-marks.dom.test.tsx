import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/clinical-dashboard/signed-image", () => ({
  SignedImage: ({ caption }: { caption?: string }) => <p>{caption}</p>,
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    authorizationHeader: { Authorization: "Bearer cover-test" },
    session: { user: { id: "cover-test-user" } },
  }),
}));

import { AnswerSourceDrawer } from "@/components/clinical-dashboard/answer-source-drawer";
import { NaturalLanguageAnswer, primaryAnswerDisplayText } from "@/components/clinical-dashboard/answer-content";
import { AnswerSourceMark, AnswerSourceMarkOverflow } from "@/components/clinical-dashboard/answer-source-mark";
import { compactVerificationWordingFor } from "@/components/ui/verification-notice";
import { type AnswerSourceRow } from "@/components/clinical-dashboard/answer-source-rows";
import { normalizeSourceMetadata } from "@/lib/source-metadata";
import type { SupportedClaim } from "@/lib/types";

/**
 * The numbered marks in the answer prose.
 *
 * What is pinned here is not how they look but what they are allowed to claim:
 * a mark restates an attribution the answer pipeline already recorded per
 * sentence, and where no such record exists the prose renders unmarked with the
 * source rail underneath still carrying every document. That degrade is the
 * common case on fallback and source-only answers, so it is tested as a
 * behaviour rather than treated as an edge.
 */

const ANSWER =
  "Check the full blood count weekly for the first eighteen weeks. Record every result in the clinical notes.";

const FIRST_SENTENCE = "Check the full blood count weekly for the first eighteen weeks.";

function row(overrides: Partial<AnswerSourceRow> & { id: string; title: string }): AnswerSourceRow {
  return {
    documentId: `doc-${overrides.id}`,
    pageNumber: 8,
    metadata: normalizeSourceMetadata(null),
    score: 0.9,
    href: `/documents/${overrides.id}?chunk=${overrides.id}`,
    cited: true,
    ...overrides,
  };
}

const ROWS: AnswerSourceRow[] = [
  row({ id: "chunk-a", title: "Clozapine monitoring protocol", sourceStrength: "strong" }),
  row({ id: "chunk-b", title: "Metabolic screening standard", pageNumber: 11, sourceStrength: "limited" }),
];

function claim(overrides: Partial<SupportedClaim> & { claimId: string; text: string }): SupportedClaim {
  return {
    riskClass: "routine",
    supportingChunkIds: ["chunk-a"],
    supportStatus: "direct",
    ...overrides,
  };
}

function renderProse({
  claims,
  openSourceIndex = null,
  onOpenSource = vi.fn(),
}: {
  claims?: SupportedClaim[];
  openSourceIndex?: number | null;
  onOpenSource?: (index: number, support?: "direct" | "partial") => void;
}) {
  return render(
    <NaturalLanguageAnswer
      text={ANSWER}
      query="clozapine monitoring"
      bestSource={null}
      sources={[]}
      sourceLinks={[]}
      railRows={ROWS}
      claims={claims}
      copied={false}
      onCopy={vi.fn()}
      onOpenSource={onOpenSource}
      openSourceIndex={openSourceIndex}
    />,
  );
}

describe("in-prose source marks", () => {
  it("marks a sentence the pipeline recorded as directly supported, and opens that source", async () => {
    const user = userEvent.setup();
    const onOpenSource = vi.fn();
    renderProse({
      claims: [claim({ claimId: "claim-1", text: FIRST_SENTENCE, supportingChunkIds: ["chunk-b"] })],
      onOpenSource,
    });

    const marks = screen.getAllByTestId("answer-source-mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("2");
    await user.click(marks[0]);
    // The chunk the claim named, not the first row and not the row's position in
    // the claim's own citation list.
    expect(onOpenSource).toHaveBeenCalledWith(1, "direct");
  });

  it("renders no marks and still renders the rail when the answer carries no assessed claims", () => {
    // Every fallback and degraded path reaches the surface this way.
    renderProse({ claims: undefined });
    expect(screen.queryAllByTestId("answer-source-mark")).toHaveLength(0);
    expect(screen.getByTestId("answer-source-rail")).toBeInTheDocument();
    expect(screen.getAllByTestId("answer-source-rail-row")).toHaveLength(2);
  });

  it("leaves the displayed prose byte-identical whether or not it carries marks", () => {
    const { unmount } = renderProse({ claims: undefined });
    const plain = screen.getByTestId("plain-answer-prose").textContent;
    unmount();

    renderProse({ claims: [claim({ claimId: "claim-1", text: FIRST_SENTENCE })] });
    const prose = screen.getByTestId("plain-answer-prose");
    // The mark is a button inside the prose, so compare the prose text with the
    // mark's own text removed rather than the whole subtree.
    for (const mark of within(prose).getAllByTestId("answer-source-mark")) mark.remove();
    expect(prose.textContent).toBe(plain);
    expect(prose.textContent).toBe(primaryAnswerDisplayText(ANSWER, { preserveBold: true }));
  });

  it("marks a partially supported sentence differently from a direct one", () => {
    renderProse({
      claims: [claim({ claimId: "claim-1", text: FIRST_SENTENCE, supportStatus: "partial" })],
    });
    const [mark] = screen.getAllByTestId("answer-source-mark");
    expect(mark).toHaveAttribute("data-support", "partial");
    expect(mark).toHaveAccessibleName(/partial support/);
  });

  it("lights the sentence whose source is open, with a cue that survives forced colors", () => {
    renderProse({ claims: [claim({ claimId: "claim-1", text: FIRST_SENTENCE })], openSourceIndex: 0 });
    const claimSpan = screen.getByTestId("answer-claim");
    expect(claimSpan).toHaveAttribute("data-claim-lit", "true");
    // Backgrounds are remapped under forced-colors; the border is painted, so the
    // reader does not lose the sentence they were checking.
    expect(claimSpan.className).toContain("border-l-2");
    expect(screen.getAllByTestId("answer-source-mark")[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("gives the mark and the drawer pager different accessible names", () => {
    // Both controls select "source 2". If they announced identically a screen
    // reader user could not tell the reference from the pager.
    function Harness() {
      const [openIndex, setOpenIndex] = useState<number | null>(0);
      return (
        <>
          <NaturalLanguageAnswer
            text={ANSWER}
            bestSource={null}
            sources={[]}
            sourceLinks={[]}
            railRows={ROWS}
            claims={[claim({ claimId: "claim-1", text: FIRST_SENTENCE, supportingChunkIds: ["chunk-b"] })]}
            copied={false}
            onCopy={vi.fn()}
            onOpenSource={setOpenIndex}
            openSourceIndex={openIndex}
          />
          <AnswerSourceDrawer
            sources={ROWS}
            openIndex={openIndex}
            onOpenIndexChange={setOpenIndex}
            onClose={() => setOpenIndex(null)}
          />
        </>
      );
    }
    render(<Harness />);

    expect(screen.getAllByTestId("answer-source-mark")[0]).toHaveAccessibleName(
      /^Source 2: Metabolic screening standard, page 11 — direct support$/,
    );
    const pager = screen.getByTestId("answer-source-drawer-pager");
    expect(within(pager).getByRole("button", { name: /^Show source 2/ })).toBeInTheDocument();
  });

  it("drawer support sentence matches the mark's claim support, not the row strength", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [openIndex, setOpenIndex] = useState<number | null>(null);
      const [claimIndex, setClaimIndex] = useState<number | null>(null);
      const [claimSupport, setClaimSupport] = useState<"direct" | "partial" | null>(null);
      return (
        <>
          <NaturalLanguageAnswer
            text={ANSWER}
            bestSource={null}
            sources={[]}
            sourceLinks={[]}
            railRows={ROWS}
            claims={[claim({ claimId: "claim-1", text: FIRST_SENTENCE, supportStatus: "partial" })]}
            copied={false}
            onCopy={vi.fn()}
            onOpenSource={(index, support) => {
              setClaimIndex(index);
              setClaimSupport(support ?? null);
              setOpenIndex(index);
            }}
            onOpenRailSource={(index) => {
              setClaimIndex(null);
              setClaimSupport(null);
              setOpenIndex(index);
            }}
            openSourceIndex={openIndex}
          />
          <AnswerSourceDrawer
            sources={ROWS}
            openIndex={openIndex}
            activeSupportIndex={claimIndex}
            activeClaimSupport={claimSupport}
            onOpenIndexChange={(index) => {
              setClaimIndex(null);
              setClaimSupport(null);
              setOpenIndex(index);
            }}
            onClose={() => {
              setOpenIndex(null);
              setClaimIndex(null);
              setClaimSupport(null);
            }}
          />
        </>
      );
    }
    render(<Harness />);

    await user.click(screen.getAllByTestId("answer-source-mark")[0]);
    // ROWS[0] is strong; the claim is partial. The sentence must follow the mark.
    expect(screen.getByTestId("answer-source-drawer-support")).toHaveTextContent("supports part of the claim");
  });

  it("returns focus to the mark, not the rail, when the drawer closes on that claim's source", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [openIndex, setOpenIndex] = useState<number | null>(null);
      const [claimIndex, setClaimIndex] = useState<number | null>(null);
      return (
        <>
          <NaturalLanguageAnswer
            text={ANSWER}
            bestSource={null}
            sources={[]}
            sourceLinks={[]}
            railRows={ROWS}
            claims={[claim({ claimId: "claim-1", text: FIRST_SENTENCE })]}
            copied={false}
            onCopy={vi.fn()}
            onOpenSource={(index) => {
              setClaimIndex(index);
              setOpenIndex(index);
            }}
            onOpenRailSource={(index) => {
              setClaimIndex(null);
              setOpenIndex(index);
            }}
            openSourceIndex={openIndex}
          />
          <AnswerSourceDrawer
            sources={ROWS}
            openIndex={openIndex}
            activeSupportIndex={claimIndex}
            onOpenIndexChange={(index) => {
              setClaimIndex(null);
              setOpenIndex(index);
            }}
            onClose={() => {
              setOpenIndex(null);
              setClaimIndex(null);
            }}
          />
        </>
      );
    }
    render(<Harness />);

    const mark = screen.getAllByTestId("answer-source-mark")[0];
    await user.click(mark);
    expect(screen.getByTestId("answer-source-drawer")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    // The reader was mid-sentence. Landing on the rail would lose the sentence
    // the drawer was covering.
    await vi.waitFor(() => expect(mark).toHaveFocus());
  });

  it("never makes a whole sentence unbreakable when a bold run blocks the trailing-word split", () => {
    // `splitTrailingWord` refuses to cut inside a `**…**` run. The fallback used
    // to nowrap the ENTIRE sentence, which on a phone column is a horizontal
    // overflow bug — a much worse outcome than a mark starting the next line.
    const bolded = "Withhold the dose and escalate to the on-call registrar **immediately today**.";
    render(
      <NaturalLanguageAnswer
        text={bolded}
        bestSource={null}
        sources={[]}
        sourceLinks={[]}
        railRows={ROWS}
        claims={[claim({ claimId: "claim-1", text: bolded })]}
        copied={false}
        onCopy={vi.fn()}
        onOpenSource={vi.fn()}
      />,
    );

    const claimSpan = screen.getByTestId("answer-claim");
    for (const node of claimSpan.querySelectorAll(".whitespace-nowrap")) {
      // Only the mark cluster may be held together.
      expect(node.textContent?.replace(/\s/g, "")).toBe("1");
    }
  });

  it("does not mark a historical turn, whose rail links out instead of opening a drawer", () => {
    render(
      <NaturalLanguageAnswer
        text={ANSWER}
        bestSource={null}
        sources={[]}
        sourceLinks={[]}
        railRows={ROWS}
        claims={[claim({ claimId: "claim-1", text: FIRST_SENTENCE })]}
        copied={false}
        onCopy={vi.fn()}
      />,
    );
    // A prior turn mounts no drawer, so a mark would advertise a panel that never
    // opens.
    expect(screen.queryAllByTestId("answer-source-mark")).toHaveLength(0);
    expect(screen.getAllByTestId("answer-source-rail-row")[0].tagName).toBe("A");
  });

  it("presents a refusal's rows as searched, never as support: no marks, no numbers, no 'cited' (#Z9NS6H)", () => {
    render(
      <NaturalLanguageAnswer
        text={ANSWER}
        query="clozapine monitoring"
        bestSource={null}
        sources={[]}
        sourceLinks={[]}
        railRows={ROWS}
        claims={[claim({ claimId: "claim-1", text: FIRST_SENTENCE })]}
        copied={false}
        onCopy={vi.fn()}
        onOpenSource={vi.fn()}
        isRefusal
      />,
    );
    expect(screen.queryAllByTestId("answer-source-mark")).toHaveLength(0);
    const heading = screen.getByTestId("answer-source-rail-heading");
    expect(heading).toHaveTextContent("Documents searched");
    expect(heading).toHaveTextContent("2 searched");
    expect(heading).not.toHaveTextContent(/cited/i);
    for (const card of screen.getAllByTestId("answer-source-rail-row")) {
      expect(card).toHaveAttribute("data-cited", "false");
    }
  });

  it("splits the inter-mark gap between adjacent source marks and overflow marks so ::before hit targets do not overlap (R03)", () => {
    render(
      <p>
        First sentence.
        <AnswerSourceMark
          index={0}
          label="Source 1: Maudsley Prescribing Guidelines, page 42 — direct support"
          onOpen={vi.fn()}
        />
        <AnswerSourceMarkOverflow count={2} />
      </p>,
    );
    const mark = screen.getByTestId("answer-source-mark");
    const overflow = screen.getByTestId("answer-source-mark-overflow");
    expect(mark.nextElementSibling).toBe(overflow);
    expect(mark).toHaveClass("answer-source-mark");
    expect(overflow).toHaveClass("answer-source-mark-overflow");

    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain(".answer-source-mark + .answer-source-mark-overflow::before");
    expect(css).toContain(".answer-source-mark:has(+ .answer-source-mark-overflow)::before");
  });
});

describe("answer body no longer owns a source-status row", () => {
  it("renders no Source-only disclosure in the answer body", () => {
    // Owner decision, 2026-09-03: the Source-only pill was the fourth warning
    // surface above the first cited passage and the only one built from its own
    // disclosure mechanism. Its governed wording now leads the Answer
    // limitations disclosure in `answer-result-surface.tsx`, which the chip row
    // opens. `NaturalLanguageAnswer` therefore owns no status row at all.
    render(
      <NaturalLanguageAnswer
        text={ANSWER}
        query="clozapine monitoring"
        bestSource={null}
        sources={[]}
        sourceLinks={[]}
        railRows={ROWS}
        copied={false}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("source-only-disclosure")).not.toBeInTheDocument();
    expect(screen.queryByTestId("answer-source-status-row")).not.toBeInTheDocument();
  });

  it("keeps the governed extractive wording verbatim for the limitations disclosure", () => {
    // The strings themselves are the contract, so they stay pinned here even
    // though the element that renders them moved. `answer-result-surface.tsx`
    // calls this exact lookup with "extractive"; it never rewords at the call
    // site. Pinned by `answer-support-priority.dom.test.tsx`.
    expect(compactVerificationWordingFor("ungrounded", "extractive")).toBe(
      "Copied from cited sources without model synthesis. Sources could not be shown to support every claim. Check each dose, number, timing and threshold before acting.",
    );
    expect(compactVerificationWordingFor("source_only", "extractive")).toBe(
      "Copied from cited sources without model synthesis. Verify against the cited sources before acting.",
    );

    // The panel takes whichever state won precedence, not always source_only:
    // #207 lets stale, partial and ungrounded outrank it. Every extractive
    // variant must therefore open with the same attribution and must never
    // claim a model wrote the answer, or the panel would contradict the chip
    // that opened it.
    for (const state of ["ready", "stale_evidence", "partial_retrieval", "ungrounded", "source_only"] as const) {
      const wording = compactVerificationWordingFor(state, "extractive");
      expect(wording).toMatch(/^Copied from/);
      expect(wording).not.toContain("AI-generated");
    }
  });

  it("renders no status row at all when the answer is synthesized", () => {
    render(
      <NaturalLanguageAnswer
        text={ANSWER}
        query="clozapine monitoring"
        bestSource={null}
        sources={[]}
        sourceLinks={[]}
        railRows={ROWS}
        copied={false}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("answer-source-status-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("retrieval-state-stale-toggle")).not.toBeInTheDocument();
  });
});
