import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MedicationRecordPage } from "@/components/clinical-dashboard/medication-record-page";
import { appModeHomeHref } from "@/lib/app-modes";
import type { MedicationRecord } from "@/lib/medications";

vi.mock("next/navigation", () => ({
  usePathname: () => "/medications/test-med",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

// Controllable data-hook mock so each test drives one content-first state.
const { useMedicationDetail } = vi.hoisted(() => ({ useMedicationDetail: vi.fn() }));
vi.mock("@/components/clinical-dashboard/use-medication-catalog", () => ({ useMedicationDetail }));
// The two patient panels carry their own data concerns; stub them to a findable
// marker so these tests can assert *where* they render without pulling in the
// profile store.
vi.mock("@/components/clinical-dashboard/patient-profile-panel", () => ({
  PatientProfilePanel: () => <p>patient-profile-panel</p>,
}));
vi.mock("@/components/clinical-dashboard/medication-considerations", () => ({
  MedicationConsiderations: () => <p>medication-considerations</p>,
  MedicationInteractionCallout: () => <p>medication-interaction-callout</p>,
}));

function mockDetail(state: { data: unknown; loading: boolean; error: string | null; notFound?: boolean }) {
  useMedicationDetail.mockReturnValue({ notFound: false, ...state });
}

// Minimal record with no `src` "...checked" text, so the "Reviewed" identity
// badge depends purely on governance — which lets us assert the governance-drop
// invariant cleanly (isReviewed() otherwise falls back to source-review text).
const fallbackDrug: MedicationRecord = {
  slug: "test-med",
  name: "Fallback Drug",
  class: "Test class",
  subclass: "",
  category: "",
  accent: "#0f766e",
  tag: "",
  schedule: "",
  stats: [],
  sections: [],
  quick: [],
};
const liveDrug: MedicationRecord = { ...fallbackDrug, name: "Live Drug" };

describe("MedicationRecordPage content-first states", () => {
  it("renders the SSR fallback record immediately during loading, not the skeleton", () => {
    mockDetail({ data: null, loading: true, error: null });
    render(<MedicationRecordPage slug="test-med" fallbackRecord={fallbackDrug} />);
    expect(screen.getByRole("heading", { name: "Fallback Drug" })).toBeInTheDocument();
    expect(screen.queryByText(/Loading medication reference/i)).not.toBeInTheDocument();
  });

  it("shows the skeleton when loading with no fallback record", () => {
    mockDetail({ data: null, loading: true, error: null });
    render(<MedicationRecordPage slug="owner-only" />);
    expect(screen.getByText(/Loading medication reference/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Fallback Drug" })).not.toBeInTheDocument();
  });

  it("live swap-in prefers the live record over the SSR fallback", () => {
    mockDetail({ data: { record: liveDrug, governance: null }, loading: false, error: null });
    render(<MedicationRecordPage slug="test-med" fallbackRecord={fallbackDrug} />);
    expect(screen.getByRole("heading", { name: "Live Drug" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Fallback Drug" })).not.toBeInTheDocument();
  });

  it("renders the error panel when nothing renderable exists", () => {
    mockDetail({ data: null, loading: false, error: "Network unavailable" });
    render(<MedicationRecordPage slug="test-med" />);
    expect(screen.getByRole("heading", { name: "This medicine page didn\u2019t load" })).toBeInTheDocument();
    expect(screen.getByText("Network unavailable")).toBeInTheDocument();
  });

  it("renders a named not-found with a route back when the medication does not exist (#W0T66R)", () => {
    mockDetail({ data: null, loading: false, error: "Request failed (404)", notFound: true });
    render(<MedicationRecordPage slug="zzz" />);
    expect(screen.getByRole("heading", { level: 1, name: "Medication Not Found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to medications" })).toHaveAttribute("href", "/medications");
    expect(screen.queryByText("Request failed (404)")).not.toBeInTheDocument();
  });

  it("keeps a non-not-found failure as an error rather than a not-found (#W0T66R)", () => {
    mockDetail({ data: null, loading: false, error: "Request failed (503)", notFound: false });
    render(<MedicationRecordPage slug="zzz" />);
    expect(screen.getByText("Request failed (503)")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Medication Not Found" })).not.toBeInTheDocument();
  });

  it("drops fixture governance on error so a fixture 'Reviewed' badge does not persist as authoritative", () => {
    mockDetail({ data: null, loading: false, error: "boom" });
    render(
      <MedicationRecordPage
        slug="test-med"
        fallbackRecord={fallbackDrug}
        fallbackGovernance={{ validationStatus: "approved" }}
      />,
    );
    // Content-first still paints the record...
    expect(screen.getByRole("heading", { name: "Fallback Drug" })).toBeInTheDocument();
    // ...but the fixture's approved-governance "Reviewed" badge must not survive
    // the error, because the authoritative status is now unknown.
    expect(screen.queryByText("Reviewed")).not.toBeInTheDocument();
  });

  it("moves the patient panels out of the body and behind the header control", async () => {
    // Both cards left the page body; the feature did not leave with them. The
    // entry point is the header's patients control, and the panels render inside
    // the sheet it opens.
    const user = userEvent.setup();
    mockDetail({ data: { record: liveDrug, governance: null }, loading: false, error: null });
    render(<MedicationRecordPage slug="test-med" fallbackRecord={fallbackDrug} />);

    expect(screen.queryByText("patient-profile-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("medication-considerations")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Patient details" }));
    const sheet = screen.getByTestId("medication-patient-sheet");
    expect(within(sheet).getByText("patient-profile-panel")).toBeInTheDocument();
    expect(within(sheet).getByText("medication-considerations")).toBeInTheDocument();
  });

  it("keeps the SSR fallback governance badge while the fetch is still in flight", () => {
    mockDetail({ data: null, loading: true, error: null });
    render(
      <MedicationRecordPage
        slug="test-med"
        fallbackRecord={fallbackDrug}
        fallbackGovernance={{ validationStatus: "approved" }}
      />,
    );
    // Contrast to the error case: while loading (no error) the SSR-provided
    // governance is trusted, so the "Reviewed" badge shows.
    expect(screen.getByText("Reviewed")).toBeInTheDocument();
  });
});

describe("MedicationRecordPage source link (#05WXHX)", () => {
  // No medication record carries its own source link yet, so the footer points to the
  // default source the owner chose on 2026-09-25: the TGA Product Information search.
  it("links to the TGA Product Information search for the medicine", () => {
    mockDetail({ data: { record: fallbackDrug }, loading: false, error: null });
    render(<MedicationRecordPage slug="test-med" fallbackRecord={fallbackDrug} />);
    const link = screen.getByRole("link", { name: `Search the TGA Product Information for ${fallbackDrug.name}` });
    const href = new URL(link.getAttribute("href")!);
    expect(href.origin).toBe("https://www.ebs.tga.gov.au");
    expect(href.pathname).toBe("/ebs/picmi/picmirepository.nsf/PICMI");
    expect(href.searchParams.get("q")).toBe(fallbackDrug.name);
    expect(href.searchParams.get("t")).toBe("pi");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("offers no TGA link when there is no record to name", () => {
    mockDetail({ data: null, loading: false, error: "Medication not found." });
    render(<MedicationRecordPage slug="missing" />);
    expect(screen.queryByRole("link", { name: /TGA Product Information/ })).not.toBeInTheDocument();
  });
});

describe("MedicationRecordPage confirmed source links (#05WXHX step 2)", () => {
  const confirmedLink = {
    id: "fixture-clozapine-pi",
    title: "Australian Product Information: clozapine",
    publisher: "Therapeutic Goods Administration",
    href: "https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/PICMI?OpenForm&q=clozapine&t=pi",
  };

  async function openAdditionalTab() {
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: /Additional/ })[0]);
  }

  it("renders no Sources list when no link is confirmed", async () => {
    mockDetail({ data: { record: fallbackDrug }, loading: false, error: null });
    render(<MedicationRecordPage slug="test-med" fallbackRecord={fallbackDrug} />);
    await openAdditionalTab();
    expect(screen.queryByTestId("medication-source-links")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sources" })).not.toBeInTheDocument();
  });

  it("renders a confirmed link on the Additional tab only, opening the source outside the app", async () => {
    mockDetail({ data: { record: fallbackDrug }, loading: false, error: null });
    render(<MedicationRecordPage slug="test-med" fallbackRecord={fallbackDrug} sourceLinks={[confirmedLink]} />);
    expect(screen.queryByTestId("medication-source-links")).not.toBeInTheDocument();

    await openAdditionalTab();
    const list = screen.getByTestId("medication-source-links");
    expect(within(list).getByRole("heading", { name: "Sources" })).toBeInTheDocument();
    const link = within(list).getByRole("link", { name: /Australian Product Information: clozapine/ });
    expect(link).toHaveAttribute("href", confirmedLink.href);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")?.split(" ")).toEqual(expect.arrayContaining(["noreferrer", "noopener"]));
    expect(within(list).getByText("Therapeutic Goods Administration")).toBeInTheDocument();
  });

  it("keeps the no-sources footer and TGA fallback search when no link is confirmed", () => {
    mockDetail({ data: { record: fallbackDrug }, loading: false, error: null });
    render(<MedicationRecordPage slug="test-med" fallbackRecord={fallbackDrug} />);
    expect(screen.getByText(/does not yet link to its own sources/)).toBeInTheDocument();
    expect(screen.queryByText(/linked sources/)).not.toBeInTheDocument();
  });

  it("points the footer at the linked sources instead of the fallback search when a link is confirmed", () => {
    mockDetail({ data: { record: fallbackDrug }, loading: false, error: null });
    render(<MedicationRecordPage slug="test-med" fallbackRecord={fallbackDrug} sourceLinks={[confirmedLink]} />);
    expect(screen.queryByText(/does not yet link to its own sources/)).not.toBeInTheDocument();
    expect(screen.getByText(/against this record’s linked sources/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Search the TGA Product Information/ })).not.toBeInTheDocument();
  });
});

describe("MedicationRecordPage mock-up v6 states", () => {
  const statDrug: MedicationRecord = {
    ...fallbackDrug,
    stats: [
      { label: "Target range", value: "0.6-0.8" },
      { label: "Half-life", value: "24 h", cls: "good" },
      { label: "Toxicity risk", value: "High", cls: "hi" },
      { label: "Renal adj.", value: "Mandatory", flag: "warn" },
    ],
  };

  it("keeps a high-risk figure red and spoken, and makes caution and reassurance figures neutral", () => {
    mockDetail({ data: { record: statDrug }, loading: false, error: null });
    render(<MedicationRecordPage slug="test-med" fallbackRecord={statDrug} />);
    const figures = screen.getAllByTestId("medication-figure");
    expect(figures.map((figure) => figure.getAttribute("data-flag"))).toEqual([null, null, "high", "caution"]);
    expect(figures[2]?.className).toContain("danger");
    for (const figure of [figures[0], figures[1], figures[3]]) {
      expect(figure?.className).not.toMatch(/danger|warning|success/);
    }
    expect(figures.map((figure) => figure.querySelectorAll("svg").length)).toEqual([0, 0, 1, 1]);
    // The cue is spoken too, not only drawn.
    expect(figures[2]).toHaveTextContent("High risk: Toxicity risk");
    expect(figures[3]).toHaveTextContent("Caution: Renal adj.");
    expect(figures[0]).not.toHaveTextContent(/Caution|High risk/);
  });

  it("lets an odd last figure span the phone row so the hairlines close cleanly", () => {
    const three = { ...statDrug, stats: statDrug.stats.slice(0, 3), schedule: "", category: "" };
    mockDetail({ data: { record: three }, loading: false, error: null });
    render(<MedicationRecordPage slug="test-med" fallbackRecord={three} />);
    const figures = screen.getAllByTestId("medication-figure");
    expect(figures.length % 2).toBe(1);
    expect(figures.at(-1)?.className).toContain("last:odd:col-span-2");
    expect(figures[0]?.parentElement?.className).toContain(`xl:grid-cols-${figures.length}`);
  });

  it("says plainly when the record has no source linked, and not when it has one", () => {
    mockDetail({ data: { record: fallbackDrug }, loading: false, error: null });
    const { unmount } = render(<MedicationRecordPage slug="test-med" fallbackRecord={fallbackDrug} />);
    expect(screen.getByTestId("medication-no-source")).toHaveTextContent(
      "No source link confirmed for this record yet. Its own source notes are under Additional.",
    );
    unmount();
    render(
      <MedicationRecordPage
        slug="test-med"
        fallbackRecord={fallbackDrug}
        sourceLinks={[{ id: "x", title: "PI", publisher: "TGA", href: "https://www.tga.gov.au/" }]}
      />,
    );
    expect(screen.queryByTestId("medication-no-source")).not.toBeInTheDocument();
  });

  it("says nothing is linked from this page yet and offers the reader's own PDFs", () => {
    mockDetail({ data: { record: fallbackDrug }, loading: false, error: null });
    render(<MedicationRecordPage slug="test-med" fallbackRecord={fallbackDrug} />);
    const from = screen.getByTestId("medication-from-page");
    expect(from).toHaveTextContent(
      "No calculator, monitoring schedule or factsheet is linked to this medicine page yet.",
    );
    expect(within(from).getByRole("link", { name: /Browse factsheets/ })).toHaveAttribute(
      "href",
      appModeHomeHref("factsheets"),
    );
    expect(within(from).getByRole("link", { name: /Search your PDFs for Fallback Drug/ })).toHaveAttribute(
      "href",
      appModeHomeHref("documents", { query: "Fallback Drug", run: true }),
    );
  });

  it("adds a plain 'Still loading' line after eight seconds, and shows nothing clinical", () => {
    vi.useFakeTimers();
    try {
      mockDetail({ data: null, loading: true, error: null });
      render(<MedicationRecordPage slug="owner-only" />);
      expect(screen.queryByTestId("medication-slow-load")).not.toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(8_000);
      });
      expect(screen.getByTestId("medication-slow-load")).toHaveTextContent(
        "Still loadingTaking longer than usual. Nothing is shown until the record arrives.",
      );
      expect(screen.queryByTestId("medication-figure")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers Try again and two ways forward when the record fails to load", async () => {
    const retry = vi.fn();
    useMedicationDetail.mockReturnValue({
      data: null,
      loading: false,
      error: "Request failed (503)",
      notFound: false,
      retry,
    });
    render(<MedicationRecordPage slug="lithium-carbonate" />);
    const failed = screen.getByTestId("medication-load-failed");
    // A server error is not called a connection problem; its own reason is shown.
    expect(failed).toHaveTextContent("Try again in a moment. If it keeps happening, the reason is below.");
    expect(failed).toHaveTextContent("Details: Request failed (503)");
    await userEvent.setup().click(within(failed).getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(within(failed).getByRole("link", { name: /Search your PDFs for lithium carbonate/ })).toBeInTheDocument();
    expect(within(failed).getByRole("link", { name: "Back to all medicines" })).toHaveAttribute(
      "href",
      appModeHomeHref("prescribing"),
    );
  });
});
