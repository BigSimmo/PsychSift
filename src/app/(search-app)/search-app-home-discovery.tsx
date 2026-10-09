import { BRAND_DESCRIPTION, BRAND_NAME } from "@/lib/brand";

const homePageJsonLd = {
  "@context": "https://schema.org",
  "@type": "MedicalWebPage",
  name: `${BRAND_NAME} Clinical Reference`,
  url: "https://psychsift.com.au",
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
