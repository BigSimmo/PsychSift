import { useRef, type ReactNode } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SourcePreviewPopover } from "@/components/clinical-dashboard/source-preview-popover";

/**
 * Ledger #107: component state matrices are the largest untested surface — 83 of 208
 * production components had zero executed lines when this was measured on 2026-07-29,
 * and this popover was one of them.
 *
 * It is worth covering ahead of prettier components because it gates *document
 * access*: it is the surface a clinician uses to look at the sources behind an
 * answer. Its failure modes are all invisible to an E2E happy path — a popover that
 * renders off-screen, never takes focus, or leaves a document-level key listener
 * behind after closing all look fine in a screenshot.
 *
 * jsdom geometry is deterministic here: `window.visualViewport` is absent so the
 * layout math falls back to `window.innerWidth`/`innerHeight` (1024x768), and an
 * un-mocked `getBoundingClientRect` returns zeroes. Both placements are therefore
 * reachable without guessing at real layout.
 */

function Harness({
  open,
  onClose,
  title,
  children,
  anchorRect,
  withAnchor = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  anchorRect?: Partial<DOMRect>;
  withAnchor?: boolean;
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button
        type="button"
        ref={(node) => {
          if (!withAnchor) return;
          anchorRef.current = node;
          if (node && anchorRect) {
            node.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, ...anchorRect }) as DOMRect;
          }
        }}
        onClick={() => {}}
      >
        Sources
      </button>
      <SourcePreviewPopover open={open} onClose={onClose} anchorRef={anchorRef} title={title}>
        {children ?? <a href="https://example.org/guideline.pdf">Open document</a>}
      </SourcePreviewPopover>
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SourcePreviewPopover", () => {
  it("renders nothing while closed", () => {
    render(<Harness open={false} onClose={() => {}} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("presents an open preview as a non-modal dialog named by its title", () => {
    render(<Harness open onClose={() => {}} title="Sources for clozapine" />);

    const dialog = screen.getByRole("dialog", { name: "Sources for clozapine" });
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(dialog).toHaveAttribute("data-testid", "source-capsule-preview");
  });

  it("defaults its accessible name so the dialog is never anonymous", () => {
    render(<Harness open onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: "Sources" })).toBeInTheDocument();
  });

  it("portals to the document body so an overflow-hidden ancestor cannot clip it", () => {
    // The band and answer surfaces this opens from are `overflow-hidden`; rendering
    // in place would clip the preview rather than overlaying it.
    render(<Harness open onClose={() => {}} />);

    expect(screen.getByRole("dialog").parentElement).toBe(document.body);
  });

  it("places itself below the anchor when there is room, and pins inside the viewport edge", () => {
    render(<Harness open onClose={() => {}} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-popover-placement", "below");
    // 8px anchor gap below a zero-height anchor at the top of the viewport, and the
    // 12px edge padding rather than the anchor's own left edge of 0.
    expect(dialog).toHaveStyle({ top: "8px", left: "12px" });
  });

  it("flips above the anchor when the space below cannot hold the minimum height", () => {
    render(<Harness open onClose={() => {}} anchorRect={{ top: 700, bottom: 740 }} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-popover-placement", "above");
    // Sits its own max height plus the gap above the anchor rather than overflowing
    // the bottom edge.
    expect(dialog).toHaveStyle({ top: "340px" });
  });

  it("stays hidden rather than flashing at the wrong position when no anchor is measured", () => {
    // A visible popover at a stale/unknown offset is worse than an invisible one:
    // it paints over content at the top-left of the page for a frame.
    render(<Harness open onClose={() => {}} withAnchor={false} />);

    expect(screen.getByTestId("source-capsule-preview")).toHaveStyle({ visibility: "hidden" });
    // `visibility: hidden` also takes it out of the accessibility tree, so a screen
    // reader does not announce a preview the sighted user cannot see either.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves focus into the preview so the keyboard lands on the sources, not the page", async () => {
    render(<Harness open onClose={() => {}} />);

    await waitFor(() => expect(screen.getByRole("link", { name: "Open document" })).toHaveFocus());
  });

  it("prefers an explicitly marked autofocus target over the first focusable child", async () => {
    render(
      <Harness open onClose={() => {}}>
        <a href="https://example.org/first.pdf">First</a>
        <button type="button" data-sheet-autofocus="true" onClick={() => {}}>
          Preferred
        </button>
      </Harness>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Preferred" })).toHaveFocus());
  });

  it("lets Tab leave the non-modal preview from its last control instead of looping focus", async () => {
    render(<Harness open onClose={() => {}} />);
    const link = screen.getByRole("link", { name: "Open document" });
    await waitFor(() => expect(link).toHaveFocus());

    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    link.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(false);
  });

  it("focuses the surface itself when it holds nothing focusable", async () => {
    render(
      <Harness open onClose={() => {}}>
        <p>No sources could be loaded.</p>
      </Harness>,
    );

    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on a pointer press outside itself", async () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Open document" })).toHaveFocus());

    await userEvent.click(document.body);

    expect(onClose).toHaveBeenCalled();
  });

  it("stays open when the press lands inside the preview", async () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);

    await userEvent.click(screen.getByRole("link", { name: "Open document" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("releases its document key listener once closed", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<Harness open onClose={onClose} />);

    rerender(<Harness open={false} onClose={onClose} />);
    onClose.mockClear();
    await userEvent.keyboard("{Escape}");

    // A listener left on `document` would keep firing `onClose` for a surface that
    // is no longer on screen, and would swallow Escape from whatever is.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("releases its document key listener on unmount", async () => {
    const onClose = vi.fn();
    const { unmount } = render(<Harness open onClose={onClose} />);

    unmount();
    onClose.mockClear();
    await userEvent.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("recomputes its placement when the viewport resizes under it", async () => {
    const { rerender } = render(<Harness open onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-popover-placement", "below");

    // Re-anchor near the bottom, then resize: the rAF-coalesced listener must adopt
    // the new geometry rather than leaving the popover where it first landed.
    rerender(<Harness open onClose={() => {}} anchorRect={{ top: 700, bottom: 740 }} />);
    window.dispatchEvent(new Event("resize"));

    await waitFor(() => expect(screen.getByRole("dialog")).toHaveAttribute("data-popover-placement", "above"));
  });
});
