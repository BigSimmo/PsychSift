import { useEffect, useRef, useState } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sheet } from "@/components/ui/sheet";
import { OverlayRoot } from "@/components/ui/overlay-root";

// jsdom (via vitest's environment) normally provides requestAnimationFrame, but
// guard it so the Sheet's focus scheduling never throws if a runner omits it.
beforeEach(() => {
  if (typeof window.requestAnimationFrame !== "function") {
    window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((id: number) =>
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>)) as typeof window.cancelAnimationFrame;
  }
});

afterEach(() => {
  // Guard teardown: unhandled rAF/setTimeout from Sheet focus scheduling can
  // fire after Vitest tears down the jsdom environment under coverage workers.
  if (typeof document !== "undefined" && document.body) {
    document.body.style.overflow = "";
  }
});

it("portals into OverlayRoot's modal host by default", async () => {
  render(
    <>
      <OverlayRoot />
      <Sheet open onClose={() => {}} title="Default portal sheet">
        <p>Default portal body</p>
      </Sheet>
    </>,
  );

  const body = await screen.findByText("Default portal body");
  expect(body.closest('[data-overlay-host="modal"]')).not.toBeNull();
});

function Stacked({
  openA,
  openB,
  onCloseA,
  onCloseB,
}: {
  openA: boolean;
  openB: boolean;
  onCloseA: () => void;
  onCloseB: () => void;
}) {
  return (
    <>
      <Sheet open={openA} onClose={onCloseA} title="Lower sheet" portal>
        <p>Lower body</p>
      </Sheet>
      <Sheet open={openB} onClose={onCloseB} title="Upper sheet" portal>
        <p>Upper body</p>
      </Sheet>
    </>
  );
}

function pressEscape() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

function DetachedResolverFallbackHarness() {
  const [open, setOpen] = useState(false);
  const [showResolverTarget, setShowResolverTarget] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const staleResolverTargetRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button
        type="button"
        ref={openerRef}
        onClick={() => {
          setShowResolverTarget(true);
          setOpen(true);
        }}
      >
        Open sheet
      </button>
      {showResolverTarget ? (
        <button
          type="button"
          ref={(element) => {
            if (element) staleResolverTargetRef.current = element;
          }}
        >
          Stale resolver target
        </button>
      ) : null}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Return focus"
        returnFocusRef={openerRef}
        resolveReturnFocusTarget={() => staleResolverTargetRef.current}
      >
        <button
          type="button"
          onClick={() => {
            setShowResolverTarget(false);
            setOpen(false);
          }}
        >
          Close sheet
        </button>
      </Sheet>
    </>
  );
}

function DynamicReturnFocusHarness() {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const updatedTargetRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  return (
    <>
      <button
        type="button"
        ref={openerRef}
        onClick={() => {
          returnFocusRef.current = openerRef.current;
          setOpen(true);
        }}
      >
        Open sheet
      </button>
      <button type="button" ref={updatedTargetRef}>
        Updated return target
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Dynamic return" returnFocusRef={returnFocusRef}>
        <button
          type="button"
          onClick={() => {
            returnFocusRef.current = updatedTargetRef.current;
            setOpen(false);
          }}
        >
          Close to updated target
        </button>
      </Sheet>
    </>
  );
}

