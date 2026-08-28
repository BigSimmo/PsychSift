import type { Metadata } from "next";

import { DifferentialPresentationReleasePage } from "@/components/differentials/differential-presentation-release-page-client";
import { presentationStaticParams } from "@/lib/differentials";

type DifferentialPresentationRouteProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ query?: string | string[]; q?: string | string[]; ids?: string | string[] }>;
};

export const dynamicParams = true;

function firstSearchParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export function generateStaticParams() {
  return presentationStaticParams();
}

export async function generateMetadata({ params }: DifferentialPresentationRouteProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Differential presentation - Clinical KB",
    description: `Current public differential presentation for ${slug.replace(/-/g, " ")}.`,
    // DB-only slugs are resolved by the client release loader, so this generic
    // successful shell is deliberately non-indexable rather than a soft-404 SEO signal.
    robots: { index: false, follow: false },
  };
}

export default async function DifferentialPresentationRoute({
  params,
  searchParams,
}: DifferentialPresentationRouteProps) {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const query = firstSearchParam(resolvedSearchParams.query ?? resolvedSearchParams.q)?.trim() ?? "";
  const selectedIds = (firstSearchParam(resolvedSearchParams.ids) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return <DifferentialPresentationReleasePage query={query} presentationSlug={slug} selectedIds={selectedIds} />;
}
