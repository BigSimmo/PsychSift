import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ROOT,
  numberWeightFindings,
  parseTsxFile as parse,
  scanOffendingLines,
  sourceFiles,
} from "./helpers/type-weight-scanner";

/**
 * CPD type weights (design standard v13 §1, CPD spec §5 "Type").
 *
 * Headings 600, names and row titles 500, body and numbers 400. Nothing on a
 * CPD page is ever bold, extrabold or black, and `--font-weight-value` (650)
 * is never used. A number is never heavier than 400 and never uppercase, so a
 * month total reads "9.5 h", not "9.5 H".
 *
 * A NUMBER ELEMENT is a JSX element whose own class list carries `nums` or
 * `tabular-nums`, or whose `data-testid` / `testId` ends in `-hours` or
 * `-total`. Its weight is its own last `font-*` weight class, or else the
 * nearest JSX ancestor's in the same file (CSS inherits it); the same goes for
 * `uppercase` / `normal-case`. Class strings are read through `cn(...)`,
 * template literals, local constants and the recipe constants CPD imports from
 * the shared recipe modules in `type-weight-scanner`, so `cn(eyebrowText, …)`
 * counts as the 600 uppercase eyebrow it is.
 */

const CPD_DIRS = ["src/components/cme", "src/app/(search-app)/cme"];
const BANNED = /\bfont-(?:bold|extrabold|black)\b|--font-weight-value|\[font-weight:/;

const cpdFiles = sourceFiles(CPD_DIRS, [".tsx"]);

describe("CPD type weights", () => {
  it("scans the CPD component and route folders", () => {
    expect(cpdFiles.length).toBeGreaterThan(30);
  });

  it("never uses font-bold, font-extrabold, font-black or --font-weight-value", () => {
    expect(scanOffendingLines(cpdFiles, BANNED)).toEqual([]);
  });

  it("sets every number at 400 and never in uppercase", () => {
    const results = cpdFiles.map((file) => numberWeightFindings(parse(file)));
    expect(results.reduce((sum, result) => sum + result.numbers, 0)).toBeGreaterThanOrEqual(8);
    expect(results.flatMap((result) => result.findings)).toEqual([]);
  });

  it("catches a number that inherits the eyebrow's weight and capitals, and passes the fixed form", () => {
    const fixture = (total: string) =>
      parse(
        resolve(ROOT, "src/components/cme/fixture.tsx"),
        `import { cn, eyebrowText } from "@/components/ui-primitives";
export function Month() {
  return (
    <h2 className={cn(eyebrowText, "flex")}>
      <span>September 2026</span>
      ${total}
    </h2>
  );
}`,
      );
    expect(numberWeightFindings(fixture('<span className="tabular-nums">9.5 h</span>')).findings).toEqual([
      "src/components/cme/fixture.tsx:6 number at font-semibold",
      "src/components/cme/fixture.tsx:6 number set in uppercase",
    ]);
    expect(
      numberWeightFindings(fixture('<span className="nums font-normal normal-case">9.5 h</span>')).findings,
    ).toEqual([]);
  });
});
