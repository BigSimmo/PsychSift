import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Moved from the deleted WA MHA Form 6A/6B print layout's suite: print.css itself stays live
// (globals.css imports it, and Therapy Compass marks screen-only controls with `no-print`).
describe("print.css (#C4CFFP)", () => {
  it("enforces visible display for form headers, titles, and statutory metadata in @media print", () => {
    const printCss = readFileSync(resolve(process.cwd(), "src/styles/print.css"), "utf8");

    expect(printCss).toContain("@media print");
    expect(printCss).toContain("[data-print-header]");
    expect(printCss).toContain(".statutory-metadata");
    expect(printCss).toContain("display: block !important");
    expect(printCss).toContain("visibility: visible !important");
    expect(printCss).toMatch(/\[data-screen-only\],\s*\.no-print\s*\{\s*display: none !important;/);
  });
});
