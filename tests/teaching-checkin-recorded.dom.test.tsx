/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));
vi.mock("@/components/teaching/teaching-nav-header", () => ({ TeachingNavHeader: () => null }));

import { CheckinRecorded, wasAlreadyCheckedIn } from "@/components/teaching/checkin/checkin-recorded";
import { TeachingScanLanding } from "@/components/teaching/teaching-scan-landing";
import { TeachingSessionScreen } from "@/components/teaching/teaching-session";

import {
  AFTER,
  DURING,
  OCC,
  TEAM_A,
  detail,
  json,
  serveFetch,
  useTeachingTestClock,
} from "./helpers/teaching-fixtures";

// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock(DURING);

const SESSION_URL = `/api/teaching?view=session&occurrenceId=${OCC}`;
const TEAM_URL = `/api/teaching/services/${TEAM_A}`;

/** A JSON answer carrying the server's own clock in its Date header, the way the real server sends it. */
function timedJson(body: unknown, serverNow: Date | null = DURING): Response {
  const response = json(200, body);
  if (serverNow) response.headers.set("date", serverNow.toUTCString());
  return response;
}

function serveScan(recordedAt: Date = DURING, serverNow: Date | null = DURING) {
  return serveFetch((url) => {
    if (url === "/api/teaching/checkin/open")
      return json(200, {
        occurrenceId: OCC,
        title: "Registrar teaching",
        startsAt: DURING.toISOString(),
        stream: "room",
      });
    if (url === "/api/teaching/checkin/complete")
      return timedJson(
        { occurrenceId: OCC, method: "code_room", recordedAt: recordedAt.toISOString(), serviceId: TEAM_A },
        serverNow,
      );
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
    // The Logbook is one tap away, once: the "Teaching record" row is the only link to it.
    expect(within(card).getByRole("link", { name: /Teaching record/ })).toHaveAttribute("href", "/teaching/logbook");
    expect(screen.queryByRole("link", { name: "Open my Logbook" })).toBeNull();
    expect(
      screen.getAllByRole("link").filter((link) => link.getAttribute("href") === "/teaching/logbook"),
    ).toHaveLength(1);
    expect(within(card).getByText("Session register")).toBeInTheDocument();
    // The session has not ended: logging to CPD waits, and says until when.
    await waitFor(() => expect(card).toHaveTextContent("You can log it once it ends at 13:30"));
    expect(within(card).getByRole("button", { name: "Log to CPD after it ends" })).toBeDisabled();
    expect(card).not.toHaveTextContent("already checked in");
    // The page heading stays the announced status line.
    expect(screen.getByRole("heading", { level: 1, name: "You're checked in" })).toBeInTheDocument();
  });

  it("says a repeat scan added nothing twice, when the server recorded it well before it answered", async () => {
    serveScan(new Date(DURING.getTime() - 10 * 60_000));
    render(<TeachingScanLanding token="tok-1" />);
    expect(await screen.findByText("You were already checked in. Nothing is added twice.")).toBeInTheDocument();
  });

  it("does not call a fresh check-in a repeat when the phone's clock runs fast", async () => {
    // The phone thinks it is 10 minutes later, but the server recorded and answered at the same moment.
    vi.setSystemTime(new Date(DURING.getTime() + 10 * 60_000));
    serveScan(DURING, DURING);
    render(<TeachingScanLanding token="tok-1" />);
    const card = await screen.findByTestId("checkin-recorded");
    expect(card).not.toHaveTextContent("already checked in");
  });

  it("claims no repeat when the server's answer carries no clock", async () => {
    serveScan(new Date(DURING.getTime() - 10 * 60_000), null);
    render(<TeachingScanLanding token="tok-1" />);
    const card = await screen.findByTestId("checkin-recorded");
    expect(card).not.toHaveTextContent("already checked in");
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

describe("the scan page always has a way out", () => {
  it("offline: says the scan is kept for 10 minutes, with Try again and Go to Today", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      serveFetch((url) => {
        if (url === "/api/teaching/checkin/open")
          return json(200, {
            occurrenceId: OCC,
            title: "Registrar teaching",
            startsAt: DURING.toISOString(),
            stream: "room",
          });
        if (url === "/api/teaching/checkin/complete") throw new TypeError("Failed to fetch");
        return null;
      });
      render(<TeachingScanLanding token="tok-1" />);
      const offline = await screen.findByTestId("teaching-scan-offline");
      expect(offline).toHaveTextContent("Your scan is kept on this phone for 10 minutes.");
      expect(offline).not.toHaveTextContent(/7 days/);
      expect(within(offline).getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(within(offline).getByRole("link", { name: "Go to Today" })).toHaveAttribute("href", "/teaching");
    } finally {
      online.mockRestore();
    }
  });

  it("waiting for sign-in: Go to Today is there before and after the link is sent", async () => {
    serveFetch((url) =>
      url === "/api/teaching/checkin/open"
        ? json(200, { occurrenceId: OCC, title: "Registrar teaching", startsAt: DURING.toISOString(), stream: "room" })
        : url === "/api/teaching/checkin/complete"
          ? json(401, { error: "Sign in", message: "Sign in", code: "teaching_signed_out" })
          : null,
    );
    render(<TeachingScanLanding token="tok-1" />);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "dr@example.org" } });
    expect(screen.getByRole("link", { name: "Go to Today" })).toHaveAttribute("href", "/teaching");
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByText(/Check your email/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Today" })).toHaveAttribute("href", "/teaching");
  });
});