describe("Sheet stacked-overlay coordination", () => {
  it("routes Escape to only the top-most open Sheet", () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    render(<Stacked openA openB onCloseA={onCloseA} onCloseB={onCloseB} />);

    pressEscape();

    expect(onCloseB).toHaveBeenCalledTimes(1);
    expect(onCloseA).not.toHaveBeenCalled();
  });

  it("keeps body scroll locked until the last Sheet closes, then restores the original overflow", () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    const { rerender } = render(<Stacked openA openB onCloseA={onCloseA} onCloseB={onCloseB} />);

    // Both open → body scroll locked once.
    expect(document.body.style.overflow).toBe("hidden");

    // Close the upper (top) Sheet: the lower Sheet still holds the lock.
    rerender(<Stacked openA openB={false} onCloseA={onCloseA} onCloseB={onCloseB} />);
    expect(document.body.style.overflow).toBe("hidden");

    // After Escape now targets the lower Sheet (new top-most).
    pressEscape();
    expect(onCloseA).toHaveBeenCalledTimes(1);

    // Close the last Sheet: original overflow ("") is restored exactly once.
    rerender(<Stacked openA={false} openB={false} onCloseA={onCloseA} onCloseB={onCloseB} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("locks body scroll for a single Sheet and restores it on close (unchanged baseline)", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Sheet open onClose={onClose} title="Solo" portal>
        <p>Solo body</p>
      </Sheet>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <Sheet open={false} onClose={onClose} title="Solo" portal>
        <p>Solo body</p>
      </Sheet>,
    );
    expect(document.body.style.overflow).toBe("");
  });

  it("cancels focus-restore timers on unmount so coverage teardown cannot throw", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { unmount } = render(
      <Sheet open onClose={onClose} title="Solo" portal>
        <p>Solo body</p>
      </Sheet>,
    );
    await vi.runAllTimersAsync();
    const restoreFrameSpy = vi.spyOn(window, "requestAnimationFrame");

    // Unmount while open: no restore callback should be scheduled after the
    // mount cleanup has started tearing down the component.
    unmount();
    await vi.runAllTimersAsync();
    expect(restoreFrameSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("keeps caller-provided mobile and small-screen height caps authoritative", () => {
    const { getByRole } = render(
      <Sheet open onClose={vi.fn()} title="Capped sheet" contentClassName="max-h-[88dvh] sm:max-h-[min(80dvh,36rem)]">
        <p>Body</p>
      </Sheet>,
    );

    const classes = getByRole("dialog").classList;
    expect(classes).toContain("max-h-[88dvh]");
    expect(classes).toContain("sm:max-h-[min(80dvh,36rem)]");
    expect(classes).not.toContain("max-h-[calc(100dvh-2rem)]");
    expect(classes).not.toContain("sm:max-h-[88dvh]");
  });

  it("uses a bottom sheet on phones and a restrained right drawer from small screens", () => {
    render(
      <Sheet open onClose={vi.fn()} title="Filters" placement="responsive-right">
        <p>Filter body</p>
      </Sheet>,
    );

    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog).toHaveClass(
      "rounded-t-2xl",
      "sm:h-full",
      "sm:max-w-[32rem]",
      "sm:rounded-l-2xl",
      "sm:rounded-r-none",
    );
    expect(dialog.parentElement).toHaveClass("items-end", "justify-center", "sm:items-stretch", "sm:justify-end");
  });

  it("keeps the dialog mounted in production when the title resolves empty", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const { getByRole, queryByRole } = render(
        // Callers can satisfy `title: string` with "" from fetched data.
        <Sheet open onClose={() => {}} title={"" as string} portal testId="unnamed-sheet">
          <p>Recoverable body</p>
        </Sheet>,
      );

      expect(queryByRole("dialog")).not.toBeNull();
      expect(getByRole("dialog")).toHaveAttribute("aria-label", "Dialog");
      expect(getByRole("dialog")).toHaveTextContent("Recoverable body");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("upgrades from the close-button fallback to a late-mounted data-sheet-autofocus target", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Sheet open onClose={onClose} title="Sources" portal>
        <p>Loading filters…</p>
      </Sheet>,
    );

    // First open frame: no autofocus child yet, so the close control is focused.
    await waitFor(() => {
      const closeButton = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
      expect(closeButton).not.toBeNull();
      expect(document.activeElement).toBe(closeButton);
    });

    rerender(
      <Sheet open onClose={onClose} title="Sources" portal>
        <input data-sheet-autofocus="true" placeholder="Find a document" />
      </Sheet>,
    );

    // Open-focus retries must move off the close fallback onto the Find field.
    await waitFor(() => {
      const findField = document.querySelector<HTMLInputElement>('input[placeholder="Find a document"]');
      expect(findField).not.toBeNull();
      expect(document.activeElement).toBe(findField);
    });
  });

  it("falls back to returnFocusRef when a resolver target has detached", async () => {
    const user = userEvent.setup();
    render(<DetachedResolverFallbackHarness />);

    const opener = screen.getByRole("button", { name: "Open sheet" });
    await user.click(opener);
    await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));

    await user.click(screen.getByRole("button", { name: "Close sheet" }));

    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("reads returnFocusRef at close time so callers can retarget focus", async () => {
    const user = userEvent.setup();
    render(<DynamicReturnFocusHarness />);

    await user.click(screen.getByRole("button", { name: "Open sheet" }));
    await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));
    await user.click(screen.getByRole("button", { name: "Close to updated target" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Updated return target" })).toHaveFocus());
  });
});

