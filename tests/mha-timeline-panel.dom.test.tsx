import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { timeframeContentSha256, type MhaTimeframeEntry } from "@/lib/mha-timeline";
import timeframes from "../data/mha-timeframes.json";

/**
 * `fixtureEntries`, when set, replaces the shipped timeframes for the panel. The shipped file is
 * all drafted (agents never sign), so a signed-off entry can only be exercised through a fixture.
 * Its quote is invented on purpose: this file tests rendering, not statutory content.
 */
const control = vi.hoisted(() => ({ fixtureEntries: null as MhaTimeframeEntry[] | null }));

vi.mock("@/lib/mha-timeline", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/mha-timeline")>();
  return {
    ...original,
    timelineFor: (formCode: string, start: Date | null) =>
      control.fixtureEntries
        ? original.timelineFor(formCode, start, control.fixtureEntries)
        : original.timelineFor(formCode, start),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/forms/test-form",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
  }),
}));

import { FormDetailPage, formNavSections } from "@/components/forms/form-detail-page";
import {
  MHA_TIMELINE_AWAITING_REVIEW,
  MHA_TIMELINE_AWAITING_REVIEW_SHORT,
  MHA_TIMELINE_NOT_CALCULABLE,
  MHA_TIMELINE_REFERENCE_NOTE,
  MhaTimelinePanel,
} from "@/components/forms/mha-timeline-panel";
import { formSlug } from "@/lib/form-register";
import { getFormRecord } from "@/lib/forms";
import { mhaActMetadata } from "@/lib/mha-act-sections";

afterEach(() => {
  cleanup();
  control.fixtureEntries = null;
});

