import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ServiceDetailPage } from "@/components/services/service-detail-page";
import type { ServiceRecord } from "@/lib/service-ranker";

import { expectWellFormedDefinitionLists } from "./helpers/definition-list-shape";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  // InPageNavHeader derives its sheet state from the pathname; without this the
  // mock throws before the page renders.
  usePathname: () => "/services/test-service",
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    isSaved: () => false,
    setFavourite: vi.fn(async () => true),
    isAuthenticated: true,
  }),
}));

function baseService(overrides: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    slug: "test-service",
    title: "Test Service",
    subtitle: "Short clinical fit",
    statusChips: [{ label: "High confidence", tone: "success" }],
    primaryContact: { label: "Phone", value: "13 92 76", kind: "phone" },
    contacts: [{ label: "Phone", value: "13 92 76", kind: "phone" }],
    route: "Self phone referral",
    eligibility: "Eligible callers",
    cost: "Free",
    referral: "Self phone referral",
    summaryCards: [
      { id: "route", label: "Route", title: "Self phone referral" },
      { id: "best-use", label: "Best use", title: "Crisis support" },
      { id: "eligibility", label: "Eligibility", title: "Eligible callers" },
      { id: "cost", label: "Cost", title: "Free" },
    ],
    referralInfo: [
      { label: "Primary route", value: "Self phone referral" },
      { label: "Phone", value: "13 92 76" },
    ],
    bestUse: "Crisis support",
    criteria: [{ label: "Eligible callers", tone: "meet" }],
    verification: { locallyVerified: false, confidence: "High", notes: ["Verify locally before use"] },
    tags: ["crisis"],
    catchments: ["Statewide"],
    catalogueLabel: "Catalogue service",
    navigatorQuery: "Test Service",
    source: { label: "Catalogue", status: "Source checked" },
    ...overrides,
  };
}

