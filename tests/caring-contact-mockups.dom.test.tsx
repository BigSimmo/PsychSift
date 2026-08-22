import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CaringContactDesignSuite } from "@/components/caring-contacts/mockups";
import {
  ROWAN_SELECTED_SENDING_PREFERENCE,
  syntheticPathways,
  syntheticPatients,
  syntheticPlannedContacts,
  syntheticTemplates,
} from "@/components/caring-contacts/mockups/fixtures";
import {
  completionMutationOverlayLabels,
  completionOverlayDefinitions,
  OverlaySpecimens,
} from "@/components/caring-contacts/mockups/overlay-specimens";
import {
  AUTOMATED_REPLY_RESPONSE,
  EXACT_MESSAGE_GSM7,
  EXACT_PATIENT_VISIBLE_MESSAGE,
  calculateGsm7,
  canActivateGovernedVersions,
} from "@/components/caring-contacts/mockups/personalisation-screen";
import { ReviewActivationScreen } from "@/components/caring-contacts/mockups/review-activation-screen";
import {
  APPROVED_CARING_CONTACT_ROUTE_IDENTITIES,
  DESIGNATED_FICTIONAL_MOBILE_NUMBERS,
  FICTIONAL_CONTACTS_BY_ROLE,
  SUPERSEDED_CARING_CONTACT_ROUTE_PATTERNS,
} from "@/components/caring-contacts/mockups/types";

const expectedOverlayLabels = [
  "Verify identity",
  "Change patient",
  "Pathway preview",
  "Message preview",
  "Communication preference",
  "Adjust date/time",
  "Outside-window warning",
  "Save draft",
  "Discard changes",
  "Final activation",
  "Activation success",
  "Pause",
  "Withdrawal",
  "Reassignment",
  "Delivery detail",
  "Resolve failed delivery",
  "Contact-changed block",
  "Template changed/retired",
  "Session expiry",
  "Offline banner",
  "Recoverable error",
  "Permission unavailable",
  "Team switcher",
  "Draft/version conflict",
] as const;

function OverlayHarness() {
  const [offline, setOffline] = useState(false);
  return <OverlaySpecimens offline={offline} onOfflineChange={setOffline} />;
}

