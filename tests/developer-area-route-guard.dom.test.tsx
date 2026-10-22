import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * #L31: DeveloperAreaGate's administrator check runs once, when the shared
 * layout first mounts, and the App Router does not re-run a shared layout for
 * a soft client-side navigation between its own sibling pages. This guard is
 * the fix — it calls router.refresh() on every pathname change so the server
 * tree (DeveloperAreaGate included) is re-fetched with the current session.
 */

const mocks = vi.hoisted(() => ({
  pathname: "/admin/developer-hub",
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: mocks.refresh }),
}));

afterEach(() => {
  cleanup();
  mocks.pathname = "/admin/developer-hub";
  mocks.refresh.mockClear();
});

describe("DeveloperAreaRouteGuard", () => {
  it("does not refresh on the initial mount", async () => {
    const { DeveloperAreaRouteGuard } = await import("@/components/developer-area/developer-area-route-guard");

    render(
      <DeveloperAreaRouteGuard>
        <p>content</p>
      </DeveloperAreaRouteGuard>,
    );

    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("calls router.refresh() when the pathname changes to a sibling hub page", async () => {
    const { DeveloperAreaRouteGuard } = await import("@/components/developer-area/developer-area-route-guard");

    const { rerender } = render(
      <DeveloperAreaRouteGuard>
        <p>content</p>
      </DeveloperAreaRouteGuard>,
    );
    expect(mocks.refresh).not.toHaveBeenCalled();

    mocks.pathname = "/admin/developer-hub/ledger";
    rerender(
      <DeveloperAreaRouteGuard>
        <p>content</p>
      </DeveloperAreaRouteGuard>,
    );

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh again for a re-render at the same pathname", async () => {
    const { DeveloperAreaRouteGuard } = await import("@/components/developer-area/developer-area-route-guard");

    const { rerender } = render(
      <DeveloperAreaRouteGuard>
        <p>content</p>
      </DeveloperAreaRouteGuard>,
    );
    rerender(
      <DeveloperAreaRouteGuard>
        <p>content changed</p>
      </DeveloperAreaRouteGuard>,
    );

    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("always renders its children regardless of refresh state", async () => {
    const { DeveloperAreaRouteGuard } = await import("@/components/developer-area/developer-area-route-guard");

    const { getByText } = render(
      <DeveloperAreaRouteGuard>
        <p>content</p>
      </DeveloperAreaRouteGuard>,
    );

    expect(getByText("content")).toBeInTheDocument();
  });
});
