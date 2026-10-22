import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FreshnessStamp } from "@/components/developer-area/hub/freshness-stamp";
import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import { formatRelativeAge, resolveFreshnessFrom, resolveLiveFreshness } from "@/lib/developer-area/freshness";

// PanelPageShell's back control is a ContextualBackLink, which calls
// next/navigation's useRouter for its history-aware click handler. Outside an
// app-router tree that throws "invariant expected app router to be mounted",
// so every render here needs the router mocked, same as the hub page test.
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/developer-hub/corpus-health",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

const NOW = new Date("2026-08-22T12:00:00.000Z");

describe("resolveFreshnessFrom", () => {
  it("reports the age in whole hours", () => {
    const freshness = resolveFreshnessFrom("2026-08-22T09:00:00.000Z", NOW);
    expect(freshness.contentAt).toBe("2026-08-22T09:00:00.000Z");
    expect(freshness.viewedAt).toBe(NOW.toISOString());
    expect(freshness.ageHours).toBe(3);
  });

  it("returns a null age for a missing content date", () => {
    expect(resolveFreshnessFrom(null, NOW).ageHours).toBeNull();
  });

  it("returns a null age for an unparseable content date rather than NaN", () => {
    // A NaN age reaching the stamp would render "NaN hours old" beside a
    // confident-looking timestamp, which is the one thing the stamp exists to
    // prevent. Guard here, not only in the formatter.
    expect(resolveFreshnessFrom("not-a-date", NOW).ageHours).toBeNull();
  });

  it("formats relative intervals cleanly without 0 hours ago (#FDST2Q)", () => {
    expect(formatRelativeAge(10_000)).toBe("just now");
    expect(formatRelativeAge(59_000)).toBe("just now");
    expect(formatRelativeAge(120_000)).toBe("< 1 hour ago");
    expect(formatRelativeAge(3_500_000)).toBe("< 1 hour ago");
    expect(formatRelativeAge(3_600_000)).toBe("1 hour ago");
    expect(formatRelativeAge(7_200_000)).toBe("2 hours ago");
  });

  it("creates live freshness with mode live (#XKS6FD)", () => {
    const live = resolveLiveFreshness(null, NOW);
    expect(live.mode).toBe("live");
    expect(live.contentAt).toBeNull();
    expect(live.viewedAt).toBe(NOW.toISOString());
  });
});

describe("FreshnessStamp label", () => {
  it("says Ledger when no label is given, so Phase 1 is unchanged", () => {
    render(<FreshnessStamp freshness={resolveFreshnessFrom("2026-08-22T09:00:00.000Z", NOW)} />);
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Ledger content as of/);
  });

  it("uses the given label in both the known and unknown branches", () => {
    const { unmount } = render(
      <FreshnessStamp freshness={resolveFreshnessFrom("2026-08-22T09:00:00.000Z", NOW)} label="Repository" />,
    );
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Repository content as of/);
    unmount();

    render(<FreshnessStamp freshness={resolveFreshnessFrom(null, NOW)} label="Repository" />);
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Repository revision unknown/);
  });

  it("renders live status when mode is live (#XKS6FD)", () => {
    render(<FreshnessStamp freshness={resolveLiveFreshness(null, NOW)} label="Ingestion jobs" />);
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Ingestion jobs read live on demand/);
  });
});

describe("PanelPageShell", () => {
  it("renders a titled main, a back link to the hub, and the stamp", () => {
    render(
      <PanelPageShell
        testId="developer-routes"
        title="Routes and modes"
        freshness={resolveFreshnessFrom("2026-08-22T09:00:00.000Z", NOW)}
        freshnessLabel="Repository"
      >
        <p>body</p>
      </PanelPageShell>,
    );

    expect(screen.getByTestId("developer-routes")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Routes and modes" })).toBeInTheDocument();
    const back = screen.getByTestId("developer-routes-back");
    expect(back).toHaveAttribute("href", "/admin/developer-hub");
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Repository content as of/);
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("requires freshnessLabel on every caller, so a new page cannot silently inherit FreshnessStamp's Ledger default", () => {
    // Structural guard, checked at compile time. `FreshnessStamp` defaults its
    // own `label` to "Ledger" for Phase 1's direct call site, and that default
    // is exactly what must not leak through the shell: a page that forgot to
    // pass its own `freshnessLabel` would silently render "Ledger content as
    // of …" over data that is not the ledger. If `freshnessLabel` ever regains
    // a `?`, `FreshnessLabelIsOptional` flips to `true` and the assignment
    // below fails `npm run typecheck` — this test does not need to run to
    // catch the regression, only to exist.
    type ShellProps = Parameters<typeof PanelPageShell>[0];
    type FreshnessLabelIsOptional = undefined extends ShellProps["freshnessLabel"] ? true : false;
    const isOptional: FreshnessLabelIsOptional = false;
    expect(isOptional).toBe(false);
  });
});
