import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CaringContactDesignSuite } from "@/components/caring-contacts/mockups";
import {
  EXACT_PATIENT_VISIBLE_MESSAGE,
  PATIENT_VISIBLE_NO_REPLY_NOTICE,
} from "@/components/caring-contacts/mockups/personalisation-screen";

function desktopNavigation() {
  return screen.getByRole("navigation", { name: "Desktop workspace" });
}

describe("Caring Contact product redesign", () => {
  it("presents one focused product page in the repository workspace shell", () => {
    render(<CaringContactDesignSuite />);

    expect(screen.getByRole("heading", { name: "Today", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Foundation board" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /specimen/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("caring-contact-screen-patient-agreement")).not.toBeInTheDocument();
    expect(screen.getByTestId("caring-contact-synthetic-marker")).toHaveAttribute(
      "title",
      "Synthetic prototype — fictional data only",
    );

    expect(
      within(desktopNavigation())
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Today", "Patients", "Schedule", "Templates", "More"]);
    expect(
      within(screen.getByRole("navigation", { name: "Phone workspace" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Today", "Patients", "Schedule", "More"]);
  });

  it("completes the governed activation workflow and lands on the patient overview", async () => {
    const user = userEvent.setup();
    render(<CaringContactDesignSuite />);

    await user.click(screen.getByRole("button", { name: "Review Rowan Sample plan setup" }));

    expect(screen.getByRole("heading", { name: "Patient and agreement", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    expect(screen.getAllByText("Agreement confirmed: Yes").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Patient-controlled and suitable for discreet SMS")).toBeInTheDocument();
    expect(screen.getByText("Example Aftercare Team", { selector: "p" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue to pathway selection" }));
    expect(screen.getByRole("heading", { name: "Pathway selection", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Plan activation progress" })).toHaveTextContent(
      "Patient and agreement",
    );

    const previewTrigger = screen.getByRole("button", { name: "Preview pathway" });
    await user.click(previewTrigger);
    const preview = screen.getByRole("dialog", { name: "Preview governed pathway" });
    expect(within(preview).getByRole("list", { name: "Caring-contact schedule" })).toBeInTheDocument();
    expect(within(preview).getAllByRole("listitem")).toHaveLength(10);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(previewTrigger).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Continue to personalisation" }));
    expect(screen.getByRole("heading", { name: "Personalisation", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Morning/ })).toBeChecked();
    expect(screen.getByText(EXACT_PATIENT_VISIBLE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(/one preference applies to all 10 contacts/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue to review and activation" }));
    expect(screen.getByRole("heading", { name: "Review and activation", level: 1 })).toBeInTheDocument();
    const activationSchedule = screen.getByRole("list", { name: "Caring-contact schedule" });
    expect(within(activationSchedule).getAllByRole("listitem")).toHaveLength(10);
    // Assert against the exported constant, not a literal: the wording is provisional pending clinical
    // approval, and a hard-coded copy silently goes stale the next time it changes.
    expect(screen.getAllByText(new RegExp(PATIENT_VISIBLE_NO_REPLY_NOTICE, "i")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Activate 10-contact plan" }));
    const activation = screen.getByRole("dialog", { name: "Final activation assurance" });
    expect(activation).toHaveTextContent(/creates no plan and sends no message/i);
    await user.click(within(activation).getByRole("button", { name: "Confirm activation review" }));

    const overviewHeading = screen.getByRole("heading", { name: "Patient overview", level: 1 });
    await waitFor(() => expect(overviewHeading).toHaveFocus());
    expect(screen.getByTestId("caring-contact-screen-patient-overview")).toBeInTheDocument();
    expect(screen.getByText("1 delivered · 9 scheduled")).toBeInTheDocument();
    expect(within(screen.getByTestId("caring-contact-continuity-compact")).getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByTestId("caring-contact-continuity-wide")).toBeInTheDocument();
  });

  it("moves from the team-scoped patient directory into the plan and its governed actions", async () => {
    const user = userEvent.setup();
    render(<CaringContactDesignSuite />);

    await user.click(within(desktopNavigation()).getByRole("button", { name: "Patients" }));
    expect(screen.getByRole("heading", { name: "Patients", level: 1 })).toBeInTheDocument();

    const search = screen.getByRole("searchbox", { name: "Search active team patients" });
    await user.type(search, "Rowan");
    expect(screen.getByText("Rowan Sample")).toBeInTheDocument();
    expect(screen.queryByText("Mira Example")).not.toBeInTheDocument();
    await user.clear(search);

    await user.click(screen.getByRole("button", { name: "View patient" }));
    await user.click(screen.getByRole("button", { name: "View active plan" }));
    expect(screen.getByRole("heading", { name: "Plan and contact detail", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Example twelve-month pathway · SYN-v0.3/)).toBeInTheDocument();

    const pauseTrigger = screen.getByRole("button", { name: "Pause plan" });
    await user.click(pauseTrigger);
    const pauseDialog = screen.getByRole("dialog", { name: "Pause caring-contact plan" });
    await user.click(within(pauseDialog).getAllByRole("button", { name: "Cancel" })[1]!);
    await waitFor(() => expect(pauseTrigger).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Open delivery exception" }));
    const exception = screen.getByRole("dialog", { name: "Permanent delivery exception" });
    expect(exception).toHaveTextContent(/does not indicate patient safety, receipt, wellbeing or response/i);
    await user.click(within(exception).getByRole("button", { name: "Record operational review" }));
    expect(within(exception).getByRole("status")).toHaveTextContent(/synthetic contact and plan remain unchanged/i);
    await user.click(within(exception).getByRole("button", { name: "Close transport detail" }));
  });

  it("makes the Schedule date state, week navigation and named exception honest", async () => {
    const user = userEvent.setup();
    render(<CaringContactDesignSuite />);

    await user.click(within(desktopNavigation()).getByRole("button", { name: "Schedule" }));
    expect(screen.getByRole("heading", { name: "Saturday 15 August 2026", level: 2 })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Sun 16 Aug, 3 scheduled contacts/ }));
    expect(screen.getByRole("heading", { name: "Sunday 16 August 2026", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("No named exceptions for this day")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByRole("heading", { name: "Saturday 22 August 2026", level: 2 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    expect(screen.getByRole("heading", { name: "Saturday 15 August 2026", level: 2 })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Sam Wilson.*Transport status unavailable/ }));
    expect(screen.getByRole("dialog", { name: "Permanent delivery exception" })).toBeInTheDocument();
  });

  it("keeps supporting destinations out of the primary phone dock and gives each a focused page", async () => {
    const user = userEvent.setup();
    render(<CaringContactDesignSuite />);
    const phoneNavigation = screen.getByRole("navigation", { name: "Phone workspace" });

    await user.click(within(phoneNavigation).getByRole("button", { name: "More" }));
    let more = screen.getByRole("dialog", { name: "More" });
    for (const destination of ["Templates", "Team", "Guidance", "Reports"]) {
      expect(within(more).getByRole("button", { name: new RegExp(`^${destination}`) })).toBeInTheDocument();
    }

    await user.click(within(more).getByRole("button", { name: /^Templates/ }));
    expect(screen.getByRole("heading", { name: "Governed templates", level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Example retired twelve-month pathway/ }));
    expect(screen.getByText("Unavailable for new activation")).toBeInTheDocument();

    for (const destination of ["Team", "Guidance", "Reports"] as const) {
      await user.click(within(phoneNavigation).getByRole("button", { name: "More" }));
      more = screen.getByRole("dialog", { name: "More" });
      await user.click(within(more).getByRole("button", { name: new RegExp(`^${destination}`) }));
      expect(screen.getByRole("heading", { name: destination, level: 1 })).toBeInTheDocument();
    }

    expect(screen.getByText(/No clinical outcome, response or engagement inference/i)).toBeInTheDocument();
  });
});
