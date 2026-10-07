import { describe, expect, it } from "vitest";

import { EMPTY_APPLICATIONS, type ApplicationsState } from "@/lib/cme/applications";
import { agreementWorkAnswer, featureSearchPages, withFeaturePages } from "@/lib/work-search/feature-pages";
import { searchWorkPages, workSearchPages, type WorkSearchPage } from "@/lib/work-search/pages";

function applications(): ApplicationsState {
  return {
    ...EMPTY_APPLICATIONS,
    referees: [
      { id: "r1", name: "Dr Grant", role: "Consultant", status: "asked", history: [] },
      { id: "example:r2", name: "Dr Example", role: "Consultant", status: "asked", history: [] },
    ],
  };
}

describe("feature pages in Search my work", () => {
  it("offers each feature's page under its area, with its own words", () => {
    const pages = featureSearchPages(null);
    const sick = pages.find((page) => page.href === "/roster/sick");
    expect(sick).toMatchObject({ label: "Sick for tomorrow", area: "Roster", identity: "roster" });
    expect(pages.find((page) => page.href === "/admin/contract")?.label).toBe("Contract end tracker");
    expect(pages.some((page) => page.href === "/teaching/term/folder")).toBe(true);
    expect(pages.some((page) => page.href.startsWith("/teaching/assessments?view=inbox"))).toBe(true);
    expect(searchWorkPages("unwell", pages)[0]?.page.href).toBe("/roster/sick");
    expect(new Set(pages.map((page) => page.id)).size).toBe(pages.length);
  });

  it("lists the reader's own referees only when signed in, never an example one", () => {
    expect(featureSearchPages(null).some((page) => page.label.includes("referee"))).toBe(false);
    const own = featureSearchPages({ entries: [], applications: applications() });
    expect(own.some((page) => page.label === "Dr Grant, referee")).toBe(true);
    expect(own.some((page) => page.label.includes("Dr Example"))).toBe(false);
  });

  it("never offers the discreet leave card", () => {
    const leave = featureSearchPages(null).filter((page) => page.href.startsWith("/admin/leave"));
    expect(leave.length).toBeGreaterThan(1);
    expect(JSON.stringify(leave).toLowerCase()).not.toContain("domestic");
  });

  it("does not offer a page twice once the frame lists it, and keeps the feature's words", () => {
    const frame: WorkSearchPage = {
      id: "rost:sick",
      label: "Sick",
      area: "Roster",
      identity: "roster",
      sub: null,
      href: "/roster/sick",
      icon: "pulse",
      keywords: [],
    };
    const merged = withFeaturePages([frame], featureSearchPages(null));
    expect(merged.filter((page) => page.href === "/roster/sick")).toHaveLength(1);
    expect(merged.find((page) => page.href === "/roster/sick")?.keywords).toContain("unwell");
    expect(withFeaturePages(workSearchPages(), []).length).toBe(workSearchPages().length);
  });
});

describe("agreement answers in Search my work", () => {
  it("quotes the agreement with its clause and links the topic", () => {
    const answer = agreementWorkAnswer("can I be rostered straight after nights");
    expect(answer).toMatchObject({
      area: "roster",
      label: "From the agreement",
      headline: "Time off after nights",
      meta: ["Clause 15(6)(g)"],
      action: { label: "Open the agreement", href: "/my-day/profile/agreement?topic=rest-after-nights" },
    });
    expect(answer?.items).toEqual([]);
  });

  it("stays out of ordinary searches and patient details", () => {
    expect(agreementWorkAnswer("overtime form")).toBeNull();
    expect(agreementWorkAnswer("UR 4471823 after nights")).toBeNull();
  });
});
