/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOpenReminders } from "@/components/work-frame/two-pane-side-strip";
import { registerNavigationGuard } from "@/lib/navigation-guards";

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/psychiatry/safety-plan",
}));

afterEach(() => {
  router.push.mockReset();
});

describe("side menu Reminders shortcut", () => {
  it("stays on a page with unsaved work when the reader says stay", () => {
    const remove = registerNavigationGuard(() => false);
    const { result } = renderHook(() => useOpenReminders());
    act(() => result.current());
    expect(router.push).not.toHaveBeenCalled();
    remove();
  });

  it("goes to My Day when nothing holds the reader", () => {
    const { result } = renderHook(() => useOpenReminders());
    act(() => result.current());
    expect(router.push).toHaveBeenCalledWith("/my-day");
  });
});
