// Citation titles get a space before a jammed bracket ("Guideline(EMHS)"), but not
// inside a receptor subtype name such as "5-HT(2A)" (audit 26 Oct 2026).

import { describe, expect, it } from "vitest";

import { formatCitationLabel } from "@/lib/citations";

function label(title: string) {
  return formatCitationLabel({ title, file_name: "x.pdf", page_number: 1 });
}

describe("citation title bracket spacing", () => {
  it.each(["5-HT(2A) antagonism and psychosis", "5-HT(1A) partial agonists"])("keeps %o intact", (title) => {
    expect(label(title)).toContain(title.split(" ")[0]);
  });

  it.each([
    ["Lithium Clinical Guideline(EMHS)", "Guideline (EMHS)"],
    ["Clozapine Policy(2024)", "Policy (2024)"],
  ])("still spaces %o", (title, expected) => {
    expect(label(title)).toContain(expected);
  });
});
