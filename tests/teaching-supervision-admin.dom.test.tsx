/** @vitest-environment jsdom */

// One supervisor list: in a service that belongs to a hospital, People and roles names the supervisor,
// so the Teaching organiser sees the pairings and a link there instead of the pairing form.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => ({ supervisorsFromPeople: undefined as boolean | undefined }));
vi.mock("@/components/teaching/use-teaching-resource", () => ({
  useTeachingResource: () => ({
    status: "ready",
    retry: vi.fn(),
    data: {
      supervisorsFromPeople: read.supervisorsFromPeople,
      pairings: [
        {
          pairingId: "00000000-0000-4000-8000-000000000001",
          access: "organiser",
          registrarName: "Rae Example",
          supervisorName: "No supervisor named",
          startsOn: "2026-10-27",
          endsOn: "2027-10-27",
          targetHours: null,
          confirmedMinutes: 0,
          pendingMinutes: 0,
          pendingCount: 0,
          oldestPendingAt: null,
          entries: null,
        },
      ],
    },
  }),
}));

import { TeachingSupervisionAdmin } from "@/components/teaching/teaching-supervision-admin";

afterEach(() => cleanup());

function open() {
  render(
    <TeachingSupervisionAdmin
      serviceId="00000000-0000-4000-8000-0000000000aa"
      data={{ series: [], groups: [], members: [] }}
      today="2026-10-27"
      isAdmin={false}
      onSaved={vi.fn()}
    />,
  );
}

describe("TeachingSupervisionAdmin", () => {
  it("points a hospital service to People and roles and offers no pairing form", () => {
    read.supervisorsFromPeople = true;
    open();
    expect(screen.getByText(/Rae Example · No supervisor named/)).toBeInTheDocument();
    expect(screen.getByTestId("teaching-supervision-people-link")).toHaveAttribute("href", "/admin/people");
    expect(screen.queryByRole("button", { name: "Create pairing" })).toBeNull();
  });

  it("keeps the pairing form for a service outside any hospital", () => {
    read.supervisorsFromPeople = false;
    open();
    expect(screen.queryByTestId("teaching-supervision-people-link")).toBeNull();
    expect(screen.getByRole("button", { name: "Create pairing" })).toBeInTheDocument();
  });
});