describe("ServiceDetailPage content cleanup", () => {
  it("hides quick facts, referral, criteria, and tags when those sections have no content", () => {
    render(
      <ServiceDetailPage
        service={baseService({
          subtitle: undefined,
          route: undefined,
          eligibility: undefined,
          cost: undefined,
          referral: undefined,
          bestUse: undefined,
          summaryCards: [],
          referralInfo: [],
          criteria: [],
          tags: [],
          catchments: [],
        })}
      />,
    );

    expect(screen.queryByLabelText("Priority facts")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Referral information" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Referral criteria" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tags & catchments" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Verification" })).toBeInTheDocument();
  });

  it("shows a short website host instead of a raw multi-line URL", () => {
    const longUrl =
      "https://www.mhc.wa.gov.au/getting-help/other-support-services/community-support-and-treatment-services/community-alcohol-and-drug-services";
    render(
      <ServiceDetailPage
        service={baseService({
          primaryContact: { label: "Website", value: longUrl, detail: "Public source URL", kind: "web" },
          contacts: [{ label: "Website", value: longUrl, detail: "Public source URL", kind: "web" }],
        })}
      />,
    );

    expect(screen.getByText(/Website: mhc\.wa\.gov\.au/)).toBeInTheDocument();
    expect(screen.queryByText(longUrl)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("service-actions-trigger"));
    expect(
      within(screen.getByTestId("service-actions-sheet")).getByRole("link", { name: "Open website" }),
    ).toHaveAttribute("href", longUrl);
  });

  it("offers the source instead of a fake contact action when no contact is available", () => {
    const sourceUrl = "https://example.com/current-service-details";
    render(
      <ServiceDetailPage
        service={baseService({
          primaryContact: undefined,
          contacts: [],
          source: { label: "Public source", status: "Source checked", url: sourceUrl },
        })}
      />,
    );

    fireEvent.click(screen.getByTestId("service-actions-trigger"));
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute("href", sourceUrl);
    expect(screen.queryByRole("button", { name: "Copy contact" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Call" })).not.toBeInTheDocument();
  });

  it("keeps a distinct verification source available alongside the primary contact", () => {
    const sourceUrl = "https://example.com/current-service-details";
    render(
      <ServiceDetailPage
        service={baseService({
          source: { label: "Public source", status: "Source checked", url: sourceUrl },
        })}
      />,
    );

    fireEvent.click(screen.getByTestId("service-actions-trigger"));
    const actions = within(screen.getByTestId("service-actions-sheet"));
    expect(actions.getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:139276");
    expect(actions.getByRole("link", { name: "Open source" })).toHaveAttribute("href", sourceUrl);
    expect(screen.getByRole("link", { name: "View service source" })).toHaveAttribute("href", sourceUrl);
  });

  it("does not expose a non-HTTP website contact as an actionable link", () => {
    const sourceUrl = "https://example.com/current-service-details";
    render(
      <ServiceDetailPage
        service={baseService({
          primaryContact: { label: "Website", value: "javascript:alert(1)", kind: "web" },
          contacts: [{ label: "Website", value: "javascript:alert(1)", kind: "web" }],
          source: { label: "Public source", status: "Source checked", url: sourceUrl },
        })}
      />,
    );

    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByRole("link", { name: "Confirm at source" })).toHaveAttribute("href", sourceUrl);
  });

  it("falls back to route when referral is a blank string", () => {
    render(
      <ServiceDetailPage
        service={baseService({
          referral: "   ",
          route: "Statewide phone triage",
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Statewide phone triage" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Confirm referral route" })).not.toBeInTheDocument();
  });

  it("compacts pipe-joined fallback summary and referral text for display", () => {
    render(
      <ServiceDetailPage
        service={baseService({
          summaryCards: undefined,
          referralInfo: undefined,
          route: "Self-referral accepted | Self-referral accepted by phone",
          eligibility: "Age 12+ | Age 12+ and families/carers",
          cost: "Free/confidential | Free | Free public AOD service",
          referral: "Self-referral accepted | Self-referral accepted by phone",
          bestUse: "Core counselling | Front door for counselling",
          subtitle: "Core counselling | Front door for counselling",
        })}
      />,
    );

    expect(screen.getByLabelText("Priority facts")).toBeInTheDocument();
    expect(screen.queryByText(/\|/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Self-referral accepted by phone").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Free/confidential").length).toBeGreaterThan(0);
  });

  it("preserves best-use guidance when explicit summary and criteria arrays are empty", () => {
    render(
      <ServiceDetailPage
        service={baseService({
          bestUse: "Early intervention support",
          summaryCards: [],
          criteria: [],
        })}
      />,
    );

    const facts = within(screen.getByLabelText("Priority facts"));
    expect(facts.getByText("Early intervention support")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Referral criteria" })).not.toBeInTheDocument();
  });

  it("keeps referral details compact and exposes no copy controls", () => {
    render(<ServiceDetailPage service={baseService()} />);

    // The priority facts are the shared At a glance card; the region keeps its established name.
    expect(screen.getByLabelText("Priority facts")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "At a glance" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Call 13 92 76" })).toHaveAttribute("href", "tel:139276");
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("service-actions-trigger"));
    expect(screen.queryByRole("button", { name: "Copy contact" })).not.toBeInTheDocument();
  });

  it("shows repeated priority-card supporting text only once", () => {
    render(
      <ServiceDetailPage
        service={baseService({
          summaryCards: [
            { id: "best-use", label: "Best use", title: "Crisis support", detail: "Shared audience" },
            { id: "eligibility", label: "Eligibility", title: "Eligible callers", detail: "Shared audience" },
            { id: "route", label: "Route", title: "Self phone referral", detail: "Unique route note" },
          ],
        })}
      />,
    );

    const facts = within(screen.getByLabelText("Priority facts"));
    expect(facts.getAllByText("Shared audience")).toHaveLength(1);
    expect(facts.getByText("Unique route note")).toBeInTheDocument();
  });

  it("keeps a detail that matches another priority card title", () => {
    render(
      <ServiceDetailPage
        service={baseService({
          summaryCards: [
            { id: "best-use", label: "Best use", title: "Crisis support", detail: "Eligible callers" },
            { id: "eligibility", label: "Eligibility", title: "Eligible callers", detail: "Shared audience" },
          ],
        })}
      />,
    );

    const facts = within(screen.getByLabelText("Priority facts"));
    expect(facts.getAllByText("Eligible callers")).toHaveLength(2);
  });

  it("keeps the referral facts a well-formed description list (#Q80S8B)", () => {
    const { container } = render(<ServiceDetailPage service={baseService()} />);
    expectWellFormedDefinitionLists(container);
  });

  it("extracts the first valid dialable phone URI from composite strings without concatenating digits", () => {
    const compositePhone = "1300 555 788 (metro); 1800 676 822 (Peel)";
    render(
      <ServiceDetailPage
        service={baseService({
          primaryContact: { label: "Phone", value: compositePhone, kind: "phone" },
          contacts: [{ label: "Phone", value: compositePhone, kind: "phone" }],
        })}
      />,
    );

    fireEvent.click(screen.getByTestId("service-actions-trigger"));
    const actions = within(screen.getByTestId("service-actions-sheet"));
    const callLink = actions.getByRole("link", { name: "Call" });
    expect(callLink).toHaveAttribute("href", "tel:1300555788");
    expect(callLink.getAttribute("href")).not.toContain("1800676822");
  });

  it("renders individual dialable links for multi-number and composite phone referral rows", () => {
    const compositePhone = "1300 555 788 (metro); 1800 676 822 (Peel)";
    const { container } = render(
      <ServiceDetailPage
        service={baseService({
          referralInfo: [
            { label: "Phone", value: compositePhone },
            { label: "Triage phone", value: "08 9224 8888\n08 9224 8889" },
          ],
        })}
      />,
    );

    expect(screen.getByRole("link", { name: "1300 555 788 (metro)" })).toHaveAttribute("href", "tel:1300555788");
    expect(screen.getByRole("link", { name: "1800 676 822 (Peel)" })).toHaveAttribute("href", "tel:1800676822");
    expect(screen.getByRole("link", { name: "08 9224 8888" })).toHaveAttribute("href", "tel:0892248888");
    expect(screen.getByRole("link", { name: "08 9224 8889" })).toHaveAttribute("href", "tel:0892248889");

    expectWellFormedDefinitionLists(container);
  });
});
