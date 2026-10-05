import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MedicationPrescribingWorkspace } from "@/components/clinical-dashboard/medication-prescribing-workspace";
import { PatientProfileProvider } from "@/components/clinical-dashboard/patient-profile-context";
import { appModeHomeHref } from "@/lib/app-modes";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// When set, the catalogue answers with no ranked matches over a catalogue of
// two records: the "nothing found" state.
const catalogEmpty = vi.hoisted(() => ({ current: false }));
const catalogueRecords = [
  {
    slug: "lithium",
    name: "Lithium",
    class: "Mood stabiliser",
    subclass: "",
    category: "",
    stats: [],
    sections: [],
    quick: [],
  },
  {
    slug: "clozapine",
    name: "Clozapine",
    class: "Antipsychotic",
    subclass: "",
    category: "",
    stats: [],
    sections: [],
    quick: [],
  },
];

// The prescribing results view filters a medication catalogue through scope,
// match-quality, class and clinical-signal controls. The catalogue hook fetches
// `/api/medications` (and reads the auth session), so it is mocked with a fixed
// set of results chosen to land in different filter buckets. Only
// usePatientProfile needs a real provider (the profile stays empty here, so no
// per-patient alert badges are computed).

type Result = {
  id: string;
  name: string;
  indication: string;
  match: string;
  dose: string;
  ceiling: string;
  action: string;
  actionTone: "danger" | "warning" | "neutral";
  tone: "teal" | "blue" | "slate";
};

// Clozapine: danger + exact fit → Safety (not Monitoring).
const clozapine: Result = {
  id: "clozapine",
  name: "Clozapine",
  indication: "Treatment-resistant schizophrenia",
  match: "Exact clinical fit",
  dose: "12.5 mg",
  ceiling: "900 mg",
  action: "Avoid abrupt cessation",
  actionTone: "danger",
  tone: "teal",
};
// Lithium: warning + monitor language → both clinical signals.
const lithium: Result = {
  id: "lithium",
  name: "Lithium",
  indication: "Bipolar maintenance",
  match: "Exact clinical fit",
  dose: "400 mg",
  ceiling: "1.2 mmol",
  action: "Monitor serum levels",
  actionTone: "warning",
  tone: "blue",
};
// Sertraline: neutral + related match → neither clinical signal.
const sertraline: Result = {
  id: "sertraline",
  name: "Sertraline",
  indication: "Depression",
  match: "Related match",
  dose: "50 mg",
  ceiling: "200 mg",
  action: "First-line option",
  actionTone: "neutral",
  tone: "slate",
};

const catalogInterpretation = vi.hoisted(() => ({
  current: undefined as
    | {
        correctedQuery?: string;
        corrections?: Array<{ from: string; to: string }>;
        appliedExpansions?: string[];
      }
    | undefined,
}));

// Cross-mode "also matches" strip is a separate AuthProvider-backed component;
// stub it so this test isolates the filter strip from that component's auth deps.
vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

vi.mock("@/components/clinical-dashboard/use-medication-catalog", () => ({
  useMedicationCatalog: () => ({
    data: {
      records: catalogEmpty.current ? catalogueRecords : [],
      matches: (catalogEmpty.current ? [] : [clozapine, lithium, sertraline]).map((result) => ({
        medication: undefined,
        result,
        score: 1,
        reasons: [],
      })),
      interpretation: catalogInterpretation.current,
      total: 3,
      governance: {},
    },
    loading: false,
    error: null,
  }),
}));

function renderWorkspace(overrides: Partial<{ query: string; showHome: boolean }> = {}) {
  return render(
    <PatientProfileProvider>
      <MedicationPrescribingWorkspace
        query={overrides.query ?? "prescribing"}
        loading={false}
        realDataReady
        authUnavailable={false}
        apiUnavailable={false}
        setupWarning={null}
        onSuggestedSearch={vi.fn()}
        showHome={overrides.showHome}
      />
    </PatientProfileProvider>,
  );
}

// Each result name renders in both the desktop table and the mobile card list,
// so a visible row appears more than once; a filtered-out row appears zero times.
function rowVisible(name: string): boolean {
  return screen.queryAllByText(name).length > 0;
}

// Match quality is a one-of-N lens, so its options are radios in a radiogroup.
function filterButton(label: string): HTMLElement {
  return screen.getByRole("radio", { name: new RegExp(`^${label}`, "i") });
}

afterEach(() => {
  catalogInterpretation.current = undefined;
  catalogEmpty.current = false;
  window.history.replaceState(null, "", "/");
  cleanup();
  vi.restoreAllMocks();
});

