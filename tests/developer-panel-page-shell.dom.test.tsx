import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

import { FreshnessStamp } from "@/components/developer-area/hub/freshness-stamp";
import { PanelPageShell } from "@/components/developer-area/hub/panel-page-shell";
import { resolveFreshnessFrom } from "@/lib/developer-area/freshness";

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
    expect(back).toHaveAttribute("href", "/mockups/development");
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/Repository content as of/);
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});
