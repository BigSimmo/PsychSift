import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "@/app/(search-app)/teaching/sample/route";
import { TEACHING_SAMPLE_COOKIE, teachingSampleEntryHref, teachingSampleReturnPath } from "@/lib/teaching/sample-paths";

function hit(query: string) {
  return GET(new NextRequest(`https://psychiatry.tools/teaching/sample${query}`));
}

describe("Teaching sample switch", () => {
  it("only clears the retired Teaching-only cookie and lands on Teaching's home", () => {
    // The one example data switch replaced the Teaching-only sample cookie; old links still land safely.
    const response = hit("");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/teaching");
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`${TEACHING_SAMPLE_COOKIE}=;`));
    expect(response.cookies.get(TEACHING_SAMPLE_COOKIE)?.value ?? "").toBe("");
  });

  it("returns the reader to the Teaching page they came from", () => {
    expect(hit("?next=%2Fteaching%2Forganise").headers.get("location")).toBe("/teaching/organise");
  });

  it("turns the sample off with leave=1", () => {
    const response = hit("?leave=1&next=%2Fteaching%2Fweek");
    expect(response.headers.get("location")).toBe("/teaching/week");
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`${TEACHING_SAMPLE_COOKIE}=;`));
  });

  it("never redirects outside Teaching, or back into the switch", () => {
    for (const next of [
      "https://evil.example",
      "//evil.example/teaching",
      "/teachingx",
      "/documents",
      "/teaching/sample",
      "/teaching/sample?leave=1",
      "",
      null,
    ]) {
      expect(teachingSampleReturnPath(next)).toBe("/teaching");
    }
    expect(teachingSampleReturnPath("/teaching/session/abc?check-in=scan")).toBe("/teaching/session/abc?check-in=scan");
  });

  it("builds the entry link from the current page", () => {
    expect(teachingSampleEntryHref("/teaching/logbook")).toBe("/teaching/sample?next=%2Fteaching%2Flogbook");
    expect(teachingSampleEntryHref(null)).toBe("/teaching/sample?next=%2Fteaching");
  });
});
