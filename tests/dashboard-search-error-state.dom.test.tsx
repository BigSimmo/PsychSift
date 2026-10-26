import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardSearchErrorState } from "@/components/clinical-dashboard/dashboard-search-error-state";
import { SEARCH_SESSION_EXPIRED_MESSAGE } from "@/components/clinical-dashboard/search-utils";

const noop = () => undefined;

function renderErrorState(
  errorKind: "failure" | "session-expired" | "daily-limit",
  error: string,
  extra: { errorDetail?: string; onSignInAndSend?: () => void } = {},
) {
  render(
    <DashboardSearchErrorState
      error={error}
      errorKind={errorKind}
      activeModeResultKind="answer"
      documentsResultsOwnError={false}
      lastFailedQuery="lithium monitoring"
      query="lithium monitoring"
      onRephrase={noop}
      onRetry={noop}
      onSearchDocuments={noop}
      {...extra}
    />,
  );
}

describe("answer error panel", () => {
  it("offers Retry after an ordinary failure", () => {
    renderErrorState("failure", "Answer generation failed.");
    expect(screen.getByText("Answer unavailable")).toBeTruthy();
    expect(screen.getByTestId("answer-error-retry")).toBeTruthy();
  });

  it("keeps the question and offers Sign in and send, without Retry, when the session expired (F-15, D26-05)", () => {
    const onSignInAndSend = vi.fn();
    renderErrorState("session-expired", SEARCH_SESSION_EXPIRED_MESSAGE, { onSignInAndSend });
    expect(screen.getByText("You were signed out, so this wasn\u2019t sent")).toBeTruthy();
    expect(screen.getByText("Your question is kept. Sign in and it will send straight away.")).toBeTruthy();
    expect(screen.queryByTestId("answer-error-retry")).toBeNull();
    fireEvent.click(screen.getByTestId("answer-error-sign-in-and-send"));
    expect(onSignInAndSend).toHaveBeenCalledTimes(1);
  });

  it("does not offer Retry at the daily answer limit (D26-09)", () => {
    renderErrorState("daily-limit", "You've used today's answers. You can ask again from 7:40 pm.");
    expect(screen.getByText("Today\u2019s answers are used up")).toBeTruthy();
    expect(screen.queryByTestId("answer-error-retry")).toBeNull();
    expect(screen.getByTestId("answer-error-search-documents")).toBeTruthy();
  });

  it("keeps the server's own words behind Show technical detail (D26-08)", () => {
    renderErrorState("failure", "This answer didn\u2019t finish.", { errorDetail: "upstream_timeout: stream closed" });
    expect(screen.getByTestId("answer-error")).toHaveTextContent("This answer didn\u2019t finish.");
    const detail = screen.getByTestId("answer-error-detail");
    expect(detail.tagName).toBe("DETAILS");
    expect(detail).not.toHaveAttribute("open");
    expect(detail).toHaveTextContent("Show technical detail");
    expect(detail).toHaveTextContent("upstream_timeout: stream closed");
  });
});
