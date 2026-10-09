/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/" }));
const auth = vi.hoisted(() => ({ status: "loading", session: null, authEpoch: 1 }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  // Work-mode redesign, owner request 6 Oct 2026: the work frame reads the query.
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));

import { CmeOwnerBoundary } from "@/components/cme/cme-owner-boundary";
import { ModeBand, useModeBandCurrentTab } from "@/components/mode-band/mode-band";
import { TeachingDepthPage } from "@/components/teaching/teaching-depth-page";

const ready = { status: "ready" as const, data: {}, code: null, refreshing: false, retry: () => {} };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("mode band on each mode's pages", () => {
  it("marks First Nations' Bedside tab current on the mode home", () => {
    nav.pathname = "/first-nations";
    render(<ModeBand modeId="first-nations">page</ModeBand>);
    expect(screen.getByRole("link", { name: "Bedside" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the band, with the tapped tab current, on a First Nations page", () => {
    nav.pathname = "/first-nations/contacts";
    render(<ModeBand modeId="first-nations">page</ModeBand>);
    expect(screen.getByTestId("mode-band")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Contacts" })).toHaveAttribute("aria-current", "page");
  });

  it("says CPD is loading in the band while the session is checked, with no record shown", () => {
    nav.pathname = "/cme";
    render(
      <ModeBand modeId="cme" statusSlot={["/cme"]}>
        <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
          Private record
        </CmeOwnerBoundary>
      </ModeBand>,
    );
    expect(screen.getByTestId("mode-band")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Loading your records" })).toBeTruthy();
    expect(screen.queryByText("Private record")).toBeNull();
  });

  it("says CPD is offline in the band when the device is offline", () => {
    nav.pathname = "/cme";
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    render(
      <ModeBand modeId="cme" statusSlot={["/cme"]}>
        <CmeOwnerBoundary serverAuthVerified serverOwnerId="owner-a" demoMode={false}>
          Private record
        </CmeOwnerBoundary>
      </ModeBand>,
    );
    expect(screen.getByTestId("mode-band-status")).toHaveTextContent(/^Offline/);
  });

  it("leaves a Teaching page's name to the band, a child page's and a tab page's alike", () => {
    nav.pathname = "/teaching/review";
    const view = render(
      <ModeBand modeId="teaching">
        <TeachingDepthPage title="Weekly CPD review" demoMode resource={ready} ready>
          body
        </TeachingDepthPage>
      </ModeBand>,
    );
    // Work-mode redesign, owner request 6 Oct 2026: the band now names every Teaching page, More pages
    // included ("Log to CPD"), so a depth page's own h1 is for screen readers only, like a tab's.
    expect(screen.getByRole("heading", { level: 1, name: "Weekly CPD review" })).toHaveClass("sr-only");
    nav.pathname = "/teaching/teach";
    view.rerender(
      <ModeBand modeId="teaching">
        <TeachingDepthPage title="Presenting" demoMode resource={ready} ready>
          body
        </TeachingDepthPage>
      </ModeBand>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Presenting" })).toHaveClass("sr-only");
  });

  it("gives a tab with a short name its full name for screen readers", () => {
    nav.pathname = "/teaching/assessments";
    render(
      <ModeBand modeId="teaching">
        <>page</>
      </ModeBand>,
    );
    const tab = screen.getByRole("link", { name: "Registrar supervision" });
    expect(tab).toHaveAttribute("href", "/teaching/supervision");
    // The row still draws the short name, and only once.
    expect(tab.querySelector("[aria-hidden='true']")).toHaveTextContent(/^Registrar$/);
    expect(screen.queryByRole("link", { name: "Registrar" })).toBeNull();
  });

  it("ticks no Roster tab when My shifts' page draws at /roster", () => {
    // Work-mode redesign, owner request 6 Oct 2026: /roster?view=month draws My shifts' month
    // list, so that page names itself and the Month tab (the month grid) is not marked current.
    function ShiftsAtRoster() {
      useModeBandCurrentTab("shifts");
      return <>page</>;
    }
    nav.pathname = "/roster";
    render(
      <ModeBand modeId="roster">
        <ShiftsAtRoster />
      </ModeBand>,
    );
    expect(screen.getByRole("link", { name: "Month" })).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("work-frame-more")).toHaveAttribute("data-current");
  });
});
