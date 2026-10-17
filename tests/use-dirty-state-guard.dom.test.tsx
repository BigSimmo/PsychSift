/** @vitest-environment jsdom */

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDirtyStateGuard } from "@/components/ui/use-dirty-state-guard";
import { confirmShellNavigation } from "@/lib/navigation-guards";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useDirtyStateGuard", () => {
  it("blocks confirmShellNavigation() when dirty and window.confirm returns false", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { rerender } = renderHook(({ isDirty }) => useDirtyStateGuard(isDirty), {
      initialProps: { isDirty: true },
    });

    expect(confirmShellNavigation()).toBe(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    confirmSpy.mockReturnValue(true);
    expect(confirmShellNavigation()).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(2);

    rerender({ isDirty: false });
    expect(confirmShellNavigation()).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });

  it("removes the shell navigation guard and beforeunload listener on unmount", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { unmount } = renderHook(() => useDirtyStateGuard(true, "Discard draft changes?"));

    const beforeUnloadWhileMounted = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnloadWhileMounted);
    expect(beforeUnloadWhileMounted.defaultPrevented).toBe(true);
    expect(confirmShellNavigation()).toBe(false);
    expect(confirmSpy).toHaveBeenCalledWith("Discard draft changes?");

    unmount();

    const beforeUnloadAfterUnmount = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnloadAfterUnmount);
    expect(beforeUnloadAfterUnmount.defaultPrevented).toBe(false);
    expect(confirmShellNavigation()).toBe(true);
  });
});