describe("MedicationPrescribingWorkspace — home vs submitted results", () => {
  it("keeps the medication home while a draft query is typed before submit", () => {
    renderWorkspace({ query: "l", showHome: true });
    expect(screen.getByTestId("medication-home")).toBeInTheDocument();
    expect(screen.queryByTestId("medication-result-clozapine-desktop")).not.toBeInTheDocument();
    expect(screen.queryByText(/Searching/i)).not.toBeInTheDocument();
  });

  it("shows medication results only after the parent marks the search submitted", () => {
    renderWorkspace({ query: "l", showHome: false });
    expect(screen.queryByTestId("medication-home")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("medication-result-clozapine-desktop").length).toBeGreaterThan(0);
  });

  it("uses concise, interval-safe dose labels", () => {
    renderWorkspace({ showHome: false });
    expect(screen.getByText("Usual dose")).toBeInTheDocument();
    expect(screen.getByText("Max dose")).toBeInTheDocument();
    expect(screen.getAllByText("Max").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ceiling")).not.toBeInTheDocument();
  });
});

describe("MedicationPrescribingWorkspace — nothing found (mock-up v6, screen 4)", () => {
  it("names the search, gives the real catalogue count and two ways forward", () => {
    catalogEmpty.current = true;
    renderWorkspace({ query: "Examplex", showHome: false });

    const empty = screen.getByTestId("medication-nothing-found");
    expect(empty).toHaveTextContent("No medicine called \u201cExamplex\u201d in PsychSift\u2019s list of 2");
    expect(empty).toHaveTextContent("Check the spelling. It may also be in your own PDFs");
    expect(within(empty).getByRole("link", { name: /Search your PDFs for Examplex/ })).toHaveAttribute(
      "href",
      appModeHomeHref("documents", { query: "Examplex", run: true }),
    );

    fireEvent.click(within(empty).getByTestId("medication-browse-all"));
    expect(new URLSearchParams(window.location.search).get("scope")).toBe("all");
  });
});

describe("MedicationPrescribingWorkspace — query interpretation", () => {
  it("says plainly there is no medicine by a misspelt name and suggests the corrected one as a link (mock-up v6, decision 2)", () => {
    catalogInterpretation.current = {
      correctedQuery: "sertraline",
      corrections: [{ from: "sertaline", to: "sertraline" }],
      appliedExpansions: ["zoloft"],
    };

    renderWorkspace({ query: "sertaline" });

    const note = screen.getByTestId("medication-query-interpretation");
    expect(note).toHaveTextContent("No medicine called sertaline. Did you mean sertraline?");
    expect(within(note).getByRole("link", { name: "sertraline" })).toHaveAttribute(
      "href",
      appModeHomeHref("prescribing", { query: "sertraline", run: true }),
    );
    expect(screen.getByText("Related terms were also included: zoloft.")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("distinguishes applied expansions from a corrected query", () => {
    catalogInterpretation.current = { appliedExpansions: ["olanzapine", "antipsychotic"] };

    renderWorkspace({ query: "zyprexa" });

    expect(
      screen.getByRole("note", {
        name: "Search also included related terms: olanzapine, antipsychotic.",
      }),
    ).toHaveTextContent("olanzapine, antipsychotic");
    expect(screen.getByRole("note")).toHaveTextContent("Search also included");
    expect(screen.getByRole("note")).not.toHaveTextContent("Did you mean");
  });

  it("does not add interpretation chrome when the API returns none", () => {
    renderWorkspace();
    expect(screen.queryByTestId("medication-query-interpretation")).not.toBeInTheDocument();
  });
});

describe("MedicationPrescribingWorkspace — refined filters", () => {
  function openFilters() {
    fireEvent.click(screen.getByTestId("medication-filter-trigger-desktop"));
  }

  it("separates match quality from overlapping clinical signals with projected counts", () => {
    renderWorkspace();
    openFilters();

    expect(filterButton("All qualities").textContent).toContain("3");
    expect(filterButton("Exact clinical fit").textContent).toContain("2");
    expect(filterButton("Related match").textContent).toContain("1");
    expect(screen.getByRole("button", { name: /^Safety \(2\)$/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /^Monitoring \(1\)$/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("defaults to Best matches and all match qualities with ranked rows unchanged", () => {
    renderWorkspace();
    openFilters();

    expect(screen.getByRole("radio", { name: /Best matches/ })).toBeChecked();
    expect(filterButton("All qualities")).toHaveAttribute("aria-checked", "true");
    expect(rowVisible("Clozapine")).toBe(true);
    expect(rowVisible("Lithium")).toBe(true);
    expect(rowVisible("Sertraline")).toBe(true);
  });

  it("round-trips a match-quality URL refinement without changing patient safety chrome", () => {
    renderWorkspace();
    openFilters();
    fireEvent.click(filterButton("Exact clinical fit"));
    expect(new URLSearchParams(window.location.search).get("match")).toBe("exact");

    cleanup();
    renderWorkspace();
    expect(rowVisible("Clozapine")).toBe(true);
    expect(rowVisible("Lithium")).toBe(true);
    expect(rowVisible("Sertraline")).toBe(false);
    expect(screen.getByText(/Patient details/i)).toBeInTheDocument();
  });

  it("keeps Safety and Monitoring as OR values in one clinical-signal facet", () => {
    renderWorkspace();
    openFilters();
    fireEvent.click(screen.getByRole("button", { name: /^Safety \(2\)$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Monitoring \(1\)$/ }));
    expect(new URLSearchParams(window.location.search).get("signal")).toBe("monitoring,safety");

    cleanup();
    renderWorkspace();
    expect(rowVisible("Lithium")).toBe(true);
    expect(rowVisible("Clozapine")).toBe(true);
    expect(rowVisible("Sertraline")).toBe(false);
  });
});
