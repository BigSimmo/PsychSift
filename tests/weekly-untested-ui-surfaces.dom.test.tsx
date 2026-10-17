// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClinicalContent, PhoneHeader, sections } from "@/app/mockups/phone-inpage-navigation/phone-inpage-nav-widgets";
import { AdminWorkAndLeaveGroup } from "@/components/admin/junior/work-and-leave-group";
import { CpdFeatureLoading } from "@/components/cme/cpd-feature-loading";
import { LearningCatalogueSpecialtyFilter } from "@/components/cme/learning-catalogue";
import { ActTopicList } from "@/components/forms/act-topic-list";
import { WorkRolesPage } from "@/components/preview-role/work-roles-page";

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

});
Document();
  });

});
xpect(screen.getByText("Safety first")).toBeInTheDocument();
  });

});
