import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** The first rule block for `selector` in a stylesheet. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("Work pills in sentence case (design audit D20)", () => {
  it("draws .work-tag words as written, never in capitals", () => {
    const css = readFileSync(join(process.cwd(), "src/app/work-mode.css"), "utf8");
    const body = ruleBody(css, "\n.work-tag");
    expect(body).toContain("text-transform: none;");
    expect(body).not.toContain("uppercase");
  });

  it("draws Admin's status tag words as written, never in capitals", () => {
    const css = readFileSync(join(process.cwd(), "src/components/admin/admin-status.module.css"), "utf8");
    expect(ruleBody(css, "\n.tag")).not.toContain("uppercase");
  });
});
