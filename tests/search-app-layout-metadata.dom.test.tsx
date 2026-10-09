/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SearchAppLayout, { metadata } from "@/app/(search-app)/layout";
import { BRAND_DESCRIPTION, BRAND_NAME } from "@/lib/brand";

vi.mock("@/components/clinical-dashboard/shared-search-app-shell", () => ({
  SharedSearchAppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="shared-shell">{children}</div>
  ),
}));

vi.mock("@/components/psychiatry/psychiatry-visit-recorder", () => ({
  PsychiatryVisitRecorder: () => null,
}));

describe("SearchAppLayout metadata and structured data (#28ECMG)", () => {
  it("exports canonical metadata for public search app routes", () => {
    expect(metadata.alternates?.canonical).toBe("https://psychsift.com.au");
  });

  it("renders a canonical link tag and Schema.org MedicalWebPage JSON-LD in the layout shell", () => {
    const { container } = render(
      <SearchAppLayout>
        <main>Test content</main>
      </SearchAppLayout>,
    );

    const canonicalLink =
      document.head.querySelector('link[rel="canonical"]') ?? container.querySelector('link[rel="canonical"]');
    expect(canonicalLink).not.toBeNull();
    expect(canonicalLink?.getAttribute("href")).toBe("https://psychsift.com.au");

    const jsonLdScript = container.querySelector('script[type="application/ld+json"]');
    expect(jsonLdScript).not.toBeNull();
    const data = JSON.parse(jsonLdScript?.textContent || "{}");
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("MedicalWebPage");
    expect(data.name).toBe(`${BRAND_NAME} Clinical Reference`);
    expect(data.description).toBe(BRAND_DESCRIPTION);
    expect(data.audience).toEqual({
      "@type": "MedicalAudience",
      audienceType: "Clinician",
    });
  });
});
