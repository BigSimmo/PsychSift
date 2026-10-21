import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContentReviewNotice } from "@/components/content-review/content-review-notice";

// The pages that show this notice are prerendered, so the schedule must come from the
// reader's own date, not the build's. The server renders nothing; the browser fills in
// today's state.

afterEach(() => {
  vi.useRealTimers();
});

describe("ContentReviewNotice", () => {
  it("renders nothing on the server, so a prerendered page never carries a build-day state", () => {
    const html = renderToString(<ContentReviewNotice review={{ kind: "medication", lastReviewedAt: "2020-01-01" }} />);
    expect(html).toBe("");
  });

  it("works the state out from the reader's date in the browser", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-04-20T02:00:00.000Z"));
    render(<ContentReviewNotice review={{ kind: "medication", lastReviewedAt: "2026-05-10" }} />);
    const notice = screen.getByTestId("content-review-notice");
    expect(notice.getAttribute("data-review-state")).toBe("due_soon");
    expect(notice.textContent).toBe("Review due by 10 May 2027.");
  });

  it("uses the reader's local date, so a Perth morning is not held back a day by UTC", () => {
    vi.stubEnv("TZ", "Australia/Perth");
    vi.useFakeTimers({ toFake: ["Date"] });
    // 07:30 on 10 May 2027 in Perth is still 9 May in UTC.
    vi.setSystemTime(new Date("2027-05-09T23:30:00.000Z"));
    render(<ContentReviewNotice review={{ kind: "medication", lastReviewedAt: "2026-05-10" }} />);
    expect(screen.getByTestId("content-review-notice").getAttribute("data-review-state")).toBe("due");
    vi.unstubAllEnvs();
  });

  it("says nothing for a current record or a hidden state", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T02:00:00.000Z"));
    const { container, rerender } = render(
      <ContentReviewNotice review={{ kind: "therapy", lastReviewedAt: "2026-09-26" }} />,
    );
    expect(container.innerHTML).toBe("");
    rerender(<ContentReviewNotice review={{ kind: "form", lastReviewedAt: null }} hideStates={["unknown"]} />);
    expect(container.innerHTML).toBe("");
  });
});
