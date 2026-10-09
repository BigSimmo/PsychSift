/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AttendanceGapsSheet } from "@/components/teaching/organise-sheets";
import type { OrganiseRead } from "@/components/teaching/organise-model";

afterEach(cleanup);

const MOCK_ORGANISE: OrganiseRead = {
  series: [],
  groups: [],
  members: [
    {
      userId: "00000000-0000-4000-8000-000000000001",
      name: "Dr Alice Smith",
      role: "doctor",
      joinedAt: "2026-01-10T00:00:00Z",
    },
    {
      userId: "00000000-0000-4000-8000-000000000002",
      name: "Dr Bob Jones",
      role: "doctor",
      joinedAt: "2026-01-12T00:00:00Z",
    },
    {
      userId: "00000000-0000-4000-8000-000000000003",
      name: "Dr Carol Davis",
      role: "doctor",
      joinedAt: "2026-01-15T00:00:00Z",
    },
  ],
};

describe("Teaching Attendance Gaps View (#WVS32F)", () => {
  it("renders enrolled doctors with 0 check-ins this term and honest subtitle", () => {
    // Carol has 2 check-ins; Alice and Bob have 0.
    const checkInCounts = {
      "00000000-0000-4000-8000-000000000003": 2,
    };

    render(<AttendanceGapsSheet organise={MOCK_ORGANISE} checkInCountsByUserId={checkInCounts} onClose={vi.fn()} />);

    expect(screen.getByTestId("teaching-attendance-gaps-sheet")).toBeInTheDocument();

    // Alice and Bob appear with honest subtitle
    const aliceRow = screen.getByTestId("attendance-gap-00000000-0000-4000-8000-000000000001");
    expect(aliceRow).toBeInTheDocument();
    expect(aliceRow).toHaveTextContent("Dr Alice Smith");
    expect(aliceRow).toHaveTextContent("No check-ins recorded this term");

    const bobRow = screen.getByTestId("attendance-gap-00000000-0000-4000-8000-000000000002");
    expect(bobRow).toBeInTheDocument();
    expect(bobRow).toHaveTextContent("Dr Bob Jones");
    expect(bobRow).toHaveTextContent("No check-ins recorded this term");

    // Carol has check-ins, so she must NOT appear
    expect(screen.queryByTestId("attendance-gap-00000000-0000-4000-8000-000000000003")).toBeNull();
  });

  it("filters doctor names correctly", () => {
    render(<AttendanceGapsSheet organise={MOCK_ORGANISE} onClose={vi.fn()} />);

    expect(screen.getByText("Dr Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Dr Bob Jones")).toBeInTheDocument();

    const input = screen.getByLabelText("Filter doctors");
    fireEvent.change(input, { target: { value: "Alice" } });

    expect(screen.getByText("Dr Alice Smith")).toBeInTheDocument();
    expect(screen.queryByText("Dr Bob Jones")).toBeNull();
  });

  it("displays empty state when all doctors have recorded check-ins", () => {
    const allAttended = {
      "00000000-0000-4000-8000-000000000001": 1,
      "00000000-0000-4000-8000-000000000002": 3,
      "00000000-0000-4000-8000-000000000003": 5,
    };

    render(<AttendanceGapsSheet organise={MOCK_ORGANISE} checkInCountsByUserId={allAttended} onClose={vi.fn()} />);

    expect(screen.getByTestId("teaching-attendance-gaps-empty")).toHaveTextContent("No attendance gaps recorded.");
  });

  it("excludes non-doctor members (e.g. organisers/admins) from attendance gaps", () => {
    const organiseWithAdmin: OrganiseRead = {
      series: [],
      groups: [],
      members: [
        {
          userId: "00000000-0000-4000-8000-000000000004",
          name: "Admin Coordinator",
          role: "admin",
          joinedAt: "2026-01-01T00:00:00Z",
        },
      ],
    };

    render(<AttendanceGapsSheet organise={organiseWithAdmin} onClose={vi.fn()} />);

    expect(screen.getByTestId("teaching-attendance-gaps-empty")).toHaveTextContent("No attendance gaps recorded.");
    expect(screen.queryByText("Admin Coordinator")).toBeNull();
  });
});
