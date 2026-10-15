// @vitest-environment jsdom
import "./setup/jsdom.setup";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TcProvider } from "@/components/therapy-compass/bindings";
import type { Therapy } from "@/components/therapy-compass/data/types";
import { BriefScreen, buildBriefCopy } from "@/components/therapy-compass/screens/brief-screen";
import { SheetsScreen } from "@/components/therapy-compass/screens/sheets-screen";

const navigation = vi.hoisted(() => ({ pathname: "/therapy-compass/unreviewed-cbt/brief", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: false, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
}));

const makeTherapy = vi.hoisted(
  () =>
    (slug: string, name: string, reviewStatus: "reviewed" | "needs_review"): Therapy => ({
      slug,
      name,
      category: "Cognitive and behavioural",
      clinicalSummary: `${name} summary`,
      bestUsedFor: "Anxiety",
      indications: "Anxiety",
      contraindicationsOrCautions: "Check acuity before use.",
      deliverySteps: "1. Orient the patient\n2. Practise the skill",
      patientExplanation: "A structured skill for managing anxiety.",
      sourceNotes: null,
      targetSymptoms: "Anxiety",
      patientPopulation: "Adults",
      setting: "Outpatient",
      sessionLength: "50 minutes",
      timeRequired: "5 minutes",
      complexity: "Low",
      mechanism: "Cognitive restructuring",
      briefVersion: "1. Orient the patient\n2. Practise the skill",
      fifteenMinuteVersion: "1. Orient\n2. Practise\n3. Review",
      fullSessionVersion: null,
      homework: "Practise daily.",
      materials: null,
      commonPitfalls: null,
      alternatives: null,
      relatedTherapies: null,
      evidenceLevel: "High",
      evidenceNotes: null,
      limitations: null,
      references: null,
      reviewStatus,
      confidenceLevel: null,
      contentOrigin: null,
      patientSheetAvailable: true,
      briefInterventionAvailable: true,
      sourceCompleteness: null,
      indexCompleteness: null,
      reviewCompleteness: null,
      tags: ["Anxiety"],
      warnings: [],
      aliases: [],
      sources: [],
      patientSheetTemplates: [],
      clinicianScripts: [{ scriptType: "Opening", title: "Intro", body: "Let us try a brief exercise." }],
      reviewChecklist: null,
    }),
);

vi.mock("@/components/therapy-compass/data/use-therapy-data", () => ({
  useTherapyData: () => ({
    data: {
      therapies: [
        makeTherapy("unreviewed-cbt", "Unreviewed CBT", "needs_review"),
        makeTherapy("reviewed-act", "Reviewed ACT", "reviewed"),
      ],
      pathways: [],
      reference: { categories: [], tags: [], measures: [] },
    },
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));

afterEach(() => {
  navigation.pathname = "/therapy-compass/unreviewed-cbt/brief";
  navigation.search = "";
});

describe("Therapy Review Status Governance on SheetsScreen and BriefScreen (P2-1)", () => {
  describe("buildBriefCopy", () => {
    it("includes the clinical review warning line when therapyNeedsReview is true", () => {
      const unreviewed = makeTherapy("unreviewed-cbt", "Unreviewed CBT", "needs_review");
      const copied = buildBriefCopy(unreviewed, "5-minute", ["Orient the patient", "Practise the skill"]);
      expect(copied).toContain("[Awaiting clinical review — verify against primary guidelines]");
    });

    it("omits the clinical review warning line when therapyNeedsReview is false", () => {
      const reviewed = makeTherapy("reviewed-act", "Reviewed ACT", "reviewed");
      const copied = buildBriefCopy(reviewed, "5-minute", ["Orient the patient", "Practise the skill"]);
      expect(copied).not.toContain("[Awaiting clinical review — verify against primary guidelines]");
    });
  });

  describe("BriefScreen review-status badge and clipboard output", () => {
    it("renders 'Awaiting clinical review' with warning styling and copies warning text when needsReview is true", async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      navigation.pathname = "/therapy-compass/unreviewed-cbt/brief";
      render(h(TcProvider, null, h(BriefScreen)));

      const badge = screen.getByTestId("therapy-brief-review-badge");
      expect(badge).toHaveTextContent("Awaiting clinical review");
      expect(badge.className).toContain("--warning-bg");

      await user.click(screen.getByRole("button", { name: "Copy intervention" }));
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText.mock.calls[0]?.[0]).toMatch(
        /\[Awaiting clinical review [—-] verify against primary guidelines\]/,
      );
    });

    it("renders 'Reviewed' with success styling when needsReview is false", () => {
      navigation.pathname = "/therapy-compass/reviewed-act/brief";
      render(h(TcProvider, null, h(BriefScreen)));

      const badge = screen.getByTestId("therapy-brief-review-badge");
      expect(badge).toHaveTextContent("Reviewed");
      expect(badge.className).toContain("--success-bg");
    });
  });

  describe("SheetsScreen review-status warning badge", () => {
    it("renders an 'Awaiting clinical review' warning badge when therapyNeedsReview(t) is true", () => {
      navigation.pathname = "/therapy-compass/unreviewed-cbt/sheet";
      render(h(TcProvider, null, h(SheetsScreen)));

      const badge = screen.getByTestId("therapy-sheet-review-warning");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("Awaiting clinical review");
    });

    it("does not render 'Awaiting clinical review' when therapyNeedsReview(t) is false", () => {
      navigation.pathname = "/therapy-compass/reviewed-act/sheet";
      render(h(TcProvider, null, h(SheetsScreen)));

      expect(screen.queryByTestId("therapy-sheet-review-warning")).not.toBeInTheDocument();
      expect(screen.queryByText("Awaiting clinical review")).not.toBeInTheDocument();
    });
  });
});
