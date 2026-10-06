/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => import("./helpers/teaching-auth"));

import { riskPhrase, sentChangeLines, sentChanges, seriesMeta } from "@/components/teaching/organise-model";
import { TeachingOrganise } from "@/components/teaching/teaching-organise";
import { demoOrganise } from "@/lib/teaching/demo-organise";
import type { SeriesRow } from "@/lib/teaching/model";

import { serveFetch, session, useTeachingTestClock } from "./helpers/teaching-fixtures";

// A shared fixture, not a component hook: it only registers Vitest's `beforeEach`/`afterEach`.
// eslint-disable-next-line react-hooks/rules-of-hooks
useTeachingTestClock();

const series = (overrides: Partial<SeriesRow> = {}): SeriesRow => ({
  seriesId: "55555555-5555-4555-8555-555555555555",
  title: "Registrar teaching",
  kind: "lecture",
  groupIds: [],
  repeat: "weekly",
  firstDate: "2026-10-06",
  startTime: "12:30",
  minutes: 60,
  venue: null,
  joinUrl: null,
  skipDates: [],
  endDate: "2026-12-15",
  presenterId: null,
  materials: [],
  lastConfirmedAt: null,
  audience: "all_doctors",
  ...overrides,
});

describe("Organise models (mock-up v5)", () => {
  it("words a series as repeat, weekday and time, and audience", () => {
    expect(seriesMeta(series())).toBe("Weekly · Tue 12:30 · everyone");
    expect(seriesMeta(series({ repeat: "fortnightly", startTime: "14:00", audience: "registrars" }))).toBe(
      "Fortnightly · Tue 14:00 · registrars",
    );
    expect(seriesMeta(series({ repeat: "monthly_nth", audience: undefined }))).toBe("Monthly · Tue 12:30");
  });

  it("lists moved and cancelled sessions as changes sent, without inventing a reason", () => {
    const changes = sentChanges([
      session({ status: "moved", venue: "Room B" }),
      session({ occurrenceId: "x", status: "scheduled" }),
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0].reason).toBeNull();
    expect(sentChangeLines(changes[0]).meta).toBe("Moved to Room B");
    expect(
      sentChangeLines({
        id: "c",
        title: "Case",
        date: "2027-01-26",
        status: "cancelled",
        venue: null,
        reason: "public holiday",
      }),
    ).toEqual({ title: "Case, Tue 26 Jan", meta: "Cancelled · public holiday" });
  });

  it("names a room risk as 'no room set' in the 48-hour list", () => {
    expect(riskPhrase({ occurrenceId: "o", rule: "room", text: "Room not confirmed" })).toBe("no room set");
    expect(riskPhrase({ occurrenceId: "o", rule: "clash", text: "Clashes with A at 12:30" })).toBe(
      "clashes with A at 12:30",
    );
  });

  it("keeps the demo organiser data made up and inside the next 48 hours", () => {
    const now = new Date();
    const demo = demoOrganise(now);
    for (const s of demo.soon) {
      expect(s.title.startsWith("Demo ")).toBe(true);
      if (s.venue) expect(s.venue.startsWith("Demo ")).toBe(true);
      expect(Date.parse(s.startsAt)).toBeLessThan(now.getTime() + 48 * 3_600_000);
      expect(Date.parse(s.endsAt)).toBeGreaterThan(now.getTime());
    }
    expect(demo.read.members.every((m) => m.name.startsWith("Demo "))).toBe(true);
    expect(demo.read.groups.map((g) => [g.name, g.userIds.length])).toEqual([
      ["Registrars", 12],
      ["Consultants", 6],
    ]);
  });
});

describe("Organise in the demo", () => {
  it("shows the v5 organiser screen in mock-up order, with the made-up notice first", async () => {
    const fetchMock = serveFetch(() => null);
    render(<TeachingOrganise demoMode />);
    expect(await screen.findByTestId("teaching-organise-demo")).toHaveTextContent(
      "no real invitations, membership changes or records are sent",
    );
    expect(screen.getByText("Demo teaching service")).toBeInTheDocument();
    const soon = screen.getByTestId("teaching-organise-soon");
    expect(soon).toHaveTextContent(/Next 48 hours · 3 · 1 to check/);
    expect(soon).toHaveTextContent("On now · 12 checked in");
    expect(soon).toHaveTextContent("Today · no room set");
    expect(within(soon).getByRole("button", { name: "Set room" })).toBeInTheDocument();
    const labels = ["Series · 3", "Groups and members", "Changes sent · 2", "Tools"].map((label) =>
      screen.getByText(label),
    );
    for (let i = 1; i < labels.length; i += 1)
      expect(labels[i - 1].compareDocumentPosition(labels[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Explore the roles")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps every action on the page and sends nothing", async () => {
    const fetchMock = serveFetch(() => null);
    render(<TeachingOrganise demoMode />);
    fireEvent.click(await screen.findByRole("button", { name: "Set room" }));
    fireEvent.change(screen.getByLabelText("Room"), { target: { value: "Demo room 2" } });
    fireEvent.click(screen.getByRole("button", { name: /^Post to 18\smembers$/ }));
    expect(await screen.findByText(/Demo only\. Nothing was sent/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Invite a member/ }));
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "a@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(await screen.findByText(/No invitation was created or sent/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
