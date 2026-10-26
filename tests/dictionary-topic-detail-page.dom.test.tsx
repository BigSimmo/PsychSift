import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DictionaryTopicDetailPage } from "@/components/dictionary/dictionary-catalogue-pages";

const navigationState = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dictionary/topics/assessment-and-measurement",
  useSearchParams: () => new URLSearchParams(navigationState.search),
}));

describe("DictionaryTopicDetailPage", () => {
  beforeEach(() => {
    navigationState.search = "";
  });

  it("shows no collection review date, because none is recorded", () => {
    render(<DictionaryTopicDetailPage topicSlug="assessment-and-measurement" />);

    expect(screen.getAllByText("Australian terminology").length).toBeGreaterThan(0);
    // A hard-coded "Updated" stamp claimed a currency no data backed.
    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument();
    expect(screen.queryByText(/18 Aug 2026/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("dictionary-topic-detail-empty")).not.toBeInTheDocument();
  });

  it("says so when the topic search matches nothing instead of leaving the list blank", () => {
    navigationState.search = "q=zzzz-no-such-term";
    render(<DictionaryTopicDetailPage topicSlug="assessment-and-measurement" />);

    const empty = screen.getByTestId("dictionary-topic-detail-empty");
    expect(empty).toHaveTextContent("No matching dictionary entries");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });
});
