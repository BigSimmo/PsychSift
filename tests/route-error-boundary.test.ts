import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import GlobalError from "@/app/global-error";
import ServicesDetailError from "@/app/(search-app)/services/[slug]/error";
import { RouteErrorBoundary } from "@/components/route-error-boundary";

// Guards the fragility fix: every App Router `error.tsx` renders a recovery
// panel with a `Try again` action instead of crashing, and `global-error.tsx`
// stays self-contained (it replaces the root layout, so it cannot rely on
// globals.css / CSS-var theming — the very thing that may have failed).

const noop = () => undefined;

describe("RouteErrorBoundary", () => {
  it("renders default recovery copy and the reset action", () => {
    const markup = renderToStaticMarkup(createElement(RouteErrorBoundary, { error: new Error("boom"), reset: noop }));

    expect(markup).toContain("Something went wrong");
    expect(markup).toContain("Try again");
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('role="alert"');
    // Reload is opt-in; it is not shown by default.
    expect(markup).not.toContain("Reload page");
  });

  it("surfaces caller-supplied title, description, and the digest when present", () => {
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    const markup = renderToStaticMarkup(
      createElement(RouteErrorBoundary, {
        error,
        reset: noop,
        title: "Failed to load service record",
        description: "An unexpected error occurred while fetching this clinical service record.",
        showReload: true,
      }),
    );

    expect(markup).toContain("Failed to load service record");
    expect(markup).toContain("An unexpected error occurred while fetching this clinical service record.");
    expect(markup).toContain("Digest: abc123");
    expect(markup).toContain("Reload page");
  });

  it("omits the digest block when the error carries no digest", () => {
    const markup = renderToStaticMarkup(createElement(RouteErrorBoundary, { error: new Error("boom"), reset: noop }));

    expect(markup).not.toContain("Digest:");
  });
});

describe("segment error.tsx wrappers", () => {
  it("services detail boundary renders its section-specific copy", () => {
    const markup = renderToStaticMarkup(createElement(ServicesDetailError, { error: new Error("boom"), reset: noop }));

    expect(markup).toContain("Failed to load service record");
    expect(markup).toContain("Try again");
  });
});

describe("global-error boundary", () => {
  it("renders a self-contained document that does not depend on CSS variables", () => {
    const markup = renderToStaticMarkup(createElement(GlobalError, { error: new Error("fatal"), retry: noop }));

    // Replaces the root layout, so it must supply its own <html>/<body>.
    expect(markup).toContain("<html");
    expect(markup).toContain("<body");
    expect(markup).toContain("Something went wrong");
    expect(markup).toContain("Reload page");
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('role="alert"');
    // Must use inline styling, never the app's CSS-var theme tokens that may have failed to load.
    expect(markup).toContain("background-color");
    expect(markup).toContain("color-scheme:light dark");
    expect(markup).toContain("CanvasText");
    expect(markup).not.toContain("var(--");
  });
});
