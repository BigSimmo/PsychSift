/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/roster/join",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/components/roster/alerts/roster-alerts-section", () => ({
  RosterAlertsSwitch: () => <span>Alerts switch</span>,
}));

import { RosterJoinPage } from "@/components/roster/invite/roster-join-page";

const SERVICE = "5e000000-0000-4000-8000-000000000001";
const CODE = "ab".repeat(32);
const overview = {
  service: { id: SERVICE, name: "Example Health Service · General Medicine" },
  me: { rotationEndsOn: "2026-11-29" },
};
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.history.replaceState({ appRouter: "preserved" }, "", "/roster/join");
  fetchMock = vi.fn(async (input: string) => {
    if (input === "/api/on-call/services/join") return Response.json({ serviceId: SERVICE });
    if (input.includes("?what=overview")) return Response.json(overview);
    if (input === "/api/roster/settings") return Response.json({ calendarShifts: false });
    return Response.json({ teams: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("joining a Roster team", () => {
  it("removes the fragment without losing App Router history state before redeeming", async () => {
    window.history.replaceState({ appRouter: "preserved" }, "", `/roster/join#code=${CODE}`);
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "/api/on-call/services/join") {
        expect(window.location.hash).toBe("");
        expect(window.history.state).toEqual({ appRouter: "preserved" });
        return Response.json({ serviceId: SERVICE });
      }
      if (input.includes("?what=overview")) return Response.json(overview);
      return Response.json({ calendarShifts: false });
    });
    render(<RosterJoinPage />);
    expect(await screen.findByText("You're in General Medicine")).toBeInTheDocument();
    expect(screen.getByText("Example Health Service · to Sun 29 Nov")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/on-call/services/join",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: CODE }),
      }),
    );
    expect(screen.getByRole("link", { name: "See my shifts" })).toHaveAttribute("href", "/roster");
  });

  it("accepts a pasted link, clears the field, and never stores the code", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(<RosterJoinPage />);
    // Work-mode redesign, owner request 6 Oct 2026: who sees what, said before joining.
    expect(screen.getByTestId("roster-join-privacy").textContent).toBe(
      "The team and its managers see your team shifts. Shifts you add yourself stay private.",
    );
    fireEvent.change(screen.getByRole("textbox", { name: /Invite link or code/ }), {
      target: { value: `https://localhost:3000/roster/join#code=${CODE}` },
    });
    // The pasted origin must match the current page. The test page is jsdom's origin.
    fireEvent.change(screen.getByRole("textbox", { name: /Invite link or code/ }), {
      target: { value: `${window.location.origin}/roster/join#code=${CODE}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join team" }));
    await screen.findByText("You're in General Medicine");
    expect(storage).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
    storage.mockRestore();
  });

  it("uses a helpful error when the signed-in email differs or the service cannot explain the failure", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ code: "service_invite_email_mismatch" }, { status: 403 }));
    render(<RosterJoinPage />);
    fireEvent.change(screen.getByRole("textbox", { name: /Invite link or code/ }), { target: { value: CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Join team" }));
    expect(
      await screen.findByText(
        "This invite was sent to a different email. Sign in with that email, or ask your manager for a new invite.",
      ),
    ).toBeInTheDocument();
    // A failed redemption keeps the typed code, so it can be checked or tried again.
    expect(screen.getByRole("textbox", { name: /Invite link or code/ })).toHaveValue(CODE);
  });

  it("asks signed-out users to reopen the link after signing in", async () => {
    window.history.replaceState({}, "", `/roster/join#code=${CODE}`);
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 401 }));
    render(<RosterJoinPage />);
    expect(await screen.findByText("Sign in, then open the invite link again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("keeps a completed join successful when the follow-up overview is unavailable", async () => {
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "/api/on-call/services/join") return Response.json({ serviceId: SERVICE });
      if (input.includes("?what=overview")) throw new Error("offline after join");
      return Response.json({ calendarShifts: false });
    });
    render(<RosterJoinPage />);
    fireEvent.change(screen.getByRole("textbox", { name: /Invite link or code/ }), { target: { value: CODE } });
    fireEvent.click(screen.getByRole("button", { name: "Join team" }));
    expect(await screen.findByText("You're in Roster")).toBeInTheDocument();
    expect(screen.queryByText(/This invite didn't work/)).toBeNull();
  });
});
