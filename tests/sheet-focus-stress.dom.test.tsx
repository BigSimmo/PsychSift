import { act, render, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sheet } from "@/components/ui/sheet";
import { popSheet, pushSheet, SHEET_INERT_MARKER } from "@/components/ui/sheet-focus";

afterEach(() => {
  if (typeof document !== "undefined" && document.body) {
    document.body.style.overflow = "";
  }
});

function markerCount() {
  return document.querySelectorAll(`[${SHEET_INERT_MARKER}="true"]`).length;
}

function inertCount() {
  return document.querySelectorAll("[inert]").length;
}

function panelOf(title: string) {
  const heading = Array.from(document.body.querySelectorAll("h2")).find((node) => node.textContent === title);
  return heading?.closest('[role="dialog"]') as HTMLElement | undefined;
}

function Stack({ depth }: { depth: 0 | 1 | 2 | 3 }) {
  return (
    <>
      {([1, 2, 3] as const).map((level) => (
        <Sheet key={level} open={depth >= level} onClose={() => {}} title={`Level ${level}`} portal>
          <p>Level {level} body</p>
        </Sheet>
      ))}
    </>
  );
}

describe("Sheet focus stress", () => {
  it("survives rapid open/close cycling without leaking scroll lock, inert, or timers", async () => {
    document.body.style.overflow = "scroll";
    const background = document.createElement("div");
    background.append(document.createElement("button"));
    document.body.append(background);

    const { rerender, unmount } = render(
      <Sheet open={false} onClose={() => {}} title="Cycler" portal>
        <p>Body</p>
      </Sheet>,
    );

    for (let cycle = 0; cycle < 25; cycle += 1) {
      rerender(
        <Sheet open onClose={() => {}} title="Cycler" portal>
          <p>Body</p>
        </Sheet>,
      );
      rerender(
        <Sheet open={false} onClose={() => {}} title="Cycler" portal>
          <p>Body</p>
        </Sheet>,
      );
    }

    expect(document.body.style.overflow).toBe("scroll");
    expect(markerCount()).toBe(0);
    expect(background).not.toHaveAttribute("inert");

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(document.body.style.overflow).toBe("scroll");
    expect(markerCount()).toBe(0);
    background.remove();
    document.body.style.overflow = "";
  });

  it("keeps three stacked sheets consistent through reverse-order teardown", () => {
    const background = document.createElement("div");
    document.body.append(background);

    const { rerender } = render(<Stack depth={0} />);
    rerender(<Stack depth={1} />);
    const level1 = panelOf("Level 1")?.parentElement as HTMLElement;
    expect(background).toHaveAttribute("inert");
    expect(level1).not.toHaveAttribute("inert");

    rerender(<Stack depth={2} />);
    const level2 = panelOf("Level 2")?.parentElement as HTMLElement;
    expect(level1).toHaveAttribute("inert");
    expect(level2).not.toHaveAttribute("inert");

    rerender(<Stack depth={3} />);
    const level3 = panelOf("Level 3")?.parentElement as HTMLElement;
    expect(level2).toHaveAttribute("inert");
    expect(level3).not.toHaveAttribute("inert");

    rerender(<Stack depth={2} />);
    expect(level2).not.toHaveAttribute("inert");
    expect(level1).toHaveAttribute("inert");

    rerender(<Stack depth={0} />);
    expect(background).not.toHaveAttribute("inert");
    expect(markerCount()).toBe(0);
    background.remove();
  });

  it("returns focus to the sheet below when a stacked sheet closes", async () => {
    const { rerender } = render(<Stack depth={1} />);
    await waitFor(() => {
      expect(panelOf("Level 1")?.contains(document.activeElement)).toBe(true);
    });
    const lowerOpener = document.activeElement as HTMLElement;

    rerender(<Stack depth={2} />);
    await waitFor(() => {
      expect(panelOf("Level 2")?.contains(document.activeElement)).toBe(true);
    });

    rerender(<Stack depth={1} />);
    await waitFor(() => {
      expect(panelOf("Level 1")?.contains(document.activeElement)).toBe(true);
    });
    expect(document.activeElement).toBe(lowerOpener);
  });

  it("closes a middle sheet without disturbing the sheet above it", async () => {
    function Pair({ lower, upper }: { lower: boolean; upper: boolean }) {
      return (
        <>
          <Sheet open={lower} onClose={() => {}} title="Lower" portal>
            <p>Lower body</p>
          </Sheet>
          <Sheet open={upper} onClose={() => {}} title="Upper" portal>
            <p>Upper body</p>
          </Sheet>
        </>
      );
    }

    const { rerender } = render(<Pair lower upper />);
    await waitFor(() => {
      expect(panelOf("Upper")?.contains(document.activeElement)).toBe(true);
    });
    const upperFocus = document.activeElement;

    // The lower sheet closes underneath the open one.
    rerender(<Pair lower={false} upper />);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(document.activeElement).toBe(upperFocus);
    expect(panelOf("Upper")?.contains(document.activeElement)).toBe(true);
  });

  it("stays balanced under StrictMode double-invoked effects", async () => {
    document.body.style.overflow = "";
    const background = document.createElement("div");
    document.body.append(background);

    const { unmount } = render(
      <StrictMode>
        <Sheet open onClose={() => {}} title="Strict" portal>
          <p>Body</p>
        </Sheet>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(panelOf("Strict")?.contains(document.activeElement)).toBe(true);
    });
    expect(document.body.style.overflow).toBe("hidden");
    expect(background).toHaveAttribute("inert");

    unmount();
    expect(document.body.style.overflow).toBe("");
    expect(markerCount()).toBe(0);
    expect(inertCount()).toBe(0);
    background.remove();
  });

  it("does not crash or leak when the sheet has no focusable target", async () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <Sheet open onClose={() => {}} ariaLabel="Untitled test sheet" portal>
        <p>Untitled body with no controls</p>
      </Sheet>,
    );

    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    unmount();
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(markerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("releases every document listener it registered", async () => {
    const added = new Map<string, number>();
    const removed = new Map<string, number>();
    const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
    const addSpy = vi.spyOn(document, "addEventListener").mockImplementation(function (
      this: Document,
      ...args: Parameters<Document["addEventListener"]>
    ) {
      bump(added, String(args[0]));
      return Document.prototype.addEventListener.apply(this, args);
    });
    const removeSpy = vi.spyOn(document, "removeEventListener").mockImplementation(function (
      this: Document,
      ...args: Parameters<Document["removeEventListener"]>
    ) {
      bump(removed, String(args[0]));
      return Document.prototype.removeEventListener.apply(this, args);
    });

    vi.useFakeTimers();
    const { unmount } = render(
      <Sheet open onClose={() => {}} title="Listeners" portal>
        <p>Body</p>
      </Sheet>,
    );
    act(() => {
      vi.advanceTimersByTime(40);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(40);
    });
    vi.useRealTimers();

    for (const type of ["focusin", "pointerdown", "keydown"]) {
      expect(removed.get(type) ?? 0).toBeGreaterThanOrEqual(added.get(type) ?? 0);
    }
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("deactivates ancestor siblings for an inline (non-portal) sheet", () => {
    function InlineHost({ open }: { open: boolean }) {
      return (
        <div>
          <aside data-testid="inline-sibling">
            <button type="button">Background</button>
          </aside>
          <section>
            <Sheet open={open} onClose={() => {}} title="Inline" portal={false}>
              <p>Body</p>
            </Sheet>
          </section>
        </div>
      );
    }

    const { rerender } = render(<InlineHost open />);
    const sibling = document.querySelector('[data-testid="inline-sibling"]') as HTMLElement;
    expect(sibling).toHaveAttribute("inert");
    // The sheet's own ancestors must stay interactive.
    expect(sibling.parentElement).not.toHaveAttribute("inert");

    rerender(<InlineHost open={false} />);
    expect(sibling).not.toHaveAttribute("inert");
    expect(markerCount()).toBe(0);
  });

  it("gives up instead of recursing when a background surface fights for focus", async () => {
    const background = document.createElement("div");
    const greedy = document.createElement("button");
    background.append(greedy);
    document.body.append(background);

    let steals = 0;
    // Models a component that re-focuses itself from its own focus handler.
    const steal = () => {
      steals += 1;
      if (steals > 200) return;
      greedy.focus();
    };
    greedy.addEventListener("focusout", steal);

    render(
      <Sheet open onClose={() => {}} title="Contested" portal>
        <p>Body</p>
      </Sheet>,
    );
    await waitFor(() => {
      expect(panelOf("Contested")?.contains(document.activeElement)).toBe(true);
    });

    act(() => {
      greedy.focus();
    });
    await new Promise((resolve) => setTimeout(resolve, 120));

    // The war ends: bounded reclaims, no stack overflow, focus left alone.
    expect(steals).toBeLessThan(200);
    greedy.removeEventListener("focusout", steal);
    background.remove();
  });

  it("marks nothing for a detached root and still releases cleanly", () => {
    const background = document.createElement("div");
    document.body.append(background);
    const detachedRoot = document.createElement("div");

    pushSheet("detached-root", detachedRoot);
    expect(background).not.toHaveAttribute("inert");
    expect(markerCount()).toBe(0);

    popSheet("detached-root");
    expect(markerCount()).toBe(0);
    expect(document.body.style.overflow).toBe("");
    background.remove();
  });

  it("re-evaluates background when a sheet with a detached root is stacked on", () => {
    const background = document.createElement("div");
    document.body.append(background);
    const attachedRoot = document.createElement("div");
    document.body.append(attachedRoot);

    pushSheet("attached", attachedRoot);
    expect(background).toHaveAttribute("inert");

    // A top-most sheet whose root never attached must not leave the lower
    // sheet's marks stranded.
    pushSheet("detached", document.createElement("div"));
    expect(background).not.toHaveAttribute("inert");
    expect(markerCount()).toBe(0);

    popSheet("detached");
    expect(background).toHaveAttribute("inert");

    popSheet("attached");
    expect(markerCount()).toBe(0);
    expect(document.body.style.overflow).toBe("");
    attachedRoot.remove();
    background.remove();
  });

  it("keeps focus in a sheet opened from inside another sheet's panel", async () => {
    function Nested({ inner }: { inner: boolean }) {
      return (
        <Sheet open onClose={() => {}} title="Outer" portal>
          <button type="button" data-testid="open-inner">
            Open inner
          </button>
          <Sheet open={inner} onClose={() => {}} title="Inner" portal>
            <p>Inner body</p>
          </Sheet>
        </Sheet>
      );
    }

    const { rerender } = render(<Nested inner={false} />);
    const opener = document.querySelector('[data-testid="open-inner"]') as HTMLElement;
    act(() => {
      opener.focus();
    });

    rerender(<Nested inner />);
    await waitFor(() => {
      expect(panelOf("Inner")?.contains(document.activeElement)).toBe(true);
    });

    rerender(<Nested inner={false} />);
    await waitFor(() => {
      expect(document.activeElement).toBe(opener);
    });
  });

  it("survives a sheet whose open state flips while another mounts and unmounts", async () => {
    function Churn() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" data-testid="churn" onClick={() => setTick((value) => value + 1)}>
            churn
          </button>
          <Sheet open={tick % 2 === 0} onClose={() => {}} title="Even" portal>
            <p>Even body</p>
          </Sheet>
          <Sheet open={tick % 2 === 1} onClose={() => {}} title="Odd" portal>
            <p>Odd body</p>
          </Sheet>
        </>
      );
    }

    render(<Churn />);
    const churn = document.querySelector('[data-testid="churn"]') as HTMLElement;

    for (let index = 0; index < 12; index += 1) {
      act(() => {
        churn.click();
      });
    }

    await waitFor(() => {
      expect(panelOf("Even")?.contains(document.activeElement)).toBe(true);
    });
    expect(markerCount()).toBeGreaterThan(0);
    expect(document.body.style.overflow).toBe("hidden");
  });
});
