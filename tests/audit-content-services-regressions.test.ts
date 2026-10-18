import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { generateMetadata as generateFormMetadata } from "@/app/(search-app)/forms/[slug]/page";
import { generateMetadata as generateServiceMetadata } from "@/app/(search-app)/services/[slug]/page";
import { sourceToneClass } from "@/components/forms/form-detail-page";
import { toneNeutral, toneSuccess, toneWarning } from "@/components/ui-primitives";
import { formRecords, getFormRecord, type FormRecord } from "@/lib/forms";
import { canCompareServices, serviceNavigatorMetrics } from "@/lib/service-navigator-metrics";
import { serviceRecords, type ServiceRecord } from "@/lib/services";

vi.mock("@/components/forms/form-detail-client", () => ({ FormDetailClient: () => null }));
vi.mock("@/components/services/service-detail-client", () => ({ ServiceDetailClient: () => null }));

const formDetailSource = readFileSync(new URL("../src/components/forms/form-detail-page.tsx", import.meta.url), "utf8");
const normalizedFormDetailSource = formDetailSource.replace(/\s+/g, " ");
const formsSearchSource = readFileSync(
  new URL("../src/components/forms/forms-search-results-page.tsx", import.meta.url),
  "utf8",
);
const serviceNavigatorSource = readFileSync(
  new URL("../src/components/services/services-navigator-page.tsx", import.meta.url),
  "utf8",
);

function service(slug: string, fields: Partial<ServiceRecord> = {}): ServiceRecord {
  return { slug, title: slug, ...fields };
}

function formWithProvenance(status: string, locallyVerified: boolean): FormRecord {
  const form = formRecords[0]!;
  return {
    ...form,
    source: { ...form.source, status },
    verification: { ...form.verification, locallyVerified },
  };
}

