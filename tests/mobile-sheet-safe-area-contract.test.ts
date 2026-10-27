import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("mobile sheet top safe-area ownership", () => {
  it("routes fullscreen and near-full Sheet headers through the shared contract", () => {
    const sheet = source("src/components/ui/sheet.tsx");
    const accountSetup = source("src/components/clinical-dashboard/account-setup-dialog.tsx");
    const sidebar = source("src/components/clinical-dashboard/ClinicalSidebar.tsx");
    const masterHeader = source("src/components/clinical-dashboard/master-search-header.tsx");

    expect(sheet).toContain('mobileHeaderSafeArea ?? (defaultSheetIsFullscreen ? "padding" : "none")');
    expect(sheet).toContain('"pt-[max(1rem,var(--safe-area-top))] sm:pt-5"');
    expect(sheet).toContain('"top-[max(0.75rem,var(--safe-area-top))] sm:top-4"');
    expect(accountSetup).toContain('mobileHeaderSafeArea="offset"');
    // On phones the close button's own row now holds the top safe area (it used to be the
    // orientation panel's padding, with the close button floating over the content).
    expect(accountSetup).toContain("pt-[max(0.25rem,var(--safe-area-top))]");
    expect(sidebar).toContain('mobileHeaderSafeArea="padding"');
    expect(masterHeader).toContain('mobileHeaderSafeArea="padding"');
  });

  it("keeps the standalone calculator sheet below the unsafe top band on phones", () => {
    const calculatorSheet = source("src/components/calculators/calculator-sheet.tsx");

    expect(calculatorSheet).toContain(
      "max-h-[calc(100dvh-max(0.75rem,var(--safe-area-top))-var(--keyboard-height,0px))]",
    );
    expect(calculatorSheet).toContain("sm:max-h-[92dvh]");
  });
});
