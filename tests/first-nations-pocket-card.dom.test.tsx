/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FirstNationsPocketCard, PocketCardView } from "@/components/first-nations/pocket-card";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/first-nations",
  useSearchParams: () => new URLSearchParams(),
}));
import { printedLineText } from "@/components/first-nations/printed-line";
import { hospitalViews } from "@/lib/first-nations/view-model";
import { enabledProfile, testInputs } from "./fixtures/first-nations-content";
import { resetAfterEach } from "./fixtures/first-nations-models";

resetAfterEach();

describe("PocketCard", () => {
  it("prints crisis numbers and no service numbers while the service layer is off", () => {
    render(<PocketCardView hospitals={hospitalViews(testInputs())} printedOn="2026-09-26" />);
    expect(screen.getByText("13 92 76")).toBeTruthy();
    expect(screen.getByText("000")).toBeTruthy();
    expect(screen.queryByText(/Royal Perth/)).toBeNull();
    expect(screen.queryByText(/liaison/i)).toBeNull();
    expect(screen.getByText("WA statewide")).toBeTruthy();
    expect(screen.getByText("Printed 26 Sep 2026 · checked 20 Aug 2026 · recheck by 18 Nov 2026")).toBeTruthy();
  });
  it("prints liaison and switchboard once the layer is on", () => {
    render(
      <PocketCardView hospitals={hospitalViews(testInputs({ profile: enabledProfile() }))} printedOn="2026-09-26" />,
    );
    expect(screen.getByText("9000 0001")).toBeTruthy();
    expect(screen.getByText("9000 0000")).toBeTruthy();
  });
  it("prints the shipped card with no EMHS name, since the service layer ships off", () => {
    const { container } = render(<FirstNationsPocketCard />);
    expect(container.textContent).not.toMatch(/East Metropolitan|EMHS|Royal Perth/);
    expect(screen.getByRole("heading", { level: 1, name: "First Nations" })).toBeTruthy();
    expect(screen.getByText("13 92 76")).toBeTruthy();
    expect(screen.getByText(/^Printed .* · checked .* · (recheck by|due for a check since) /)).toBeTruthy();
  });
  it("cannot renew stale contact evidence by printing again", () => {
    expect(printedLineText("2027-01-01", "2026-08-20")).toBe(
      "Printed 1 Jan 2027 · checked 20 Aug 2026 · due for a check since 18 Nov 2026",
    );
  });
});
