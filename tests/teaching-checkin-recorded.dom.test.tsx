/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));
vi.mock("@/components/teaching/teaching-nav-header", () => ({ TeachingNavHeader: () => null }));

import { CheckinRecorded, wasAlreadyCheckedIn } from "@/components/teaching/checkin/checkin-recorded";
import { TeachingScanLanding } from "@/components/teaching/teaching-scan-landing";
import { TeachingSessionScreen } from "@/components/teaching/teaching-session";

import { AFTER, DURING, OCC, TEAM_A, detail, json, serveFetch, useTeachingTestClock } from "./helpers/teaching-fixtures";

// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock(DURING);

const SESSION_URL = `/api/teaching?view=session&occurrenceId=${OCC}`;
const TEAM_URL = `/api/teaching/services/${TEAM_A}`;

function serveScan(recordedAt: Date = DURING) {
  return serveFetch((url) => {
    if (url === "/api/teaching/checkin/open")
      return json(200, { occurrenceId: OCC, title: "Registrar teaching", startsAt: DURING.toISOString(), stream: "room" });
    if (url === "/api/teaching/checkin/complete")
      return json(200, { occurrenceId: OCC, method: "code_room", recordedAt: recordedAt.toISOString(), serviceId: TEAM_A });
    if (url === SESSION_URL) return json(200, detail({ venue: "Lecture theatre" }));
    if (url.startsWith("/api/teaching/resources?")) return json(200, { items: [] });
    return null;
  });
}

describe("Attendance recorded, after a scan", () => {
  it("confirms the check-in and says where it went, with the Logbook one tap away", async () => {
    serveScan();
    render(<TeachingScanLanding token="tok-1" />);
    const card = await screen.findByTestId("checkin-recorded");
    expect(within(card).getByRole("heading", { name: "Attendance recorded" })).toBeInTheDocument();
    expect(within(card).getByText("Checked in by code · shown in room")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Teaching record/ })).toHaveAttribute("href", "/teaching/logbook");
    expect(screen.getByRole("link", { name: "Open my Logbook" })).toHaveAttribute("href", "/teaching/logbook");
    expect(within(card).getByText("Session register")).toBeInTheDocument();
    // The session has not ended: logging to CPD waits, and says until when.
    await waitFor(() => expect(card).toHaveTextContent("You can log it once it ends at 13:30"));
    expect(within(card).getByRole("button", { name: "Log to CPD after it ends" })).toBeDisabled();
    expect(card).not.toHaveTextContent("already checked in");
    // The page heading stays the announced status line.
    expect(screen.getByRole("heading", { level: 1, name: "You're checked in" })).toBeInTheDocument();
  });

  it("says a repeat scan added nothing twice", async () => {
    serveScan(new Date(DURING.getTime() - 10 * 60_000));
    render(<TeachingScanLanding token="tok-1" />);
    expect(await screen.findByText("You were already checked in. Nothing is added twice.")).toBeInTheDocument();
  });

  it("opens Log to CPD once the session has ended", async () => {
    vi.setSystemTime(AFTER);
    serveScan(AFTER);
    render(<TeachingScanLanding token={null} />);
    const button = await screen.findByRole("button", { name: "Log to CPD" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("Attendance recorded, on the session page", () => {
  it("appears after a typed code, beside the phase module's own label", async () => {
    serveFetch((url, body) => {
      if (url === TEAM_URL && body)
        return json(200, { occurrenceId: OCC, method: "code_room", recordedAt: DURING.toISOString(), serviceId: TEAM_A });
      if (url === SESSION_URL) return json(200, detail());
      if (url.startsWith("/api/teaching/resources?")) return json(200, { items: [] });
      return null;
    });
    render(<TeachingSessionScreen occurrenceId={OCC} demoMode={false} initialSheet="scan" />);
    const sheet = await screen.findByRole("dialog", { name: "Check in with code" });
    fireEvent.change(within(sheet).getByLabelText("Or type the six digits"), { target: { value: "482913" } });
    fireEvent.submit(within(sheet).getByLabelText("Or type the six digits").closest("form")!);
    const card = await screen.findByTestId("checkin-recorded");
    expect(within(card).getByRole("heading", { name: "Attendance recorded" })).toBeInTheDocument();
    // The method shows once, in the phase module, not twice.
    expect(screen.getAllByText("Checked in by code · shown in room")).toHaveLength(1);
  });

  it("is not shown for a check-in made on an earlier visit", async () => {
    serveFetch((url) =>
      url === SESSION_URL
        ? json(200, detail({ myAttendance: { method: "self", recordedAt: DURING.toISOString() } }))
        : url.startsWith("/api/teaching/resources?")
          ? json(200, { items: [] })
          : null,
    );
    render(<TeachingSessionScreen occurrenceId={OCC} demoMode={false} />);
    await screen.findByTestId("teaching-session-phase");
    expect(screen.queryByTestId("checkin-recorded")).toBeNull();
  });
});

describe("the card on its own", () => {
  it("offers no CPD button in the demo, and shows a logged state", () => {
    const { rerender } = render(
      <CheckinRecorded
        title="Grand rounds"
        startsAt={DURING.toISOString()}
        endsAt={DURING.toISOString()}
        method="self"
        recordedAt={DURING.toISOString()}
        now={AFTER}
        live={false}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Grand rounds")).toBeInTheDocument();
    rerender(
      <CheckinRecorded
        title={null}
        startsAt={null}
        endsAt={null}
        method="self"
        recordedAt={DURING.toISOString()}
        now={null}
        logged
      />,
    );
    expect(screen.getByText("Logged. Your CPD log is private")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("decides a repeat scan only from times it has", () => {
    expect(wasAlreadyCheckedIn(DURING.toISOString(), null)).toBe(false);
    expect(wasAlreadyCheckedIn("not a date", AFTER)).toBe(false);
    expect(wasAlreadyCheckedIn(DURING.toISOString(), new Date(DURING.getTime() + 60_000))).toBe(false);
    expect(wasAlreadyCheckedIn(DURING.toISOString(), new Date(DURING.getTime() + 3 * 60_000))).toBe(true);
  });
});
