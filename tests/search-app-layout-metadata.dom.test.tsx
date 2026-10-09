/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SearchAppHomeDiscovery } from "@/app/(search-app)/search-app-home-discovery";
import * as searchAppLayout from "@/app/(search-app)/layout";
import { BRAND_DESCRIPTION, BRAND_NAME } from "@/lib/brand";

describe("SearchAppLayout metadata and structured data (#28ECMG)", () => {
  it("does not publish a layout-level canonical that would claim every search-app route is home", () => {
    expect("metadata" in searchAppLayout).toBe(false);
    expect(searchAppLayout).not.toHaveProperty("metadata");
  });

  it("emits Schema.org MedicalWebPage JSON-LD from the home page only", () => {
    const { container } = render(<SearchAppHomeDiscovery />);

    expect(container.querySelector('link[rel="canonical"]')).toBeNull();

    const jsonLdScript = container.querySelector('script[type="application/ld+json"]');
    expect(jsonLdScript).not.toBeNull();
    const data = JSON.parse(jsonLdScript?.textContent || "{}");
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("MedicalWebPage");
    expect(data.name).toBe(`${BRAND_NAME} Clinical Reference`);
    expect(data.url).toBe("https://psychsift.com.au");
    expect(data.description).toBe(BRAND_DESCRIPTION);
    expect(data.audience).toEqual({
      "@type": "MedicalAudience",
      audienceType: "Clinician",
    });
  });
});
