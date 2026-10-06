/** @vitest-environment jsdom */

// CPD signed out: the real screens filled with the invented demo year, in memory only.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CmeOwnerBoundary } from "@/components/cme/cme-owner-boundary";
import { DEMO_CME_ENTRIES } from "@/lib/cme/demo-year";

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

let fetchSpy: ReturnType<typeof vi.fn>;
let storageWrites: string[];

beforeEach(() => {
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
  ])("shows the sample notice and the real screen at %s", async (pathname, search) => {
    nav.pathname = pathname;
    nav.search = search;
    renderBoundary();
    const notice = await screen.findByTestId("cme-signed-out-sample", {}, { timeout: 8000 });
    expect(notice.textContent).toContain("Sample");
    expect(notice.textContent).toContain("doesn’t save");
    expect(screen.queryByTestId("server-children")).toBeNull();
    expect(screen.queryByText(/hidden/i)).toBeNull();
    expect(screen.queryByTestId("cme-sample-unavailable")).toBeNull();
  });

  it("shows a sample activity on the entry page for a sample id", async () => {
    const entry = DEMO_CME_ENTRIES[0];
    nav.pathname = `/cme/log/${entry.id}`;
    renderBoundary();
    await screen.findByTestId("cme-signed-out-sample", {}, { timeout: 8000 });
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
    expect(await screen.findByTestId("cme-signed-out-sample", {}, { timeout: 8000 })).toBeTruthy();
  });

  it("says plainly that a page outside the sample needs sign-in", async () => {
    nav.pathname = "/cme/customise";
    renderBoundary();
    await screen.findByTestId("cme-signed-out-sample", {}, { timeout: 8000 });
    expect(screen.getByTestId("cme-sample-unavailable").textContent).toContain("not part of the sample");
  });

  it("makes no network call and no browser-storage write on any sample page", async () => {
    for (const pathname of ["/cme", "/cme/log", "/cme/routines", "/cme/summary", "/cme/new", "/cme/training"]) {
      nav.pathname = pathname;
      const view = renderBoundary();
      await screen.findByTestId("cme-signed-out-sample", {}, { timeout: 8000 });
      view.unmount();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageWrites).toEqual([]);
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
