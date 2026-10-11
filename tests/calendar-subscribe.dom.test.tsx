import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CalendarSubscribe, calendarSubscriptionLinks } from "@/components/calendar/calendar-subscribe";

const TOKEN = "A".repeat(43);
const PATH = `/api/calendar/feed/${TOKEN}.ics`;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("calendarSubscriptionLinks", () => {
  it("builds the three providers' subscribe links from one feed path", () => {
    const links = calendarSubscriptionLinks("https://psychiatry.tools", PATH);
    expect(links.https).toBe(`https://psychiatry.tools${PATH}`);
    expect(links.webcal).toBe(`webcal://psychiatry.tools${PATH}`);
    expect(links.google).toBe(
      `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`webcal://psychiatry.tools${PATH}`)}`,
    );
    expect(links.outlook).toBe(
      `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(`https://psychiatry.tools${PATH}`)}&name=PsychSift`,
    );
  });
});

describe("CalendarSubscribe", () => {
  it("shows nothing in demo mode", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ subscribed: false, available: false }));
    const { container } = render(<CalendarSubscribe />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("calls the mode CPD, never CME", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ subscribed: false, available: true }));
    const { container } = render(<CalendarSubscribe />);
    await screen.findByTestId("calendar-subscribe-create");
    expect(container).toHaveTextContent(/your CPD deadlines and routines, teaching sessions/);
    expect(container.textContent).not.toMatch(/\bCME\b/);
  });

  it("makes a link on request and shows it once, with each calendar's button", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ subscribed: false, available: true }))
      .mockResolvedValueOnce(json({ path: PATH }));
    render(<CalendarSubscribe />);
    await user.click(await screen.findByTestId("calendar-subscribe-create"));
    await screen.findByTestId("calendar-subscribe-links");
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "POST" });
    expect(screen.getByTestId("calendar-subscribe-url")).toHaveTextContent(PATH);
    expect(screen.getByTestId("calendar-subscribe-apple")).toHaveAttribute(
      "href",
      expect.stringMatching(/^webcal:\/\//),
    );
    expect(screen.getByTestId("calendar-subscribe-google")).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/shown only this once/)).toBeInTheDocument();
  });

  it("never shows an existing link again, and asks before replacing it", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ subscribed: true, available: true }))
      .mockResolvedValueOnce(json({ path: PATH }));
    render(<CalendarSubscribe />);
    expect(await screen.findByTestId("calendar-subscribe-active")).toHaveTextContent("can’t be shown again");
    expect(screen.queryByTestId("calendar-subscribe-links")).toBeNull();
    await user.click(screen.getByTestId("calendar-subscribe-reset"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Make a new link" }));
    await screen.findByTestId("calendar-subscribe-links");
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "POST" });
  });

  it("turns the link off after confirming", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ subscribed: true, available: true }))
      .mockResolvedValueOnce(json({ subscribed: false }));
    render(<CalendarSubscribe />);
    await user.click(await screen.findByTestId("calendar-subscribe-off"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Turn link off" }));
    expect(await screen.findByTestId("calendar-subscribe-message")).toHaveTextContent("Link turned off");
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "DELETE" });
    expect(screen.getByTestId("calendar-subscribe-create")).toBeInTheDocument();
  });

  it("says so when the link cannot be made", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ subscribed: false, available: true }))
      .mockResolvedValueOnce(json({ message: "Too many requests. Try again shortly." }, 429));
    render(<CalendarSubscribe />);
    await user.click(await screen.findByTestId("calendar-subscribe-create"));
    expect(await screen.findByTestId("calendar-subscribe-message")).toHaveTextContent("Too many requests");
    expect(screen.queryByTestId("calendar-subscribe-links")).toBeNull();
  });
});
