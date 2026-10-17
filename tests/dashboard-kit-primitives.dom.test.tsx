// @vitest-environment jsdom

import { Calendar } from "lucide-react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashCard } from "@/components/dashboard-kit/dash-card";
import { DashAvatar, DashTag, IconChip } from "@/components/dashboard-kit/icon-chip";
import { DashItemList, DashItemRow } from "@/components/dashboard-kit/item-row";
import { DashPill } from "@/components/dashboard-kit/pill";
import { DashQuickActions } from "@/components/dashboard-kit/quick-actions";
import { ProgressRing, RingStack } from "@/components/dashboard-kit/rings";
import { DashSegmented } from "@/components/dashboard-kit/segmented";
import { DashStatTile } from "@/components/dashboard-kit/stat-tile";
import { DashWeekTiles, type DashWeekDay } from "@/components/dashboard-kit/week-tiles";

describe("dashboard-kit primitives", () => {
  it("renders DashCard in default, hero, and edit modes with accessible Hide action", () => {
    const onHide = vi.fn();
    render(
      <DashCard title="This week" aside={<span>All 7</span>} tone="hero" onHide={onHide} testId="week-card">
        <p>Card body</p>
      </DashCard>,
    );

    const card = screen.getByTestId("week-card");
    expect(card).toHaveAttribute("data-tone", "hero");
    expect(screen.getByRole("heading", { name: "This week" })).toBeInTheDocument();
    expect(screen.getByText("All 7")).toBeInTheDocument();

    const hideButton = screen.getByRole("button", { name: "Hide This week" });
    fireEvent.click(hideButton);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("renders IconChip, DashTag, and DashAvatar across tint variants", () => {
    const { container } = render(
      <div>
        <IconChip tint="amber" size="md">
          CPD
        </IconChip>
        <DashTag tint="green">On this device</DashTag>
        <DashAvatar initials="JS" tint="blue" />
      </div>,
    );

    expect(screen.getByText("On this device")).toBeInTheDocument();
    expect(container.textContent).toContain("CPD");
    expect(container.textContent).toContain("JS");
  });

  it("renders DashItemList, DashItemRow, and DashPill links and buttons", () => {
    const onAction = vi.fn();
    render(
      <DashItemList testId="items-list">
        <DashItemRow
          testId="item-row-1"
          chip={<IconChip tint="amber">EXP</IconChip>}
          title="AHPRA registration"
          subtitle="Passed 2 days ago"
          subtitleTone="passed"
          actions={
            <>
              <DashPill href="/admin" testId="pill-link" emphasis="primary">
                Open
              </DashPill>
              <DashPill onClick={onAction} testId="pill-button">
                Later
              </DashPill>
            </>
          }
        />
      </DashItemList>,
    );

    expect(screen.getByTestId("items-list")).toBeInTheDocument();
    expect(screen.getByTestId("item-row-1")).toHaveTextContent("AHPRA registration");
    expect(screen.getByTestId("pill-link")).toHaveAttribute("href", "/admin");

    fireEvent.click(screen.getByTestId("pill-button"));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders DashQuickActions, ProgressRing, RingStack, DashSegmented, DashStatTile, and DashWeekTiles", () => {
    const onSegmentChange = vi.fn();
    const days: readonly DashWeekDay[] = [
      {
        date: "2026-10-12",
        letter: "M",
        code: "D",
        kind: "work",
        today: true,
        due: true,
        spoken: "Monday 12 October, Day shift, today, something due",
      },
      {
        date: "2026-10-13",
        letter: "T",
        code: "",
        kind: "none",
        today: false,
        due: false,
        spoken: "Tuesday 13 October, no shift recorded",
      },
    ];

    render(
      <div>
        <DashQuickActions
          actions={[
            {
              label: "Log CPD",
              href: "/cme/log",
              icon: Calendar,
              hint: "add hours",
              testId: "quick-cpd",
            },
          ]}
        />
        <ProgressRing fraction={1.4} testId="progress-ring">
          <span>100%</span>
        </ProgressRing>
        <RingStack
          testId="ring-stack"
          rings={[
            { key: "ea", fraction: 0.5, stroke: "stroke-[color:var(--dash-blue)]" },
            { key: "rp", fraction: -0.2, stroke: "stroke-[color:var(--dash-green)]" },
          ]}
        />
        <DashSegmented
          label="Range"
          value="week"
          onChange={onSegmentChange}
          testId="range-seg"
          options={[
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
        />
        <DashStatTile value="38h" label="This week" testId="stat-tile" />
        <DashWeekTiles days={days} testId="week-tiles" />
      </div>,
    );

    expect(screen.getByTestId("quick-cpd")).toHaveAttribute("href", "/cme/log");
    expect(screen.getByTestId("progress-ring")).toHaveAttribute("data-fraction", "1.000");
    expect(screen.getByTestId("ring-stack").querySelectorAll("circle[data-ring]")).toHaveLength(2);
    expect(screen.getByTestId("stat-tile")).toHaveTextContent("38h");

    const monday = screen.getByLabelText("Monday 12 October, Day shift, today, something due");
    expect(monday).toHaveAttribute("aria-current", "date");

    fireEvent.click(screen.getByTestId("range-seg-month"));
    expect(onSegmentChange).toHaveBeenCalledWith("month");
  });
});
