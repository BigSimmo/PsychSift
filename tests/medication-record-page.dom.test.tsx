import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MedicationRecordPage } from "@/components/clinical-dashboard/medication-record-page";
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
