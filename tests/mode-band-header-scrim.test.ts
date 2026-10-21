import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const modeBandStyles = readFileSync(new URL("../src/app/mode-band.css", import.meta.url), "utf8");
const workModeStyles = readFileSync(new URL("../src/app/work-mode.css", import.meta.url), "utf8");

// The glass scrim washes the top bar with the page colour and blurs the rows
// just below it. Over a tinted, opaque band bar that read as a white haze
// across the band (owner report, 21 Oct 2026), so every band bar drops it.
describe("band top bars carry no glass scrim", () => {
  it("hides the scrim under a mode band and on clinical band bars", () => {
    expect(modeBandStyles).toMatch(
      /html\[data-mode-band\] \.edge-glass-header-backdrop,\s*\n\.universal-header\[data-clinical-band\] \.edge-glass-header-backdrop \{\s*\n\s*display: none;/,
    );
  });

  it("keeps the work band rule that already hides it", () => {
    expect(workModeStyles).toMatch(
      /\.universal-header\[data-work-band\] \.edge-glass-header-backdrop \{\s*\n\s*display: none;/,
    );
  });
});
