import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `DeveloperAreaGate` is the administrator gate every developer-gated layout
 * wraps its children in. #L30 was a single public build-time flag
 * (`NEXT_PUBLIC_MOCKUPS_ENABLED=true`), set alone, disabling the gate in
 * production. `tests/developer-area-access.test.ts` proves the pure
 * `developerGateBypassAllowed()` predicate directly; this file proves the
 * gate component actually consults it — and falls through to
 * `resolveDeveloperAccessState()` otherwise — end to end.
 *
 * It also covers the passwordless link credential (`developerLinkAccessGranted`,
 * the `?devkey=…` cookie): that it opens the subtree without a Supabase call,
 * and that it is additive — an unauthorised visitor holding no cookie still
 * meets the gate screen exactly as before.
 */

const mocks = vi.hoisted(() => ({
  bypassAllowed: false,
  accessResult: {
    state: "authorized" as "authorized" | "unauthenticated" | "unauthorized",
    email: null as string | null,
  },
  linkAccessGranted: false,
  pathname: "/admin/developer-hub",
  developerAreaPath: null as string | null,
  routerRefresh: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => mocks.developerAreaPath })),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: mocks.routerRefresh }),
}));

vi.mock("@/lib/developer-area/access", () => ({
  developerGateBypassAllowed: vi.fn(() => mocks.bypassAllowed),
  developerLinkAccessGranted: vi.fn(async () => mocks.linkAccessGranted),
  resolveDeveloperAccessState: vi.fn(async () => mocks.accessResult),
}));

