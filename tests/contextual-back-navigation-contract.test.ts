import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const internalArrowControls = new Set([
  // Multi-step calculator flow, not browser-route navigation.
  "components/calculators/guided-flow.tsx",
  // Returns from a calculator record to the calculator search panel in-place.
  "components/calculators/search-detail.tsx",
  // Returns from a settings subpanel to the settings root in the same dialog.
  "components/clinical-dashboard/settings-dialog.tsx",
  // Previous step in the formulation builder workflow.
  "components/formulation/formulation-builder-page.tsx",
  // Steps to the previous situation card inside the First Nations Situation
  // module; the page and route stay the same.
  "components/first-nations/situation-module.tsx",
  // Returns from a mode's own section list to the full mode list inside the
  // same popover and the same sheet. Nothing has been navigated to, so there
  // is no history entry to go back through — routing it that way would leave
  // the reader's actual page and close the menu they were still using.
  "components/clinical-dashboard/master-search-header.tsx",
  // Returns from the finished handover table to the handover form on the
  // same page; nothing has been navigated to.
  "components/on-call/handover/handover-page.tsx",
]);

function productionArrowFiles() {
  return globSync("{app,components}/**/*.tsx", { cwd: sourceRoot })
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.toLowerCase().includes("mockup"))
    .filter((file) => {
      const source = readFileSync(resolve(sourceRoot, file), "utf8");
      return (
        /<ArrowLeft(?:\s|>)/.test(source) ||
        /<ArrowLeftIcon(?:\s|>)/.test(source) ||
        /icon=\{ArrowLeft\}/.test(source) ||
        /icon:\s*ArrowLeft\b/.test(source)
      );
    });
}

describe("page-level back-arrow contract", () => {
  it("routes every production page-level left arrow through contextual browser history", () => {
    const violations = productionArrowFiles().filter((file) => {
      if (internalArrowControls.has(file)) return false;
      const source = readFileSync(resolve(sourceRoot, file), "utf8");
      return !/ContextualBackLink|navigateContextuallyBack|behavior:\s*["']history-back["']/.test(source);
    });

    expect(violations).toEqual([]);
  });

  it("keeps the internal-control exclusion list exact and reviewable", () => {
    const arrowFiles = new Set(productionArrowFiles());
    expect([...internalArrowControls].filter((file) => !arrowFiles.has(file))).toEqual([]);
  });
});
