/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WaMhaFormPrint } from "@/components/forms/wa-mha-form-print";

afterEach(cleanup);

describe("WaMhaFormPrint (#C4CFFP)", () => {
  it("renders Form 6A with visible header, title, and statutory metadata", () => {
    render(<WaMhaFormPrint formCode="6A" />);

    const header = screen.getByTestId("form-print-header");
    expect(header).toBeInTheDocument();
    expect(header).toHaveAttribute("data-print-header", "true");

    const title = screen.getByTestId("form-print-title");
    expect(title).toHaveTextContent("Inpatient treatment order in authorised hospital");

    const badge = screen.getByTestId("form-code-badge");
    expect(badge).toHaveTextContent("Form 6A");

    const statutory = screen.getByTestId("statutory-metadata");
    expect(statutory).toHaveTextContent("Sections 55, 56, 72, 89, 90, 120, 123, 131");
    expect(statutory).toHaveTextContent("Authorised Hospital");
  });

  it("renders Form 6B with general hospital setting and Chief Psychiatrist consent", () => {
    render(<WaMhaFormPrint formCode="6B" isChild />);

    const header = screen.getByTestId("form-print-header");
    expect(header).toBeInTheDocument();

    const title = screen.getByTestId("form-print-title");
    expect(title).toHaveTextContent("Inpatient treatment order in general hospital");

    const statutory = screen.getByTestId("statutory-metadata");
    expect(statutory).toHaveTextContent("Sections 61, 89, 90, 131");
    expect(statutory).toHaveTextContent("14 days (Child)");

    expect(screen.getByText(/General Hospital Detention Justification/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Chief Psychiatrist Consent/i).length).toBeGreaterThanOrEqual(1);
  });

  it("prints no invented patient facts and never defaults consent to obtained", () => {
    render(<WaMhaFormPrint formCode="6B" />);
    const root = screen.getByTestId("wa-mha-form-print-root");
    expect(root).not.toHaveTextContent("Smith, John");
    expect(root).not.toHaveTextContent("UMRN-984210");
    expect(root).not.toHaveTextContent("Obtained and documented in clinical record.");
  });

  it("print.css enforces visible display for form headers, titles, and statutory metadata in @media print", () => {
    const cssPath = resolve(process.cwd(), "src/styles/print.css");
    const printCss = readFileSync(cssPath, "utf8");

    expect(printCss).toContain("@media print");
    expect(printCss).toContain(".wa-mha-print-header");
    expect(printCss).toContain("[data-print-header]");
    expect(printCss).toContain(".statutory-metadata");
    expect(printCss).toContain("display: block !important");
    expect(printCss).toContain("visibility: visible !important");
  });
});
