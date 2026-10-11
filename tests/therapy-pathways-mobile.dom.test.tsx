import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TcProvider } from "@/components/therapy-compass/bindings";
import { PathwaysScreen } from "@/components/therapy-compass/screens/pathways-screen";
import type { Pathway, Therapy } from "@/components/therapy-compass/data/types";

const navigation = vi.hoisted(() => ({
  pathname: "/therapy-compass/pathways",
  search: "pathway=anxiety-pathway",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: false, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
}));

const therapy = (slug: string, name: string): Therapy => ({
  slug,
  name,
  category: "Skills based",
  clinicalSummary: `${name} summary`,
  bestUsedFor: `${name} best fit`,
  indications: "Anxiety",
  contraindicationsOrCautions: "Use with care.",
  deliverySteps: "1. Orient the patient",
  patientExplanation: "A practical therapy skill.",
  sourceNotes: null,
  targetSymptoms: "Anxiety",
  patientPopulation: "Adults",
  setting: "Outpatient",
  sessionLength: "50 minutes",
  timeRequired: "5 minutes",
  complexity: "Low",
  mechanism: "Skills practice",
  briefVersion: null,
  fifteenMinuteVersion: null,
  fullSessionVersion: null,
  homework: null,
  materials: null,
  commonPitfalls: null,
  alternatives: null,
  relatedTherapies: null,
  evidenceLevel: "Review source",
  evidenceNotes: null,
  limitations: null,
  references: null,
  reviewStatus: "reviewed",
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
  clinicianScripts: [],
  reviewChecklist: null,
});

const pathways: Pathway[] = [
  {
    slug: "anxiety-pathway",
    name: "Anxiety pathway",
    clinicalProblem: "Anxiety",
    summary: "Workflow for anxiety presentations.",
    cautions: "Confirm acuity and patient preference before clinical use.",
    incomplete: true,
    reviewStatus: "needs_review",
    steps: [
      {
        therapySlug: "cognitive-behavioural-therapy-cbt",
        label: "Initial option",
        description:
          "Strongest broad evidence-backed uses are depression and anxiety disorders with long descriptive copy that should remain readable on a phone without being clamped away.",
      },
      {
        therapySlug: "graded-exposure",
        label: "Alternative option",
        description: "Useful when avoidance is the main maintaining factor.",
      },
    ],
  },
  {
    slug: "mood-pathway",
    name: "Mood pathway",
    clinicalProblem: "Mood",
    summary: "Workflow for mood presentations.",
    cautions: "Use as decision support only.",
    incomplete: false,
    reviewStatus: "reviewed",
    steps: [
      {
        therapySlug: "cognitive-behavioural-therapy-cbt",
        label: "Initial option",
        description: "First-line for depression.",
      },
    ],
  },
];

vi.mock("@/components/therapy-compass/data/use-therapy-data", () => ({
  useTherapyData: () => ({
    data: {
      therapies: [
        therapy("cognitive-behavioural-therapy-cbt", "Cognitive behavioural therapy (CBT)"),
        therapy("graded-exposure", "Graded exposure"),
      ],
      pathways,
      reference: { categories: [], tags: [], measures: [] },
    },
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));

function renderPathways() {
  return render(
    <TcProvider>
      <PathwaysScreen />
    </TcProvider>,
  );
}

afterEach(() => {
  navigation.search = "pathway=anxiety-pathway";
});

describe("Therapy pathways on a phone", () => {
  it("exposes the mobile picker, step stack, and caution markers", () => {
    renderPathways();

    expect(screen.getByTestId("therapy-pathway-picker")).toBeInTheDocument();
    expect(screen.getByTestId("therapy-pathway-steps")).toBeInTheDocument();
    expect(screen.getByTestId("therapy-pathway-caution")).toBeInTheDocument();
  });

  it("says once, at the top, what the Incomplete tag means", () => {
    renderPathways();
    expect(screen.getByTestId("therapy-pathways-incomplete-note")).toHaveTextContent(
      "Incomplete means clinician review has not yet confirmed the order of the steps.",
    );
  });

  it("counts only steps that link to a therapy record as linked steps", () => {
    renderPathways();
    expect(screen.getByText("3 linked steps")).toBeInTheDocument();
  });

  it("keeps step open-record actions in the accessibility tree", () => {
    renderPathways();
    const steps = within(screen.getByTestId("therapy-pathway-steps"));

    expect(steps.getAllByRole("button", { name: "Open record" })).toHaveLength(2);
  });

  it("renders full step descriptions on the mobile stack", () => {
    renderPathways();
    const steps = within(screen.getByTestId("therapy-pathway-steps"));
    const description = steps.getByText(/Strongest broad evidence-backed uses are depression and anxiety disorders/i);

    expect(description).toBeInTheDocument();
    expect(description.className).not.toContain("line-clamp-2");
  });

  it("opens the pathway picker sheet from the compact bar", async () => {
    const user = userEvent.setup();
    renderPathways();

    await user.click(screen.getByRole("button", { name: "Change pathway" }));
    const panel = screen.getByTestId("therapy-pathway-picker-panel");
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Mood pathway/i })).toBeInTheDocument();
  });

  it("filters pathways in the picker sheet", async () => {
    const user = userEvent.setup();
    renderPathways();

    await user.click(screen.getByRole("button", { name: "Change pathway" }));
    const panel = screen.getByTestId("therapy-pathway-picker-panel");
    await user.type(within(panel).getByRole("textbox", { name: "Filter pathways" }), "mood");

    expect(within(panel).getByRole("button", { name: /Mood pathway/i })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /Anxiety pathway/i })).not.toBeInTheDocument();
  });
});
