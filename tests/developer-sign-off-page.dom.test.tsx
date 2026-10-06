import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  SIGN_OFF_PAGE_SIZE,
  SignOffQueuePageContent,
} from "@/components/developer-area/hub/sign-off-queue-page-content";
import { loadSignOffQueue } from "@/lib/developer-area/sign-off-queue";

// PanelPageShell's back control is a ContextualBackLink, which calls
// next/navigation's useRouter for its history-aware click handler. Outside an
// app-router tree that throws "invariant expected app router to be mounted",
// so every render here needs the router mocked, same as the sibling hub tests.
vi.mock("next/navigation", () => ({
  usePathname: () => "/mockups/development/clinical-sign-off",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

// Pagination and family selection are real ?family=…&page=N navigation, not
// client state, so the assertions read the href a click would follow. A plain
// <a> avoids requiring an App Router context jsdom cannot provide.
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const queue = loadSignOffQueue();
const first = queue.families[0]!;
const dictionary = queue.families.find((family) => family.id === "dictionary")!;

describe("clinical sign-off queue page", () => {
  it("renders one family's first page, not the whole queue", () => {
    // The failure this pins is the one that made the page 4.66 MB: every row of
    // every family in a single response. The slice is server-side, so the count
    // of rendered rows is the count of transferred rows.
    render(<SignOffQueuePageContent />);

    // Forms are fully signed, so the default family is an empty list rather than
    // a missing section. Other families stay off this response.
    const formsList = screen.getByTestId(`developer-sign-off-rows-${first.id}`);
    expect(within(formsList).queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByTestId(`developer-sign-off-rows-${dictionary.id}`)).toBeNull();
  });

  it("keeps every family's full total on screen while showing one family's rows", () => {
    // Without this, a reader could mistake the open section for the whole queue.
    render(<SignOffQueuePageContent requestedFamily="dictionary" />);

    const summary = screen.getByTestId("developer-sign-off-summary");
    for (const family of queue.families) {
      const link = within(summary).getByRole("link", { name: `${family.rows.length}${family.name}` });
      expect(link).toHaveTextContent(String(family.rows.length));
    }
    expect(screen.getByTestId("developer-sign-off-count-total-value")).toHaveTextContent(String(queue.total));
  });

  it("pages within the selected family and keeps the family in the link", () => {
    render(<SignOffQueuePageContent requestedFamily="dictionary" requestedPage={2} />);

    const rows = within(screen.getByTestId(`developer-sign-off-rows-dictionary`)).getAllByRole("listitem");
    expect(rows).toHaveLength(SIGN_OFF_PAGE_SIZE);
    expect(screen.getAllByLabelText("Previous page")[0]).toHaveAttribute("href", "?family=dictionary");
    expect(screen.getAllByLabelText("Next page")[0]).toHaveAttribute("href", "?family=dictionary&page=3");
    expect(screen.getByTestId("developer-sign-off-pagination-summary")).toHaveTextContent(
      `Showing 51–100 of ${dictionary.rows.length} records`,
    );
  });

  it("clamps a page past the end rather than rendering an empty list", () => {
    render(<SignOffQueuePageContent requestedFamily="formulation" requestedPage={9999} />);

    const rows = within(screen.getByTestId("developer-sign-off-rows-formulation")).getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("falls back to the first family for an unrecognised ?family=", () => {
    // A hand-edited query string should land on the queue, not on an error page
    // that reads as though the records are gone.
    render(<SignOffQueuePageContent requestedFamily="not-a-family" />);

    expect(screen.getByTestId(`developer-sign-off-rows-${first.id}`)).toBeInTheDocument();
  });
});
