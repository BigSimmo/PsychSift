import { describe, expect, it } from "vitest";

import { appModeIds, type AppModeId } from "@/lib/app-modes";
import {
  answerLoading,
  answerRecovery,
  copyButton,
  emptyStates,
  errorCopy,
  privacyCopy,
  sharedHomeEmptyState,
  sharedHomePresentation,
  specifierBuilderCopy,
  type SharedHomePresentation,
} from "@/lib/ui-copy";

/**
 * Expected mapping between shared home presentations at `/` and standalone mode home titles.
 *
 * The shared home at `/` uses full descriptive clinical headings, while standalone
 * mode components (*-home-page.tsx, medication-prescribing-workspace.tsx, etc.) use
 * concise titles (or identical titles where concise is already canonical).
 */
const EXPECTED_MODE_TITLES: Record<
  AppModeId,
  {
    sharedTitle: string;
    standaloneTitle: string;
    subtitle: string;
  }
> = {
  answer: {
    sharedTitle: "Clinical Answers",
    standaloneTitle: "Clinical Answers",
    subtitle: "Ask a clinical question or search your documents.",
  },
  documents: {
    sharedTitle: "Clinical Documents",
    standaloneTitle: "Documents",
    subtitle: "Open, browse, and continue reading your clinical sources.",
  },
  services: {
    sharedTitle: "Clinical Services",
    standaloneTitle: "Services",
    subtitle: "Search by need, catchment, or route.",
  },
  forms: {
    sharedTitle: "Clinical Forms",
    standaloneTitle: "Forms",
    subtitle: "The WA MHA 2014 forms register.",
  },
  favourites: {
    sharedTitle: "Favourites",
    standaloneTitle: "Favourites",
    subtitle: "Saved notes, sources, and sets.",
  },
  differentials: {
    sharedTitle: "Differential Diagnosis",
    standaloneTitle: "Differentials",
    subtitle: "Differential diagnosis, clinical presentations, and workups.",
  },
  dsm: {
    sharedTitle: "DSM-5 Diagnosis",
    standaloneTitle: "DSM-5 Diagnosis",
    subtitle: "Criteria, specifiers, and comparisons.",
  },
  specifiers: {
    sharedTitle: "Diagnostic Specifiers",
    standaloneTitle: "Specifiers",
    subtitle: "Check specifier fit and exclusions.",
  },
  formulation: {
    sharedTitle: "Clinical Formulation",
    standaloneTitle: "Formulation",
    subtitle: "Build a formulation from the evidence.",
  },
  prescribing: {
    sharedTitle: "Medication Reference",
    standaloneTitle: "Medication",
    subtitle: "Medication dosing and safety.",
  },
  tools: {
    sharedTitle: "Clinical Tools",
    standaloneTitle: "Tools",
    subtitle: "Clinical tools and applications.",
  },
  calculators: {
    sharedTitle: "Clinical Calculators",
    standaloneTitle: "Clinical Calculators",
    subtitle:
      "Psychiatry assessment and monitoring tools with scoring guidance, limitations, safety prompts, and source-linked clinical considerations.",
  },
  "therapy-compass": {
    sharedTitle: "Therapy",
    standaloneTitle: "Therapy",
    subtitle: "Source-grounded therapy records.",
  },
  factsheets: {
    sharedTitle: "Patient Factsheets",
    standaloneTitle: "Factsheets",
    subtitle: "Plain-language patient handouts.",
  },
  dictionary: {
    sharedTitle: "Clinical Dictionary",
    standaloneTitle: "Dictionary",
    subtitle: "Source-governed psychiatric terms, abbreviations, and distinctions.",
  },
  sources: {
    sharedTitle: "Sources",
    standaloneTitle: "Sources",
    subtitle: "Clinical source catalogue.",
  },
  "on-call": {
    sharedTitle: "On Call",
    standaloneTitle: "On Call",
    subtitle: "Your service's numbers, escalation, orientation and teaching.",
  },
  cme: {
    sharedTitle: "CPD",
    standaloneTitle: "CPD",
    subtitle: "What you have done this year, and what is still short.",
  },
  teaching: {
    sharedTitle: "Teaching",
    standaloneTitle: "Teaching",
    subtitle: "This week's sessions, check-in and your attendance record.",
  },
  psychiatry: {
    sharedTitle: "Psychiatry",
    standaloneTitle: "Psychiatry",
    subtitle: "Diagnosis, specifiers, formulation, therapy and forms.",
  },
  medicines: {
    sharedTitle: "Medicines & tools",
    standaloneTitle: "Medicines & tools",
    subtitle: "Medication, calculators, clinical tools, factsheets and the dictionary.",
  },
  "my-work": {
    sharedTitle: "Admin",
    standaloneTitle: "Admin",
    subtitle: "The paperwork around hospital work, with what to start first.",
  },
  roster: {
    sharedTitle: "Roster",
    standaloneTitle: "Roster",
    subtitle: "Your own shifts: what's on today, this week and this month.",
  },
  "first-nations": {
    sharedTitle: "First Nations",
    standaloneTitle: "First Nations",
    subtitle: "Culturally safe care for Aboriginal and Torres Strait Islander patients.",
  },
  "my-day": {
    sharedTitle: "My Day",
    standaloneTitle: "My Day",
    subtitle: "What needs you today, across On Call, Roster, CPD, Teaching and Admin.",
  },
  "open-shifts": {
    sharedTitle: "Open shifts",
    standaloneTitle: "Open shifts",
    subtitle: "Extra shifts in your Roster teams.",
  },
};

