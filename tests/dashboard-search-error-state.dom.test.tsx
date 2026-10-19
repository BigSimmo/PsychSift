import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardSearchErrorState } from "@/components/clinical-dashboard/dashboard-search-error-state";
import { SEARCH_SESSION_EXPIRED_MESSAGE } from "@/components/clinical-dashboard/search-utils";

const noop = () => undefined;

function renderErrorState(errorKind: "failure" | "session-expired", error: string) {
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
    />,
  );
}

describe("answer error panel", () => {
  it("offers Retry after an ordinary failure", () => {
    renderErrorState("failure", "Answer generation failed.");
    expect(screen.getByText("Answer unavailable")).toBeTruthy();
    expect(screen.getByTestId("answer-error-retry")).toBeTruthy();
  });

  it("asks the reader to sign in again, without Retry, when the session expired (audit F-15)", () => {
    renderErrorState("session-expired", SEARCH_SESSION_EXPIRED_MESSAGE);
    expect(screen.getByText("Sign in again")).toBeTruthy();
    expect(screen.getByText(SEARCH_SESSION_EXPIRED_MESSAGE)).toBeTruthy();
    expect(screen.queryByTestId("answer-error-retry")).toBeNull();
  });
});
