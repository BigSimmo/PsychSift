import { describe, expect, it, vi } from "vitest";

import { confirmShellNavigation, registerNavigationGuard } from "@/lib/navigation-guards";

describe("shell navigation guard registry", () => {
  it("lets the shell navigate when no page has registered a guard", () => {
    expect(confirmShellNavigation()).toBe(true);
  });

  it("stops at the first guard that says stay, and asks no later guard", () => {
    const stay = vi.fn(() => false);
    const later = vi.fn(() => true);
    const offStay = registerNavigationGuard(stay);
    const offLater = registerNavigationGuard(later);
    expect(confirmShellNavigation()).toBe(false);
    expect(stay).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    offStay();
    offLater();
  });

  it("navigates once every guard agrees, and forgets a guard once it is removed", () => {
    const leave = vi.fn(() => true);
    const off = registerNavigationGuard(leave);
    expect(confirmShellNavigation()).toBe(true);
    expect(leave).toHaveBeenCalledTimes(1);
    off();
    expect(confirmShellNavigation()).toBe(true);
    expect(leave).toHaveBeenCalledTimes(1);
  });
});
