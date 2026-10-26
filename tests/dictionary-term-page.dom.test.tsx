import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DictionaryTermPage } from "@/components/dictionary/dictionary-term-page";
import { findDictionaryEntry } from "@/lib/dictionary";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dictionary/auditory-hallucination",
}));

describe("DictionaryTermPage", () => {
  it("renders one canonical heading and one compact source-status summary", () => {
    const entry = findDictionaryEntry("auditory-hallucination");
    expect(entry).not.toBeNull();
    const { container } = render(<DictionaryTermPage entry={entry!} />);

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Auditory hallucination" })).toBeInTheDocument();
    expect(screen.getAllByTestId("dictionary-source-status-summary")).toHaveLength(1);
    expect(screen.getByTestId("dictionary-source-status-summary")).toHaveTextContent("Source linked");
    expect(screen.getByTestId("dictionary-source-status-summary")).toHaveTextContent("covered source");
  });

  it("keeps Meaning expanded and reveals phone disclosure content on demand", () => {
    const entry = findDictionaryEntry("auditory-hallucination")!;
    render(<DictionaryTermPage entry={entry} />);

    expect(screen.getByRole("button", { name: /Meaning/ })).toHaveAttribute("aria-expanded", "true");
    const contextButton = screen.getByRole("button", { name: /Use and context/ });
    expect(contextButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(contextButton);
    expect(contextButton).toHaveAttribute("aria-expanded", "true");
  });

  it("reports every section expanded, and keeps the inert toggles out of the tab order, from sm up", () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query === "(min-width: 40rem)",
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    try {
      const entry = findDictionaryEntry("auditory-hallucination")!;
      render(<DictionaryTermPage entry={entry} />);

      const contextButton = screen.getByRole("button", { name: /Use and context/ });
      expect(contextButton).toHaveAttribute("aria-expanded", "true");
      expect(contextButton).toHaveAttribute("tabindex", "-1");
      fireEvent.click(contextButton);
      expect(contextButton).toHaveAttribute("aria-expanded", "true");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows four real related-entry destinations", () => {
    const entry = findDictionaryEntry("auditory-hallucination")!;
    render(<DictionaryTermPage entry={entry} />);
    const related = screen.getByText("4 other entries from the same collection").closest("section");
    expect(related?.querySelectorAll('a[href^="/dictionary/"]')).toHaveLength(4);
  });
});
