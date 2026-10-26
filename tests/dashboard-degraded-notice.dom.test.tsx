import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DegradedNoticeFrame } from "@/components/clinical-dashboard/dashboard-notices";
import { readPrimitiveRecipeSources } from "../scripts/design-system-contract-utils.mjs";

describe("DegradedNoticeFrame", () => {
  it("reserves the notice frame only for the centred home surface", () => {
    const dashboardSource = readFileSync(resolve(process.cwd(), "src/components/ClinicalDashboard.tsx"), "utf8");
    const frameIndex = dashboardSource.indexOf("<DegradedNoticeFrame");
    const heroIndex = dashboardSource.indexOf("<section", frameIndex);

    expect(dashboardSource).toContain(
      "<DegradedNoticeFrame visible={showDegradedNotice} isOnline={isOnline} reserveSpace={centeredModeHome} />",
    );
    expect(dashboardSource).not.toContain("showDegradedNotice || centeredModeHome ? (");
    expect(frameIndex).toBeGreaterThanOrEqual(0);
    expect(heroIndex).toBeGreaterThan(frameIndex);
  });

  it("keeps a stable frame while exposing alert semantics only for degraded content", () => {
    const drawerSource = readFileSync(
      resolve(process.cwd(), "src/components/clinical-dashboard/dashboard-shell.tsx"),
      "utf8",
    );
    const primitivesSource = readPrimitiveRecipeSources();
    expect(drawerSource).toContain('"flex min-h-[56px]');
    expect(drawerSource).toContain("rounded-lg px-4 py-3 text-left");
    expect(primitivesSource).toMatch(/iconTilePremium\s*=\s*\n\s*"[^"]*h-9 w-9/);
    expect(primitivesSource).toMatch(/panelSubtle\s*=\s*\n\s*"[^"]*border border-/);

    // Mobile: max(56px minimum, 36px icon + 24px block padding) = 60px.
    // Desktop: the bordered details panel adds 2px, so 62px is the stable max.
    const collapsedDrawerMaximumPx = Math.max(56, 36 + 2 * 12) + 2;
    expect(collapsedDrawerMaximumPx).toBe(62);

    const { rerender } = render(<DegradedNoticeFrame visible={false} isOnline reserveSpace />);

    const reservedEmpty = screen.getByTestId("dashboard-degraded-notice-frame");
    expect(reservedEmpty).toHaveClass("sm:min-h-[3.875rem]", "max-sm:h-0");
    expect(reservedEmpty).not.toHaveClass("min-h-[3.875rem]");
    expect(reservedEmpty).toHaveAttribute("data-visible", "false");
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();

    rerender(<DegradedNoticeFrame visible isOnline={false} />);

    const overlayFrame = screen.getByTestId("dashboard-degraded-notice-frame");
    expect(overlayFrame).toHaveClass("h-0", "!mt-0");
    expect(overlayFrame).toHaveAttribute("data-visible", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Offline");

    rerender(<DegradedNoticeFrame visible isOnline reserveSpace />);

    const reservedFrame = screen.getByTestId("dashboard-degraded-notice-frame");
    expect(reservedFrame).toHaveClass("sm:min-h-[3.875rem]", "max-sm:h-0");
    expect(screen.getByRole("alert")).toHaveTextContent("Service unavailable");

    rerender(<DegradedNoticeFrame visible={false} isOnline />);

    expect(screen.queryByTestId("dashboard-degraded-notice-frame")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("keeps the same alert live region mounted so inserted notices are announced", () => {
    const { rerender } = render(<DegradedNoticeFrame visible={false} isOnline />);
    const region = screen.getByRole("alert");
    expect(region).toHaveClass("sr-only");
    expect(region).toBeEmptyDOMElement();

    rerender(<DegradedNoticeFrame visible isOnline={false} />);
    expect(screen.getByRole("alert")).toBe(region);
    expect(region).toHaveTextContent("Offline");

    rerender(<DegradedNoticeFrame visible isOnline reserveSpace />);
    expect(screen.getByRole("alert")).toBe(region);
    expect(region).toHaveTextContent("Service unavailable");
  });
});
