import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("Mobile ergonomics, touch targets, forced-colors, and 12px floor (Task 9)", () => {
  it("prevents iOS Safari auto-zoom by enforcing 1rem font-size below 640px on assessment and admin inputs", () => {
    const assessCss = readRepoFile("src/components/teaching/assessments/assess.css");
    expect(assessCss).toMatch(
      /@media\s*\(max-width:\s*639px\)\s*\{[\s\S]*?\.assess-txt\s*\{\s*font-size:\s*1rem;\s*\}/,
    );

    const adminWorkCss = readRepoFile("src/components/admin/admin-work.module.css");
    expect(adminWorkCss).toMatch(
      /@media\s*\(max-width:\s*639px\)\s*\{\s*\.searchBox,\s*\.field,\s*\.select,\s*\.copyBox\s*\{\s*font-size:\s*1rem;\s*\}\s*\}/,
    );
  });

  it("prevents 320px-375px horizontal overflow on medication and differential loading skeletons", () => {
    const medicationLoading = readRepoFile("src/app/(search-app)/medications/[slug]/loading.tsx");
    expect(medicationLoading).toContain("w-full max-w-96");
    expect(medicationLoading).not.toMatch(/(?<![-\w])w-96\b/);

    const differentialLoading = readRepoFile("src/app/(search-app)/differentials/diagnoses/[slug]/loading.tsx");
    expect(differentialLoading).toContain("w-full max-w-80");
    expect(differentialLoading).not.toMatch(/(?<![-\w])w-80\b/);
  });

  it("enforces >= 44px touch targets on credentials wallet Edit, mode switcher, and home recent rows", () => {
    const credentialsWallet = readRepoFile("src/components/admin/admin-credentials-wallet.tsx");
    expect(credentialsWallet).toContain("min-h-tap min-w-tap items-center justify-center");

    const modeActionPopup = readRepoFile("src/components/clinical-dashboard/mode-action-popup.tsx");
    expect(modeActionPopup).toContain(
      "-mx-1.5 flex min-h-tap max-w-full items-center gap-1 rounded-lg px-1.5 py-0.5 text-left transition",
    );

    const answerStatus = readRepoFile("src/components/clinical-dashboard/answer-status.tsx");
    expect(answerStatus).toContain("focus-ring-contained flex min-h-12 w-full items-center");
  });

  it("provides Windows High Contrast (@media (forced-colors: active)) borders and state outlines for custom controls", () => {
    const assessCss = readRepoFile("src/components/teaching/assessments/assess.css");
    expect(assessCss).toContain(".assess-cb,");
    expect(assessCss).toContain(".assess-rd,");
    expect(assessCss).toContain(".assess-sw {");
    expect(assessCss).toContain(".assess-cb[data-on],");
    expect(assessCss).toContain(".assess-opt:has(:checked) .assess-rd,");
    expect(assessCss).toContain(".assess-tg:has(:checked) .assess-sw {");

    const cmeCss = readRepoFile("src/components/cme/cme-work.css");
    expect(cmeCss).toMatch(
      /@media\s*\(forced-colors:\s*active\)\s*\{[\s\S]*?\.cpd-switch\s*\{\s*border:\s*1px solid CanvasText;\s*\}/,
    );
    expect(cmeCss).toContain('[aria-checked="true"] > .cpd-switch');

    const stripCss = readRepoFile("src/components/work-frame/two-pane-side-strip.css");
    expect(stripCss).toMatch(
      /@media\s*\(forced-colors:\s*active\)\s*\{[\s\S]*?\.two-pane-menu__rail-item\[aria-pressed="true"\]\s+\.two-pane-menu__indicator/,
    );
    expect(stripCss).toContain(".two-pane-menu__pip");

    const menuCss = readRepoFile("src/components/work-frame/two-pane-side-menu.css");
    expect(menuCss).toMatch(
      /@media\s*\(forced-colors:\s*active\)\s*\{[\s\S]*?\.two-pane-menu__row\[aria-current="true"\],\s*\.two-pane-menu__tile\[aria-current="true"\]/,
    );
  });

  it("raises sub-12px font-size rules to at least 0.75rem (12px)", () => {
    const notifyCss = readRepoFile("src/components/needs-you/notification-centre.css");
    expect(notifyCss).not.toMatch(/font-size:\s*0\.6(25|5|875)rem/);
    expect(notifyCss).toMatch(/\.notify-badge\s*\{[\s\S]*?font-size:\s*0\.75rem;/);

    const menuCss = readRepoFile("src/components/work-frame/two-pane-side-menu.css");
    expect(menuCss).not.toMatch(/font-size:\s*0\.6(25|5|875)rem/);
    expect(menuCss).toMatch(/\.two-pane-menu__bell-count\s*\{[\s\S]*?font-size:\s*0\.75rem;/);

    const carePlanCss = readRepoFile("src/components/care-plan/mockups/care-plan.module.css");
    expect(carePlanCss).not.toMatch(/font-size:\s*0\.6(25|5|875)rem/);
    expect(carePlanCss).toMatch(/\.appRoot\s+\.definitionTerm\s*\{[\s\S]*?font-size:\s*0\.75rem;/);
  });
});