vi.mock("@/components/developer-area/developer-gate-screen", () => ({
  DeveloperGateScreen: ({
    state,
    next,
    keyEntryEnabled,
    keyRejected,
  }: {
    state: string;
    next: string;
    keyEntryEnabled?: boolean;
    keyRejected?: boolean;
  }) => (
    <div
      data-testid="gate-screen"
      data-next={next}
      data-key-entry={String(Boolean(keyEntryEnabled))}
      data-key-rejected={String(Boolean(keyRejected))}
    >
      {state}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.bypassAllowed = false;
  mocks.linkAccessGranted = false;
  mocks.accessResult = { state: "authorized", email: null };
  mocks.pathname = "/admin/developer-hub";
  mocks.developerAreaPath = null;
  delete process.env.DEVELOPER_AREA_ACCESS_KEY;
  mocks.routerRefresh.mockClear();
});

describe("DeveloperAreaGate", () => {
  it("renders children without checking access when developerGateBypassAllowed() reports true", async () => {
    mocks.bypassAllowed = true;
    const { developerGateBypassAllowed, resolveDeveloperAccessState } = await import("@/lib/developer-area/access");
    const { DeveloperAreaGate } = await import("@/components/developer-area/developer-area-gate");

    render(await DeveloperAreaGate({ children: <p data-testid="protected">secret</p> }));

    expect(screen.getByTestId("protected")).toBeInTheDocument();
    expect(developerGateBypassAllowed).toHaveBeenCalledTimes(1);
    expect(resolveDeveloperAccessState).not.toHaveBeenCalled();
  });

  it("renders children when the bypass is refused but resolveDeveloperAccessState reports authorized", async () => {
    mocks.bypassAllowed = false;
    mocks.accessResult = { state: "authorized", email: "josh@stoicable.com" };
    const { DeveloperAreaGate } = await import("@/components/developer-area/developer-area-gate");

    render(await DeveloperAreaGate({ children: <p data-testid="protected">secret</p> }));

    expect(screen.getByTestId("protected")).toBeInTheDocument();
  });

  it("wraps authorized children in DeveloperAreaRouteGuard so a sibling-page navigation re-validates access (#L31)", async () => {
    mocks.bypassAllowed = false;
    mocks.accessResult = { state: "authorized", email: "josh@stoicable.com" };
    const { DeveloperAreaGate } = await import("@/components/developer-area/developer-area-gate");

    const { rerender } = render(await DeveloperAreaGate({ children: <p data-testid="protected">secret</p> }));
    expect(mocks.routerRefresh).not.toHaveBeenCalled();

    mocks.pathname = "/admin/developer-hub/ledger";
    rerender(await DeveloperAreaGate({ children: <p data-testid="protected">secret</p> }));

    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows the sign-in screen instead of children when the bypass is refused and the visitor is unauthenticated (#L30)", async () => {
    mocks.bypassAllowed = false;
    mocks.accessResult = { state: "unauthenticated", email: null };
    const { DeveloperAreaGate } = await import("@/components/developer-area/developer-area-gate");

    render(await DeveloperAreaGate({ children: <p data-testid="protected">secret</p> }));

    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
    expect(screen.getByTestId("gate-screen")).toHaveTextContent("unauthenticated");
  });

  it("shows the access-denied screen for a signed-in non-administrator", async () => {
    mocks.bypassAllowed = false;
    mocks.accessResult = { state: "unauthorized", email: "someone-else@example.com" };
    const { DeveloperAreaGate } = await import("@/components/developer-area/developer-area-gate");

    render(await DeveloperAreaGate({ children: <p data-testid="protected">secret</p> }));

    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
    expect(screen.getByTestId("gate-screen")).toHaveTextContent("unauthorized");
  });
});

describe("DeveloperAreaGate passwordless link access", () => {
  it("renders children on a valid access cookie without consulting Supabase at all", async () => {
    mocks.linkAccessGranted = true;
    // Would render the gate screen if the link credential were ignored, so this
    // proves the cookie is what admitted the visitor.
    mocks.accessResult = { state: "unauthenticated", email: null };
    const { resolveDeveloperAccessState } = await import("@/lib/developer-area/access");
    const { DeveloperAreaGate } = await import("@/components/developer-area/developer-area-gate");
    // The module factory's mock is shared across this file, so its call count
    // carries earlier tests' calls; clear it so the assertion below is about
    // this render only.
    vi.mocked(resolveDeveloperAccessState).mockClear();

    render(await DeveloperAreaGate({ children: <p data-testid="protected">secret</p> }));

    expect(screen.getByTestId("protected")).toBeInTheDocument();
    expect(screen.queryByTestId("gate-screen")).not.toBeInTheDocument();
    // Checked first and short-circuits: the common case costs no provider call.
    expect(resolveDeveloperAccessState).not.toHaveBeenCalled();
  });

  it("still shows the gate screen when no cookie is held, so the credential is additive only", async () => {
    mocks.linkAccessGranted = false;
    mocks.accessResult = { state: "unauthorized", email: "someone-else@example.com" };
    const { DeveloperAreaGate } = await import("@/components/developer-area/developer-area-gate");

    render(await DeveloperAreaGate({ children: <p data-testid="protected">secret</p> }));

    expect(screen.queryByTestId("protected")).not.toBeInTheDocument();
    expect(screen.getByTestId("gate-screen")).toHaveTextContent("unauthorized");
  });
});

describe("DeveloperAreaGate developer-key field wiring", () => {
  // The gate decides whether the key field is offered at all, because only the
  // server can see DEVELOPER_AREA_ACCESS_KEY. What crosses to the Client
  // Component must be that decision, never the key.
  it("offers the key field only when a key of sufficient strength is configured", async () => {
    mocks.accessResult = { state: "unauthenticated", email: null };
    const { DeveloperAreaGate } = await import("@/components/developer-area/developer-area-gate");

    render(await DeveloperAreaGate({ children: <p data-testid="protected">secret</p> }));
    expect(screen.getByTestId("gate-screen")).toHaveAttribute("data-key-entry", "false");
    cleanup();

    // One character short of the floor is still "unconfigured", so the field
    // stays hidden rather than promising an unlock that can never happen.
    process.env.DEVELOPER_AREA_ACCESS_KEY = "developer-area-test-key".padEnd(31, "-");
    render(await DeveloperAreaGate({ children: <p data-testid="protected">secret</p> }));
    expect(screen.getByTestId("gate-screen")).toHaveAttribute("data-key-entry", "false");
    cleanup();

    process.env.DEVELOPER_AREA_ACCESS_KEY = "developer-area-test-key".padEnd(32, "-");
    render(await DeveloperAreaGate({ children: <p data-testid="protected">secret</p> }));
    const gateScreen = screen.getByTestId("gate-screen");
    expect(gateScreen).toHaveAttribute("data-key-entry", "true");
    // The secret itself must not appear anywhere in what is sent to the browser.
    expect(document.body.innerHTML).not.toContain("developer-area-test-key");
  });

  it("passes the proxy's rejection through and hands back a target without the marker", async () => {
    mocks.accessResult = { state: "unauthenticated", email: null };
    mocks.developerAreaPath = "/admin/developer-hub?tab=risk&devkeyerror=1";
    const { DeveloperAreaGate } = await import("@/components/developer-area/developer-area-gate");

    render(await DeveloperAreaGate({ children: <p data-testid="protected">secret</p> }));

    const gateScreen = screen.getByTestId("gate-screen");
    expect(gateScreen).toHaveAttribute("data-key-rejected", "true");
    // The retry, and the eventual success, land on a clean URL.
    expect(gateScreen).toHaveAttribute("data-next", "/admin/developer-hub?tab=risk");
  });
});
