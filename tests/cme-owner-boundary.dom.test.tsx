/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CmeOwnerBoundary } from "@/components/cme/cme-owner-boundary";

const auth = vi.hoisted(() => ({ status: "loading", session: null as { user: { id: string } } | null }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// The signed-out sample loads on demand; its own behaviour is covered in cme-signed-out-sample.dom.test.tsx.
vi.mock("@/components/cme/cme-signed-out-sample", () => ({
  CmeSignedOutSample: () => <div data-testid="cme-sample-stub">CPD sample</div>,
}));

function asOwner(id: string) {
  auth.status = "authenticated";
  auth.session = { user: { id } };
}

beforeEach(() => {
  auth.status = "loading";
  auth.session = null;
  router.refresh.mockClear();
});
afterEach(cleanup);

describe("CME server-owner boundary", () => {
  it("withholds private server children while client auth is unresolved", () => {
    const view = render(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        Private A record
      </CmeOwnerBoundary>,
    );
    expect(screen.queryByText("Private A record")).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
    asOwner("owner-a");
    view.rerender(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        Private A record
      </CmeOwnerBoundary>,
    );
    expect(screen.getByText("Private A record")).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("immediately unmounts private records on sign-out before the server refresh returns", async () => {
    asOwner("owner-a");
    const view = render(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        Private A record
      </CmeOwnerBoundary>,
    );
    auth.status = "signed_out";
    auth.session = null;
    view.rerender(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        Private A record
      </CmeOwnerBoundary>,
    );
    expect(screen.queryByText("Private A record")).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    view.rerender(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId={null} demoMode={false}>
        Sign in to CME
      </CmeOwnerBoundary>,
    );
    // Signed out now shows the sample, never the server's children.
    await waitFor(() => expect(screen.getByTestId("cme-sample-stub")).toBeTruthy());
    expect(screen.queryByText("Sign in to CME")).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("never keys stale A children as B while waiting for an account-switch response", () => {
    asOwner("owner-a");
    const view = render(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        Private A record
      </CmeOwnerBoundary>,
    );
    asOwner("owner-b");
    view.rerender(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        Private A record
      </CmeOwnerBoundary>,
    );
    expect(screen.queryByText("Private A record")).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    view.rerender(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        Private A record
      </CmeOwnerBoundary>,
    );
    expect(router.refresh).toHaveBeenCalledTimes(1);
    view.rerender(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-b" demoMode={false}>
        Private B record
      </CmeOwnerBoundary>,
    );
    expect(screen.getByText("Private B record")).toBeTruthy();
  });

  it("refreshes a signed-out server page after login and withholds stale children until matching data arrives", () => {
    auth.status = "signed_out";
    const view = render(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId={null} demoMode={false}>
        Old signed-out page
      </CmeOwnerBoundary>,
    );
    asOwner("owner-a");
    view.rerender(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId={null} demoMode={false}>
        Old signed-out page
      </CmeOwnerBoundary>,
    );
    expect(screen.queryByText("Old signed-out page")).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    view.rerender(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        Private A record
      </CmeOwnerBoundary>,
    );
    expect(screen.getByText("Private A record")).toBeTruthy();
  });

  it("remounts drafts when the verified server owner changes, including simultaneous transitions", () => {
    asOwner("owner-a");
    const draft = <input aria-label="Draft title" defaultValue="New entry" />;
    const view = render(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        {draft}
      </CmeOwnerBoundary>,
    );
    fireEvent.change(screen.getByLabelText("Draft title"), { target: { value: "A private draft" } });
    asOwner("owner-b");
    view.rerender(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-b" demoMode={false}>
        {draft}
      </CmeOwnerBoundary>,
    );
    expect((screen.getByLabelText("Draft title") as HTMLInputElement).value).toBe("New entry");
  });

  it.each(["loading", "error", "unconfigured", "expired"])("hides an old owner for auth state %s", (status) => {
    auth.status = status;
    auth.session = { user: { id: "owner-a" } };
    render(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        Private A record
      </CmeOwnerBoundary>,
    );
    expect(screen.queryByText("Private A record")).toBeNull();
  });

  it("withholds a late response for a previous account and requests a matching response", () => {
    asOwner("owner-a");
    const view = render(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        Private A record
      </CmeOwnerBoundary>,
    );
    asOwner("owner-b");
    view.rerender(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        Private A record
      </CmeOwnerBoundary>,
    );
    asOwner("owner-a");
    view.rerender(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
        Private A record
      </CmeOwnerBoundary>,
    );
    view.rerender(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-b" demoMode={false}>
        Late private B record
      </CmeOwnerBoundary>,
    );
    expect(screen.queryByText("Late private B record")).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(3);
  });

  it("bypasses auth only for server-declared synthetic demo content", () => {
    render(
      <CmeOwnerBoundary serverAuthVerified serverOwnerId={null} demoMode={true}>
        Synthetic demo record
      </CmeOwnerBoundary>,
    );
    expect(screen.getByText("Synthetic demo record")).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
    const layout = readFileSync("src/app/(search-app)/cme/layout.tsx", "utf8");
    expect(layout).toContain("const demoMode = isDemoMode()");
    expect(layout).toContain("client.auth.getUser()");
    expect(layout).not.toContain("getSession()");
    expect(layout).toContain("serverOwnerId={serverOwnerId}");
  });
  it("does not mistake a failed server verification for verified signed-out children", () => {
    auth.status = "signed_out";
    render(
      <CmeOwnerBoundary serverAuthVerified={false} serverOwnerId={null} demoMode={false}>
        Unverified server content
      </CmeOwnerBoundary>,
    );
    expect(screen.queryByText("Unverified server content")).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