describe("Attendance recorded, on the session page", () => {
  it("appears after a typed code, beside the phase module's own label", async () => {
    serveFetch((url, body) => {
      if (url === TEAM_URL && body)
        return timedJson({
          occurrenceId: OCC,
          method: "code_room",
          recordedAt: DURING.toISOString(),
          serviceId: TEAM_A,
        });
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

  it("still says Attendance recorded, not already checked in, three minutes after a fresh check-in", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(DURING);
    serveFetch((url, body) => {
      if (url === TEAM_URL && body)
        return timedJson({
          occurrenceId: OCC,
          method: "code_room",
          recordedAt: DURING.toISOString(),
          serviceId: TEAM_A,
        });
      if (url === SESSION_URL) return json(200, detail());
      if (url.startsWith("/api/teaching/resources?")) return json(200, { items: [] });
      return null;
    });
    render(<TeachingSessionScreen occurrenceId={OCC} demoMode={false} initialSheet="scan" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const sheet = screen.getByRole("dialog", { name: "Check in with code" });
    fireEvent.change(within(sheet).getByLabelText("Or type the six digits"), { target: { value: "482913" } });
    fireEvent.submit(within(sheet).getByLabelText("Or type the six digits").closest("form")!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const card = screen.getByTestId("checkin-recorded");
    expect(card).not.toHaveTextContent("already checked in");
    // The page clock ticks on with the card open: the line it shows must not change.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
    });
    expect(screen.getByTestId("checkin-recorded")).not.toHaveTextContent("already checked in");
    expect(screen.getByTestId("checkin-recorded")).toHaveTextContent("Attendance recorded");
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

  it("decides a repeat scan only from the server's two times, and claims nothing without them", () => {
    expect(wasAlreadyCheckedIn(DURING.toISOString(), null)).toBe(false);
    expect(wasAlreadyCheckedIn("not a date", AFTER.getTime())).toBe(false);
    expect(wasAlreadyCheckedIn(DURING.toISOString(), Number.NaN)).toBe(false);
    // The server answered within a minute of recording it: a fresh check-in.
    expect(wasAlreadyCheckedIn(DURING.toISOString(), DURING.getTime() + 60_000)).toBe(false);
    // The server answered with a record it made minutes earlier: a repeat.
    expect(wasAlreadyCheckedIn(DURING.toISOString(), DURING.getTime() + 3 * 60_000)).toBe(true);
  });

  it("shows the repeat line only from the flag it is given, whatever the clock says", () => {
    const { rerender } = render(
      <CheckinRecorded
        title={null}
        startsAt={null}
        endsAt={null}
        method="self"
        recordedAt={DURING.toISOString()}
        now={new Date(DURING.getTime() + 60 * 60_000)}
      />,
    );
    expect(screen.queryByText(/already checked in/)).toBeNull();
    rerender(
      <CheckinRecorded
        title={null}
        startsAt={null}
        endsAt={null}
        method="self"
        recordedAt={DURING.toISOString()}
        alreadyCheckedIn
        now={DURING}
      />,
    );
    expect(screen.getByText("You were already checked in. Nothing is added twice.")).toBeInTheDocument();
  });
});
