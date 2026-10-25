// The comparison has two presentations of one `rows` memo: the wide table from
// `md` up, and a stacked per-field layout below it. jsdom applies no Tailwind,
// so BOTH render here — every query has to say which one it means.

import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TcProvider } from "@/components/therapy-compass/bindings";
import { CompareScreen } from "@/components/therapy-compass/screens/compare-screen";
import { resetTherapyCompareMemoryForTests } from "@/lib/therapy-compare-memory";

const navigation = vi.hoisted(() => ({
  pathname: "/therapy-compass/compare",
  search: "ids=alpha,beta&comparison=all",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: false, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
}));

const therapy = vi.hoisted(() => (slug: string, name: string, caution: string) => ({
  slug,
  name,
  category: "Skills based",
  clinicalSummary: `${name} summary`,
  bestUsedFor: `${name} best fit`,
  indications: "Anxiety",
  contraindicationsOrCautions: caution,
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
}));

vi.mock("@/components/therapy-compass/data/use-therapy-data", () => ({
  useTherapyData: () => ({
    data: {
      therapies: [
        therapy("alpha", "Alpha therapy", "Alpha caution."),
        therapy("beta", "Beta therapy", "Clarify the aim first. Beta caution."),
      ],
      pathways: [],
      reference: { categories: [], tags: [], measures: [] },
    },
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));

function renderCompare() {
  return render(
    <TcProvider>
      <CompareScreen />
    </TcProvider>,
  );
}

afterEach(() => {
  navigation.search = "ids=alpha,beta&comparison=all";
  window.localStorage.clear();
  resetTherapyCompareMemoryForTests();
});

beforeEach(() => {
  window.localStorage.clear();
  resetTherapyCompareMemoryForTests();
});

describe("Therapy comparison on a phone", () => {
  it("forks at md, so the 720px table never has to scroll sideways on a phone", () => {
    renderCompare();

    // The table is `min-w-[720px]`; at 640–767px it would still scroll, which is
    // why the fork is `md` rather than `sm`.
    expect(screen.getByTestId("therapy-compare-table").className).toContain("hidden");
    expect(screen.getByTestId("therapy-compare-table").className).toContain("md:block");
    expect(screen.getByTestId("therapy-compare-stack").className).toContain("md:hidden");
  });

  it("keeps each field label with its values instead of scrolling them apart", () => {
    renderCompare();
    const stack = within(screen.getByTestId("therapy-compare-stack"));

    // One card per field, and every selected therapy appears inside that card —
    // the label cannot leave the values it labels.
    const caution = stack.getByRole("region", { name: "When not to use" });
    expect(within(caution).getByText("Alpha therapy")).toBeInTheDocument();
    expect(within(caution).getByText("Beta therapy")).toBeInTheDocument();
    expect(within(caution).getByText("Alpha caution.")).toBeInTheDocument();
    // The whole caution, not its first sentence: the risk wording can come second.
    expect(within(caution).getByText("Clarify the aim first. Beta caution.")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("therapy-compare-table")).getByText("Clarify the aim first. Beta caution."),
    ).toBeInTheDocument();

    const fit = stack.getByRole("region", { name: "Best fit" });
    expect(within(fit).getByText("Alpha therapy best fit")).toBeInTheDocument();
  });

  it("shows the phone layout the same rows the tab filter chose", () => {
    navigation.search = "ids=alpha,beta&comparison=priorities";
    renderCompare();
    const stack = within(screen.getByTestId("therapy-compare-stack"));

    expect(stack.getByRole("region", { name: "When not to use" })).toBeInTheDocument();
    expect(stack.getByRole("region", { name: "Evidence level" })).toBeInTheDocument();
    // "Time required" is not a priority row, so neither presentation shows it.
    expect(stack.queryByRole("region", { name: "Time required" })).toBeNull();
    expect(within(screen.getByTestId("therapy-compare-table")).queryByText("Time required")).toBeNull();
  });

  it("draws no comparison at all — and no empty slots — below two therapies", () => {
    navigation.search = "ids=alpha";
    renderCompare();

    expect(screen.queryByTestId("therapy-compare-stack")).toBeNull();
    expect(screen.queryByTestId("therapy-compare-table")).toBeNull();
  });

  it("uses the hybrid pip summary on phone instead of four tall empty cards", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes("639px"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    navigation.search = "comparison=all";
    renderCompare();

    expect(await screen.findByTestId("compare-slot-strip-pip-summary")).toBeInTheDocument();
    expect(screen.queryByTestId("compare-slot-tile")).toBeNull();
  });
});
