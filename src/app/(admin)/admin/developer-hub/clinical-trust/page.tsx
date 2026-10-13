import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ClinicalTrustCockpit } from "@/components/developer-area/clinical-trust-cockpit";

export const metadata: Metadata = {
  title: "Clinical trust · Developer · PsychSift",
  description: "Administrator-only quality feedback, source-impact, and content-maturity evidence.",
};

export default function ClinicalTrustPage() {
  return (
    <main className="mx-auto grid w-full max-w-[72rem] gap-6 px-4 py-8 sm:px-6" data-testid="clinical-trust-page">
      <Link
        href="/mockups/development"
        className="inline-flex min-h-12 w-fit items-center gap-2 text-sm font-bold text-[color:var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      >
        <ArrowLeft aria-hidden="true" className="size-icon-sm" />
        Developer hub
      </Link>
      <header className="grid gap-2">
        <h1 className="text-2xl font-extrabold text-[color:var(--text-heading)]">Clinical trust cockpit</h1>
        <p className="max-w-3xl text-sm leading-6 text-[color:var(--text-muted)]">
          One privacy-safe operating view for feedback triage, source-change impact, and catalogue maturity. Human
          review remains explicit; this page never changes content status automatically.
        </p>
      </header>
      <ClinicalTrustCockpit />
    </main>
  );
}
