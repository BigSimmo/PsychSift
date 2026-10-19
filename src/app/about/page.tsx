import type { Metadata } from "next";
import { Info } from "lucide-react";

import { FrontDoorPage } from "@/components/front-door/front-door-page";
import { ABOUT_PAGE_DESCRIPTION, ABOUT_PAGE_TITLE, ABOUT_SECTIONS } from "@/lib/front-door-content";

export const metadata: Metadata = {
  title: "About and intended use",
  description: ABOUT_PAGE_DESCRIPTION,
};

/** About and intended use. DRAFT copy lives in `src/lib/front-door-content.ts`. */
export default function AboutPage() {
  return (
    <FrontDoorPage
      title={ABOUT_PAGE_TITLE}
      description={ABOUT_PAGE_DESCRIPTION}
      icon={Info}
      sections={ABOUT_SECTIONS}
      testId="about-page"
    />
  );
}