describe("MhaTimelinePanel with unsigned copies of the shipped entries", () => {
  it("shows the fixed note, a labelled input, each quote and Act link, and no calculated time", async () => {
    const user = userEvent.setup();
    control.fixtureEntries = timeframes.entries.map((entry) => ({
      ...entry,
      status: "drafted",
      reviewedBy: null,
      reviewedAt: null,
      reviewedContentSha256: null,
    })) as MhaTimeframeEntry[];
    render(<MhaTimelinePanel formCode="3A" />);

    const panel = screen.getByRole("region", { name: "Timeline" });
    expect(within(panel).getByText(MHA_TIMELINE_REFERENCE_NOTE)).toBeInTheDocument();
    expect(MHA_TIMELINE_REFERENCE_NOTE).toBe("Reference only — check against the Act and your service's procedure.");

    const input = within(panel).getByLabelText("When was this made?");
    expect(input).toHaveAttribute("type", "datetime-local");
    // Design audit D01: the record starts its clock, carrying the form across.
    expect(within(panel).getByTestId("mha-timeline-start-clock")).toHaveAttribute("href", "/forms/clock?form=3A");

    const items = within(panel).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.querySelector("blockquote")?.textContent).toMatch(/\d+ hours/);
      const link = within(item).getByRole("link", { name: /Mental Health Act 2014 \(WA\) s 28/ });
      expect(link).toHaveAttribute("href", mhaActMetadata.sourceUrl);
      // Every s 28 limit carries the quoted s 28(11) referral-expiry caveat.
      expect(within(item).getByTestId("mha-timeline-caveat")).toHaveTextContent(
        "The person cannot continue to be detained if the referral expires",
      );
    }
    // No s 28 limit is ever calculated: each also ends when the referral expires (s 28(11)).
    // Drafted, so each also says it is awaiting clinical review (the short form, not the
    // "time not calculated" wording twice).
    for (const item of items) {
      expect(within(item).getByText(MHA_TIMELINE_NOT_CALCULABLE)).toBeInTheDocument();
      expect(within(item).getByText(MHA_TIMELINE_AWAITING_REVIEW_SHORT)).toBeInTheDocument();
    }
    expect(within(panel).queryByText(MHA_TIMELINE_AWAITING_REVIEW)).toBeNull();
    expect(
      within(panel).getByText(
        "Perth time (AWST). No time is calculated yet: every limit below is awaiting clinical review.",
      ),
    ).toBeInTheDocument();
    // The non-metropolitan ceiling shows its stem, elided, before its own limb.
    expect(items[2].querySelector("blockquote")?.textContent).toMatch(
      /^“The person cannot be detained under orders made under this section for a continuous period of more than — … \(b\)if/,
    );

    // Entering a start time must not make a drafted entry show a time.
    await user.type(input, "2026-09-25T10:00");
    expect(panel.querySelector("time")).toBeNull();
  });

  it("shows the Form 5A condition prominently", () => {
    render(<MhaTimelinePanel formCode="5A" />);
    const panel = screen.getByRole("region", { name: "Timeline" });
    expect(within(panel).getByTestId("mha-timeline-condition")).toHaveTextContent(
      /^Only if this community treatment order was made under section 75/,
    );
  });

  it("renders nothing for a form with no timeframes", () => {
    const { container } = render(<MhaTimelinePanel formCode="not-a-form" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MhaTimelinePanel with a signed-off entry", () => {
  it("shows a Perth time only once a start is entered, and only for the reviewed entry", async () => {
    const reviewedFixture: MhaTimeframeEntry = {
      id: "fixture-reviewed",
      formCodes: ["3A"],
      trigger: "Reviewed fixture",
      section: "28",
      sourceTextSha256: "a".repeat(64),
      quote: "fixture quote stating 24 hours",
      duration: { value: 24, unit: "hours" },
      anchor: "Fixture anchor",
      status: "reviewed",
      reviewedBy: "Fixture Reviewer",
      reviewedAt: "2026-09-25T02:00:00Z",
      reviewedContentSha256: null,
    };
    control.fixtureEntries = [
      { ...reviewedFixture, reviewedContentSha256: timeframeContentSha256(reviewedFixture) },
      {
        id: "fixture-drafted",
        formCodes: ["3A"],
        trigger: "Drafted fixture",
        section: "28",
        sourceTextSha256: "a".repeat(64),
        quote: "fixture quote stating 72 hours",
        duration: { value: 72, unit: "hours" },
        anchor: "Fixture anchor",
        status: "drafted",
        reviewedBy: null,
        reviewedAt: null,
        reviewedContentSha256: null,
      },
    ];
    const user = userEvent.setup();
    render(<MhaTimelinePanel formCode="3A" />);
    const panel = screen.getByRole("region", { name: "Timeline" });

    expect(within(panel).getByText("Enter when this was made to see the Perth time.")).toBeInTheDocument();
    expect(panel.querySelector("time")).toBeNull();

    await user.type(within(panel).getByLabelText("When was this made?"), "2026-09-25T10:00");

    const [reviewedItem, draftedItem] = within(panel).getAllByRole("listitem");
    const time = reviewedItem.querySelector("time");
    expect(time).toHaveTextContent("Sat 26 Sep 2026, 10:00 (Perth time)");
    expect(time).toHaveAttribute("dateTime", "2026-09-26T02:00:00.000Z");
    expect(draftedItem.querySelector("time")).toBeNull();
    expect(within(draftedItem).getByText(MHA_TIMELINE_AWAITING_REVIEW)).toBeInTheDocument();
  });
});

describe("MhaTimelinePanel with a signed-off entry that is never calculated", () => {
  it("drops the awaiting-review line and the form-level awaiting-review hint once every entry is signed off", () => {
    const blocked: MhaTimeframeEntry = {
      id: "fixture-blocked",
      formCodes: ["3A"],
      trigger: "Signed-off, not calculable fixture",
      section: "28",
      sourceTextSha256: "a".repeat(64),
      quote: "fixture quote stating 24 hours",
      duration: { value: 24, unit: "hours" },
      anchor: "Fixture anchor",
      computeAllowed: false,
      status: "reviewed",
      reviewedBy: "Fixture Reviewer",
      reviewedAt: "2026-09-25T02:00:00Z",
      reviewedContentSha256: null,
    };
    control.fixtureEntries = [{ ...blocked, reviewedContentSha256: timeframeContentSha256(blocked) }];
    render(<MhaTimelinePanel formCode="3A" />);
    const panel = screen.getByRole("region", { name: "Timeline" });

    expect(within(panel).getByText(MHA_TIMELINE_NOT_CALCULABLE)).toBeInTheDocument();
    expect(within(panel).queryByText(MHA_TIMELINE_AWAITING_REVIEW_SHORT)).toBeNull();
    expect(within(panel).queryByText(MHA_TIMELINE_AWAITING_REVIEW)).toBeNull();
    expect(panel).not.toHaveTextContent(/awaiting clinical review/i);
    expect(
      within(panel).getByText("Perth time (AWST). No time is calculated for the limits below."),
    ).toBeInTheDocument();
  });
});

describe("Form detail page Timeline section", () => {
  it("is declared after Priority facts in the in-page navigation", () => {
    const ids = formNavSections.map((section) => section.id);
    expect(ids.indexOf("form-timeline")).toBe(ids.indexOf("form-priority-facts") + 1);
  });

  it("renders after Priority facts on a form with timeframes", () => {
    const form = getFormRecord(formSlug("3A"));
    if (!form) throw new Error("Expected Form 3A");
    const { container } = render(<FormDetailPage form={form} />);

    const timeline = container.querySelector("#form-timeline");
    const priorityFacts = container.querySelector("#form-priority-facts");
    expect(timeline).not.toBeNull();
    expect(priorityFacts!.compareDocumentPosition(timeline!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is absent on a form without timeframes", () => {
    const form = getFormRecord(formSlug("1A"));
    if (!form) throw new Error("Expected Form 1A");
    const { container } = render(<FormDetailPage form={form} />);
    expect(container.querySelector("#form-timeline")).toBeNull();
    expect(container.querySelector("#form-priority-facts")).not.toBeNull();
  });
});
