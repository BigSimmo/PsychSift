/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const announcer = vi.hoisted(() => ({ announce: vi.fn() }));
vi.mock("@/components/ui/live-announcer", () => announcer);
import { ClinicalAskAnswerSurface } from "@/components/clinical-dashboard/clinical-ask-answer-surface";
import {
  ClinicalAskSessionProvider,
  useClinicalAskSession,
} from "@/components/clinical-dashboard/clinical-ask-session-context";
import { ClinicalAskWorkspace } from "@/components/clinical-dashboard/clinical-ask-workspace";

function Harness({
  onDraftChange,
  onRun,
  onReturnToSearch,
}: {
  onDraftChange?(draft: string): void;
  onRun?(question: string): void;
  onReturnToSearch?(): void;
} = {}) {
  const session = useClinicalAskSession();
  return (
    <>
      <button
        onClick={() => {
          session.setDraft("synthetic", "services");
          session.setSuggestions([{ id: "s1", field: "population", value: "adult", status: "suggested" }]);
        }}
      >
        Seed
      </button>
      <button
        onClick={() =>
          session.receiveEvent({
            type: "final",
            payload: {
              feedback: null,
              response: {
                state: "evidence_gap",
                mode: "services",
                explanation: "No supported conclusion.",
                evidence: [],
                missingInformation: [],
                nextActions: [],
              },
            },
          })
        }
      >
        Gap
      </button>
      <button
        onClick={() =>
          session.receiveEvent({
            type: "clarification",
            response: {
              state: "clarification_required",
              mode: "services",
              suggestions: [],
              clarifications: [
                { id: "services:careSetting", field: "careSetting", prompt: "Which care setting?", required: true },
              ],
            },
          })
        }
      >
        Clarify
      </button>
      <button
        onClick={() =>
          session.receiveEvent({
            type: "error",
            code: "provider_unavailable",
            retryable: true,
            message: "Connection required.",
          })
        }
      >
        Fail
      </button>
      <button
        onClick={() =>
          session.receiveEvent({
            type: "final",
            payload: {
              feedback: null,
              response: {
                state: "answered",
                mode: "services",
                lead: { id: "lead", text: "Consider the local pathway.", evidenceIds: ["e1"] },
                sections: [
                  {
                    id: "s",
                    title: "Options",
                    claims: [{ id: "c", text: "Review eligibility.", evidenceIds: ["e1"] }],
                  },
                ],
                conflicts: [{ id: "conflict", text: "Access criteria differ.", evidenceIds: ["e1"] }],
                missingInformation: ["Current location"],
                followUps: ["Check urgency"],
                handoffs: [{ targetMode: "forms", label: "Continue to Forms", acceptedContext: {} }],
                evidence: [
                  {
                    id: "e1",
                    tier: "external",
                    title: "Authority guidance",
                    publisher: "Health authority",
                    jurisdiction: "SG",
                    href: "https://example.test/source",
                    extract: "Synthetic extract",
                    reviewState: "needs_review",
                    publishedAt: null,
                    updatedAt: null,
                    retrievedAt: "2026-08-22T00:00:00.000Z",
                  },
                ],
              },
            },
          })
        }
      >
        Answer
      </button>
      <ClinicalAskWorkspace onDraftChange={onDraftChange} onRun={onRun} onReturnToSearch={onReturnToSearch} />
    </>
  );
}

