/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));
vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));
// The header portals into the app header's slot, which these tests do not mount.
vi.mock("@/components/teaching/teaching-nav-header", () => ({ TeachingNavHeader: () => null }));

import { CheckinQr } from "@/components/teaching/checkin-qr";
import { TeachingCheckinScreen } from "@/components/teaching/teaching-checkin";
import { TeachingDisplayScreen } from "@/components/teaching/teaching-display";
import { TeachingSwitch } from "@/components/teaching/teaching-modules";
import { TeachingScanLanding } from "@/components/teaching/teaching-scan-landing";
import { useCheckinCode } from "@/components/teaching/use-checkin-code";

import { authState } from "./helpers/teaching-auth";
import {
  DURING,
  OCC,
  TEAM_A,
  detail,
  fetchCalls,
  json,
  serveFetch,
  useTeachingTestClock,
} from "./helpers/teaching-fixtures";

// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock(DURING);

const SESSION_URL = `/api/teaching?view=session&occurrenceId=${OCC}`;
const TEAM_URL = `/api/teaching/services/${TEAM_A}`;
const SECRET = "a".repeat(64);
const WINDOW = Math.floor(DURING.getTime() / 30_000);
const code = { token: "tok", typedCode: "482913", window: WINDOW, validUntil: DURING.toISOString() };

let visibility: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function stubNavigator(key: string, value: unknown) {
  Object.defineProperty(navigator, key, { configurable: true, writable: true, value });
}

afterEach(() => {
  visibility = "visible";
  for (const key of ["wakeLock", "share", "clipboard"]) delete (navigator as unknown as Record<string, unknown>)[key];
  delete (document as unknown as Record<string, unknown>).fullscreenEnabled;
});

function serveCheckin(extra: (url: string, body: Record<string, unknown> | null) => Response | null = () => null) {
  return serveFetch(
    (url, body) =>
      extra(url, body) ??
      (url === SESSION_URL
        ? json(200, detail({ canShowCode: true }))
        : url.includes("action=register.read")
          ? json(200, { counts: { code: 0, self: 0, visitors: 0 } })
          : url.includes("action=checkin.code")
            ? json(200, code)
            : null),
  );
}

function wakeLockMock() {
  const release = vi.fn(async () => undefined);
  const request = vi.fn(async () => ({ release }));
  stubNavigator("wakeLock", { request });
  return { request, release };
}

