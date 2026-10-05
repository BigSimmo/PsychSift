import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModeBand, ModeBandStatus, useModeBandCount } from "@/components/mode-band/mode-band";

vi.mock("next/navigation", () => ({ usePathname: () => "/cme" }));

function YearPage({ drafts, sample }: { drafts: number; sample?: boolean }) {
  useModeBandCount("log", drafts);
  return <ModeBandStatus value={sample ? { kind: "sample" } : { kind: "saved", at: new Date() }} />;
}

describe("mode band tab counts", () => {
  it("puts a page's count on its tab, spoken as a to-do", () => {
    render(
      <ModeBand modeId="cme" statusSlot>
        <YearPage drafts={3} />
      </ModeBand>,
    );
    const log = screen.getByRole("link", { name: /^Log/ });
    expect(log).toHaveTextContent("Log3, 3 to do");
  });

  it("takes the count off the tab when the page closes", () => {
    const view = render(
      <ModeBand modeId="cme" statusSlot>
        <YearPage drafts={3} />
      </ModeBand>,
    );
    view.rerender(
      <ModeBand modeId="cme" statusSlot>
        <p>Another page</p>
      </ModeBand>,
    );
    expect(screen.getByRole("link", { name: /^Log/ })).toHaveTextContent(/^Log$/);
  });

  it("marks a signed-out band so its counts are hidden", () => {
    render(
      <ModeBand modeId="cme" statusSlot>
        <YearPage drafts={3} sample />
      </ModeBand>,
    );
    expect(screen.getByTestId("mode-band").querySelector('[data-mode-band-status="sample"]')).not.toBeNull();
  });
});
