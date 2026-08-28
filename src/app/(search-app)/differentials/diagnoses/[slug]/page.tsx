import type { Metadata } from "next";

import { DifferentialDiagnosisPageClient } from "@/components/differentials/differential-diagnosis-page-client";
import { differentialStaticParams } from "@/lib/differentials";

type DifferentialDiagnosisRouteProps = {
  params: Promise<{ slug: string }>;
};

export const dynamicParams = true;

export function generateStaticParams() {
  return differentialStaticParams();
}

export async function generateMetadata({ params }: DifferentialDiagnosisRouteProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Differential diagnosis - Clinical KB",
    description: `Current public differential diagnosis for ${slug.replace(/-/g, " ")}.`,
  };
}

export default async function DifferentialDiagnosisRoute({ params }: DifferentialDiagnosisRouteProps) {
  const { slug } = await params;
  return <DifferentialDiagnosisPageClient slug={slug} />;
}
