// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ status: "signed_out" as string }));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({ status: auth.status }),
}));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: () => <div role="dialog" aria-label="Continue to your workspace" />,
}));

import { WorkSignInNotice } from "@/components/mode-kit/work-sign-in-notice";
import { WorkStateLoading, WorkStateNotice } from "@/components/mode-kit/work-state";

afterEach(() => {
  cleanup();
  auth.status = "signed_out";
});

/*
 * The one set of work-mode page states (review 2, item 1): every area draws
 * signed out, no team, empty, offline and a failed read the same way.
 */
describe("WorkStateNotice", () => {
  it("draws every kind as the kit's flat empty card, amber only for offline and a failed read", () => {
    const kinds = ["signed-out", "no-team", "empty", "offline", "error"] as const;
    for (const kind of kinds) {
      const { unmount } = render(<WorkStateNotice kind={kind} title={`Title ${kind}`} testId="state" />);
      const card = screen.getByTestId("state");
      expect(card).toHaveClass("work-card");
      expect(card).toHaveAttribute("data-work-state", kind);
      const badge = card.querySelector(".work-empty__badge");
      expect(badge).toHaveAttribute("aria-hidden", "true");
      if (kind === "offline" || kind === "error") expect(badge).toHaveAttribute("data-tone", "amber");
      else expect(badge).not.toHaveAttribute("data-tone");
      unmount();
    }
  });

  it("announces a failed read as an alert and offline as a status, and leaves the rest quiet", () => {
    const { rerender } = render(<WorkStateNotice kind="error" title="Couldn't load" testId="state" />);
    expect(screen.getByTestId("state")).toHaveAttribute("role", "alert");
    rerender(<WorkStateNotice kind="offline" title="You're offline" testId="state" />);
    expect(screen.getByTestId("state")).toHaveAttribute("role", "status");
    rerender(<WorkStateNotice kind="empty" title="Nothing yet" testId="state" />);
    expect(screen.getByTestId("state")).not.toHaveAttribute("role");
    rerender(<WorkStateNotice kind="signed-out" title="Sign in" role="status" testId="state" />);
    expect(screen.getByTestId("state")).toHaveAttribute("role", "status");
  });

  it("gives signed out the area-colour Sign in, and a failed read a quiet Try again", () => {
    const onSignIn = vi.fn();
    const onRetry = vi.fn();
    const { rerender } = render(<WorkStateNotice kind="signed-out" title="Sign in to see it" onSignIn={onSignIn} />);
    const signIn = screen.getByRole("button", { name: "Sign in" });
    expect(signIn).toHaveAttribute("data-variant", "primary");
    fireEvent.click(signIn);
    expect(onSignIn).toHaveBeenCalledOnce();

    rerender(<WorkStateNotice kind="error" title="Couldn't load" onRetry={onRetry} retryTestId="retry" />);
    const retry = screen.getByTestId("retry");
    expect(retry).toHaveAccessibleName("Try again");
    expect(retry).toHaveAttribute("data-variant", "secondary");
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
    // A Sign in handler means nothing on a failed read, and a retry nothing on signed out.
    rerender(<WorkStateNotice kind="signed-out" title="Sign in" onRetry={onRetry} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("keeps an area's own further action after the built-in one", () => {
    render(
      <WorkStateNotice
        kind="no-team"
        title="No team yet"
        action={<a href="/roster/join">Join a team</a>}
        testId="state"
      />,
    );
    expect(within(screen.getByTestId("state")).getByRole("link", { name: "Join a team" })).toHaveAttribute(
      "href",
      "/roster/join",
    );
  });
});

describe("WorkSignInNotice", () => {
  it("opens the sign-in dialog in place, never a link to another page", () => {
    render(<WorkSignInNotice title="Sign in to see your roster" testId="signed-out" />);
    expect(within(screen.getByTestId("signed-out")).queryByRole("link")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("dialog", { name: "Continue to your workspace" })).toBeInTheDocument();
  });

  it("runs onSignedIn once when a sign-in started here succeeds, and not for one already signed in", () => {
    const onSignedIn = vi.fn();
    const view = render(<WorkSignInNotice title="Sign in" onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignedIn).not.toHaveBeenCalled();
    auth.status = "authenticated";
    view.rerender(<WorkSignInNotice title="Sign in" onSignedIn={onSignedIn} />);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    view.unmount();

    const already = vi.fn();
    render(<WorkSignInNotice title="Sign in" onSignedIn={already} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(already).not.toHaveBeenCalled();
  });
});

describe("WorkStateLoading", () => {
  it("is a grey shape with the words for screen readers only, never a bare Loading line", () => {
    render(<WorkStateLoading label="Loading your teams…" testId="loading" />);
    const status = screen.getByRole("status", { name: "Loading your teams…" });
    expect(status).toHaveAttribute("data-testid", "loading");
    expect(within(status).getByText("Loading your teams…")).toHaveClass("sr-only");
    expect(status.querySelectorAll("[data-skeleton-row]").length).toBe(3);
  });
});
