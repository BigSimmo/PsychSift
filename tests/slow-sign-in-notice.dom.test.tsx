/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SLOW_SIGN_IN_BODY, SLOW_SIGN_IN_TITLE, SlowSignInNotice } from "@/components/front-door/slow-sign-in-notice";
import { ToastProvider } from "@/components/ui/toast";
import { SLOW_SIGN_IN_COOKIE } from "@/lib/supabase/auth-deadline";

const nav = vi.hoisted(() => ({ pathname: "/my-day" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

// Owner "Build" 27 Oct 2026: when the server's 4 second sign-in limit is reached the page opens as
// signed out, and this note says why instead of leaving the doctor to think they were logged out.

afterEach(() => {
  cleanup();
  nav.pathname = "/my-day";
  document.cookie = `${SLOW_SIGN_IN_COOKIE}=; Path=/; Max-Age=0`;
  vi.restoreAllMocks();
});

function renderNotice() {
  return render(
    <ToastProvider>
      <SlowSignInNotice />
    </ToastProvider>,
  );
}

describe("slow sign-in notice", () => {
  it("says nothing on a normal visit", () => {
    renderNotice();
    expect(screen.queryByText(SLOW_SIGN_IN_TITLE)).toBeNull();
  });

  it("says why the page opened signed out, once, and clears the flag", () => {
    document.cookie = `${SLOW_SIGN_IN_COOKIE}=1; Path=/`;
    renderNotice();
    expect(screen.getByText(SLOW_SIGN_IN_TITLE)).toBeTruthy();
    expect(screen.getByText(SLOW_SIGN_IN_BODY)).toBeTruthy();
    expect(document.cookie).not.toContain(`${SLOW_SIGN_IN_COOKIE}=1`);

    cleanup();
    renderNotice();
    expect(screen.queryByText(SLOW_SIGN_IN_TITLE)).toBeNull();
  });

  it("checks again after an in-app navigation, which passes the proxy again", () => {
    const view = renderNotice();
    expect(screen.queryByText(SLOW_SIGN_IN_TITLE)).toBeNull();

    document.cookie = `${SLOW_SIGN_IN_COOKIE}=1; Path=/`;
    nav.pathname = "/roster";
    view.rerender(
      <ToastProvider>
        <SlowSignInNotice />
      </ToastProvider>,
    );
    expect(screen.getByText(SLOW_SIGN_IN_TITLE)).toBeTruthy();
  });

  it("reloads the page on Try again", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload });
    document.cookie = `${SLOW_SIGN_IN_COOKIE}=1; Path=/`;
    renderNotice();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
