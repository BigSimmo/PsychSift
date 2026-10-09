/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CmeNewEntryRoute } from "@/components/cme/cme-new-entry-route";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/cme/new",
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CmeNewEntryRoute - Missed Teaching Replacement (#A9GC6S)", () => {
  it("renders replacement checkbox and reveals input when checked", async () => {
    const user = userEvent.setup();
    render(<CmeNewEntryRoute />);

    const checkbox = screen.getByTestId("cme-replacement-checkbox");
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();

    expect(screen.queryByTestId("cme-missed-session-input")).toBeNull();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    const input = screen.getByTestId("cme-missed-session-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("submits missedSessionId in payload when replacement is filled and saved", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, linkedMissedSession: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<CmeNewEntryRoute />);

    // Check replacement checkbox and fill session ID
    await user.click(screen.getByTestId("cme-replacement-checkbox"));
    await user.type(screen.getByTestId("cme-missed-session-input"), "session-wa-2026");

    // Fill minimal required entry form fields: title, hours, category
    await user.type(screen.getByLabelText(/what was it/i), "Replacement teaching session");
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "Educational" }));

    // Click Save entry
    await user.click(screen.getByRole("button", { name: "Save entry" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/cme/entries");
    const payload = JSON.parse(call[1].body);
    expect(payload.title).toBe("Replacement teaching session");
    expect(payload.missedSessionId).toBe("session-wa-2026");
  });

  it("pre-fills replacement checkbox and input when missedSessionId prop is passed", () => {
    render(<CmeNewEntryRoute missedSessionId="session-prefill-42" />);

    const checkbox = screen.getByTestId("cme-replacement-checkbox");
    expect(checkbox).toBeChecked();

    const input = screen.getByTestId("cme-missed-session-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("session-prefill-42");
  });
});
