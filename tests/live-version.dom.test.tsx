/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  LivePreview,
  LiveVersionProvider,
  writeLiveVersionChoice,
} from "@/components/live-version/live-version-provider";
import { clearAccountScopedBrowserStorage } from "@/lib/account-scoped-browser-state";

afterEach(() => {
  cleanup();
  document.cookie = "psychsift-live-version=; path=/; max-age=0";
});

describe("live version in the browser", () => {
  it("draws preview work only on the newest version", () => {
    const { rerender } = render(
      <LiveVersionProvider liveVersion={{ available: true, newest: true }}>
        <LivePreview feature="work-mode-new-screens" fallback={<p>Everyone&apos;s</p>}>
          <p>Newest</p>
        </LivePreview>
      </LiveVersionProvider>,
    );
    expect(screen.getByText("Newest")).toBeTruthy();
    rerender(
      <LiveVersionProvider liveVersion={{ available: true, newest: false }}>
        <LivePreview feature="work-mode-new-screens" fallback={<p>Everyone&apos;s</p>}>
          <p>Newest</p>
        </LivePreview>
      </LiveVersionProvider>,
    );
    expect(screen.queryByText("Newest")).toBeNull();
    expect(screen.getByText("Everyone's")).toBeTruthy();
  });

  it("forgets the choice at sign-out, so the next person starts on their own default", () => {
    writeLiveVersionChoice("everyone");
    expect(document.cookie).toContain("psychsift-live-version=everyone");
    clearAccountScopedBrowserStorage();
    expect(document.cookie).not.toContain("psychsift-live-version");
  });
});
