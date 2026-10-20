/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SIGN_IN_ENDED_BODY, SignInEndedNotice } from "@/components/front-door/sign-in-ended-notice";
import { ToastProvider } from "@/components/ui/toast";

// Design audit D-04 (owner yes 19 Oct 2026): an ended sign-in still clears this device's private
// notes, but now says so.
let clearedAt: number | null = null;
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ deviceDataClearedAt: clearedAt }) }));

afterEach(() => {
  cleanup();
  clearedAt = null;
});

function renderNotice() {
  return render(
    <ToastProvider>
      <SignInEndedNotice />
    </ToastProvider>,
  );
}

describe("sign-in ended notice", () => {
  it("says nothing while nothing was cleared", () => {
    renderNotice();
    expect(screen.queryByText(SIGN_IN_ENDED_BODY)).toBeNull();
  });

  it("says once, and keeps saying until dismissed, that an ended sign-in cleared this device", () => {
    clearedAt = 1_760_000_000_000;
    const view = renderNotice();
    expect(screen.getByText("Your sign-in ended")).toBeTruthy();
    expect(screen.getByText(SIGN_IN_ENDED_BODY)).toBeTruthy();
    act(() => {
      view.rerender(
        <ToastProvider>
          <SignInEndedNotice />
        </ToastProvider>,
      );
    });
    expect(screen.getAllByText(SIGN_IN_ENDED_BODY)).toHaveLength(1);
  });

  it("takes the notice down once the reader signs in again", () => {
    clearedAt = 1_760_000_000_000;
    const view = renderNotice();
    expect(screen.getByText(SIGN_IN_ENDED_BODY)).toBeTruthy();
    clearedAt = null;
    act(() => {
      view.rerender(
        <ToastProvider>
          <SignInEndedNotice />
        </ToastProvider>,
      );
    });
    expect(screen.queryByText(SIGN_IN_ENDED_BODY)).toBeNull();
  });
});