describe("Caring Contact governance contracts", () => {
  it("keeps every fictional contact role distinct and every plan contact in one selected window", () => {
    expect(FICTIONAL_CONTACTS_BY_ROLE).toEqual({
      miraPatientMobile: "+61 491 570 006",
      rowanPatientMobile: "+61 491 570 156",
      programmeStaffedLine: "+61 491 570 157",
      crisisSupportContact: "+61 491 570 158",
    });
    expect(DESIGNATED_FICTIONAL_MOBILE_NUMBERS).toEqual([
      "+61 491 570 006",
      "+61 491 570 156",
      "+61 491 570 157",
      "+61 491 570 158",
    ]);
    expect(new Set(Object.values(FICTIONAL_CONTACTS_BY_ROLE)).size).toBe(4);
    expect(syntheticPatients.every((patient) => DESIGNATED_FICTIONAL_MOBILE_NUMBERS.includes(patient.mobile))).toBe(
      true,
    );
    expect(syntheticPatients.map(({ mobile }) => mobile)).toEqual([
      FICTIONAL_CONTACTS_BY_ROLE.miraPatientMobile,
      FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile,
    ]);
    expect(syntheticPlannedContacts).toHaveLength(10);
    expect(syntheticPlannedContacts.every(({ window }) => window === ROWAN_SELECTED_SENDING_PREFERENCE.window)).toBe(
      true,
    );
    expect(
      syntheticPlannedContacts.every(
        ({ windowLabel }) => windowLabel === ROWAN_SELECTED_SENDING_PREFERENCE.windowLabel,
      ),
    ).toBe(true);
    expect(syntheticPlannedContacts[0]?.transportState).toBe("Delivered");
    expect(syntheticPlannedContacts.slice(1).every(({ transportState }) => transportState === "Scheduled")).toBe(true);
  });

  it("freezes the approved future routes and marks nested episode/version routes superseded", () => {
    expect(APPROVED_CARING_CONTACT_ROUTE_IDENTITIES).toEqual({
      today: "/caring-contacts",
      patients: "/caring-contacts/patients",
      patient: "/patients/[patientId]",
      newPlan: "/plans/new",
      plan: "/plans/[planId]",
      schedule: "/caring-contacts/schedule",
      contact: "/contacts/[contactId]",
      templates: "/caring-contacts/templates",
      pathwayTemplate: "/templates/[pathwayId]",
      team: "/caring-contacts/team",
      guidance: "/caring-contacts/guidance",
      reports: "/caring-contacts/reports",
    });
    expect(SUPERSEDED_CARING_CONTACT_ROUTE_PATTERNS).toEqual([
      "/caring-contacts/patients/[episodeId]/activate/*",
      "/caring-contacts/patients/[episodeId]/plan",
      "/caring-contacts/patients/[episodeId]/contacts/[contactId]",
      "/caring-contacts/patients/[episodeId]",
      "/caring-contacts/templates/[versionId]",
    ]);
  });

  it("derives exact GSM-7 septets and blocks unapproved or retired versions", () => {
    const pendingTemplate = syntheticTemplates.find(
      ({ approvalState }) => approvalState === "Illustrative — approval pending",
    )!;

    expect(EXACT_MESSAGE_GSM7).toEqual({ invalidCharacters: [], segments: 2, septets: 252, valid: true });
    // The automated reply (production-build spec §2.1) is patient-visible too, so it carries the same
    // two-segment ceiling and the same prohibition on echoing a patient mobile number.
    expect(calculateGsm7(AUTOMATED_REPLY_RESPONSE)).toEqual({
      invalidCharacters: [],
      segments: 2,
      septets: 218,
      valid: true,
    });
    expect(AUTOMATED_REPLY_RESPONSE).toContain(FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine);
    expect(AUTOMATED_REPLY_RESPONSE).toContain(FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact);
    expect(AUTOMATED_REPLY_RESPONSE).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.miraPatientMobile);
    expect(AUTOMATED_REPLY_RESPONSE).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile);
    expect(EXACT_PATIENT_VISIBLE_MESSAGE).toContain(FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine);
    expect(EXACT_PATIENT_VISIBLE_MESSAGE).toContain(FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact);
    expect(EXACT_PATIENT_VISIBLE_MESSAGE).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.miraPatientMobile);
    expect(EXACT_PATIENT_VISIBLE_MESSAGE).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile);
    expect(calculateGsm7("A^B")).toEqual({ invalidCharacters: [], segments: 1, septets: 4, valid: true });
    expect(calculateGsm7("Hello 🙂")).toMatchObject({ invalidCharacters: ["🙂"], segments: 0, valid: false });
    expect(calculateGsm7("A".repeat(160)).segments).toBe(1);
    expect(calculateGsm7("A".repeat(161)).segments).toBe(2);
    expect(canActivateGovernedVersions({ pathway: syntheticPathways[0], template: syntheticTemplates[0] })).toBe(true);
    expect(canActivateGovernedVersions({ pathway: syntheticPathways[0], template: pendingTemplate })).toBe(false);
    expect(canActivateGovernedVersions({ pathway: syntheticPathways[1], template: syntheticTemplates[0] })).toBe(false);
  });

  it("renders a pending selected message as unavailable with a named approval remedy", async () => {
    const user = userEvent.setup();
    const pendingTemplate = syntheticTemplates.find(
      ({ approvalState }) => approvalState === "Illustrative — approval pending",
    )!;
    render(
      <ReviewActivationScreen
        pathway={syntheticPathways[0]}
        template={pendingTemplate}
        onBack={() => undefined}
        onOverview={() => undefined}
      />,
    );

    expect(screen.getByText("Activation unavailable", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Message version is awaiting two-person approval/i)).toBeInTheDocument();
    expect(screen.getByText(/select a current, locally approved message version/i)).toBeInTheDocument();
    const activate = screen.getByRole("button", { name: "Activate 10-contact plan" });
    expect(activate).toHaveAttribute("aria-disabled", "true");
    await user.click(activate);
    expect(screen.queryByText(/Prototype activation reviewed/i)).not.toBeInTheDocument();
  });

  it("renders a retired selected pathway as unavailable with a named replacement remedy", () => {
    render(
      <ReviewActivationScreen
        pathway={syntheticPathways[1]}
        template={syntheticTemplates[0]}
        onBack={() => undefined}
        onOverview={() => undefined}
      />,
    );

    expect(screen.getByText("Selected version unavailable for activation", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Activation unavailable", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/Pathway version is not current\. Lifecycle: Retired\./i)).toBeInTheDocument();
    expect(screen.getByText(/select a current, locally approved pathway version/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate 10-contact plan" })).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the complete overlay decision matrix explicit and internally consistent", () => {
    expect(completionOverlayDefinitions.map(({ label }) => label)).toEqual(expectedOverlayLabels);
    expect(new Set(completionOverlayDefinitions.map(({ id }) => id)).size).toBe(24);
    expect(completionOverlayDefinitions).toHaveLength(24);
    expect(completionMutationOverlayLabels).toHaveLength(16);
    expect(completionOverlayDefinitions.filter(({ mutatesState }) => mutatesState).map(({ label }) => label)).toEqual(
      completionMutationOverlayLabels,
    );
    for (const definition of completionOverlayDefinitions) {
      expect(definition.title).not.toBe("");
      expect(definition.summary).not.toBe("");
      expect(definition.content).not.toBe("");
      expect(definition.decision).not.toBe("");
      expect(definition.content).not.toMatch(/monitor(?:ed|ing)? replies|patient is safe|risk score/i);
    }
  });

  it("keeps overlay focus restoration and offline mutation guards outside the product page catalogue", async () => {
    const user = userEvent.setup();
    render(<OverlayHarness />);

    const inventory = screen.getByRole("list", { name: "Complete overlay inventory" });
    expect(within(inventory).getAllByRole("listitem")).toHaveLength(24);

    const identityTrigger = within(inventory).getByRole("button", { name: "Open Verify identity" });
    await user.click(identityTrigger);
    expect(screen.getByRole("dialog", { name: "Verify identity before changing patient" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(identityTrigger).toHaveFocus());

    await user.click(within(inventory).getByRole("button", { name: "Open Offline banner" }));
    expect(screen.getByRole("status", { name: "Offline status" })).toBeInTheDocument();
    expect(identityTrigger).toHaveAttribute("aria-disabled", "true");

    const readOnlyPreview = within(inventory).getByRole("button", { name: "Open Message preview" });
    expect(readOnlyPreview).not.toHaveAttribute("aria-disabled");
    await user.click(readOnlyPreview);
    const preview = screen.getByRole("dialog", { name: "Preview exact patient-visible message" });
    expect(within(preview).getByRole("button", { name: "Return to personalisation" })).not.toHaveAttribute(
      "aria-disabled",
    );
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Try reconnecting" }));
    expect(screen.queryByRole("status", { name: "Offline status" })).not.toBeInTheDocument();
    expect(identityTrigger).not.toHaveAttribute("aria-disabled");
  });

  it("does not introduce clinical scoring or two-way messaging affordances in any destination", async () => {
    const user = userEvent.setup();
    render(<CaringContactDesignSuite />);

    function expectNoProhibitedAffordance() {
      expect(screen.queryByText(/clinical risk|risk score|wellbeing score|engagement score/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: /reply|message/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /reply|inbox|conversation/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: /inbox|messages|conversations/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /reply|inbox|messages|conversations/i })).not.toBeInTheDocument();
    }

    const navigation = screen.getByRole("navigation", { name: "Desktop workspace" });
    expectNoProhibitedAffordance();
    for (const destination of ["Patients", "Schedule", "Templates", "Today"]) {
      await user.click(within(navigation).getByRole("button", { name: destination }));
      expectNoProhibitedAffordance();
    }

    for (const destination of ["Team", "Guidance", "Reports"] as const) {
      await user.click(within(navigation).getByRole("button", { name: "More" }));
      const more = screen.getByRole("dialog", { name: "More" });
      await user.click(within(more).getByRole("button", { name: new RegExp(`^${destination}`) }));
      expect(screen.getByRole("heading", { level: 1, name: destination })).toBeInTheDocument();
      expectNoProhibitedAffordance();
    }
  });
});
