import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SharedHomeEmptyState } from "@/components/clinical-dashboard/answer-status";
import { appModeIds, type AppModeId } from "@/lib/app-modes";
import { sharedHomePresentation, type SharedHomePresentation } from "@/lib/ui-copy";

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const expectedPresentations = [
  {
    modeId: "answer",
    title: "Clinical Answers",
    subtitle: "Ask a clinical question or search your documents.",
    iconClass: "lucide-sparkles",
  },
  {
    modeId: "documents",
    title: "Clinical Documents",
    subtitle: "Open, browse, and continue reading your clinical sources.",
    iconClass: "lucide-file-text",
  },
  {
    modeId: "services",
    title: "Clinical Services",
    subtitle: "Search by need, catchment, or route.",
    iconClass: "lucide-route",
  },
  {
    modeId: "forms",
    title: "Clinical Forms",
    subtitle: "The WA MHA 2014 forms register.",
    iconClass: "lucide-file-pen-line",
  },
  {
    modeId: "favourites",
    title: "Favourites",
    subtitle: "Saved notes, sources, and sets.",
    iconClass: "lucide-heart",
  },
  {
    modeId: "differentials",
    title: "Differential Diagnosis",
    subtitle: "Differential diagnosis, clinical presentations, and workups.",
    iconClass: "lucide-brain-circuit",
  },
  {
    modeId: "dsm",
    title: "DSM-5 Diagnosis",
    subtitle: "Criteria, specifiers, and comparisons.",
    iconClass: "lucide-book-open-check",
  },
  {
    modeId: "specifiers",
    title: "Diagnostic Specifiers",
    subtitle: "Check specifier fit and exclusions.",
    iconClass: "lucide-tags",
  },
  {
    modeId: "formulation",
    title: "Clinical Formulation",
    subtitle: "Build a formulation from the evidence.",
    iconClass: "lucide-network",
  },
  {
    modeId: "prescribing",
    title: "Medication Reference",
    subtitle: "Medication dosing and safety.",
    iconClass: "lucide-pill",
  },
  {
    modeId: "tools",
    title: "Clinical Tools",
    subtitle: "Clinical tools and applications.",
    iconClass: "lucide-wrench",
  },
  {
    modeId: "calculators",
    title: "Clinical Calculators",
    subtitle:
      "Psychiatry assessment and monitoring tools with scoring guidance, limitations, safety prompts, and source-linked clinical considerations.",
    iconClass: "lucide-calculator",
  },
  {
    modeId: "therapy-compass",
    title: "Therapy",
    subtitle: "Source-grounded therapy records.",
    iconClass: "lucide-compass",
  },
  {
    modeId: "factsheets",
    title: "Patient Factsheets",
    subtitle: "Plain-language patient handouts.",
    iconClass: "lucide-book-open-text",
  },
  {
    modeId: "dictionary",
    title: "Clinical Dictionary",
    subtitle: "Source-governed psychiatric terms, abbreviations, and distinctions.",
    iconClass: "lucide-book-marked",
  },
  {
    modeId: "sources",
    title: "Sources",
    subtitle: "Clinical source catalogue.",
    iconClass: "lucide-library-big",
  },
  {
    modeId: "on-call",
    title: "On Call",
    subtitle: "Your service's numbers, escalation, orientation and teaching.",
    iconClass: "lucide-phone-call",
  },
  {
    modeId: "cme",
    title: "CPD",
    subtitle: "What you have done this year, and what is still short.",
    iconClass: "lucide-graduation-cap",
  },
  {
    modeId: "teaching",
    title: "Teaching",
    subtitle: "This week's sessions, check-in and your attendance record.",
    iconClass: "lucide-presentation",
  },
  {
    modeId: "psychiatry",
    title: "Psychiatry",
    subtitle: "Diagnosis, specifiers, formulation, therapy and forms.",
    iconClass: "lucide-brain",
  },
  {
    modeId: "my-work",
    title: "Admin",
    subtitle: "The paperwork around hospital work, with what to start first.",
    iconClass: "lucide-clipboard-list",
  },
  {
    modeId: "roster",
    title: "Roster",
    subtitle: "Your own shifts: what's on today, this week and this month.",
    iconClass: "lucide-calendar-range",
  },
  {
    modeId: "first-nations",
    title: "First Nations",
    subtitle: "Culturally safe care for Aboriginal and Torres Strait Islander patients.",
    iconClass: "lucide-users",
  },
  {
    modeId: "my-day",
    title: "My Day",
    subtitle: "What needs you today, across On Call, Roster, CPD, Teaching and Admin.",
    iconClass: "lucide-sunrise",
  },
  {
    modeId: "medicines",
    title: "Medicines & tools",
    subtitle: "Medication, calculators, clinical tools, factsheets and the dictionary.",
    iconClass: "lucide-pill",
  },
] as const satisfies ReadonlyArray<{
  modeId: AppModeId;
  title: string;
  subtitle: string;
  iconClass: string;
}>;

