import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearChunkLoadReloadAttempt,
  ErrorBoundary,
  getChunkLoadReloadKey,
  hasChunkLoadReloadAttempted,
  markChunkLoadReloadAttempted,
} from "@/components/error-boundary";

describe("ErrorBoundary chunk-load reload recovery", () => {
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    reloadMock = vi.fn();
    vi.stubGlobal("location", {
      ...window.location,
      pathname: "/differentials",
      reload: reloadMock as unknown as () => void,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const chunkError = () =>
    Object.assign(new Error("Loading chunk 9999 failed.\n(error: /_next/static/chunks/9999.js)"), {
      name: "ChunkLoadError",
    });

  function ThrowingChild({ error }: { error?: Error }) {
    if (error) {
      throw error;
    }
    return <div>Normal Content</div>;
  }

  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <div>Normal Content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Normal Content")).toBeInTheDocument();
  });

  it("does not reload on non-chunk error and renders fallback", () => {
    render(
      <ErrorBoundary fallback={(err) => <div>Fallback: {err.message}</div>}>
        <ThrowingChild error={new Error("Regular application error")} />
      </ErrorBoundary>,
    );

    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.getByText("Fallback: Regular application error")).toBeInTheDocument();
    expect(hasChunkLoadReloadAttempted("/differentials")).toBe(false);
  });

  it("triggers automatic one-time reload on ChunkLoadError and sets sessionStorage flag", () => {
    render(
      <ErrorBoundary fallback={<div>Fallback UI</div>}>
        <ThrowingChild error={chunkError()} />
      </ErrorBoundary>,
    );

    expect(reloadMock).toHaveBeenCalledOnce();
    expect(hasChunkLoadReloadAttempted("/differentials")).toBe(true);
    expect(sessionStorage.getItem(getChunkLoadReloadKey("/differentials"))).toBe("true");
  });

  it("prevents infinite reload loops if reload was already attempted for pathname", () => {
    markChunkLoadReloadAttempted("/differentials");
    expect(hasChunkLoadReloadAttempted("/differentials")).toBe(true);

    render(
      <ErrorBoundary fallback={<div>Fallback after reload</div>}>
        <ThrowingChild error={chunkError()} />
      </ErrorBoundary>,
    );

    // Should NOT call reload again
    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.getByText("Fallback after reload")).toBeInTheDocument();
  });

  it("renders default RouteErrorBoundary when no custom fallback is passed on second failure", () => {
    markChunkLoadReloadAttempted("/differentials");

    render(
      <ErrorBoundary>
        <ThrowingChild error={chunkError()} />
      </ErrorBoundary>,
    );

    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "This page didn't finish loading" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
  });

  it("clears the reload flag on manual reset", () => {
    markChunkLoadReloadAttempted("/differentials");
    expect(hasChunkLoadReloadAttempted("/differentials")).toBe(true);

    let shouldThrow = true;
    function ResettableChild() {
      if (shouldThrow) {
        throw chunkError();
      }
      return <div>Recovered Content</div>;
    }

    render(
      <ErrorBoundary
        fallback={(_err, reset) => (
          <div>
            <span>Error occurred</span>
            <button
              type="button"
              onClick={() => {
                shouldThrow = false;
                reset();
              }}
            >
              Manual Reset
            </button>
          </div>
        )}
      >
        <ResettableChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Error occurred")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manual Reset" }));
    expect(screen.getByText("Recovered Content")).toBeInTheDocument();
    expect(hasChunkLoadReloadAttempted("/differentials")).toBe(false);
  });

  it("supports explicit pathname prop for route-scoped reload flags", () => {
    render(
      <ErrorBoundary pathname="/custom-route" fallback={<div>Custom fallback</div>}>
        <ThrowingChild error={chunkError()} />
      </ErrorBoundary>,
    );

    expect(reloadMock).toHaveBeenCalledOnce();
    expect(hasChunkLoadReloadAttempted("/custom-route")).toBe(true);
    expect(hasChunkLoadReloadAttempted("/differentials")).toBe(false);
  });

  it("clearChunkLoadReloadAttempt safely clears pathname attempt", () => {
    markChunkLoadReloadAttempted("/test-path");
    expect(hasChunkLoadReloadAttempted("/test-path")).toBe(true);

    clearChunkLoadReloadAttempt("/test-path");
    expect(hasChunkLoadReloadAttempted("/test-path")).toBe(false);
  });

  it("does not reload and safely renders fallback if sessionStorage throws (e.g. storage disabled/blocked), preventing infinite reload loops", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    render(
      <ErrorBoundary fallback={<div>Fallback with disabled storage</div>}>
        <ThrowingChild error={chunkError()} />
      </ErrorBoundary>,
    );

    // Must NOT call reload because persistence failed — doing so would cause an infinite reload loop!
    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.getByText("Fallback with disabled storage")).toBeInTheDocument();
  });
});