describe("ui-copy", () => {
  describe("sharedHomePresentation", () => {
    it("covers every declared app mode exactly once", () => {
      const definedModes = Object.keys(sharedHomePresentation) as AppModeId[];
      expect(definedModes.sort()).toEqual([...appModeIds].sort());
      expect(definedModes).toHaveLength(26);
    });

    it.each(appModeIds)("provides non-empty title and subtitle for %s", (modeId) => {
      const presentation: SharedHomePresentation = sharedHomePresentation[modeId];
      expect(presentation).toBeDefined();
      expect(typeof presentation.title).toBe("string");
      expect(presentation.title.trim().length).toBeGreaterThan(0);
      expect(typeof presentation.subtitle).toBe("string");
      expect(presentation.subtitle.trim().length).toBeGreaterThan(0);
      if ("suggestions" in presentation && presentation.suggestions) {
        expect(Array.isArray(presentation.suggestions)).toBe(true);
      }
    });

    it.each(appModeIds)("reconciles %s titles with expected shared and standalone titles", (modeId) => {
      const presentation = sharedHomePresentation[modeId];
      const expected = EXPECTED_MODE_TITLES[modeId];

      expect(presentation.title).toBe(expected.sharedTitle);
      expect(presentation.subtitle).toBe(expected.subtitle);
      expect(expected.standaloneTitle.trim().length).toBeGreaterThan(0);
    });

    it("ensures all subtitles end with punctuation and contain no un-trimmed whitespace", () => {
      for (const modeId of appModeIds) {
        const presentation = sharedHomePresentation[modeId];
        expect(presentation.title).toBe(presentation.title.trim());
        expect(presentation.subtitle).toBe(presentation.subtitle.trim());
        expect(presentation.subtitle).toMatch(/[.!?]$/);
      }
    });

    it("pins Therapy title to 'Therapy' (not 'Therapy Compass')", () => {
      expect(sharedHomePresentation["therapy-compass"].title).toBe("Therapy");
    });

    it("publishes the exact Sources starter suggestions", () => {
      expect(sharedHomePresentation.sources.suggestions).toEqual([
        "Australian guidelines",
        "RANZCP",
        "review required",
      ]);
    });
  });

  describe("sharedHomeEmptyState", () => {
    it("exports valid labels for starter actions and recents", () => {
      expect(sharedHomeEmptyState.starterActionsLabel).toBe("Starter actions");
      expect(sharedHomeEmptyState.recentLabel).toBe("Recent searches");
    });
  });

  describe("answerRecovery copy", () => {
    it("exports non-empty recovery action labels and guidance", () => {
      expect(answerRecovery.retry).toBe("Retry");
      expect(answerRecovery.searchDocuments).toBe("Search documents instead");
      expect(answerRecovery.rephrase).toBe("Rephrase question");
      expect(answerRecovery.failureHint).toBeTruthy();
      expect(answerRecovery.noResults.heading).toBeTruthy();
      expect(answerRecovery.noResults.body).toBeTruthy();
    });
  });

  describe("specifierBuilderCopy", () => {
    it("exports hero, steps, navigation, and review copy", () => {
      expect(specifierBuilderCopy.hero.title).toBeTruthy();
      expect(specifierBuilderCopy.steps.base.title).toBeTruthy();
      expect(specifierBuilderCopy.steps.episodeFeatures.title).toBeTruthy();
      expect(specifierBuilderCopy.steps.courseOnset.title).toBeTruthy();
      expect(specifierBuilderCopy.steps.severityRemission.title).toBeTruthy();
      expect(specifierBuilderCopy.navigation.previous).toBe("Previous");
      expect(specifierBuilderCopy.review.title).toBeTruthy();
    });
  });

  describe("emptyStates, privacyCopy, and errorCopy", () => {
    it("exports valid copy structures", () => {
      expect(copyButton.copied).toBe("Copied");
      expect(answerLoading.ariaLabel).toBe("Loading answer");
      expect(privacyCopy.pageEyebrow).toBe("Privacy");
      expect(privacyCopy.pageTitle).toBe("How PsychSift handles your data");
      expect(errorCopy.searchSetupNotReady).toBeTruthy();
      expect(errorCopy.clipboardCopyFailed).toBeTruthy();
      expect(emptyStates.topSource.title).toBeTruthy();
      expect(emptyStates.topSource.body).toBeTruthy();
    });
  });
});
