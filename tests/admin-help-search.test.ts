import { describe, expect, it } from "vitest";

import { helpQueryAlsoLooksFor, matchesHelpQuery } from "@/lib/admin/help-search";

describe("everyday-word search, on the page only", () => {
  it("finds a pay guide from 'payslip', a food note from 'hungry', and a login row from 'password'", () => {
    expect(matchesHelpQuery("Pay queries and salary packaging", "payslip")).toBe(true);
    expect(matchesHelpQuery("Food after hours: vending only after 19:30", "hungry")).toBe(true);
    expect(matchesHelpQuery("Logins, paging and remote access", "password")).toBe(true);
  });

  it("needs every word typed, ignores case and spacing, and matches everything on an empty query", () => {
    expect(matchesHelpQuery("Annual leave form", "  LEAVE   form ")).toBe(true);
    expect(matchesHelpQuery("Annual leave form", "leave taxi")).toBe(false);
    expect(matchesHelpQuery("Anything", "")).toBe(true);
  });

  // Work-mode redesign, owner request 6 Oct 2026: Help says which everyday words a query also looked for.
  it("names the everyday words a query also looks for, leaving out the words typed and unknown words", () => {
    expect(helpQueryAlsoLooksFor("hungry")).toEqual(["food", "cafeteria", "vending", "meal", "dinner", "eat"]);
    expect(helpQueryAlsoLooksFor("food meal")).not.toContain("meal");
    expect(helpQueryAlsoLooksFor("zebra")).toEqual([]);
    expect(helpQueryAlsoLooksFor("   ")).toEqual([]);
  });
});