describe("SharedHomeEmptyState", () => {
  it("covers every current app mode exactly once", () => {
    expect(expectedPresentations.map(({ modeId }) => modeId)).toEqual(appModeIds);
  });

  it.each(expectedPresentations)(
    "renders the canonical $modeId presentation",
    ({ modeId, title, subtitle, iconClass }) => {
      const { container } = render(<SharedHomeEmptyState modeId={modeId} />);

      expect(screen.getByTestId("shared-home-empty-state")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
      // `/` is the only home most modes have, so it carries the mode's own
      // subtitle rather than a bare title. The copy-reserve band below is sized
      // for exactly this title/subtitle pair.
      expect(container.querySelector("h2 + p")).toHaveTextContent(subtitle);

      const icon = container.querySelector(".mode-home-icon svg");
      expect(icon).toHaveClass(iconClass);
      expect(icon).toHaveAttribute("aria-hidden", "true");

      // No mode home carries a caveat line under the composer any more. The
      // shared-home table now also feeds mode-specific starter suggestions, so
      // the contract is title + subtitle + suggestions — and nothing else.
      const presentation: SharedHomePresentation = sharedHomePresentation[modeId];
      expect(Object.keys(presentation).sort()).toEqual(["subtitle", "suggestions", "title"]);
    },
  );

  it("reserves the phone copy height once on the pair, never on each half", () => {
    const { container } = render(<SharedHomeEmptyState modeId="answer" />);

    const heading = screen.getByRole("heading", { level: 2, name: sharedHomePresentation.answer.title });
    const copyWrapper = heading.parentElement;

    expect(copyWrapper).not.toBeNull();
    expect(copyWrapper?.children).toHaveLength(2);

    // The reserve belongs to the wrapping pair. Keep it on the pair wrapper
    // rather than on each element individually.
    expect(copyWrapper?.className).toContain("max-sm:min-h-[var(--mode-home-copy-reserve)]");
    expect(copyWrapper?.className).toContain("max-sm:content-center");
    expect(heading.className).not.toContain("min-h-[2lh]");
    expect(heading.className).not.toContain("max-sm:place-items-center");

    // The medallion tracks the fluid token rather than stepping at sm/lg, so
    // the 768-1023px tablet band stops being served the phone size.
    const medallion = container.querySelector(".mode-home-icon");
    expect(medallion?.className).toContain("size-hero-medallion");
    expect(medallion?.className).not.toContain("h-tap w-tap");
  });

  it("keeps the copy reserve banded to the measured wrap points", () => {
    const globalsSource = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

    // Bands measured in Chromium across every title/subtitle pair in
    // src/lib/ui-copy.ts. If copy changes push a mode onto another line the
    // band it belongs to must move with it, or the mode toggle jumps again.
    const oneByOne = "calc(var(--text-hero) * var(--leading-display) + 0.25rem + 1.25rem)";
    const twoByOne = "calc(2 * var(--text-hero) * var(--leading-display) + 0.25rem + 1.25rem)";
    const twoByTwo = "calc(2 * var(--text-hero) * var(--leading-display) + 0.25rem + 2 * 1.25rem)";

    expect(globalsSource).toContain(`--mode-home-copy-reserve: ${twoByOne}`);
    expect(globalsSource).toMatch(
      new RegExp(`@media \\(max-width: 322px\\)[\\s\\S]{0,120}--mode-home-copy-reserve: ${escapeForRegExp(twoByTwo)}`),
    );
    expect(globalsSource).toMatch(
      new RegExp(`@media \\(min-width: 412px\\)[\\s\\S]{0,120}--mode-home-copy-reserve: ${escapeForRegExp(oneByOne)}`),
    );
  });

  it("updates the same shared-home root when the active mode changes", () => {
    const { rerender } = render(<SharedHomeEmptyState modeId="answer" />);
    const sharedHomeRoot = screen.getByTestId("shared-home-empty-state");

    expect(sharedHomeRoot.querySelector(".mode-home-icon svg")).toHaveClass("lucide-sparkles");

    rerender(<SharedHomeEmptyState modeId="services" />);

    expect(screen.getByTestId("shared-home-empty-state")).toBe(sharedHomeRoot);
    expect(screen.getByRole("heading", { level: 2, name: "Clinical Services" })).toBeInTheDocument();
    expect(sharedHomeRoot.querySelector(".mode-home-icon svg")).toHaveClass("lucide-route");
    expect(screen.queryByText(sharedHomePresentation.answer.title, { exact: true })).not.toBeInTheDocument();
  });
});
