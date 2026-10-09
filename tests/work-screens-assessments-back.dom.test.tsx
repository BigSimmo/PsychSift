/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { forgetAssessMemory, rememberRole } from "@/components/teaching/assessments/assess-memory";
import { universalHeaderLeadingSlotId } from "@/components/work-frame/work-frame-header";
import { AssessmentsBack, assessmentsBackHref } from "@/components/work-screens/assessments/assessments-back";

describe("Assessments back link", () => {
  it("keeps the side the reader was using, even when the address names another", () => {
    expect(assessmentsBackHref("dct", "?as=supervisor")).toBe("/teaching/assessments?as=dct");
    expect(assessmentsBackHref("supervisor", "")).toBe("/teaching/assessments?as=supervisor");
  });

  it("falls back to the address's side, then the supervisor's", () => {
    expect(assessmentsBackHref("doctor", "?as=doctor")).toBe("/teaching/assessments?as=doctor");
    expect(assessmentsBackHref("doctor", "?as=dct")).toBe("/teaching/assessments?as=dct");
    expect(assessmentsBackHref("doctor", "?as=nobody")).toBe("/teaching/assessments?as=supervisor");
    expect(assessmentsBackHref("doctor", "")).toBe("/teaching/assessments?as=supervisor");
  });

  describe("in the top bar", () => {
    beforeEach(() => {
      const slot = document.createElement("div");
      slot.id = universalHeaderLeadingSlotId;
      document.body.append(slot);
    });
    afterEach(() => {
      document.getElementById(universalHeaderLeadingSlotId)?.remove();
      forgetAssessMemory();
    });

    it("goes back to the DCT's side for a DCT who opened a doctor's page", () => {
      rememberRole("dct");
      render(<AssessmentsBack />);
      expect(screen.getByTestId("assessments-back")).toHaveAttribute("href", "/teaching/assessments?as=dct");
    });
  });
});
