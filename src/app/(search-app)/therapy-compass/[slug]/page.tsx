import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DetailScreen } from "@/components/therapy-compass/screens/detail-screen";
import { findTherapyRecord, therapyNeedsReview, therapySlugs } from "@/lib/therapies";
import { therapySourceLinks } from "@/lib/therapy-source-links";

export function generateStaticParams() {
  return therapySlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const record = findTherapyRecord(slug);
  if (!record) return { title: "Therapy not found - Therapy" };
  const summary = record.clinicalSummary ?? record.bestUsedFor ?? "Source-grounded therapy record.";
  return {
    title: `${record.name} - Therapy`,
    description: therapyNeedsReview(record) ? `${summary} (Awaiting source review.)` : summary,
  };
}

export default async function TherapyCompassDetailRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!findTherapyRecord(slug)) notFound();
  // Only owner-confirmed source links reach the page; until a record is signed off this is empty.
  return <DetailScreen serverSourceLinks={{ slug, links: therapySourceLinks(slug) }} />;
}
