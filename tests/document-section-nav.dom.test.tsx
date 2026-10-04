import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DocumentSectionIndexCard,
  DocumentSectionTrack,
  jumpToDocumentSection,
} from "@/components/document-viewer/section-nav";
import { buildDocumentSectionIndex } from "@/components/document-viewer/section-index";
import { useDocumentSectionSpy } from "@/components/document-viewer/use-section-spy";

const sections = buildDocumentSectionIndex({
  hasDocument: true,
  hasStoredSummary: true,
  pageCount: 84,
  chunkCount: 312,
  visualCount: 6,
  hasIndexHealth: true,
  pinnedPage: 12,
  loading: false,
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** jsdom has no IntersectionObserver or layout; the spy needs both to leave its fallback path. */
function installSectionSpyDomHarness(ids: string[]) {
  class ImmediateIntersectionObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe() {
      this.callback([], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);

  ids.forEach((id, index) => {
    const element = document.getElementById(id);
    if (!element) return;
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: index * 40,
      top: index * 40,
      left: 0,
      right: 320,
      bottom: index * 40 + 40,
      width: 320,
      height: 40,
      toJSON: () => ({}),
    });
  });
}

describe("DocumentSectionIndexCard", () => {
  it("renders every section with its count and marks the active one", () => {
    render(
      <DocumentSectionIndexCard
        sections={sections}
        activeId="source-evidence"
        onSelect={() => {}}
        compact
        onCompactChange={() => {}}
      />,
    );

    expect(screen.getByRole("navigation", { name: "Document sections" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(sections.length + 1);
    expect(screen.getByText("312 chunks")).toBeTruthy();

    const active = screen.getByRole("button", { name: /Matching passage/ });
    expect(active.getAttribute("aria-current")).toBe("true");
  });

  it("reports the selected section id to its caller", () => {
    const onSelect = vi.fn();
    render(
      <DocumentSectionIndexCard
        sections={sections}
        activeId="source-evidence"
        onSelect={onSelect}
        compact
        onCompactChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Tables and diagrams/ }));
    expect(onSelect).toHaveBeenCalledWith("source-images");
  });

  it("toggles condensed document content without replacing section navigation", () => {
    const onCompactChange = vi.fn();
    render(
      <DocumentSectionIndexCard
        sections={sections}
        activeId="source-text"
        onSelect={() => {}}
        compact
        onCompactChange={onCompactChange}
      />,
    );

    const density = screen.getByTestId("document-view-density-toggle");
    expect(density).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Page text/ })).toBeVisible();
    fireEvent.click(density);
    expect(onCompactChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing when the document has no navigable sections", () => {
    const { container } = render(
      <DocumentSectionIndexCard sections={[]} activeId={null} onSelect={() => {}} compact onCompactChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("DocumentSectionTrack", () => {
  it("draws one weighted segment per section and hides itself from assistive tech", () => {
    const { container } = render(<DocumentSectionTrack sections={sections} activeId="source-text" />);
    const track = container.firstElementChild as HTMLElement;

    expect(track.getAttribute("aria-hidden")).toBe("true");
    expect(track.children).toHaveLength(sections.length);
    // Weighted, not equal slices.
    const grows = Array.from(track.children).map((child) => (child as HTMLElement).style.flexGrow);
    expect(new Set(grows).size).toBeGreaterThan(1);
  });
});

describe("jumpToDocumentSection", () => {
  it("opens the target accordion and closes the others before scrolling", () => {
    document.body.innerHTML = `
      <details id="source-summary" name="document-viewer-section" open></details>
      <details id="source-images" name="document-viewer-section"></details>
    `;
    const target = document.getElementById("source-images") as HTMLDetailsElement;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });

    jumpToDocumentSection("source-images");

    expect(target.open).toBe(true);
    expect((document.getElementById("source-summary") as HTMLDetailsElement).open).toBe(false);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
  });

  it("does nothing when the section is not on the page", () => {
    expect(() => jumpToDocumentSection("source-missing")).not.toThrow();
  });
});

describe("useDocumentSectionSpy", () => {
  it("never reports a collapsed section as the active one", async () => {
    document.body.innerHTML = `
      <div id="document-overview"></div>
      <details id="source-summary" name="document-viewer-section"></details>
    `;
    // Both sit at the top of an empty jsdom viewport, so the collapsed summary
    // would win on position alone if the accordion state were ignored.
    installSectionSpyDomHarness(["document-overview", "source-summary"]);
    const model = sections.filter((section) => ["document-overview", "source-summary"].includes(section.id));

    const { result } = renderHook(() => useDocumentSectionSpy(model, true));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(result.current.activeId).toBe("document-overview");
    expect(result.current.activeId).not.toBe("source-summary");
  });

  it("takes an explicit selection immediately", () => {
    const { result } = renderHook(() => useDocumentSectionSpy(sections, false));
    act(() => {
      result.current.selectSection("source-images");
    });
    expect(result.current.activeId).toBe("source-images");
  });
});
