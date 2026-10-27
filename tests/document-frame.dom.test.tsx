import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DocumentFrame, type DocumentFrameControls } from "@/components/ui/document-frame";

const readyControls = (overrides: Partial<DocumentFrameControls> = {}): DocumentFrameControls => ({
  fitWidth: true,
  onFitWidth: vi.fn(),
  zoom: 1,
  onZoomChange: vi.fn(),
  viewingAid: false,
  onViewingAidChange: vi.fn(),
  ...overrides,
});

describe("DocumentFrame", () => {
  it("renders a stable, labelled loading frame without mounting ready content", () => {
    render(
      <DocumentFrame
        alt="Lithium monitoring source preview"
        src={{ kind: "document" }}
        state="loading"
        loadingLabel="Preparing source preview"
        statusDetail={<p>Loading source metadata</p>}
        statusActions={<a href="https://example.test/source.pdf">Open source</a>}
      >
        <p>Ready-only source content</p>
      </DocumentFrame>,
    );

    const frame = screen.getByRole("group", { name: "Lithium monitoring source preview" });
    expect(frame).toHaveAttribute("aria-busy", "true");
    expect(frame).toHaveAttribute("data-state", "loading");
    expect(screen.getByRole("status")).toHaveTextContent("Preparing source preview");
    expect(screen.getByRole("status")).toHaveTextContent("Loading source metadata");
    expect(screen.getByRole("link", { name: "Open source" })).toBeVisible();
    expect(screen.getByTestId("document-frame-surround")).toHaveClass("min-h-64", "sm:min-h-72");
    expect(screen.queryByText("Ready-only source content")).toBeNull();
  });

  it("owns the complete error structure and an accessible retry action", () => {
    const onRetry = vi.fn();
    render(
      <DocumentFrame
        alt="Medication chart"
        src={{ kind: "image" }}
        state="error"
        errorMessage="The signed preview link expired."
        onRetry={onRetry}
        statusActions={<a href="https://example.test/chart.png">Open original</a>}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Preview unavailable");
    expect(alert).toHaveTextContent("The signed preview link expired.");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry preview" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(within(alert).getByRole("link", { name: "Open original" })).toBeVisible();
  });

  it("renders controlled fit, zoom, and viewing-aid actions in one print-hidden toolbar", () => {
    const onFitWidth = vi.fn();
    const onZoomChange = vi.fn();
    const onViewingAidChange = vi.fn();
    render(
      <DocumentFrame
        alt="Clinical guideline page"
        src={{ kind: "pdf-page", url: "https://example.test/guideline.pdf", page: 2, pageCount: 7 }}
        state="ready"
        controls={readyControls({ onFitWidth, onZoomChange, onViewingAidChange })}
      >
        <canvas aria-label="Clinical guideline page 2" />
      </DocumentFrame>,
    );

    const toolbar = screen.getByRole("toolbar", { name: "Document viewing controls" });
    expect(toolbar).toHaveAttribute("data-print-hide");
    expect(screen.getByRole("button", { name: "Fit width of document" })).toHaveAttribute("aria-pressed", "true");
    // Zoom renders twice by design: inline from 380px up, and inside the phone
    // overflow below it. CSS shows exactly one; jsdom sees both.
    const [inlineZoomOut] = screen.getAllByRole("button", { name: "Zoom out" });
    const [inlineZoomIn] = screen.getAllByRole("button", { name: "Zoom in" });
    expect(inlineZoomOut).toHaveClass("min-h-tap", "min-w-tap");
    expect(inlineZoomIn).toHaveClass("min-h-tap", "min-w-tap");
    expect(screen.getByLabelText("Document zoom")).toHaveTextContent("100%");

    fireEvent.click(inlineZoomOut);
    fireEvent.click(inlineZoomIn);
    fireEvent.click(screen.getByRole("button", { name: "Fit width of document" }));
    fireEvent.click(screen.getByRole("button", { name: "Viewing aid: reduce glare around the document" }));

    expect(onZoomChange).toHaveBeenNthCalledWith(1, 0.85);
    expect(onZoomChange).toHaveBeenNthCalledWith(2, 1.15);
    expect(onFitWidth).toHaveBeenCalledOnce();
    expect(onViewingAidChange).toHaveBeenCalledWith(true);
  });

  // The viewer used to print the page number twice — once in the frame band and
  // again in the PDF component's own toolbar — and used Maximize2 for both "fit
  // width" and "fullscreen". One toolbar owns both now.
  it("owns page navigation with a single readout and distinct fit/fullscreen actions", () => {
    const onPageChange = vi.fn();
    const onRotate = vi.fn();
    const onFullscreenChange = vi.fn();
    render(
      <DocumentFrame
        alt="Clinical guideline page"
        src={{ kind: "pdf-page", url: "https://example.test/guideline.pdf", page: 2, pageCount: 7 }}
        state="ready"
        controls={readyControls({ page: 2, pageCount: 7, onPageChange, onRotate, onFullscreenChange })}
      >
        <canvas aria-label="Clinical guideline page 2" />
      </DocumentFrame>,
    );

    expect(screen.getByLabelText("Page number")).toHaveValue("2");
    expect(screen.getAllByText("/ 7")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPageChange).toHaveBeenCalledWith(1);

    fireEvent.change(screen.getByLabelText("Page number"), { target: { value: "5" } });
    fireEvent.blur(screen.getByLabelText("Page number"));
    expect(onPageChange).toHaveBeenCalledWith(5);

    // Out-of-range entries clamp instead of navigating past the document.
    fireEvent.change(screen.getByLabelText("Page number"), { target: { value: "99" } });
    fireEvent.blur(screen.getByLabelText("Page number"));
    expect(onPageChange).toHaveBeenLastCalledWith(7);

    expect(screen.getByRole("button", { name: "Fit width of document" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Enter fullscreen document view" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Fit page width and enter fullscreen" })).toBeNull();
  });

  // Codex P2 on PR #1741: a deep-linked ?page=999 left the toolbar on 999 while
  // the canvas showed the last page. Bound the readout and Previous/Next against
  // pageCount so navigation cannot walk further out of range.
  it("bounds an out-of-range controlled page against pageCount", () => {
    const onPageChange = vi.fn();
    render(
      <DocumentFrame
        alt="Clinical guideline page"
        src={{ kind: "pdf-page", url: "https://example.test/guideline.pdf", page: 999, pageCount: 10 }}
        state="ready"
        controls={readyControls({ page: 999, pageCount: 10, onPageChange })}
      >
        <canvas aria-label="Clinical guideline page" />
      </DocumentFrame>,
    );

    expect(screen.getByLabelText("Page number")).toHaveValue("10");
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPageChange).toHaveBeenCalledWith(9);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("resynchronizes the page draft when pageCount rises without a page change", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <DocumentFrame
        alt="Clinical guideline page"
        src={{ kind: "pdf-page", url: "https://example.test/guideline.pdf", page: 8, pageCount: 5 }}
        state="ready"
        controls={readyControls({ page: 8, pageCount: 5, onPageChange })}
      >
        <canvas aria-label="Clinical guideline page" />
      </DocumentFrame>,
    );

    expect(screen.getByLabelText("Page number")).toHaveValue("5");

    rerender(
      <DocumentFrame
        alt="Clinical guideline page"
        src={{ kind: "pdf-page", url: "https://example.test/guideline.pdf", page: 8, pageCount: 20 }}
        state="ready"
        controls={readyControls({ page: 8, pageCount: 20, onPageChange })}
      >
        <canvas aria-label="Clinical guideline page" />
      </DocumentFrame>,
    );

    expect(screen.getByLabelText("Page number")).toHaveValue("8");
    fireEvent.blur(screen.getByLabelText("Page number"));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  // A 320px row cannot hold page navigation plus six tap targets, so the
  // narrowest phones reach zoom, fit, rotate, viewing aid and fullscreen through
  // one overflow. Every one of them keeps the production tap target.
  it("keeps every phone overflow action at the production tap target", () => {
    render(
      <DocumentFrame
        alt="Clinical guideline page"
        src={{ kind: "pdf-page", url: "https://example.test/guideline.pdf", page: 1, pageCount: 3 }}
        state="ready"
        controls={readyControls({
          page: 1,
          pageCount: 3,
          onPageChange: vi.fn(),
          onRotate: vi.fn(),
          onFullscreenChange: vi.fn(),
        })}
      >
        <canvas aria-label="Clinical guideline page 1" />
      </DocumentFrame>,
    );

    const overflow = screen.getByTestId("document-frame-overflow");
    // Nested under role="toolbar", a bare <summary> was exposed as generic in
    // Chromium — keep an explicit button role so assistive tech and E2E agree.
    expect(within(overflow).getByRole("button", { name: "More viewing options" })).toBeVisible();
    for (const name of ["Zoom out", "Zoom in", "Fit width", "Rotate 90°", "Viewing aid", "Fullscreen"]) {
      const control = within(overflow).getByRole("button", { name });
      expect(control.className).toMatch(/min-h-tap/);
    }
  });

  it("omits page navigation for sources that are not paged", () => {
    render(
      <DocumentFrame
        alt="Clinical figure"
        src={{ kind: "image", url: "https://example.test/figure.png" }}
        state="ready"
        controls={readyControls()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- A plain image is the document-content fixture under test. */}
        <img src="https://example.test/figure.png" alt="Clinical figure" />
      </DocumentFrame>,
    );

    expect(screen.queryByLabelText("Page number")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  });

  it("suppresses the viewing aid while zoomed and never decorates source pixels", () => {
    render(
      <DocumentFrame
        alt="Clinical figure"
        src={{ kind: "image", url: "https://example.test/figure.png" }}
        state="ready"
        controls={readyControls({ fitWidth: false, zoom: 1.5, viewingAid: true })}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- A plain image is the document-content fixture under test. */}
        <img src="https://example.test/figure.png" alt="Clinical figure" />
      </DocumentFrame>,
    );

    const frame = screen.getByTestId("document-frame");
    const content = screen.getByTestId("document-frame-content");
    const viewingAid = screen.getByRole("button", { name: "Viewing aid unavailable while zoomed" });
    expect(frame).toHaveAttribute("data-viewing-aid", "off");
    expect(viewingAid).toBeDisabled();
    expect(viewingAid).toHaveAttribute("aria-pressed", "false");
    expect(content).toHaveClass("w-full", "min-w-0", "max-w-full", "break-inside-avoid", "print:break-inside-avoid");
    expect(content.getAttribute("style") ?? "").toBe("");
    expect(content.className).not.toMatch(/(?:invert|filter|color-scheme)/);
  });
});
