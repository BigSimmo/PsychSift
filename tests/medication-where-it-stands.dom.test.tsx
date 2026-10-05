/** @vitest-environment jsdom */

// "Where it stands" on a medicine page states no formulary status or PBS
// listing of its own: each row opens the publisher that owns the answer, or
// the clinician's own document search.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MedicationWhereItStands } from "@/components/clinical-dashboard/medication-where-it-stands";
import { appModeHomeHref } from "@/lib/app-modes";
import { WA_FORMULARY_HREF, pbsSearchHref } from "@/lib/medicines-references";

afterEach(cleanup);

describe("MedicationWhereItStands", () => {
  it("links the formulary, a PBS search for this medicine and a library search, and claims no status", () => {
    render(<MedicationWhereItStands medicineName="Lithium carbonate" />);

    const formulary = screen.getByTestId("medication-stands-formulary");
    expect(formulary.getAttribute("href")).toBe(WA_FORMULARY_HREF);
    expect(formulary.getAttribute("target")).toBe("_blank");

    const pbs = screen.getByTestId("medication-stands-pbs");
    expect(pbs.getAttribute("href")).toBe(pbsSearchHref("Lithium carbonate"));
    expect(pbs.getAttribute("href")).toBe("https://www.pbs.gov.au/pbs/search?term=Lithium+carbonate");
    expect(pbs.getAttribute("rel")).toBe("noopener noreferrer");

    const local = screen.getByTestId("medication-stands-local");
    expect(local.getAttribute("href")).toBe(appModeHomeHref("documents", { query: "Lithium carbonate", run: true }));
    expect(local.getAttribute("target")).toBeNull();

    const text = screen.getByTestId("medication-where-it-stands").textContent ?? "";
    expect(text).not.toMatch(/authority|streamlined|restricted|non-formulary|current|listed/i);
  });
});
