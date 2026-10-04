/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OnCallTeachingStrip } from "@/components/on-call/on-call-teaching-strip";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import type { OnCallTeachingSession } from "@/lib/on-call/teaching-schedule";

afterEach(cleanup);

function entry(slug: string, title: string): OnCallEntry {
  return {
    id: slug,
    slug,
    section: "education",
    title,
    subtitle: null,
    body: null,
    details: { topics: [] },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
  };
}

const JOURNAL_CLUB: OnCallTeachingSession = {
  entry: entry("journal-club", "Journal club"),
  date: "2026-09-17",
  when: "Thursday 1pm",
  presenter: "Dr Ng",
  location: "Seminar room 2",
  recordingUrl: "https://example-hospital-intranet.test/journal-club",
  isRecurring: true,
};

const GRAND_ROUNDS: OnCallTeachingSession = {
  entry: entry("grand-rounds", "Grand rounds"),
  date: "2026-10-01",
  when: null,
  presenter: "Prof Ash",
  location: null,
  recordingUrl: null,
  isRecurring: false,
};

describe("OnCallTeachingStrip", () => {
  it("renders nothing at all when there is nothing on", () => {
    const { container } = render(<OnCallTeachingStrip sessions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("prints a checkable date, not a countdown", () => {
    render(<OnCallTeachingStrip sessions={[JOURNAL_CLUB, GRAND_ROUNDS]} />);
    const card = screen.getByTestId("on-call-home-teaching-journal-club");
    expect(card).toHaveTextContent("Thu");
    expect(card).toHaveTextContent("17");
    expect(card).toHaveTextContent("Sep");
    expect(card.textContent ?? "").not.toMatch(/\bin \d+ days?\b/i);
    expect(card.textContent ?? "").not.toMatch(/tomorrow/i);
  });

  it("names the session, the presenter and the room", () => {
    render(<OnCallTeachingStrip sessions={[JOURNAL_CLUB]} />);
    const card = screen.getByTestId("on-call-home-teaching-journal-club");
    expect(card).toHaveTextContent("Journal club");
    expect(card).toHaveTextContent("Dr Ng");
    expect(card).toHaveTextContent("Seminar room 2");
  });

  it("marks the soonest session as next in words, not by colour alone", () => {
    render(<OnCallTeachingStrip sessions={[JOURNAL_CLUB, GRAND_ROUNDS]} />);
    const first = screen.getByTestId("on-call-home-teaching-journal-club");
    const second = screen.getByTestId("on-call-home-teaching-grand-rounds");
    const badge = within(first).getByTestId("on-call-home-teaching-next-badge");
    expect(badge).toHaveTextContent(/next/i);
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(within(second).queryByTestId("on-call-home-teaching-next-badge")).toBeNull();
  });

  it("marks a recording link as leaving the app", () => {
    render(<OnCallTeachingStrip sessions={[JOURNAL_CLUB, GRAND_ROUNDS]} />);
    const card = screen.getByTestId("on-call-home-teaching-journal-club");
    const recording = within(card).getByRole("link", { name: /recording/i });
    expect(recording).toHaveAttribute("href", "https://example-hospital-intranet.test/journal-club");
    expect(recording).toHaveAttribute("target", "_blank");
    expect(recording).toHaveAttribute("rel", "noopener noreferrer");
    expect(recording).toHaveTextContent(/opens in a new tab/i);
    expect(
      within(screen.getByTestId("on-call-home-teaching-grand-rounds")).queryByRole("link", { name: /recording/i }),
    ).toBeNull();
  });

  it("never draws a recording link that is not http or https", () => {
    const unsafe = { ...GRAND_ROUNDS, recordingUrl: "javascript:alert(1)" };
    render(<OnCallTeachingStrip sessions={[unsafe]} />);
    const card = screen.getByTestId("on-call-home-teaching-grand-rounds");
    expect(within(card).queryByRole("link", { name: /recording/i })).toBeNull();
    expect(card.innerHTML).not.toContain("javascript:");
  });

  it("opens the Teaching page from the card itself", () => {
    render(<OnCallTeachingStrip sessions={[GRAND_ROUNDS]} />);
    const card = screen.getByTestId("on-call-home-teaching-grand-rounds");
    const link = within(card).getByRole("link", { name: /grand rounds/i });
    expect(link).toHaveAttribute("href", "/teaching/week");
  });

  it("gives the day number tabular figures and hides every glyph from assistive tech", () => {
    render(<OnCallTeachingStrip sessions={[JOURNAL_CLUB]} />);
    const card = screen.getByTestId("on-call-home-teaching-journal-club");
    expect(card.querySelector(".nums")?.textContent).toBe("17");
    for (const svg of card.querySelectorAll("svg")) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("scrolls inside its own container so the page body never scrolls sideways", () => {
    render(<OnCallTeachingStrip sessions={[JOURNAL_CLUB, GRAND_ROUNDS]} />);
    const strip = screen.getByTestId("on-call-home-teaching-strip");
    expect(strip.className).toContain("overflow-x-auto");
    expect(strip.className).toContain("sm:flex-wrap");
  });
});
