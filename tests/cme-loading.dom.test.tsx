import { readFileSync } from "node:fs";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/(search-app)/cme/loading";
import LogLoading from "@/app/(search-app)/cme/log/loading";
import CalendarLoading from "@/app/(search-app)/cme/calendar/loading";
import TrainingLoading from "@/app/(search-app)/cme/training/loading";
import LearningLoading from "@/app/(search-app)/cme/learning/loading";
import RoutinesLoading from "@/app/(search-app)/cme/routines/loading";
import NewLoading from "@/app/(search-app)/cme/new/loading";
import CustomiseLoading from "@/app/(search-app)/cme/customise/loading";
import EntryLoading from "@/app/(search-app)/cme/log/[id]/loading";

const CLEARANCE = "pb-[calc(max(1rem,env(safe-area-inset-bottom))+6rem)]";

describe("CPD loading state", () => {
  it("draws the Year page's shapes in its order: header, summary card, the button, chips, 52 px rows", () => {
    const { container } = render(<Loading />);
    const status = screen.getByRole("status", { name: "Loading your CPD record" });
    expect(status.className).toContain(CLEARANCE);
    expect(status.className).toContain("max-w-5xl");
    expect(screen.getByTestId("cme-loading-lead").className).toContain("lg:grid-cols-");
    expect(screen.getByTestId("cme-loading-header").className).toMatch(/\bh-12\b/);
    // A plain outlined card at the container radius, like the loaded summary: no dark panel.
    const hero = screen.getByTestId("cme-loading-hero");
    expect(hero.className).toMatch(/\brounded-lg\b/);
    expect(hero.className).not.toContain("--surface-summary");
    expect(screen.getByTestId("cme-loading-card").className).toMatch(/\bh-12\b/);
    expect(screen.getAllByTestId("cme-loading-chip")).toHaveLength(2);
    const rows = container.querySelectorAll<HTMLElement>('[data-testid="cme-loading-rows"] [data-skeleton-row]');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.className).toMatch(/\bmin-h-13\b/);
    const inOrder = ["cme-loading-header", "cme-loading-hero", "cme-loading-card", "cme-loading-rows"].map((id) =>
      screen.getByTestId(id),
    );
    for (let index = 1; index < inOrder.length; index += 1) {
      expect(
        inOrder[index - 1]!.compareDocumentPosition(inOrder[index]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("gives the Log its own list shapes, never Today's hero", () => {
    const { container } = render(<LogLoading />);
    expect(screen.getByRole("status", { name: "Loading your CPD log" }).className).toContain(CLEARANCE);
    expect(screen.queryByTestId("cme-loading-hero")).toBeNull();
    expect(container.querySelectorAll('[data-testid="cme-log-loading-rows"] [data-skeleton-row]')).toHaveLength(6);
  });

  it("shows page-shaped static placeholders for Calendar and Training", () => {
    const calendar = render(<CalendarLoading />);
    expect(screen.getByRole("status", { name: "Loading your CPD calendar" })).toBeInTheDocument();
    expect(calendar.container.querySelector(".h-80")).toBeInTheDocument();
    expect(screen.queryByTestId("cme-loading-hero")).toBeNull();
    calendar.unmount();

    const training = render(<TrainingLoading />);
    expect(screen.getByRole("status", { name: "Loading your CPD training" })).toBeInTheDocument();
    expect(training.container.querySelectorAll(".h-36")).toHaveLength(2);
    training.unmount();
  });

  it("gives the pages that used to inherit Today's skeleton their own shapes", () => {
    const pages = [
      [LearningLoading, "Loading your CPD learning"],
      [RoutinesLoading, "Loading your CPD routines"],
      [NewLoading, "Loading the activity form"],
      [CustomiseLoading, "Loading your dashboard choices"],
      [EntryLoading, "Loading this activity"],
    ] as const;
    for (const [Page, name] of pages) {
      const { container, unmount } = render(<Page />);
      expect(screen.getByRole("status", { name })).toBeInTheDocument();
      expect(screen.queryByTestId("cme-loading-hero")).toBeNull();
      expect(container.firstElementChild?.className).toContain(CLEARANCE);
      unmount();
    }
    render(<NewLoading />);
    expect(screen.getByTestId("cme-new-loading-fields")).toBeInTheDocument();
  });

  it("is static: no shimmer, no animation, no transition", () => {
    for (const Page of [
      Loading,
      LogLoading,
      LearningLoading,
      RoutinesLoading,
      NewLoading,
      CustomiseLoading,
      EntryLoading,
    ]) {
      const { container, unmount } = render(<Page />);
      const moving = [...container.querySelectorAll<HTMLElement>("[class]")].filter((node) =>
        /animate-|shimmer|\btransition\b/.test(node.getAttribute("class") ?? ""),
      );
      expect(moving.map((node) => node.getAttribute("class"))).toEqual([]);
      unmount();
    }
  });

  it("no longer borrows the generic mode-home skeleton", () => {
    expect(readFileSync("src/app/(search-app)/cme/loading.tsx", "utf8")).not.toContain("ModeHomeRouteLoading");
  });
});
