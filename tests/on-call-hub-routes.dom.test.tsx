/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call/call",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "signed_out", authEpoch: 1 }) }));
vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => ({
    entries: [],
    loading: false,
    isOffline: false,
    signedOut: true,
    cachedAt: null,
    loadError: null,
    retry: vi.fn(),
    demoMode: false,
  }),
  cacheOnCallEntries: vi.fn(),
}));

import OnCallCallRoute from "@/app/(search-app)/on-call/call/page";
import OnCallFindRoute from "@/app/(search-app)/on-call/find/page";
import OnCallReferRoute from "@/app/(search-app)/on-call/refer/page";
import OnCallWhosOnRoute from "@/app/(search-app)/on-call/whos-on/page";
import { OnCallPlaybookSection } from "@/components/on-call/on-call-playbook-section";
import {
  ON_CALL_HUB_PAGE_HREFS,
  ON_CALL_HUB_PAGE_TITLES,
  type OnCallHubPage,
} from "@/components/on-call/on-call-section-identity";
import { modeSecondaryNavigationRegistry } from "@/lib/mode-secondary-navigation";

const routes: { page: Exclude<OnCallHubPage, "now">; Route: () => ReactElement }[] = [
  { page: "whos-on", Route: OnCallWhosOnRoute },
  { page: "call", Route: OnCallCallRoute },
  { page: "refer", Route: OnCallReferRoute },
  { page: "find", Route: OnCallFindRoute },
];

// Pinned: with no Supabase env, a dev run falls back to the demo handbook, and
// these assertions are about the signed-in handbook's signed-out state.
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false"));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("On Call hub routes", () => {
  it("lists every hub page in the pages sheet at the href the identity map names", () => {
    const hrefs: readonly (string | undefined)[] = modeSecondaryNavigationRegistry["on-call"].map(
      (entry) => entry.href,
    );
    for (const page of Object.keys(ON_CALL_HUB_PAGE_HREFS) as OnCallHubPage[]) {
      expect(hrefs).toContain(ON_CALL_HUB_PAGE_HREFS[page]);
    }
  });

  it.each(routes.map((route) => [route.page, route] as const))(
    "%s renders one h1 named from the identity map",
    (_page, route) => {
      render(<route.Route />);
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 1, name: ON_CALL_HUB_PAGE_TITLES[route.page] })).toBeInTheDocument();
    },
  );

  it.each(routes.map((route) => [route.page, route] as const))(
    "%s shows a signed-out reader the sample hospital instead of a sign-in wall",
    (_page, route) => {
      render(<route.Route />);
      expect(screen.queryByTestId("on-call-handbook-state-signed-out")).toBeNull();
    },
  );

  it("keeps the two personal editors reachable from Call and Refer", () => {
    render(<OnCallCallRoute />);
    expect(screen.getByRole("link", { name: "Your own numbers" })).toHaveAttribute("href", "/on-call/contacts");
    cleanup();
    render(<OnCallReferRoute />);
    expect(screen.getByRole("link", { name: "Your own referrals" })).toHaveAttribute("href", "/on-call/referrals");
  });
});

describe("Playbook", () => {
  it("opens with the Who do I call now? link, as a raised card and never the command fill", () => {
    render(<OnCallPlaybookSection entries={[]} />);
    const link = screen.getByTestId("on-call-playbook-who-do-i-call");
    expect(link).toHaveAttribute("href", "/on-call/now");
    expect(link).toHaveTextContent("Who do I call now?");
    expect(link.className).not.toMatch(/--command/);
  });
});
