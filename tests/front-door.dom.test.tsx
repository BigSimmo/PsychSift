/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FirstRunGuide } from "@/components/front-door/first-run-guide";
import { TermsAcceptancePrompt } from "@/components/front-door/terms-acceptance-prompt";
import { TERMS_PROMPT_ACCEPT_LABEL, TERMS_VERSION } from "@/lib/front-door-content";
import { TERMS_METADATA_KEY } from "@/lib/terms-acceptance";

const updateUser = vi.fn(async () => ({ data: {}, error: null as unknown }));
let auth: {
  status: string;
  session: { user: { id: string; user_metadata: Record<string, unknown> } } | null;
  client: { auth: { updateUser: typeof updateUser } } | null;
};
let pathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));

function signedIn(metadata: Record<string, unknown> = {}) {
  auth = {
    status: "authenticated",
    session: { user: { id: "user-1", user_metadata: metadata } },
    client: { auth: { updateUser } },
  };
}

describe("Terms acceptance prompt", () => {
  beforeEach(() => {
    window.localStorage.clear();
    updateUser.mockClear();
    pathname = "/";
  });
  afterEach(() => cleanup());

  it("shows nothing when signed out", () => {
    auth = { status: "signed_out", session: null, client: null };
    render(<TermsAcceptancePrompt />);
    expect(screen.queryByTestId("terms-acceptance-prompt")).toBeNull();
  });

  it("asks a signed-in user once and records the current version on the account", async () => {
    signedIn();
    render(<TermsAcceptancePrompt />);
    expect(screen.getByRole("link", { name: "Read the full Terms of Use" }).getAttribute("href")).toBe("/terms");
    fireEvent.click(screen.getByRole("button", { name: TERMS_PROMPT_ACCEPT_LABEL }));
    await waitFor(() => expect(screen.queryByTestId("terms-acceptance-prompt")).toBeNull());
    expect(updateUser).toHaveBeenCalledWith({
      data: { [TERMS_METADATA_KEY]: expect.objectContaining({ version: TERMS_VERSION }) },
    });
    expect(window.localStorage.getItem("psychsift:terms-accepted:user-1")).toBe(TERMS_VERSION);
  });

  it("stays hidden for the accepted version and re-prompts for a new one", () => {
    signedIn({ [TERMS_METADATA_KEY]: { version: TERMS_VERSION, acceptedAt: "2026-10-18T00:00:00Z" } });
    const { unmount } = render(<TermsAcceptancePrompt />);
    expect(screen.queryByTestId("terms-acceptance-prompt")).toBeNull();
    unmount();
    signedIn({ [TERMS_METADATA_KEY]: { version: "2020-01-01", acceptedAt: "2020-01-01T00:00:00Z" } });
    render(<TermsAcceptancePrompt />);
    expect(screen.getByTestId("terms-acceptance-prompt")).toBeTruthy();
  });

  it("never covers the terms page itself", () => {
    signedIn();
    pathname = "/terms";
    render(<TermsAcceptancePrompt />);
    expect(screen.queryByTestId("terms-acceptance-prompt")).toBeNull();
  });
});

describe("First-run guide", () => {
  beforeEach(() => {
    window.localStorage.clear();
    updateUser.mockClear();
  });
  afterEach(() => cleanup());

  it("shows three steps and stays dismissed for that user", () => {
    signedIn();
    const { unmount } = render(<FirstRunGuide />);
    expect(screen.getByTestId("first-run-guide").querySelectorAll("li")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the getting started guide" }));
    expect(screen.queryByTestId("first-run-guide")).toBeNull();
    expect(updateUser).toHaveBeenCalledTimes(1);
    unmount();
    render(<FirstRunGuide />);
    expect(screen.queryByTestId("first-run-guide")).toBeNull();
  });

  it("is skipped when the account already dismissed it on another device", () => {
    signedIn({ psychsift_first_run_guide_dismissed: "2026-10-18T00:00:00Z" });
    render(<FirstRunGuide />);
    expect(screen.queryByTestId("first-run-guide")).toBeNull();
  });
});
