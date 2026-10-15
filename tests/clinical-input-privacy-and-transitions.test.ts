/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/on-call/handover",
  useSearchParams: () => new URLSearchParams(),
}));

import { ClinicalAskAnswerSurface } from "@/components/clinical-dashboard/clinical-ask-answer-surface";
import { CmeEntryForm } from "@/components/cme/cme-entry-form";
import { DsmDiagnosisNoteBuilder } from "@/components/dsm/dsm-diagnosis-note-builder";
import { FormulationBuilderPage } from "@/components/formulation/formulation-builder-page";
import { OnCallHandoverPage } from "@/components/on-call/handover/handover-page";
import {
  clearAccountScopedBrowserStorage,
  TEACHING_TERM_TRACKER_STORAGE_KEY,
} from "@/lib/account-scoped-browser-state";
import { setSharedDevice } from "@/lib/alerts/shared-device";
import { dsmDiagnoses } from "@/lib/dsm";
import { dsmNoteBuilderRecord } from "@/lib/dsm-note";
import { clearOnCallHandover } from "@/lib/on-call/handover";
import { sampleTermTracker } from "@/lib/teaching/term-tracker";
import { saveTermTrackerState, useTermTrackerStore } from "@/lib/teaching/term-tracker-store";

function expectPrivacyAttributes(element: Element | null) {
  expect(element).not.toBeNull();
  expect(element?.getAttribute("autocomplete")).toBe("off");
  expect(element?.getAttribute("spellcheck")).toBe("false");
  expect(element?.getAttribute("data-gramm")).toBe("false");
  expect(element?.getAttribute("data-enable-grammarly")).toBe("false");
}

describe("Clinical input privacy attributes & account transitions", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    window.localStorage.clear();
    window.sessionStorage.clear();
    setSharedDevice(false);
    clearOnCallHandover();
  });

  afterEach(() => {
    cleanup();
    setSharedDevice(false);
  });

  it("renders privacy attributes on OnCallHandoverPage NoteArea, TextLine, and bed/ward inputs", () => {
    const { container } = render(React.createElement(OnCallHandoverPage));
    const bedInput = container.querySelector('[data-testid="on-call-handover-bed"]');
    const wardInput = container.querySelector('[data-testid="on-call-handover-ward"]');
    const impression = container.querySelector('[data-testid="on-call-handover-impression"]');
    const story = container.querySelector('[data-testid="on-call-handover-story"]');
    const referrals = container.querySelector('[data-testid="on-call-handover-referrals"]');
    const plan = container.querySelector('[data-testid="on-call-handover-plan"]');

    expectPrivacyAttributes(bedInput);
    expectPrivacyAttributes(wardInput);
    expectPrivacyAttributes(impression);
    expectPrivacyAttributes(story);
    expectPrivacyAttributes(referrals);
    expectPrivacyAttributes(plan);
  });

  it("renders privacy attributes on FormulationBuilderPage textareas and resets state on account transition", () => {
    const { container } = render(React.createElement(FormulationBuilderPage));
    const stepButtons = container.querySelectorAll('ol[aria-label="Formulation builder steps"] button');
    expect(stepButtons.length).toBe(4);

    // Step 1 is default; click step 2 (Structure)
    fireEvent.click(stepButtons[1]!);
    const structureTextareas = Array.from(container.querySelectorAll("textarea"));
    expect(structureTextareas.length).toBeGreaterThan(0);
    for (const textarea of structureTextareas) {
      expectPrivacyAttributes(textarea);
    }

    fireEvent.change(structureTextareas[0]!, { target: { value: "Synthetic clinical note" } });
    expect(window.sessionStorage.getItem("psychsift_formulation_draft")).toContain("Synthetic clinical note");

    // Step 3 (Review)
    fireEvent.click(stepButtons[2]!);
    const reviewTextareas = Array.from(container.querySelectorAll("textarea"));
    expect(reviewTextareas.length).toBeGreaterThan(0);
    for (const textarea of reviewTextareas) {
      expectPrivacyAttributes(textarea);
    }

    // Step 4 (Draft)
    fireEvent.click(stepButtons[3]!);
    const draftTextarea = container.querySelector('textarea[aria-label="Formulation draft"]');
    expectPrivacyAttributes(draftTextarea);

    // Account transition clears live React state and sessionStorage without re-populating it
    act(() => {
      clearAccountScopedBrowserStorage();
    });
    expect(window.sessionStorage.getItem("psychsift_formulation_draft")).toBeNull();
  });

  it("renders privacy attributes on DsmDiagnosisNoteBuilder and resets state on account transition", () => {
    const panic = dsmNoteBuilderRecord(dsmDiagnoses.find((d) => d.slug === "panic-disorder")!);
    const { container } = render(React.createElement(DsmDiagnosisNoteBuilder, { record: panic }));

    const specifierInput = container.querySelector("#dsm-note-specifier-text") as HTMLInputElement | null;
    expectPrivacyAttributes(specifierInput);

    fireEvent.change(specifierInput!, { target: { value: "Synthetic specifier" } });
    const storageKey = `psychsift_dsm_draft_${panic.icdCode}`;
    expect(window.sessionStorage.getItem(storageKey)).toContain("Synthetic specifier");

    act(() => {
      clearAccountScopedBrowserStorage();
    });

    expect(specifierInput?.value).toBe("");
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("renders privacy attributes on CmeEntryForm and ClinicalAskAnswerSurface free-text inputs", () => {
    const { container: cmeContainer } = render(
      React.createElement(CmeEntryForm, { onSubmit: vi.fn(), existingEntries: [] }),
    );
    expectPrivacyAttributes(cmeContainer.querySelector("#cme-entry-title"));
    expectPrivacyAttributes(cmeContainer.querySelector("#cme-entry-reflection"));

    const { container: askContainer } = render(
      React.createElement(ClinicalAskAnswerSurface, {
        response: {
          state: "clarification_required",
          mode: "services",
          suggestions: [],
          clarifications: [
            {
              id: "serviceLocation",
              field: "serviceLocation",
              prompt: "Specify synthetic context",
              required: true,
            },
          ],
        },
        onClarificationChange: vi.fn(),
      }),
    );
    expectPrivacyAttributes(askContainer.querySelector('input[name="serviceLocation"]'));
  });

  it("prevents term-tracker-store from reading or writing localStorage when Shared Device mode is active", () => {
    setSharedDevice(true);
    const sample = sampleTermTracker("2026-10-06");
    saveTermTrackerState(sample);
    expect(window.localStorage.getItem(TEACHING_TERM_TRACKER_STORAGE_KEY)).toBeNull();

    function Probe() {
      const { state, update } = useTermTrackerStore(null);
      return React.createElement(
        "button",
        {
          type: "button",
          onClick: () => update(() => sample),
          "data-terms": state?.terms.length ?? 0,
        },
        "Save term",
      );
    }

    render(React.createElement(Probe));
    fireEvent.click(screen.getByRole("button", { name: "Save term" }));
    expect(window.localStorage.getItem(TEACHING_TERM_TRACKER_STORAGE_KEY)).toBeNull();
  });
});
