/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RotationsRead } from "@/components/roster/rotations/use-rotations";
import { EXAMPLE_ROTATION_SERVICE_ID, exampleRotationRounds } from "@/lib/example-data/datasets/roster-rotations";

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
  usePathname: () => "/roster/manage/rotations/new",
  useSearchParams: () => new URLSearchParams(),
}));

const rotationsRead: { current: RotationsRead } = { current: null as unknown as RotationsRead };
vi.mock("@/components/roster/rotations/use-rotations", () => ({
  useRotations: () => rotationsRead.current,
}));

import { syntheticPatients } from "@/components/care-plan/mockups/fixtures";
import { CarePlanPrototypeProvider } from "@/components/care-plan/mockups/prototype-provider";
import { SafetyPlanFormSurface } from "@/components/care-plan/mockups/safety-plan-form";
import { OnCallEntryEditor } from "@/components/on-call/on-call-entry-editor";
import { NewRotationRoundPage } from "@/components/roster/rotations/admin/round-form";

function isBeforeUnloadPrevented(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("Dirty-state guards, download attributes & external link rel attributes", () => {
  beforeEach(() => {
    const example = exampleRotationRounds(new Date());
    const exampleTeam = example.rounds[0]!.round;
    const teams = [{ serviceId: EXAMPLE_ROTATION_SERVICE_ID, name: "Adult team", people: exampleTeam.people }];
    rotationsRead.current = {
      status: "ready",
      source: "example",
      mine: [],
      managed: example.rounds,
      canManage: true,
      teams,
      team: teams[0]!,
      actions: { createRound: vi.fn() } as unknown as RotationsRead["actions"],
      retry: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("guards SafetyPlanFormSurface with useDirtyStateGuard when draft values are modified", () => {
    const patientId = syntheticPatients[0]!.id;
    const { container } = render(
      React.createElement(
        CarePlanPrototypeProvider,
        null,
        React.createElement(SafetyPlanFormSurface, {
          patientId,
          scenario: "normal",
          navigate: vi.fn(),
        }),
      ),
    );

    expect(isBeforeUnloadPrevented()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Start a new version/i }));

    expect(isBeforeUnloadPrevented()).toBe(false);

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    fireEvent.change(textarea!, { target: { value: "Updated synthetic warning sign" } });

    expect(isBeforeUnloadPrevented()).toBe(true);
  });

  it("guards RoundForm (NewRotationRoundPage) with useDirtyStateGuard when draft is modified", () => {
    const { container } = render(React.createElement(NewRotationRoundPage));
    expect(isBeforeUnloadPrevented()).toBe(false);

    const textInputs = Array.from(container.querySelectorAll('input[type="text"], input:not([type])'));
    expect(textInputs.length).toBeGreaterThan(0);
    fireEvent.change(textInputs[0]!, { target: { value: "2027 Modified Round Name" } });

    expect(isBeforeUnloadPrevented()).toBe(true);
  });

  it("guards OnCallEntryEditor with useDirtyStateGuard when open and dirty", () => {
    render(
      React.createElement(OnCallEntryEditor, {
        open: true,
        onClose: vi.fn(),
        section: "contacts",
        entry: null,
        onSaved: vi.fn(),
        onDeleted: vi.fn(),
      }),
    );

    expect(isBeforeUnloadPrevented()).toBe(false);

    const dialog = screen.getByTestId("on-call-entry-editor");
    const titleInput = dialog.querySelector('input[type="text"], input:not([type])') as HTMLInputElement | null;
    expect(titleInput).not.toBeNull();
    fireEvent.change(titleInput!, { target: { value: "After-hours Psychiatry Registrar" } });

    expect(isBeforeUnloadPrevented()).toBe(true);
  });

  it("releases beforeunload guard when OnCallEntryEditor is closed (open=false)", () => {
    const { rerender } = render(
      React.createElement(OnCallEntryEditor, {
        open: true,
        onClose: vi.fn(),
        section: "contacts",
        entry: null,
        onSaved: vi.fn(),
        onDeleted: vi.fn(),
      }),
    );

    const dialog = screen.getByTestId("on-call-entry-editor");
    const titleInput = dialog.querySelector('input[type="text"], input:not([type])') as HTMLInputElement | null;
    fireEvent.change(titleInput!, { target: { value: "Dirty title" } });
    expect(isBeforeUnloadPrevented()).toBe(true);

    rerender(
      React.createElement(OnCallEntryEditor, {
        open: false,
        onClose: vi.fn(),
        section: "contacts",
        entry: null,
        onSaved: vi.fn(),
        onDeleted: vi.fn(),
      }),
    );
    expect(isBeforeUnloadPrevented()).toBe(false);
  });

  it("includes download on RosterCoverTab Excel export link and overflow-x-auto + noopener noreferrer across Workstream B external link files", () => {
    const rosterCoverSource = fs.readFileSync("src/components/roster/manage/roster-cover-tab.tsx", "utf8");
    expect(rosterCoverSource).toMatch(/<a\s+[^>]*download[\s>]/);
    expect(rosterCoverSource).toContain("Download Excel");

    const cmeTrainingSource = fs.readFileSync("src/components/cme/cme-training-page.tsx", "utf8");
    expect(cmeTrainingSource).toMatch(
      /<div className="overflow-x-auto">\s*<table[^>]*data-testid="cme-training-experience-grid"/,
    );
    expect(cmeTrainingSource).toContain('rel="noopener noreferrer"');

    const mhaClockSource = fs.readFileSync("src/components/psychiatry/mha-clock-page.tsx", "utf8");
    expect(mhaClockSource).toContain('rel="noopener noreferrer"');

    const askSurfaceSource = fs.readFileSync(
      "src/components/clinical-dashboard/clinical-ask-answer-surface.tsx",
      "utf8",
    );
    expect(askSurfaceSource).toContain('rel="noopener noreferrer"');

    const workstreamBExternalLinkFiles = [
      "src/components/cme/applications/applications-cv-page.tsx",
      "src/components/cme/applications/applications-page.tsx",
      "src/components/cme/cme-training-page.tsx",
      "src/components/cme/cpd-home/cpd-home-page.tsx",
      "src/components/first-nations/acknowledgement.tsx",
      "src/components/first-nations/liaison-hero.tsx",
      "src/components/first-nations/phrase-line.tsx",
      "src/components/first-nations/place-card.tsx",
      "src/components/medicines/medicines-home-page.tsx",
      "src/components/medicines/medicines-home.tsx",
      "src/components/my-day/profile/agreement-profile-page.tsx",
      "src/components/on-call/call/call-page.tsx",
      "src/components/on-call/first-week/first-week-section-view.tsx",
      "src/components/psychiatry/mha-clock-page.tsx",
      "src/components/psychiatry/psychiatry-home-page.tsx",
      "src/components/psychiatry/psychiatry-home.tsx",
      "src/components/teaching/teaching-home-page.tsx",
      "src/components/teaching/assessments/assessments-home.tsx",
      "src/components/teaching/term-assessment.tsx",
      "src/components/teaching/term-home-page.tsx",
      "src/components/clinical-dashboard/clinical-ask-answer-surface.tsx",
    ];

    const existingFiles = workstreamBExternalLinkFiles.filter((filePath) => fs.existsSync(filePath));
    expect(existingFiles.length).toBeGreaterThanOrEqual(11);

    for (const filePath of existingFiles) {
      const source = fs.readFileSync(filePath, "utf8");
      const relMatches = Array.from(source.matchAll(/\brel="([^"]*)"/g)).map((m) => m[1]!);
      for (const relValue of relMatches) {
        if (relValue.includes("noreferrer")) {
          expect(relValue, `${filePath} has rel="${relValue}" without noopener`).toContain("noopener");
        }
      }
      const targetBlankTags = Array.from(source.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)).map((m) => m[0]!);
      for (const tag of targetBlankTags) {
        expect(tag, `${filePath} has target="_blank" without noopener: ${tag}`).toMatch(/\brel="[^"]*noopener[^"]*"/);
        expect(tag, `${filePath} has target="_blank" without noreferrer: ${tag}`).toMatch(
          /\brel="[^"]*noreferrer[^"]*"/,
        );
      }
    }
  });
});
