// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OwnerTodaySection } from "@/components/developer-area/hub/owner-today-section";
import type { OwnerToday } from "@/lib/developer-area/owner-today";
import type { SignOffToday } from "@/lib/developer-area/sign-off-today";

function today(signOff: SignOffToday): OwnerToday {
  return { decisions: [], privacy: [], uncontrolledHazards: 0, signOff };
}

const twoRows: SignOffToday = {
  waiting: 40,
  signable: 12,
  rows: [
    {
      family: "wa-mha-forms",
      key: "form:form-3c",
      id: "form-3c",
      title: "Form 3C — Synthetic form",
      nativeStatus: "drafted",
      statusLabel: "Drafted, no clinician sign-off",
      requires: "A named reviewer signs it.",
      href: "/forms/form-3c",
      signOff: { script: "clinical:review", kind: "form", code: "3C" },
      familyName: "WA Mental Health Act forms",
      command: 'npm run clinical:review -- --write --kind form --code "3C" --reviewed-by',
    },
    {
      family: "sources",
      key: "source-acquisition:src-1",
      id: "src-1",
      title: "Synthetic source",
      nativeStatus: "candidate",
      statusLabel: "Captured, not yet verified",
      requires: "The owner verifies it.",
      href: null,
      signOff: { script: "clinical:review", kind: "source", code: "src-1" },
      familyName: "Source acquisitions",
      command: 'npm run clinical:review -- --write --kind source --code "src-1" --reviewed-by',
    },
  ],
};

describe("Owner panel: Sign off today", () => {
  it("lists each record with its own signing command, in order", () => {
    render(<OwnerTodaySection today={today(twoRows)} />);
    const list = screen.getByTestId("owner-panel-sign-off-today-list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Form 3C");
    expect(items[0]).toHaveTextContent('--code "3C"');
    expect(items[1]).toHaveTextContent("--kind source");
  });

  it("links a record that has a page and leaves one without a page unlinked", () => {
    render(<OwnerTodaySection today={today(twoRows)} />);
    expect(screen.getByRole("link", { name: "Form 3C — Synthetic form" })).toHaveAttribute("href", "/forms/form-3c");
    expect(screen.queryByRole("link", { name: "Synthetic source" })).toBeNull();
  });

  it("has no control that could sign anything", () => {
    render(<OwnerTodaySection today={today(twoRows)} />);
    const section = screen.getByTestId("owner-panel-sign-off-today");
    expect(within(section).queryAllByRole("button")).toEqual([]);
    expect(section.querySelector("form, input")).toBeNull();
  });

  it("states the waiting and signable totals", () => {
    render(<OwnerTodaySection today={today(twoRows)} />);
    expect(screen.getByTestId("owner-panel-today-summary")).toHaveTextContent("40 records awaiting sign-off");
    expect(screen.getByTestId("owner-panel-sign-off-today")).toHaveTextContent(
      "Of 40 records waiting, 12 can be signed",
    );
  });

  it("says plainly when nothing can be signed rather than showing an empty list", () => {
    render(<OwnerTodaySection today={today({ rows: [], waiting: 5, signable: 0 })} />);
    expect(screen.queryByTestId("owner-panel-sign-off-today-list")).toBeNull();
    expect(screen.getByTestId("owner-panel-sign-off-today")).toHaveTextContent("No record the sign-off tools can sign");
  });
});