describe("content and services audit regressions", () => {
  it("derives service navigator metrics and requires two records for comparison", () => {
    const records = [
      service("high", {
        criteria: [
          { label: "Eligible", tone: "meet" },
          { label: "Confirm catchment", tone: "caution" },
        ],
        verification: { confidence: "High" },
      }),
      service("medium", {
        criteria: [{ label: "Excluded", tone: "reject" }],
        verification: { confidence: "Medium" },
      }),
      service("low", { verification: { confidence: "Low" } }),
      service("unknown"),
    ];

    expect(serviceNavigatorMetrics(records)).toEqual({
      meets: 1,
      cautions: 1,
      rejects: 1,
      high: 1,
      medium: 1,
      low: 1,
      unknown: 1,
      verified: 0,
      localConfirmation: 0,
    });
    expect(canCompareServices([])).toBe(false);
    expect(canCompareServices(records.slice(0, 1))).toBe(false);
    expect(canCompareServices(records.slice(0, 2))).toBe(true);
    expect(serviceNavigatorSource).toContain('searchParams.get("shortlist")');
    expect(serviceNavigatorSource).toContain('data-testid="services-shortlist-bar"');
    expect(serviceNavigatorSource).toContain("disabled={selected.length < 2}");
    expect(serviceNavigatorSource).not.toContain("useEffect(");
    expect(serviceNavigatorSource).toContain("aria-pressed={selected}");
    expect(serviceNavigatorSource).toContain("Add ${service.title} to shortlist");
    expect(serviceNavigatorSource).toContain("Remove ${service.title} from shortlist");
    // Deferred-query lag must not flash the group-empty state while ranking catches up.
    expect(serviceNavigatorSource).toContain("query.trim() && deferredQuery !== query");
    expect(serviceNavigatorSource).toContain("deferredQuery === query && displayedMatches.length === 0");
    // Shortlist Compare/Clear keep keyboard focus rings (shared focus-visible contract).
    expect(serviceNavigatorSource).toMatch(
      /navigateWorkflow\("compare"\)[\s\S]*?focus-visible:outline-\[color:var\(--focus\)\]/,
    );
    expect(serviceNavigatorSource).toMatch(
      /navigateWorkflow\("search", \[\]\)[\s\S]*?focus-visible:outline-\[color:var\(--focus\)\]/,
    );
  });

  it("counts only explicit local verification and lets confirmation-required status veto it", () => {
    const records = [
      service("explicit", {
        verification: { locallyVerified: true, confidence: "High" },
        source: { status: "Official source" },
      }),
      service("status-only", {
        verification: { confidence: "High" },
        source: { status: "Official verified source" },
      }),
      service("confirmation-veto", {
        verification: { locallyVerified: true, confidence: "High" },
        source: { status: "Local source confirmation required" },
      }),
      service("unrelated-required-status", {
        verification: { confidence: "Unknown" },
        source: { status: "Referral required" },
      }),
    ];

    expect(serviceNavigatorMetrics(records)).toMatchObject({ verified: 1, localConfirmation: 1 });
  });

  it("keeps seeded form provenance explicitly unverified and free of invented source facts", () => {
    const transport = getFormRecord("transport-crisis-form");

    expect(transport).not.toBeNull();
    expect(transport).toMatchObject({
      verification: { locallyVerified: false, confidence: "Medium" },
      source: {
        label: "Office of the Chief Psychiatrist WA — approved MHA 2014 forms",
        status: "Source checked",
      },
    });
    expect(transport?.source).toHaveProperty("url");
    expect(transport?.source).toHaveProperty("reviewed");
    expect(transport?.source).not.toHaveProperty("pages");
    expect(transport?.source).not.toHaveProperty("pageCount");
    expect(transport?.source).not.toHaveProperty("reviewDue");
    expect(JSON.stringify(transport?.source)).not.toMatch(/\b\d+\s+pages?\b|\bstatutory\b/i);
    expect(formDetailSource).not.toMatch(/\b\d+\s+pages?\b|\bReview due\b/i);
    expect(formDetailSource).not.toContain("01 May 2026");
    expect(formDetailSource).not.toMatch(/5\(2\)|Admission order|Treatment order/);
    expect(formDetailSource).toContain("Open official source / pathway");
    expect(normalizedFormDetailSource).toContain(
      'label: "Source currency", value: displayText(form.source?.reviewed, "Review locally")',
    );

    for (const form of formRecords) {
      if (form.source?.url) continue;
      expect(form.verification?.locallyVerified, form.slug).toBe(false);
      expect(form.verification?.confidence, form.slug).toBe("Unknown");
      expect(form.source?.status, form.slug).toMatch(/confirmation required/i);
      expect(form.source?.reviewed, form.slug).toBeUndefined();
    }

    expect(formsSearchSource).toContain("Title or content match");
    expect(formsSearchSource).toContain("Content match in record details");
    expect(formsSearchSource).not.toContain("Content match in related pathway");
    expect(formsSearchSource).toContain("View all forms");
    // "View all forms" opens the whole register (the query-less search route) and
    // counts the register, not the current matches (#SZA102).
    expect(formsSearchSource).toContain('consolidatedModeSearchPath("forms")');
    expect(formsSearchSource).toContain("View all forms ({registerTotal})");
    expect(formsSearchSource).not.toContain('href="/forms"');
    // The retired detailed Forms home (and its caveat footer) is gone; the
    // structural footer contract lives in tests/mode-home-no-caveat-footer.test.ts.
    expect(formsSearchSource).not.toContain("Source catalogue reviewed");
  });

  it("does not render negative or text-only source statuses as verified", () => {
    expect(sourceToneClass(formWithProvenance("Unverified", true))).toBe(toneWarning);
    expect(sourceToneClass(formWithProvenance("Official verified source", false))).toBe(toneNeutral);
    expect(sourceToneClass(formWithProvenance("Official source", true))).toBe(toneSuccess);
  });

  it("generates form and service metadata from each requested slug", async () => {
    const firstForm = formRecords[0]!;
    const secondForm = formRecords[1]!;
    const firstService = serviceRecords[0]!;
    const secondService = serviceRecords[1]!;

    const [
      firstFormMetadata,
      secondFormMetadata,
      firstServiceMetadata,
      secondServiceMetadata,
      registryOnlyFormMetadata,
      registryOnlyServiceMetadata,
    ] = await Promise.all([
      generateFormMetadata({ params: Promise.resolve({ slug: firstForm.slug }) }),
      generateFormMetadata({ params: Promise.resolve({ slug: secondForm.slug }) }),
      generateServiceMetadata({ params: Promise.resolve({ slug: firstService.slug }) }),
      generateServiceMetadata({ params: Promise.resolve({ slug: secondService.slug }) }),
      generateFormMetadata({ params: Promise.resolve({ slug: "registry-only-form" }) }),
      generateServiceMetadata({ params: Promise.resolve({ slug: "registry-only-service" }) }),
    ]);

    expect(firstFormMetadata).toEqual({
      title: `${firstForm.title} - Forms - PsychSift`,
      description: firstForm.subtitle,
    });
    expect(secondFormMetadata).toEqual({
      title: `${secondForm.title} - Forms - PsychSift`,
      description: secondForm.subtitle,
    });
    expect(firstServiceMetadata).toEqual({
      title: `${firstService.title} - Services - PsychSift`,
      description: firstService.subtitle,
    });
    expect(secondServiceMetadata).toEqual({
      title: `${secondService.title} - Services - PsychSift`,
      description: secondService.subtitle,
    });
    expect(firstFormMetadata.title).not.toEqual(secondFormMetadata.title);
    expect(firstServiceMetadata.title).not.toEqual(secondServiceMetadata.title);
    expect(registryOnlyFormMetadata.title).toBe("Form record - Forms - PsychSift");
    expect(registryOnlyServiceMetadata.title).toBe("Service record - Services - PsychSift");
  });

  it("claims and renders a form source link only when the record has a URL", () => {
    // The duplicated `ActionPanel` that used to carry this moved into the
    // in-page header's actions sheet, so the URL is resolved once, up front —
    // and the sheet still renders an explicit disabled placeholder rather than
    // an "Open official source" control that goes nowhere.
    expect(normalizedFormDetailSource).toContain("const sourceHref = form.source?.url ?? null;");
    expect(normalizedFormDetailSource).toContain("{sourceHref ? (");
    expect(normalizedFormDetailSource).toContain("No official source URL is recorded for this form.");
    expect(normalizedFormDetailSource).toContain("href={form.source.url}");
    expect(normalizedFormDetailSource).toContain('target="_blank"');
    expect(normalizedFormDetailSource).toContain('rel="noopener noreferrer"');
    expect(normalizedFormDetailSource).toContain("inline-flex min-h-tap");
    expect(normalizedFormDetailSource).toContain("sm:min-h-10");
    expect(formDetailSource).toContain("Source link pending");
    expect(formDetailSource).toContain("Official");
  });
});
