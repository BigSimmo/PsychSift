/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AttendanceRoster, type RegistrarMember } from "@/components/teaching/attendance-roster";

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
});
