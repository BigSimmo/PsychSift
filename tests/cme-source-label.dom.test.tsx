import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CmeAnnualSummary } from "@/components/cme/cme-annual-summary";
import { CmeDashboard } from "@/components/cme/cme-dashboard";
import { CmeProgrammePage } from "@/components/cme/cme-programme-page";
import { CmeSetupPage } from "@/components/cme/cme-setup-page";
import { CME_PRESET_VERSION, createAustralianRanzcpPreset } from "@/lib/cme/presets";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cme",
}));

afterEach(cleanup);

const PRESET_YEAR = createAustralianRanzcpPreset(2026, "2026-01-05");
const LABEL = "RANZCP (Medical Board baseline plus RANZCP peer review)";

describe("screens name the CPD home, never the internal preset id", () => {
  it("on Today's source line", () => {
    render(<CmeDashboard set={PRESET_YEAR} entries={[]} now={new Date("2026-09-19T02:00:00Z")} />);
    const provenance = screen.getByTestId("cme-provenance");
    // The Year page names the preset as the mock-up does: "the RANZCP starting set".
    expect(provenance).toHaveTextContent("the RANZCP starting set");
    expect(provenance).not.toHaveTextContent(CME_PRESET_VERSION);
  });

  it("on the programme screen", () => {
    render(<CmeProgrammePage set={PRESET_YEAR} />);
    const provenance = screen.getByTestId("cme-provenance");
    expect(provenance).toHaveTextContent(`against ${LABEL}.`);
    expect(provenance).not.toHaveTextContent(CME_PRESET_VERSION);
  });

  it("on the annual summary", () => {
    render(<CmeAnnualSummary set={PRESET_YEAR} entries={[]} now={new Date("2026-09-19T02:00:00Z")} />);
    const summary = screen.getByTestId("cme-annual-summary");
    expect(summary).toHaveTextContent(`Targets confirmed 5 January 2026: ${LABEL}`);
    expect(summary).not.toHaveTextContent(CME_PRESET_VERSION);
  });

  it("on the set-up screen's preset card", () => {
    render(<CmeSetupPage year={2026} set={null} />);
    // The national baseline is the default home; the RANZCP preset card shows once RANZCP is chosen.
    fireEvent.click(screen.getByRole("radio", { name: "RANZCP" }));
    const preset = screen.getByTestId("cme-setup-preset");
    expect(preset).toHaveTextContent(`Starting preset: ${LABEL}`);
    expect(preset).not.toHaveTextContent(CME_PRESET_VERSION);
  });
});
