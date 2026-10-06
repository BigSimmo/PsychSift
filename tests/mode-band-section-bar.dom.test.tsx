/**
 * Under a mode band, a page's own section bar stays in the page, below the
 * band, rather than moving into the top bar on phones (Josh, 6 Oct 2026).
 * Without a band both portals still move it into the top bar's collapse slot.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PhoneHeaderCollapsePortal } from "@/components/clinical-dashboard/phone-header-collapse-portal";
import { ModeBandShownContext } from "@/components/mode-band/mode-band-shown";
import { ModeNavHeaderPortal } from "@/components/mode-nav/mode-nav-portal";
import { phoneHeaderCollapseAddonSlotId } from "@/lib/mode-home-composer";

let host: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  host = document.createElement("div");
  host.id = phoneHeaderCollapseAddonSlotId;
  document.body.append(host);
});

afterEach(() => {
  host.remove();
  vi.unstubAllGlobals();
});

const portals = [
  ["PhoneHeaderCollapsePortal", PhoneHeaderCollapsePortal],
  ["ModeNavHeaderPortal", ModeNavHeaderPortal],
] as const;

describe.each(portals)("%s", (_name, Portal) => {
  it("keeps the section bar in the page, under the band, when a band shows", () => {
    render(
      <ModeBandShownContext.Provider value>
        <main data-testid="page">
          <Portal>
            <nav aria-label="Sections" />
          </Portal>
        </main>
      </ModeBandShownContext.Provider>,
    );
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(screen.getByTestId("page")).toContainElement(nav);
    expect(host).toBeEmptyDOMElement();
  });

  it("still moves the section bar into the top bar where no band shows", () => {
    render(
      <main data-testid="page">
        <Portal>
          <nav aria-label="Sections" />
        </Portal>
      </main>,
    );
    expect(host).toContainElement(screen.getByRole("navigation", { name: "Sections" }));
  });
});
