/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AttendanceRoster, type RegistrarMember } from "@/components/teaching/attendance-roster";
import { AttendanceGapsSheet } from "@/components/teaching/organise-sheets";
import type { OrganiseRead } from "@/components/teaching/organise-model";

afterEach(cleanup);

const MOCK_MEMBERS: RegistrarMember[] = [
  {
    userId: "doc-1",
    name: "Dr. Gregory House",
    role: "doctor",
  },
  {
    userId: "doc-2",
    name: "Dr. James Wilson",
    role: "doctor",
  },
  {
    userId: "doc-3",
    name: "Dr. Lisa Cuddy",
    role: "doctor",
  },
];

describe("AttendanceRoster (#WVS32F)", () => {
  it("renders all registrars and identifies attendance gaps with honest wording", () => {
    // Wilson has 3 check-ins; House and Cuddy have 0.
    const counts = { "doc-2": 3 };

    render(<AttendanceRoster members={MOCK_MEMBERS} checkInCountsByUserId={counts} />);

    expect(screen.getByTestId("teaching-attendance-roster")).toBeInTheDocument();

    const houseRow = screen.getByTestId("attendance-roster-row-doc-1");
    expect(houseRow).toHaveTextContent("Dr. Gregory House");
    expect(houseRow).toHaveTextContent("No check-in recorded this term");
    expect(houseRow).toHaveAttribute("data-has-gap", "true");

    const wilsonRow = screen.getByTestId("attendance-roster-row-doc-2");
    expect(wilsonRow).toHaveTextContent("Dr. James Wilson");
    expect(wilsonRow).toHaveTextContent("3 check-ins recorded");
    expect(wilsonRow).toHaveAttribute("data-has-gap", "false");
  });

  it("filters and highlights registrars when attendance gap toggle is pressed", () => {
    const counts = { "doc-2": 3 };

    render(<AttendanceRoster members={MOCK_MEMBERS} checkInCountsByUserId={counts} />);

    const gapToggle = screen.getByTestId("attendance-gap-filter-toggle");
    fireEvent.click(gapToggle);

    // House and Cuddy appear; Wilson does not
    expect(screen.getByTestId("attendance-roster-row-doc-1")).toBeInTheDocument();
    expect(screen.getByTestId("attendance-roster-row-doc-3")).toBeInTheDocument();
    expect(screen.queryByTestId("attendance-roster-row-doc-2")).toBeNull();

    // Badges appear on gap rows
    const badges = screen.getAllByTestId("attendance-gap-badge");
    expect(badges.length).toBe(2);
  });

  it("filters registrars by name search", () => {
    render(<AttendanceRoster members={MOCK_MEMBERS} />);

    const input = screen.getByLabelText("Filter registrars");
    fireEvent.change(input, { target: { value: "Wilson" } });

    expect(screen.getByText("Dr. James Wilson")).toBeInTheDocument();
    expect(screen.queryByText("Dr. Gregory House")).toBeNull();
  });

  it("displays empty state when all doctors have recorded check-ins and gaps filter is active", () => {
    const allAttended = { "doc-1": 1, "doc-2": 2, "doc-3": 4 };

    render(<AttendanceRoster members={MOCK_MEMBERS} checkInCountsByUserId={allAttended} initialFilterGapsOnly />);

    expect(screen.getByTestId("attendance-roster-empty")).toHaveTextContent("No attendance gaps recorded.");
  });

  it("wires AttendanceRoster inside AttendanceGapsSheet with initialFilterGapsOnly enabled", () => {
    const organise: OrganiseRead = {
      series: [],
      groups: [],
      members: [
        {
          userId: "00000000-0000-4000-8000-000000000001",
          name: "Dr. Gregory House",
          role: "doctor",
          joinedAt: "2026-01-10T00:00:00Z",
        },
        {
          userId: "00000000-0000-4000-8000-000000000002",
          name: "Dr. James Wilson",
          role: "doctor",
          joinedAt: "2026-01-12T00:00:00Z",
        },
      ],
    };

    render(
      <AttendanceGapsSheet
        organise={organise}
        checkInCountsByUserId={{ "00000000-0000-4000-8000-000000000002": 3 }}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByTestId("teaching-attendance-roster")).toBeInTheDocument();
    expect(screen.getAllByTestId("attendance-roster-search")).toHaveLength(1);
    expect(screen.getByTestId("attendance-roster-row-00000000-0000-4000-8000-000000000001")).toBeInTheDocument();
    expect(screen.queryByTestId("attendance-roster-row-00000000-0000-4000-8000-000000000002")).toBeNull();
    expect(screen.queryByTestId("teaching-attendance-gaps-empty")).toBeNull();

    // Toggling to All Registrars reveals Wilson as well
    fireEvent.click(screen.getByTestId("roster-view-all-btn"));
    expect(screen.getByTestId("attendance-roster-row-00000000-0000-4000-8000-000000000002")).toBeInTheDocument();
  });
});
