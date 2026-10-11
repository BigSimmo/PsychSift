import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { DifferentialPresentationWorkflowPage } from "@/components/differentials/differential-presentation-workflow-page";
import {
  LEGACY_PRESENTATION_SLUG_ALIASES,
  presentationStaticParams,
  resolvePresentationSlug,
} from "@/lib/differentials";
import {
  readDifferentialCatalogueRecords,
  readPresentationPageRecord,
} from "@/lib/site-content/differential-page-records";

type DifferentialPresentationRouteProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ query?: string | string[]; q?: string | string[]; ids?: string | string[] }>;
};

function firstSearchParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export function generateStaticParams() {
  const canonical = presentationStaticParams();
  const aliases = Object.keys(LEGACY_PRESENTATION_SLUG_ALIASES).map((slug) => ({ slug }));
  return [...canonical, ...aliases];
}

export async function generateMetadata({ params }: DifferentialPresentationRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const canonicalSlug = resolvePresentationSlug(slug);
  const workflow = await readPresentationPageRecord(canonicalSlug);
  if (!workflow) return { title: "Differential presentation not found - PsychSift" };
  return {
    title: `${workflow.title} - Differential presentation - PsychSift`,
    description: workflow.subtitle,
  };
}

export default async function DifferentialPresentationRoute({
  params,
  searchParams,
}: DifferentialPresentationRouteProps) {
  const { slug } = await params;
  const canonicalSlug = resolvePresentationSlug(slug);

  if (canonicalSlug !== slug) {
    const resolvedSearchParams = searchParams ? await searchParams : {};
    const urlParams = new URLSearchParams();
    for (const [key, value] of Object.entries(resolvedSearchParams)) {
      if (Array.isArray(value)) {
        for (const v of value) urlParams.append(key, v);
      } else if (value) {
        urlParams.append(key, value);
      }
    }
    const queryString = urlParams.toString();
    redirect(`/differentials/presentations/${canonicalSlug}${queryString ? `?${queryString}` : ""}`);
  }

  // The candidate list read does not depend on the workflow, so both database reads start together
  // rather than one after the other (each crosses Singapore -> Sydney).
  const [workflow, catalogue] = await Promise.all([
    readPresentationPageRecord(canonicalSlug),
    readDifferentialCatalogueRecords(),
  ]);
  if (!workflow) notFound();
  const candidateSlugs = new Set(workflow.candidates.map((candidate) => candidate.slug));
  const candidateRecords = catalogue.filter((record) => candidateSlugs.has(record.slug));

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const query = firstSearchParam(resolvedSearchParams.query ?? resolvedSearchParams.q)?.trim() ?? "";
  const selectedIds = (firstSearchParam(resolvedSearchParams.ids) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return (
    <DifferentialPresentationWorkflowPage
      query={query}
      presentationSlug={canonicalSlug}
      selectedIds={selectedIds}
      workflow={workflow}
      candidateRecords={candidateRecords}
    />
  );
}