describe("ClinicalAskWorkspace", () => {
  beforeEach(() => {
    navigation.push.mockReset();
    announcer.announce.mockReset();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("announces each Clinical Ask result through the shared announcer", () => {
    render(
      <ClinicalAskSessionProvider>
        <Harness />
      </ClinicalAskSessionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Seed" }));
    fireEvent.click(screen.getByRole("button", { name: "Gap" }));
    expect(announcer.announce).toHaveBeenLastCalledWith("Clinical Ask found an evidence gap.");
    fireEvent.click(screen.getByRole("button", { name: "Clarify" }));
    expect(announcer.announce).toHaveBeenLastCalledWith("Clinical Ask needs more Case Context.");
    fireEvent.click(screen.getByRole("button", { name: "Fail" }));
    expect(announcer.announce).toHaveBeenLastCalledWith("Clinical Ask could not complete.");
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(announcer.announce).toHaveBeenLastCalledWith("Clinical Ask answer ready.");
  });

  it("releases a feedback choice whose save failed and announces a successful copy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      render(
        <ClinicalAskAnswerSurface
          response={{
            state: "answered",
            mode: "services",
            lead: { id: "lead", text: "Consider the local pathway.", evidenceIds: [] },
            sections: [],
            conflicts: [],
            missingInformation: [],
            followUps: [],
            handoffs: [],
            evidence: [],
          }}
          feedbackMetadata={{ interactionId: "i-1", answerHash: "h-1", feedbackToken: "t-1" }}
        />,
      );
      const helpful = screen.getByRole("button", { name: "Helpful" });
      fireEvent.click(helpful);
      expect(await screen.findByText("Feedback could not be saved.")).toBeInTheDocument();
      expect(helpful).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
      await waitFor(() => expect(announcer.announce).toHaveBeenCalledWith("Answer copied."));
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("reviews suggestions, evidence gaps, and clears memory-only case state", () => {
    render(
      <ClinicalAskSessionProvider>
        <Harness />
      </ClinicalAskSessionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Seed" }));
    expect(screen.getByRole("region", { name: "Clinical Ask workspace" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review Case Context" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    fireEvent.click(screen.getByRole("button", { name: "Gap" }));
    expect(screen.getByRole("heading", { name: "Evidence Gap" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/system prompt|retrieval score|provider request/i);
    fireEvent.click(screen.getByRole("button", { name: "Clear case" }));
    expect(screen.queryByRole("region", { name: "Clinical Ask workspace" })).not.toBeInTheDocument();
  });

  it("focuses editable clarification answers and never renders internal provider fields", async () => {
    const onRun = vi.fn();
    render(
      <ClinicalAskSessionProvider>
        <Harness onRun={onRun} />
      </ClinicalAskSessionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Seed" }));
    fireEvent.click(screen.getByRole("button", { name: "Clarify" }));
    const field = screen.getByRole("textbox", { name: "Which care setting?" });
    const continueButton = screen.getByRole("button", { name: "Continue with confirmed context" });
    await waitFor(() => expect(field).toHaveFocus());
    expect(continueButton).toHaveAttribute("aria-disabled", "true");
    expect(continueButton).not.toBeDisabled();
    fireEvent.change(field, { target: { value: "community" } });
    expect(field).toHaveValue("community");
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);
    expect(onRun).toHaveBeenCalledWith("synthetic");
    expect(document.body.textContent).not.toMatch(/system prompt|provider request|retrieval score/i);
  });

  it("offers explicit retry and clears the case before returning to search", () => {
    const onRun = vi.fn();
    const onReturnToSearch = vi.fn();
    render(
      <ClinicalAskSessionProvider>
        <Harness onRun={onRun} onReturnToSearch={onReturnToSearch} />
      </ClinicalAskSessionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Seed" }));
    fireEvent.click(screen.getByRole("button", { name: "Fail" }));

    fireEvent.click(screen.getByRole("button", { name: "Retry Smart answer" }));
    expect(onRun).toHaveBeenCalledWith("synthetic");
    fireEvent.click(screen.getByRole("button", { name: "Return to search" }));
    expect(onReturnToSearch).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "Clinical Ask workspace" })).not.toBeInTheDocument();
  });

  it("expands evidence, copies without the question by default, and reviews handoffs", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const onDraftChange = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(
      <ClinicalAskSessionProvider>
        <Harness onDraftChange={onDraftChange} />
      </ClinicalAskSessionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Seed" }));
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    fireEvent.click(screen.getByText("Evidence and sources"));
    expect(screen.getByText("Authority guidance")).toBeInTheDocument();
    expect(screen.queryByText("Review extract")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Report an issue"));
    for (const label of [
      "Wrong mode",
      "Missed source",
      "Unsupported conclusion",
      "Important information missing",
      "Source conflict",
      "Outdated source",
      "Presentation problem",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).not.toContain("Question: synthetic");
    expect(writeText.mock.calls[0][0]).toContain("Clinician Confirmation");
    expect(writeText.mock.calls[0][0]).toContain("retrieved 2026-08-22");
    fireEvent.click(screen.getByRole("checkbox", { name: "Include question in copy and print" }));
    fireEvent.click(screen.getByRole("button", { name: /Copied|Copy answer/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1][0]).toContain("Question: synthetic");
    fireEvent.click(screen.getByRole("button", { name: "Check urgency" }));
    expect(onDraftChange).toHaveBeenCalledWith("Check urgency");
    fireEvent.click(screen.getByRole("button", { name: /Copied|Copy answer/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
    expect(writeText.mock.calls[2][0]).toContain("Question: synthetic");
    expect(writeText.mock.calls[2][0]).not.toContain("Question: Check urgency");
    fireEvent.click(screen.getByRole("button", { name: "Continue to Forms" }));
    expect(screen.getByRole("dialog", { name: "Review Clinical Ask handoff" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept handoff" }));
    expect(navigation.push).toHaveBeenCalledWith("/?mode=forms");
  });
});
