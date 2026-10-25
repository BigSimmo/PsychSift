/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ColourCodingReferenceContent } from "@/components/reference/colour-coding-reference-content";
import { SourceMethodReferenceContent } from "@/components/reference/source-method-reference-content";

import { expectWellFormedDefinitionLists } from "./helpers/definition-list-shape";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

describe("reference description lists are well formed (#Q80S8B)", () => {
  it.each(["page", "guide"] as const)("colour coding reference (%s)", (variant) => {
    const { container } = render(
      <ColourCodingReferenceContent variant={variant} onOpenFullReference={() => undefined} />,
    );
    expectWellFormedDefinitionLists(container);
  });

  it.each(["page", "guide"] as const)("source method reference (%s)", (variant) => {
    const { container } = render(<SourceMethodReferenceContent variant={variant} onOpenFullPage={() => undefined} />);
    expectWellFormedDefinitionLists(container);
  });
});

describe("source method status groups are named by their headings", () => {
  it("points every aria-labelledby reference at an element that exists", () => {
    const { container } = render(<SourceMethodReferenceContent variant="page" onOpenFullPage={() => undefined} />);
    const labelled = Array.from(container.querySelectorAll('section[aria-labelledby^="method-status-"]'));
    expect(labelled.length).toBeGreaterThan(0);
    for (const section of labelled) {
      const ids = (section.getAttribute("aria-labelledby") ?? "").split(/\s+/);
      expect(ids).toHaveLength(1);
      expect(container.ownerDocument.getElementById(ids[0])).not.toBeNull();
    }
  });
});
