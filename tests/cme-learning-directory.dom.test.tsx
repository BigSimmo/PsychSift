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
    expect(cards[1]).toHaveTextContent("Mon 2 Nov to Tue 3 Nov · Perth · Free for members");
    expect(cards[0]).toHaveTextContent("Thu 1 Oct, all day · Online · Free for members");
    expect(main).toHaveTextContent("Western Australia. Checked Sunday 20 September.");
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
    expect(screen.getAllByTestId("cme-learning-item")).toHaveLength(2);
    expect(screen.getByText("Every specialty")).toBeInTheDocument();
    // One quiet link says how many the preset hides and brings them back in one tap.
    const widen = screen.getByTestId("cme-learning-all-specialties");
    expect(widen).toHaveTextContent("Show 1 from other specialties");
    await user.click(widen);
    expect(screen.getAllByTestId("cme-learning-item")).toHaveLength(3);
    await user.click(screen.getByTestId("cme-learning-psychiatry-only"));
    expect(screen.getAllByTestId("cme-learning-item")).toHaveLength(2);
  });

  it("writes 24-hour times and every date with its weekday, and offers no specialty link when nothing is hidden", () => {
    render(
      <CmeLearningPage
        items={[
          item({ id: "timed", title: "Timed update", startsOn: "2026-10-24", startsAt: "08:30", endsAt: "16:30" }),
          item({ id: "evening", title: "Evening talk", startsOn: "2026-10-28", startsAt: "18:00" }),
          item({ id: "next-year", title: "Next year symposium", startsOn: "2027-02-13", costNote: null }),
        ]}
        lastCheckedOn="2026-09-26"
        nowIso={NOW_ISO}
      />,
    );
    const [timed, evening, nextYear] = screen.getAllByTestId("cme-learning-item");
    expect(timed).toHaveTextContent("Sat 24 Oct, 08:30 to 16:30 · Perth · Free for members");
    expect(evening).toHaveTextContent("Wed 28 Oct, from 18:00");
    expect(nextYear).toHaveTextContent("Sat 13 Feb 2027, all day · Perth");
    expect(screen.queryByTestId("cme-learning-all-specialties")).toBeNull();
  });

  it("shows hospital teaching only when a destination is supplied", () => {
    const { rerender } = render(<CmeLearningPage items={[]} lastCheckedOn="2026-09-26" nowIso={NOW_ISO} />);
    expect(screen.queryByRole("link", { name: /Your hospital's teaching/ })).toBeNull();
    rerender(
      <CmeLearningPage items={[]} lastCheckedOn="2026-09-26" nowIso={NOW_ISO} hospitalTeachingHref="/teaching" />,
    );
    const teaching = screen.getByRole("link", { name: /Your hospital's teaching/ });
    expect(teaching).toHaveAttribute("href", "/teaching");
    expect(teaching).toHaveTextContent("In Teaching");
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
    expect(within(section).getByRole("heading", { name: "Date not confirmed · 2" })).toBeInTheDocument();
    expect(section).toHaveTextContent("No date yet. Check the organiser's page before you plan.");
    // Details only: no Log as CPD or calendar for a date nobody has confirmed.
    expect(within(section).queryByRole("link", { name: "Log as CPD" })).toBeNull();
    expect(within(section).queryByRole("button", { name: "Add to calendar" })).toBeNull();
    expect(
      within(section)
        .getAllByTestId("cme-learning-item")
        .map((card) => within(card).getByRole("heading").textContent),
    ).toEqual(["Old guess", "Undated event"]);
    expect(within(section).getAllByText("Date not confirmed")).toHaveLength(2);
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

  it("chips the next two, then splits this year from next year with the year shown", () => {
    render(
      <CmeLearningPage
        items={[
          item({ id: "a", title: "A", startsOn: "2026-09-27" }),
          item({ id: "b", title: "B", startsOn: "2026-10-16" }),
          item({ id: "c", title: "C", startsOn: "2026-12-01" }),
          item({ id: "d", title: "D", startsOn: "2027-02-03" }),
          item({ id: "e", title: "E", kind: "recorded", startsOn: null, endsOn: null }),
        ]}
        lastCheckedOn="2026-09-26"
        nowIso={NOW_ISO}
      />,
    );
    const chips = screen.getAllByTestId("cme-learning-countdown");
    expect(chips.map((chip) => chip.textContent)).toEqual(["Tomorrow", "In 20 days"]);
    const later = screen.getByTestId("cme-learning-later-this-year");
    expect(later).toHaveTextContent("Later this year · 1");
    expect(within(later).queryByTestId("cme-learning-countdown")).toBeNull();
    const nextYear = screen.getByTestId("cme-learning-next-year");
    expect(nextYear).toHaveTextContent("Next year and any time · 2");
    expect(nextYear).toHaveTextContent("Wed 3 Feb 2027");
    expect(nextYear).toHaveTextContent("Online · watch any time");
    expect(screen.getByTestId("cme-learning-next")).toHaveTextContent("Sun 27 Sep, all day");
    expect(within(nextYear).getAllByRole("link", { name: "Log as CPD" })).toHaveLength(2);
  });
});
