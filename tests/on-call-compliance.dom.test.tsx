/** @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ComplianceList } from "@/components/on-call/compliance-list";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

const sampleLabelledEntry: OnCallEntry = {
  id: "00000000-0000-4000-8000-000000000001",
  section: "logistics",
  slug: "ahpra-registration",
  title: "Ahpra Medical Registration",
  subtitle: "Annual renewal",
  body: "National medical board annual registration.",
  linkedDocumentIds: [],
  tags: [],
  isPersonal: true,
  includeOnCard: false,
  sortOrder: 1,
  lastVerifiedAt: null,
  details: {
    kind: "compliance",
    category: "Registration",
    consequence: "stops-work",
    expiresOn: "2027-09-30",
  },
};

const sampleUnlabelledEntry: OnCallEntry = {
  id: "00000000-0000-4000-8000-000000000002",
  section: "logistics",
  slug: "hospital-induction",
  title: "Hospital Induction Module",
  subtitle: null,
  body: "Mandatory corporate orientation.",
  linkedDocumentIds: [],
  tags: [],
  isPersonal: true,
  includeOnCard: false,
  sortOrder: 2,
  lastVerifiedAt: null,
  details: {
    kind: "compliance",
    // category intentionally omitted
    consequence: "chased",
  },
};

const sampleNullDetailsEntry: OnCallEntry = {
  id: "00000000-0000-4000-8000-000000000003",
  section: "logistics",
  slug: "unparseable-compliance-record",
  title: "Unparseable Compliance Record",
  subtitle: null,
  body: "Stored row with invalid schema details.",
  linkedDocumentIds: [],
  tags: [],
  isPersonal: true,
  includeOnCard: false,
  sortOrder: 3,
  lastVerifiedAt: null,
  details: null,
};

describe("ComplianceList fallback badge for unlabelled rows (#RHGAYP)", () => {
  it("renders the specific category badge when a compliance row is labelled", () => {
    render(<ComplianceList entries={[sampleLabelledEntry]} />);

    const row = screen.getByTestId("on-call-compliance-row-ahpra-registration");
    expect(within(row).getByText("Registration")).toBeInTheDocument();
    expect(within(row).queryByText("General Requirement")).toBeNull();
  });

  it("renders a clear fallback badge ('General Requirement') when a stored compliance row is unlabelled", () => {
    render(<ComplianceList entries={[sampleUnlabelledEntry]} />);

    const row = screen.getByTestId("on-call-compliance-row-hospital-induction");
    expect(within(row).getByText("General Requirement")).toBeInTheDocument();
  });

  it("renders a clear fallback badge ('General Requirement') when a stored compliance row has null details", () => {
    render(<ComplianceList entries={[sampleNullDetailsEntry]} />);

    const row = screen.getByTestId("on-call-compliance-row-unparseable-compliance-record");
    expect(within(row).getByText("General Requirement")).toBeInTheDocument();
  });

  it("renders mixed lists correctly with appropriate badges on each item", () => {
    render(<ComplianceList entries={[sampleLabelledEntry, sampleUnlabelledEntry, sampleNullDetailsEntry]} />);

    const labelledRow = screen.getByTestId("on-call-compliance-row-ahpra-registration");
    expect(within(labelledRow).getByText("Registration")).toBeInTheDocument();
    expect(within(labelledRow).queryByText("General Requirement")).toBeNull();

    const unlabelledRow = screen.getByTestId("on-call-compliance-row-hospital-induction");
    expect(within(unlabelledRow).getByText("General Requirement")).toBeInTheDocument();

    const nullDetailsRow = screen.getByTestId("on-call-compliance-row-unparseable-compliance-record");
    expect(within(nullDetailsRow).getByText("General Requirement")).toBeInTheDocument();
  });
});
