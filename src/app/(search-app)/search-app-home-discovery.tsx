import { BRAND_DESCRIPTION, BRAND_NAME } from "@/lib/brand";

const homePageJsonLd = {
  "@context": "https://schema.org",
  "@type": "MedicalWebPage",
  name: `${BRAND_NAME} Clinical Reference`,
  // The live site (docs/deployment-architecture.md). psychsift.com.au was never this app's domain.
  url: "https://psychiatry.tools",
  description: BRAND_DESCRIPTION,
  audience: {
    "@type": "MedicalAudience",
    audienceType: "Clinician",
  },
};

/** Home-only discovery markup — never render from the shared search-app layout. */
export function SearchAppHomeDiscovery() {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homePageJsonLd) }} />;
}