describe("the presenter's phone kit", () => {
  it("keeps the screen awake while the code shows, asks again on return, and lets go on leaving", async () => {
    const lock = wakeLockMock();
    serveCheckin();
    const { unmount } = render(<TeachingCheckinScreen occurrenceId={OCC} demoMode={false} />);
    await screen.findByTestId("teaching-checkin-qr");
    await waitFor(() => expect(lock.request).toHaveBeenCalledWith("screen"));
    setVisibility("hidden");
    setVisibility("visible");
    await waitFor(() => expect(lock.request).toHaveBeenCalledTimes(2));
    unmount();
    await waitFor(() => expect(lock.release).toHaveBeenCalled());
  });

  it("shows the code as normal where wake lock is missing or refused", async () => {
    serveCheckin();
    const { unmount } = render(<TeachingCheckinScreen occurrenceId={OCC} demoMode={false} />);
    expect(await screen.findByTestId("teaching-checkin-qr")).toBeInTheDocument();
    unmount();
    stubNavigator("wakeLock", { request: vi.fn(async () => Promise.reject(new Error("NotAllowedError"))) });
    render(<TeachingCheckinScreen occurrenceId={OCC} demoMode={false} />);
    expect(await screen.findByTestId("teaching-checkin-qr")).toBeInTheDocument();
  });

  it("copies the shared-screen link and says so, offers Share only where the phone can, and says when copying fails", async () => {
    const writeText = vi.fn(async () => undefined);
    stubNavigator("clipboard", { writeText });
    serveCheckin((url, body) =>
      url === TEAM_URL && body?.action === "display.create"
        ? json(200, { token: "t", path: `/teaching/display/${SECRET}`, expiresAt: "2026-09-30T06:00:00.000Z" })
        : null,
    );
    const { unmount } = render(<TeachingCheckinScreen occurrenceId={OCC} demoMode={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Show on a shared screen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(await screen.findByTestId("teaching-checkin-copied")).toHaveTextContent("Link copied.");
    expect(screen.getByTestId("teaching-checkin-copied")).toHaveAttribute("role", "status");
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/teaching/display/${SECRET}`);
    expect(screen.queryByRole("button", { name: "Share…" })).toBeNull();
    expect(screen.getByRole("link", { name: /Open the shared screen/ })).toHaveAttribute(
      "href",
      `/teaching/display/${SECRET}`,
    );
    unmount();

    const share = vi.fn(async () => undefined);
    stubNavigator("share", share);
    stubNavigator("clipboard", { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) });
    render(<TeachingCheckinScreen occurrenceId={OCC} demoMode={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Show on a shared screen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Share…" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't copy the link.");
  });

  it("names the stream the shared screen shows, and keeps it when the phone's switch changes", async () => {
    const created: Record<string, unknown>[] = [];
    serveCheckin((url, body) => {
      if (url === SESSION_URL) return json(200, detail({ canShowCode: true, hasJoinLink: true }));
      if (url === TEAM_URL && body?.action === "display.create") {
        created.push(body);
        return json(200, { token: "t", path: `/teaching/display/${SECRET}`, expiresAt: "2026-09-30T06:00:00.000Z" });
      }
      return null;
    });
    render(<TeachingCheckinScreen occurrenceId={OCC} demoMode={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Show on a shared screen" }));
    const panel = screen.getByTestId("teaching-checkin-shared");
    await waitFor(() => expect(panel).toHaveTextContent("It shows the Room code. Link works until"));
    expect(created[0]).toMatchObject({ stream: "room" });
    fireEvent.click(screen.getByRole("radio", { name: "Teams" }));
    expect(panel).toHaveTextContent("It shows the Room code.");
  });

  it("shows the shared-screen control as busy while the link is made", async () => {
    let finish: (response: Response) => void = () => undefined;
    serveCheckin((url, body) =>
      url === TEAM_URL && body?.action === "display.create"
        ? (new Promise<Response>((resolve) => (finish = resolve)) as unknown as Response)
        : null,
    );
    render(<TeachingCheckinScreen occurrenceId={OCC} demoMode={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Show on a shared screen" }));
    expect(await screen.findByRole("button", { name: "Creating link" })).toHaveAttribute("aria-busy", "true");
    finish(json(200, { token: "t", path: `/teaching/display/${SECRET}`, expiresAt: "2026-09-30T06:00:00.000Z" }));
    expect(await screen.findByRole("button", { name: "Stop sharing" })).toBeInTheDocument();
  });
});

describe("polling", () => {
  function Probe({ url }: { url: string }) {
    const view = useCheckinCode(url, Date.now());
    return <span data-testid="phase">{view.phase}</span>;
  }

  it("rests while the page is hidden and fetches at once when it is back", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(DURING);
    const fetchMock = serveFetch((url) => (url === "/api/code" ? json(200, code) : null));
    render(<Probe url="/api/code" />);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(fetchCalls(fetchMock, "/api/code")).toBe(1);
    setVisibility("hidden");
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchCalls(fetchMock, "/api/code")).toBe(1);
    setVisibility("visible");
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(fetchCalls(fetchMock, "/api/code")).toBe(2);
  });
});

describe("the shared screen", () => {
  function serveDisplay() {
    authState.status = "signed_out";
    serveFetch((url) =>
      url === `/api/teaching/display/${SECRET}`
        ? json(200, { ...code, title: "Registrar teaching", venue: null, closesAt: "2026-09-30T05:45:00.000Z" })
        : null,
    );
  }

  it("offers Full screen only where the browser allows it", async () => {
    serveDisplay();
    const { unmount } = render(<TeachingDisplayScreen secret={SECRET} />);
    await screen.findByTestId("teaching-checkin-qr");
    expect(screen.queryByTestId("teaching-display-fullscreen")).toBeNull();
    unmount();

    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    const requestFullscreen = vi.fn(async () => undefined);
    document.documentElement.requestFullscreen = requestFullscreen;
    render(<TeachingDisplayScreen secret={SECRET} />);
    fireEvent.click(await screen.findByRole("button", { name: "Full screen" }));
    expect(requestFullscreen).toHaveBeenCalled();
  });

  it("keeps the projector awake while the code shows", async () => {
    const lock = wakeLockMock();
    serveDisplay();
    render(<TeachingDisplayScreen secret={SECRET} />);
    await screen.findByTestId("teaching-checkin-qr");
    await waitFor(() => expect(lock.request).toHaveBeenCalledWith("screen"));
  });

  it("gives the ended screen a heading", async () => {
    render(<TeachingDisplayScreen secret="not-a-secret" />);
    expect(screen.getByRole("heading", { level: 1, name: "Check-in code" })).toBeInTheDocument();
  });
});

describe("the scan landing", () => {
  it("announces the check-in and offers Go to Today", async () => {
    serveFetch((url) =>
      url === "/api/teaching/checkin/complete"
        ? json(200, { occurrenceId: OCC, method: "code_room", recordedAt: DURING.toISOString(), serviceId: TEAM_A })
        : null,
    );
    render(<TeachingScanLanding token={null} />);
    const heading = await screen.findByRole("heading", { name: "You're checked in" });
    expect(heading.closest("[role=status]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Go to Today" })).toHaveAttribute("href", "/teaching");
  });

  it("sends the sign-in link from the keyboard, then offers Send again and a different email", async () => {
    serveFetch((url) =>
      url === "/api/teaching/checkin/complete"
        ? json(401, { error: "Sign in", message: "Sign in", code: "teaching_signed_out" })
        : null,
    );
    render(<TeachingScanLanding token={null} />);
    const email = await screen.findByLabelText("Email");
    fireEvent.change(email, { target: { value: "dr@example.org" } });
    fireEvent.submit(email.closest("form")!);
    await waitFor(() => expect(authState.signInWithEmail).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "Send again" }));
    await waitFor(() => expect(authState.signInWithEmail).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});

// The `--teaching-qr-*` and `--teaching-segment-*` colours live only in the
// `[data-mode-identity="teaching"]` block. The shared display screen sits
// outside every Teaching page, where an unscoped QR painted as one black
// square no camera could read, and an unscoped switch lost its selected fill.
describe("Teaching colours resolve wherever the parts are drawn", () => {
  it("scopes the QR to the Teaching identity on the SVG itself", () => {
    render(<CheckinQr value="https://example.test/c" label="Check-in QR code" />);
    expect(screen.getByTestId("teaching-checkin-qr")).toHaveAttribute("data-mode-identity", "teaching");
  });

  it("scopes the switch's segment colours on a wrapper, not on the scroller that overrides the accent", () => {
    render(
      <TeachingSwitch
        value="all"
        onChange={() => undefined}
        options={[
          { value: "all", label: "All" },
          { value: "online", label: "Online" },
        ]}
        label="Show"
      />,
    );
    const scroller = screen.getByTestId("teaching-switch");
    expect(scroller).not.toHaveAttribute("data-mode-identity");
    expect(scroller.parentElement).toHaveAttribute("data-mode-identity", "teaching");
    expect(scroller.parentElement).toHaveClass("contents");
  });
});
