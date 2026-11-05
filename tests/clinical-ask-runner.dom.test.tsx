/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const streamClinicalAsk = vi.hoisted(() => vi.fn());
vi.mock("@/lib/clinical-ask/client-stream", () => ({ streamClinicalAsk }));

import {
  ClinicalAskSessionProvider,
  useClinicalAskSession,
} from "@/components/clinical-dashboard/clinical-ask-session-context";
import { useClinicalAskRunner } from "@/components/clinical-dashboard/use-clinical-ask-runner";
import { useClinicalAskDashboardChrome } from "@/components/clinical-dashboard/use-clinical-ask-shell-state";
import type { AppModeId } from "@/lib/app-modes";
import type { ClinicalAskFinalPayload } from "@/lib/clinical-ask/contracts";

type PendingRun = {
  signal: AbortSignal;
  resolve(payload: ClinicalAskFinalPayload): void;
};

function RunnerHarness({ query, online = true }: { query: string; online?: boolean }) {
  const session = useClinicalAskSession();
  const run = useClinicalAskRunner({
    clinicalAskMode: "services",
    clinicalAskOnline: online,
    clinicalAskSession: session,
    query,
  });
  return (
    <>
      <button type="button" onClick={run}>
        Run
      </button>
      <button type="button" onClick={session.cancel}>
        Stop
      </button>
      <button type="button" onClick={session.clear}>
        Clear
      </button>
      <output data-testid="runner-state">
        {JSON.stringify({
          draft: session.draft,
          submittedQuestion: session.submittedQuestion,
          submitted: session.submitted,
          response: session.response,
        })}
      </output>
    </>
  );
}

function ModeResetHarness({ mode }: { mode: AppModeId }) {
  const { clinicalAskMode, clinicalAskSession } = useClinicalAskDashboardChrome({
    accountId: "account-a",
    searchMode: mode,
    query: "Synthetic question",
    clinicalAskAvailableModeIds: ["services", "forms"],
  });
  return (
    <>
      <button
        type="button"
        disabled={!clinicalAskMode}
        onClick={() => clinicalAskMode && clinicalAskSession.setDraft("Synthetic question", clinicalAskMode)}
      >
        Seed mode
      </button>
      <output data-testid="mode-state">{JSON.stringify({ mode: clinicalAskSession.mode })}</output>
    </>
  );
}

describe("useClinicalAskRunner", () => {
  beforeEach(() => {
    streamClinicalAsk.mockReset();
  });

  it.each(["Stop", "Clear", "account change", "unmount"])(
    "skips deferred stream initialization after %s",
    async (action) => {
      const view = render(
        <ClinicalAskSessionProvider accountId="account-a">
          <RunnerHarness query="Synthetic question" />
        </ClinicalAskSessionProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Run" }));
      if (action === "unmount") view.unmount();
      else if (action === "account change")
        view.rerender(
          <ClinicalAskSessionProvider accountId="account-b">
            <RunnerHarness query="Synthetic question" />
          </ClinicalAskSessionProvider>,
        );
      else fireEvent.click(screen.getByRole("button", { name: action }));
      await act(async () => {
        await vi.dynamicImportSettled();
      });
      expect(streamClinicalAsk).not.toHaveBeenCalled();
    },
  );

  it("starts only the latest request when replacement happens before lazy initialization", async () => {
    const realClient = await vi.importActual<typeof import("@/lib/clinical-ask/client-stream")>(
      "@/lib/clinical-ask/client-stream",
    );
    streamClinicalAsk.mockImplementation(realClient.streamClinicalAsk);
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const view = render(
      <ClinicalAskSessionProvider>
        <RunnerHarness query="Question A" />
      </ClinicalAskSessionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    view.rerender(
      <ClinicalAskSessionProvider>
        <RunnerHarness query="Question B" />
      </ClinicalAskSessionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toMatchObject({ question: "Question B" });
  });

  it("keeps run B active when the aborted run A settles", async () => {
    const pending: PendingRun[] = [];
    streamClinicalAsk.mockImplementation(
      (_request: unknown, signal: AbortSignal) =>
        new Promise<ClinicalAskFinalPayload>((resolve) => pending.push({ signal, resolve })),
    );
    const view = render(
      <ClinicalAskSessionProvider>
        <RunnerHarness query="Question A" />
      </ClinicalAskSessionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(pending).toHaveLength(1));
    view.rerender(
      <ClinicalAskSessionProvider>
        <RunnerHarness query="Question B" />
      </ClinicalAskSessionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0]?.signal.aborted).toBe(true);
    expect(pending[1]?.signal.aborted).toBe(false);

    await act(async () => {
      pending[0]?.resolve({
        response: {
          state: "failed",
          mode: "services",
          code: "aborted",
          retryable: false,
          message: "Clinical Ask was cancelled.",
        },
        feedback: null,
      });
      await Promise.resolve();
    });

    expect(pending[1]?.signal.aborted).toBe(false);
    expect(screen.getByTestId("runner-state")).toHaveTextContent('"submitted":true');
    expect(screen.getByTestId("runner-state")).toHaveTextContent('"response":null');

    await act(async () => {
      pending[1]?.resolve({
        response: {
          state: "failed",
          mode: "services",
          code: "provider_unavailable",
          retryable: true,
          message: "Clinical Ask is temporarily unavailable.",
        },
        feedback: null,
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("runner-state")).toHaveTextContent('"submitted":false'));
    expect(screen.getByTestId("runner-state")).toHaveTextContent('"code":"provider_unavailable"');
  });

  it("keeps an offline question in tab memory without calling the stream", () => {
    render(
      <ClinicalAskSessionProvider>
        <RunnerHarness query="Which service is appropriate after discharge?" online={false} />
      </ClinicalAskSessionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(streamClinicalAsk).not.toHaveBeenCalled();
    expect(screen.getByTestId("runner-state")).toHaveTextContent(
      '"submittedQuestion":"Which service is appropriate after discharge?"',
    );
    expect(screen.getByTestId("runner-state")).toHaveTextContent('"code":"provider_unavailable"');
    expect(screen.getByTestId("runner-state")).toHaveTextContent('"retryable":true');
  });

  it("retains mode-unavailable failures instead of falling back to ordinary search", async () => {
    streamClinicalAsk.mockImplementation(async (_request, _signal, onEvent) => {
      onEvent({
        type: "error",
        code: "mode_unavailable",
        retryable: false,
        message: "Smart answers are not available for this mode.",
      });
      return {
        response: {
          state: "failed",
          mode: "services",
          code: "mode_unavailable",
          retryable: false,
          message: "Smart answers are not available for this mode.",
        },
        feedback: null,
      };
    });
    render(
      <ClinicalAskSessionProvider>
        <RunnerHarness query="Which service is appropriate after discharge?" />
      </ClinicalAskSessionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(screen.getByTestId("runner-state")).toHaveTextContent('"mode_unavailable"'));
    expect(screen.getByTestId("runner-state")).toHaveTextContent(
      '"submittedQuestion":"Which service is appropriate after discharge?"',
    );
  });

  it("clears tab-scoped Clinical Ask state when the active mode changes", async () => {
    const view = render(
      <ClinicalAskSessionProvider>
        <ModeResetHarness mode="services" />
      </ClinicalAskSessionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Seed mode" }));
    expect(screen.getByTestId("mode-state")).toHaveTextContent('"mode":"services"');

    view.rerender(
      <ClinicalAskSessionProvider>
        <ModeResetHarness mode="forms" />
      </ClinicalAskSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("mode-state")).toHaveTextContent('"mode":null'));
  });
});
