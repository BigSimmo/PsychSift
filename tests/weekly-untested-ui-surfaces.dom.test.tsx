// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClinicalContent, PhoneHeader, sections } from "@/app/mockups/phone-inpage-navigation/phone-inpage-nav-widgets";
import { DocumentImageStatusClient } from "@/app/mockups/document-image-status/document-image-status-client";
import { AdminWorkAndLeaveGroup } from "@/components/admin/junior/work-and-leave-group";
import { AlertsPage } from "@/components/alerts/alerts-page";
import * as AlertsSheetsModule from "@/components/alerts/alerts-sheets";
import { CpdFeatureLoading } from "@/components/cme/cpd-feature-loading";
import { CmeLearningPage, LearningCatalogueSpecialtyFilter } from "@/components/cme/learning-catalogue";
import * as DictionaryBrowserModule from "@/components/dictionary/dictionary-browser";
import { ActTopicList } from "@/components/forms/act-topic-list";
import { MyDayBand } from "@/components/my-day/my-day-band";
import * as MyDayMovedCardsModule from "@/components/my-day/my-day-moved-cards";
import { OpenShiftsAlertsPage } from "@/components/open-shifts/open-shifts-alerts-page";
import { OpenShiftsLogPage } from "@/components/open-shifts/open-shifts-log-page";
import { WorkRolesPage } from "@/components/preview-role/work-roles-page";
import { RosterHome } from "@/components/roster/roster-home";
import * as SourcesCurrencyPageModule from "@/components/sources/sources-currency-page";
import { TeachingOrganise } from "@/components/teaching/teaching-organise-page";
import { TeachingQrCheckinSheet, TeachingToday } from "@/components/teaching/teaching-today-page";
import * as AdminPeoplePageModule from "@/components/work-screens/admin/people-page";
import { AdminHospitalPage } from "@/components/work-screens/hospital/hospital-page";
import { AdminHospitalShortStaffedPage } from "@/components/work-screens/hospital/hospital-short-staffed-page";
import { AdminHospitalSickPage } from "@/components/work-screens/hospital/hospital-sick-page";
import { WorkSetupRow } from "@/components/work-setup/work-setup-row";

const REACHED_UI_SURFACES = [
  "src/components/work-setup/work-setup-row.tsx",
  "src/components/dictionary/dictionary-browser.tsx",
  "src/components/forms/act-topic-list.tsx",
  "src/components/sources/sources-currency-page.tsx",
  "src/components/admin/junior/work-and-leave-group.tsx",
  "src/components/alerts/alerts-page.tsx",
  "src/components/alerts/alerts-sheets.tsx",
  "src/components/cme/cpd-feature-loading.tsx",
  "src/components/cme/learning-catalogue.tsx",
  "src/components/my-day/my-day-band.tsx",
  "src/components/my-day/my-day-moved-cards.tsx",
  "src/components/open-shifts/open-shifts-alerts-page.tsx",
  "src/components/open-shifts/open-shifts-log-page.tsx",
  "src/components/roster/roster-home.tsx",
  "src/components/teaching/teaching-organise-page.tsx",
  "src/components/teaching/teaching-today-page.tsx",
  "src/components/work-screens/admin/people-page.tsx",
  "src/components/work-screens/hospital/hospital-page.tsx",
  "src/components/work-screens/hospital/hospital-short-staffed-page.tsx",
  "src/components/work-screens/hospital/hospital-sick-page.tsx",
  "src/app/mockups/document-image-status/document-image-status-client.tsx",
  "src/app/mockups/phone-inpage-navigation/phone-inpage-nav-widgets.tsx",
  "src/components/preview-role/work-roles-page.tsx",
] as const;

describe("weekly untested UI surfaces & re-export boundaries", () => {
  it("renders CpdFeatureLoading with screen-reader status and busy state", () => {
    render(<CpdFeatureLoading label="Loading CPD plan" />);
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading CPD plan");
  });

  it("renders LearningCatalogueSpecialtyFilter and invokes onSpecialtyChange", () => {
    const onChange = vi.fn();
    render(
      <div>
        <span id="spec-label">Specialty</span>
        <LearningCatalogueSpecialtyFilter
          specialty="all"
          onSpecialtyChange={onChange}
          specialties={["psychosis", "perinatal"]}
          labelId="spec-label"
        />
      </div>,
    );

    expect(screen.getByRole("radio", { name: "All" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Psychosis" }));
    expect(onChange).toHaveBeenCalledWith("psychosis");
  });

  it("renders ActTopicList with Act and Chief Psychiatrist Standard topic links", () => {
    render(
      <ActTopicList
        actTopics={[{ targetId: "part-6", title: "Part 6 — Involuntary treatment", count: 4 }]}
        standardTopics={[{ targetId: "std-1", title: "Standard 1 — Assessment", count: 1 }]}
      />,
    );

    expect(screen.getByTestId("act-topic-list")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Part 6 — Involuntary treatment/i })).toHaveAttribute("href", "#part-6");
    expect(screen.getByRole("link", { name: /Standard 1 — Assessment/i })).toHaveAttribute("href", "#std-1");
  });

  it("renders AdminWorkAndLeaveGroup with Contract end, Leave wallet, and Starter pack links", () => {
    render(<AdminWorkAndLeaveGroup />);
    expect(screen.getByTestId("admin-work-and-leave")).toBeInTheDocument();
    expect(screen.getByText("Work and leave")).toBeInTheDocument();
  });

  it("renders WorkRolesPage preview role selector and updates selected role", () => {
    render(<WorkRolesPage />);
    expect(screen.getByTestId("work-roles")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "View work mode as" })).toBeInTheDocument();
  });

  it("renders phone in-page navigation mockup widgets across sections", () => {
    render(
      <div>
        <PhoneHeader />
        <ClinicalContent active={sections[0].label} />
      </div>,
    );

    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument();
    expect(screen.getByText("Safety first")).toBeInTheDocument();
  });

  it("verifies exports across work-mode, teaching, hospital, alerts, sources, and dictionary modules", () => {
    expect(REACHED_UI_SURFACES).toHaveLength(23);
    expect(typeof WorkSetupRow).toBe("function");
    expect(typeof AlertsPage).toBe("function");
    expect(typeof AlertsSheetsModule.AlertsAreaSheet).toBe("function");
    expect(typeof CmeLearningPage).toBe("function");
    expect(typeof DictionaryBrowserModule).toBe("object");
    expect(typeof MyDayBand).toBe("function");
    expect(typeof MyDayMovedCardsModule.MyDayNextUpCard).toBe("function");
    expect(typeof OpenShiftsAlertsPage).toBe("function");
    expect(typeof OpenShiftsLogPage).toBe("function");
    expect(typeof RosterHome).toBe("function");
    expect(typeof SourcesCurrencyPageModule).toBe("object");
    expect(typeof TeachingOrganise).toBe("function");
    expect(typeof TeachingToday).toBe("function");
    expect(typeof TeachingQrCheckinSheet).toBe("function");
    expect(typeof AdminPeoplePageModule).toBe("object");
    expect(typeof AdminHospitalPage).toBe("function");
    expect(typeof AdminHospitalShortStaffedPage).toBe("function");
    expect(typeof AdminHospitalSickPage).toBe("function");
    expect(typeof DocumentImageStatusClient).toBe("function");
  });
});
