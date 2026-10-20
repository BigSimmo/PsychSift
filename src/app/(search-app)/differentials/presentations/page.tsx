import type { Metadata } from "next";
import { DifferentialStreamPage } from "@/components/differentials/differential-stream-page";

export const metadata: Metadata = {
  title: "Presentations | Differentials | PsychSift",
  description: "Browse presentations and the diagnoses to consider for each.",
};

type DifferentialPresentationsRouteProps = {
  searchParams?: Promise<{ query?: string | string[]; q?: string | string[] }>;
};

function firstSearchParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DifferentialPresentationsRoute({ searchParams }: DifferentialPresentationsRouteProps) {
  const params = searchParams ? await searchParams : {};
  const query = firstSearchParam(params.query ?? params.q)?.trim() ?? "";

  return <DifferentialStreamPage stream="presentations" query={query} />;
}
