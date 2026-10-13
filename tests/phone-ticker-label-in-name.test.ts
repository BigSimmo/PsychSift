import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { sourceSegment } from "./helpers/source-contract";

/**
 * Lighthouse Label-in-Name (WCAG 2.5.3) on the phone "Try this" ticker:
 * visible text is "Try this" and the suggestion (the trailing "Tap to search"
 * left the visible line on 12 Oct 2026 so the suggestion fits a phone). The
 * name must start with that visible text; it still ends "Tap to search" so it
 * says what a tap does.
 */
const SOURCE = readFileSync(
  resolve(process.cwd(), "src/components/clinical-dashboard/universal-search-command-surface.tsx"),
  "utf8",
);

describe("phone ticker Label-in-Name", () => {
  it("includes Try this, the suggestion, and Tap to search in the accessible name", () => {
    const ticker = sourceSegment(SOURCE, 'data-testid="smart-search-phone-ticker"', "SmartIntentCue", {
      label: "phone ticker button",
    });

    expect(ticker).toContain("aria-label={`Try this ${resolvedTickerExample}. Tap to search`}");
    expect(ticker).toContain('<span className="smart-search-phone-ticker-kicker">Try this</span>');
    expect(ticker).not.toContain("smart-search-phone-ticker-action");
    expect(ticker).not.toContain("Try suggested search:");
  });
});