describe("Sheet close handler freshness", () => {
  it("calls the latest onClose when Close is clicked right after a commit, before passive effects flush", async () => {
    // Reproduces the admin-renewed-sheet flake: an async save re-renders the
    // sheet with a new onClose, and a click that lands between that commit and
    // the passive-effect flush must not reach the previous render's handler.
    const { createRoot } = await import("react-dom/client");
    const previousActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    const calls: number[] = [];
    const bump: { current: (() => void) | null } = { current: null };
    function Harness() {
      const [n, setN] = useState(0);
      useEffect(() => {
        bump.current = () => setN(1);
      }, []);
      return (
        <Sheet open onClose={() => calls.push(n)} title="Freshness sheet" dismissOnBack={false}>
          <p data-testid="freshness-n">{n}</p>
        </Sheet>
      );
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      root.render(<Harness />);
      for (let i = 0; i < 50 && !document.querySelector('[data-testid="freshness-n"]'); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const label = document.querySelector('[data-testid="freshness-n"]')!;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const clickedAfterCommit = new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          if (label.textContent !== "1") return;
          observer.disconnect();
          (document.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
          resolve();
        });
        observer.observe(label, { childList: true, characterData: true, subtree: true });
      });
      setTimeout(() => bump.current?.(), 0);
      await clickedAfterCommit;
      expect(calls).toEqual([1]);
    } finally {
      root.unmount();
      container.remove();
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });
});

describe("Sheet dismissOnBack history", () => {
  function renderSheet(open: boolean, onClose: () => void) {
    return (
      <>
        <OverlayRoot />
        <Sheet open={open} onClose={onClose} dismissOnBack title="Filter sheet">
          <p>Filter body</p>
        </Sheet>
      </>
    );
  }

  it("does not stack a history entry per open when the parent closes the sheet itself", () => {
    // A filter sheet's Done button closes through the parent, not requestClose,
    // so the entry pushed on open is left behind. Before the fix every
    // open-then-Done cycle pushed another same-URL entry, and Back needed one
    // extra press per use to leave the page.
    const onClose = vi.fn();
    const startLength = window.history.length;
    const { rerender, unmount } = render(renderSheet(false, onClose));

    for (let cycle = 0; cycle < 3; cycle += 1) {
      rerender(renderSheet(true, onClose));
      rerender(renderSheet(false, onClose));
    }

    expect(window.history.length).toBe(startLength + 1);
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("pushes a fresh entry when the leftover entry's URL was rewritten after the push", () => {
    const onClose = vi.fn();
    const { rerender, unmount } = render(renderSheet(false, onClose));
    rerender(renderSheet(true, onClose));
    rerender(renderSheet(false, onClose));
    const lengthAfterFirstCycle = window.history.length;

    // A filter that rewrites the URL while keeping history.state must not have
    // its new URL undone by a later Back that pops a reused entry.
    window.history.replaceState(window.history.state, "", "/?filters=changed");
    rerender(renderSheet(true, onClose));

    expect(window.history.length).toBe(lengthAfterFirstCycle + 1);
    unmount();
  });
});
