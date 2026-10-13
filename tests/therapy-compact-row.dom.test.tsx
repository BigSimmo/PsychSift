import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Therapy } from "@/components/therapy-compass/data/types";

/**
 * Compact Therapy rows (owner-approved, October 2026).
 *
 * SAFETY: the Avoid / modify warning shows IN FULL at every width: no line
 * clamp, no truncation, no ellipsis, no "tap to read". "Best used for" and
 * "Best fit" leave the row and must still appear, word for word, in the record.
 */

const LONG_CAUTION =
  "Avoid or substantially modify where there is active psychosis, acute suicide risk without a safety plan, " +
  "severe cognitive impairment, intoxication at sessions, unmanaged mania, or an eating disorder with medical " +
  "instability, and confirm the main problem is not better matched to a more specific first-line therapy such " +
  "as exposure and response prevention, trauma-focused therapy or a structured personality therapy. " +
  "This second sentence belongs to the record, not the row.";

function therapy(overrides: Partial<Therapy> = {}): Therapy {
  return {
    slug: "act",
    name: "Acceptance and Commitment Therapy (ACT)",
    aliases: [],
    tags: ["Mood", "Anxiety", "Trauma"],
    category: "Behavioural",
    reviewStatus: "needs_review",
    briefInterventionAvailable: true,
    patientSheetAvailable: true,
    clinicalSummary: "A structured behavioural therapy.",
    bestUsedFor: "Most defensible routine psychiatric uses are depression and anxiety-spectrum distress.",
    targetSymptoms: "Experiential avoidance, cognitive fusion, rigid self-stories and behavioural restriction.",
    setting: "Outpatient clinic, group programme or telehealth.",
    patientPopulation: "Adults and adolescents with avoidance-driven distress.",
    timeRequired: "Eight to sixteen weekly sessions.",
    contraindicationsOrCautions: LONG_CAUTION,
    warnings: [],
    ...overrides,
  } as Therapy;
}

const bindingsState = vi.hoisted(() => ({ results: [] as Therapy[] }));

vi.mock("@/components/therapy-compass/bindings", () => ({
  useTcBindings: () => ({
    error: null,
    loading: false,
    retryData: vi.fn(),
    search: { query: "", tags: [], reviewedOnly: false, briefOnly: false, sheetOnly: false },
    searchResults: bindingsState.results,
    queryMatches: bindingsState.results,
    toggleTag: vi.fn(),
    toggleReviewedOnly: vi.fn(),
    toggleBriefOnly: vi.fn(),
    clearSearch: vi.fn(),
    clearSearchFilters: vi.fn(),
    isInCompare: () => false,
    workspaceHref: (href: string) => href,
    openSheet: vi.fn(),
    compareSlugs: [],
    addCompare: vi.fn(),
    removeCompare: vi.fn(),
    reviewCount: 12,
  }),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: false, isSaved: () => false, setFavourite: vi.fn() }),
}));

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

import { TherapyRecordSections } from "@/components/therapy-compass/record/record-sections";
import { SearchScreen } from "@/components/therapy-compass/screens/search-screen";
import { therapyAvoidModifyText } from "@/components/therapy-compass/therapy-card";

const CUT_CLASS = /(^|\s)(line-clamp-\d+|[a-z]+:line-clamp-\d+|truncate|text-ellipsis|max-h-[^\s]+)(\s|$)/;

describe("Therapy compact rows", () => {
  it("shows the Avoid / modify warning in full, with no clamp or ellipsis at any width", () => {
    bindingsState.results = [therapy()];
    render(<SearchScreen />);

    const avoid = document.querySelector<HTMLElement>("[data-therapy-result-avoid]");
    expect(avoid).not.toBeNull();
    const firstSentence = LONG_CAUTION.split(/(?<=\.)\s+/)[0]!;
    expect(therapyAvoidModifyText(therapy())).toBe(firstSentence);
    // The whole warning, character for character.
    expect(avoid!.textContent).toBe(`Avoid / modify: ${firstSentence}`);
    expect(avoid!.textContent).not.toContain("…");
    // Nothing in or around the warning may cut it, at any breakpoint.
    for (const node of [avoid!, ...Array.from(avoid!.querySelectorAll<HTMLElement>("*"))]) {
      expect(node.getAttribute("class") ?? "").not.toMatch(CUT_CLASS);
    }
    expect(avoid!.parentElement?.getAttribute("class") ?? "").not.toMatch(CUT_CLASS);
    // Warning colour, not muted text.
    expect(avoid!.className).toContain("text-[color:var(--warning-text)]");
  });

  it("is one row: the title opens the record and the actions are 48px icon controls", () => {
    bindingsState.results = [therapy()];
    render(<SearchScreen />);

    const row = document.querySelector<HTMLElement>("[data-therapy-result-card]")!;
    expect(row.tagName).toBe("LI");
    expect(within(row).getByRole("link", { name: "Acceptance and Commitment Therapy (ACT)" })).toHaveAttribute(
      "href",
      "/therapy-compass/act",
    );
    expect(within(row).queryByText("Best used for")).toBeNull();
    expect(within(row).queryByText("Best fit")).toBeNull();
    for (const name of [/Save .* to favourites/, /Add .* to compare/, /Patient sheet for/]) {
      const button = within(row).getByRole("button", { name });
      expect(button.className).toContain("w-tap");
    }
  });

  it("keeps the Review queue one tap away now that it has left the main tabs", () => {
    bindingsState.results = [therapy()];
    render(<SearchScreen />);

    const link = screen.getByTestId("therapy-review-queue-link");
    expect(link).toHaveAttribute("href", "/therapy-compass/review");
    expect(link).toHaveTextContent("Review queue");
    expect(link).toHaveTextContent("12 to review");
  });

  it("still shows what the row used for Best used for and Best fit, word for word, in the record", () => {
    const record = therapy();
    render(<TherapyRecordSections therapy={record} />);

    for (const text of [record.bestUsedFor, record.targetSymptoms, record.setting, record.patientPopulation]) {
      expect(screen.getByText(text!, { exact: false })).toBeInTheDocument();
    }
  });
});
