import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isChunkLoadError, RouteErrorBoundary } from "@/components/route-error-boundary";
import { CHUNK_RELOAD_STORAGE_KEY } from "@/lib/chunk-load-recovery";

// Audit F11: a dynamic ChunkLoadError on Differentials under a network fault
// landed on the generic panel, whose primary action, "Try again", re-renders
// from the same missing chunk and fails again. Only a full reload fetches it.
describe("RouteErrorBoundary chunk-load recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  const chunkError = () =>
    Object.assign(new Error("Loading chunk 4821 failed.\n(error: /_next/static/chunks/4821.js)"), {
      name: "ChunkLoadError",
    });

  it.each([
    ["webpack ChunkLoadError", chunkError()],
    ["Chromium dynamic import", new TypeError("Failed to fetch dynamically imported module: https://x/_next/a.js")],
    ["Safari dynamic import", new TypeError("Importing a module script failed.")],
    ["CSS chunk", new Error("Loading CSS chunk 12 failed.")],
  ])("recognises a %s", (_label, error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("does not treat an ordinary error as a chunk failure", () => {
    expect(isChunkLoadError(new Error("boom"))).toBe(false);
  });

  it("reloads by itself once, so a page left over from a deploy recovers without a tap", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<RouteErrorBoundary error={chunkError()} reset={vi.fn()} />);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not reload for an ordinary error", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<RouteErrorBoundary error={new Error("boom")} reset={vi.fn()} />);
    expect(reload).not.toHaveBeenCalled();
  });

  it("explains the network cause and makes a full reload the primary action", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // A reload moments ago did not help, so the card stays and waits for the reader.
    window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(Date.now()));
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const reset = vi.fn();
    render(<RouteErrorBoundary error={chunkError()} reset={reset} />);

    expect(screen.getByRole("heading", { name: "This page didn't finish loading" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("connection dropped");
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("Reload page");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    fireEvent.click(buttons[0]!);
    expect(reload).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
