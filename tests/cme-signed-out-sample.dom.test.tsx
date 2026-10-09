/** @vitest-environment jsdom */

// CPD signed out: the real screens filled with the invented demo year, in memory
// only, while the example data switch shows examples (auto mode does for a
// signed-out visitor). The frame's banner says it is made up, so the sample has
// no notice of its own. Switch off, the visitor gets the plain sign-in state.

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CmeOwnerBoundary } from "@/components/cme/cme-owner-boundary";
import { DEMO_CME_ENTRIES } from "@/lib/cme/demo-year";
import { resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";

const auth = vi.hoisted(() => ({ status: "signed_out", session: null as { user: { id: string } } | null }));
const nav = vi.hoisted(() => ({ pathname: "/cme", search: "" }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({
  AccountSetupDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="account-dialog" /> : null),
}));
vi.mock("@/components/clinical-dashboard/phone-header-collapse-portal", () => ({
  PhoneHeaderCollapsePortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderBoundary(serverVerified = true) {
  return render(
    <CmeOwnerBoundary serverAuthVerified={serverVerified} serverOwnerId={null} demoMode={false}>
      <div data-testid="server-children">Server page for a signed-out visitor</div>
    </CmeOwnerBoundary>,
  );
}

/** The sample has loaded (its module is downloaded on demand) in place of the server page. */
async function sampleShown() {
  await waitFor(() => expect(screen.queryByTestId("cme-sample-loading")).toBeNull(), { timeout: 8000 });
  expect(screen.queryByTestId("server-children")).toBeNull();
  expect(screen.queryByTestId("cme-signed-out")).toBeNull();
}

let fetchSpy: ReturnType<typeof vi.fn>;
let storageWrites: string[];

beforeEach(() => {
  window.localStorage.clear();
  resetExampleDataForTests();
  auth.status = "signed_out";
  auth.session = null;
  nav.pathname = "/cme";
  nav.search = "";
  fetchSpy = vi.fn(() => Promise.reject(new Error("the sample must not fetch")));
  vi.stubGlobal("fetch", fetchSpy);
  storageWrites = [];
  for (const proto of [Storage.prototype]) {
    vi.spyOn(proto, "setItem").mockImplementation((key: string) => {
      storageWrites.push(key);
    });
    vi.spyOn(proto, "removeItem").mockImplementation((key: string) => {
      storageWrites.push(key);
    });
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CPD signed-out sample", () => {
  it.each([
    ["/cme", "", "Annual CPD hours"],
    ["/cme/log", "", ""],
    ["/cme/routines", "", ""],
    ["/cme/calendar", "", ""],
    ["/cme/summary", "", ""],
    ["/cme/training", "", ""],
    ["/cme/new", "", ""],
    ["/cme/setup", "", ""],
  ])("shows the real screen from the sample, with no notice of its own, at %s", async (pathname, search) => {
    nav.pathname = pathname;
    nav.search = search;
    renderBoundary();
    await sampleShown();
    expect(screen.queryByTestId("cme-signed-out-sample")).toBeNull();
    expect(screen.queryByText(/hidden/i)).toBeNull();
    expect(screen.queryByTestId("cme-sample-unavailable")).toBeNull();
  });

  it("shows a sample activity on the entry page for a sample id", async () => {
    const entry = DEMO_CME_ENTRIES[0];
    nav.pathname = `/cme/log/${entry.id}`;
    renderBoundary();
    await sampleShown();
    expect((await screen.findAllByText(entry.title)).length).toBeGreaterThan(0);
  });

  it("shows the mock-up's registrar on Training, and the junior doctor with ?example=intern", async () => {
    nav.pathname = "/cme/training";
    const view = renderBoundary();
    expect((await screen.findByTestId("cme-training-epas-figure", {}, { timeout: 8000 })).textContent).toContain(
      "1 of 2",
    );
    view.unmount();
    nav.search = "example=intern";
    renderBoundary();
    expect(
      (await screen.findByTestId("cme-training-epa-assessments-figure", {}, { timeout: 8000 })).textContent,
    ).toContain("7");
    expect(screen.queryByTestId("cme-training-epas")).toBeNull();
  });

  it("shows the sample even when the server could not verify a session", async () => {
    renderBoundary(false);
    await sampleShown();
  });

  it("says plainly that a page outside the sample needs sign-in", async () => {
    nav.pathname = "/cme/customise";
    renderBoundary();
    await sampleShown();
    expect(screen.getByTestId("cme-sample-unavailable").textContent).toContain("not part of the example data");
  });

  it("makes no network call and no browser-storage write on any sample page", async () => {
    for (const pathname of ["/cme", "/cme/log", "/cme/routines", "/cme/summary", "/cme/new", "/cme/training"]) {
      nav.pathname = pathname;
      const view = renderBoundary();
      await sampleShown();
      view.unmount();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageWrites).toEqual([]);
  });

  it("gives a signed-out visitor who turned example data off the plain sign-in state, never server children", async () => {
    act(() => setExampleDataOn(false));
    renderBoundary();
    const signedOut = screen.getByTestId("cme-signed-out");
    expect(signedOut.textContent).toContain("Sign in to see your CPD record");
    expect(screen.queryByTestId("server-children")).toBeNull();
    act(() => screen.getByRole("button", { name: "Sign in" }).click());
    expect(await screen.findByTestId("account-dialog")).toBeTruthy();
  });

  it("leaves a signed-in reader unchanged: server children, no sample", () => {
    auth.status = "authenticated";
    auth.session = { user: { id: "owner-a" } };
    render(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        <div data-testid="server-children">Private record</div>
      </CmeOwnerBoundary>,
    );
    expect(screen.getByTestId("server-children")).toBeTruthy();
    expect(screen.queryByTestId("cme-signed-out-sample")).toBeNull();
  });
});
