import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CmeLearningPage } from "@/components/cme/cme-learning-page";
import type { LearningDirectoryItem } from "@/lib/cme/learning-directory";

// 2026-09-26 in Perth (UTC+8, no daylight saving).
const NOW_ISO = "2026-09-26T02:00:00.000Z";

function item(overrides: Partial<LearningDirectoryItem> = {}): LearningDirectoryItem {
  return {
    id: "synthetic-item",
    title: "Synthetic workshop",
    provider: "Synthetic provider",
    kind: "event",
    datesConfirmed: true,
    startsOn: "2026-10-10",
    endsOn: null,
    mode: "in-person",
    location: "Perth",
    costNote: "Free for members",
    url: "https://example.org/event?ref=list",
    sourceUrl: "https://example.org/confirmed",
    lastCheckedOn: "2026-09-26",
    ...overrides,
  };
}

describe("CME learning directory page", () => {
  it("lists upcoming items in date order and drops past ones", () => {
    render(
      <CmeLearningPage
        items={[
          item({ id: "later", title: "Later course", kind: "course", startsOn: "2026-11-02", endsOn: "2026-11-03" }),
          item({ id: "past", title: "Past event", startsOn: "2026-09-01" }),
          item({ id: "soon", title: "Soon event", startsOn: "2026-10-01", mode: "online", location: null }),
        ]}
        lastCheckedOn="2026-09-20"
        nowIso={NOW_ISO}
      />,
    );
    const main = screen.getByTestId("cme-learning");
    const cards = within(main).getAllByTestId("cme-learning-item");
    expect(cards.map((card) => within(card).getByRole("heading").textContent)).toEqual(["Soon event", "Later course"]);
    expect(screen.queryByText("Past event")).toBeNull();
    expect(within(cards[1]).getByText("2 Nov to 3 November 2026")).toBeInTheDocument();
    expect(main).toHaveTextContent("List last checked on 20 September 2026");
    expect(main).toHaveTextContent(/not an endorsement/i);
    expect(main).toHaveTextContent(/confirm .* with the organiser/i);
    expect(screen.queryByTestId("cme-learning-stale")).toBeNull();
    expect(screen.queryByTestId("cme-learning-empty")).toBeNull();
    expect(screen.queryByTestId("cme-learning-unconfirmed")).toBeNull();
  });

  it("opens the organiser's page and offers a 48 px calendar control before the event", () => {
    render(<CmeLearningPage items={[item({ title: "A & B" })]} lastCheckedOn="2026-09-26" nowIso={NOW_ISO} />);
    const card = screen.getByTestId("cme-learning-item");
    const details = within(card).getByRole("link", { name: /details/i });
    expect(details).toHaveAttribute("href", "https://example.org/event?ref=list");
    expect(details).toHaveAttribute("target", "_blank");
    expect(details).toHaveAttribute("rel", "noopener noreferrer");

    const add = within(card).getByRole("button", { name: "Add to calendar" });
    expect(add.className).toContain("min-h-12");
    expect(add.className).toContain("min-w-12");
    const upcomingLog = within(card).getByRole("link", { name: "Log as CPD" });
    expect(upcomingLog.getAttribute("href")).toContain("/cme/new?");
  });

  it("offers Log as CPD from Past, carrying the public event title and source", () => {
    render(
      <CmeLearningPage
        items={[item({ title: "A & B", startsOn: "2026-09-01" })]}
        lastCheckedOn="2026-09-26"
        nowIso={NOW_ISO}
        view="past"
      />,
    );
    const card = screen.getByTestId("cme-learning-item");
    const log = within(card).getByRole("link", { name: "Log as CPD" });
    const url = new URL(log.getAttribute("href") ?? "", "https://psychiatry.tools");
    expect(url.pathname).toBe("/cme/new");
    expect([...url.searchParams.keys()]).toEqual(["title", "sourceUrl"]);
    expect(url.searchParams.get("title")).toBe("A & B");
    expect(url.searchParams.get("sourceUrl")).toBe("https://example.org/event?ref=list");
  });

  it("downloads the single-event ICS in the browser without fetching a server", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:learning-calendar");
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    try {
      render(<CmeLearningPage items={[item()]} lastCheckedOn="2026-09-26" nowIso={NOW_ISO} />);
      await user.click(screen.getByRole("button", { name: "Add to calendar" }));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      expect(click.mock.instances[0]).toHaveProperty("download", "synthetic-workshop.ics");
      expect(document.querySelector('a[href="blob:learning-calendar"]')).toBeNull();
    } finally {
      click.mockRestore();
    }
  });

  it("shows the empty state when nothing is upcoming", () => {
    render(<CmeLearningPage items={[item({ startsOn: "2026-09-01" })]} lastCheckedOn="2026-09-26" nowIso={NOW_ISO} />);
    expect(screen.getByTestId("cme-learning-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("cme-learning-item")).toBeNull();
  });

  it("warns that the list may be out of date after 45 days", () => {
    render(<CmeLearningPage items={[]} lastCheckedOn="2026-08-11" nowIso={NOW_ISO} />);
    expect(screen.getByTestId("cme-learning-stale")).toHaveTextContent(/may be out of date/i);
  });

  it("starts RANZCP at psychiatry, includes unspecialised events, and offers one-tap All", async () => {
    const user = userEvent.setup();
    render(
      <CmeLearningPage
        items={[
          item({ id: "all", title: "Every specialty" }),
          item({ id: "psychiatry", title: "Psychiatry event", specialties: ["psychiatry"] }),
          item({ id: "surgery", title: "Surgery event", specialties: ["surgery"] }),
        ]}
        lastCheckedOn="2026-09-26"
        nowIso={NOW_ISO}
        homeSource="au-ranzcp-2026-v1; https://example.org"
      />,
    );
    const specialty = screen.getByRole("radiogroup", { name: "Specialty" });
    expect(within(specialty).getByRole("radio", { name: "Psychiatry" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByTestId("cme-learning-item")).toHaveLength(2);
    expect(screen.getByText("Every specialty")).toBeInTheDocument();
    // "All" is the first option, always on screen: one tap back to every specialty.
    await user.click(within(specialty).getByRole("radio", { name: "All" }));
    expect(within(specialty).getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByTestId("cme-learning-item")).toHaveLength(3);
  });

  it("filters format and groups visible events by month", async () => {
    const user = userEvent.setup();
    render(
      <CmeLearningPage
        items={[
          item({ id: "october", title: "October online", mode: "online", startsOn: "2026-10-01" }),
          item({ id: "november", title: "November in person", mode: "in-person", startsOn: "2026-11-01" }),
        ]}
        lastCheckedOn="2026-09-26"
        nowIso={NOW_ISO}
      />,
    );
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("radiogroup", { name: "Format" })).getByRole("radio", { name: "Online" }));
    expect(screen.getAllByTestId("cme-learning-item")).toHaveLength(1);
    expect(screen.queryByText("November in person")).toBeNull();
  });

  it("shows hospital teaching only when a destination is supplied", () => {
    const { rerender } = render(<CmeLearningPage items={[]} lastCheckedOn="2026-09-26" nowIso={NOW_ISO} />);
    expect(screen.queryByRole("link", { name: "Your hospital's teaching" })).toBeNull();
    rerender(
      <CmeLearningPage items={[]} lastCheckedOn="2026-09-26" nowIso={NOW_ISO} hospitalTeachingHref="/teaching" />,
    );
    expect(screen.getByRole("link", { name: "Your hospital's teaching" })).toHaveAttribute("href", "/teaching");
  });

  it("does not warn at exactly 45 days", () => {
    render(<CmeLearningPage items={[]} lastCheckedOn="2026-08-12" nowIso={NOW_ISO} />);
    expect(screen.queryByTestId("cme-learning-stale")).toBeNull();
  });

  it("puts items with unconfirmed dates in their own section, never dropping them", () => {
    render(
      <CmeLearningPage
        items={[
          item({ id: "dated", title: "Dated event" }),
          item({ id: "undated", title: "Undated event", datesConfirmed: false, startsOn: null }),
          item({ id: "old-guess", title: "Old guess", datesConfirmed: false, startsOn: "2026-01-01" }),
        ]}
        lastCheckedOn="2026-09-26"
        nowIso={NOW_ISO}
      />,
    );
    const section = screen.getByTestId("cme-learning-unconfirmed");
    expect(within(section).getByRole("heading", { name: "Dates to confirm" })).toBeInTheDocument();
    expect(section).toHaveTextContent(
      "We couldn't confirm the date for these. Check the organiser's page before planning around them.",
    );
    expect(
      within(section)
        .getAllByTestId("cme-learning-item")
        .map((card) => within(card).getByRole("heading").textContent),
    ).toEqual(["Old guess", "Undated event"]);
    expect(within(section).getByText("Date not confirmed")).toBeInTheDocument();
    expect(screen.getAllByTestId("cme-learning-item")).toHaveLength(3);
  });

  it("keeps the unconfirmed section even when nothing dated is upcoming", () => {
    render(
      <CmeLearningPage
        items={[item({ datesConfirmed: false, startsOn: null })]}
        lastCheckedOn="2026-09-26"
        nowIso={NOW_ISO}
      />,
    );
    expect(screen.getByTestId("cme-learning-empty")).toBeInTheDocument();
    expect(screen.getByTestId("cme-learning-unconfirmed")).toBeInTheDocument();
  });
});
