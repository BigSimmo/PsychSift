import type { Metadata } from "next";
import { DifferentialStreamPage } from "@/components/differentials/differential-stream-page";

export const metadata: Metadata = {
  title: "Diagnoses | Differentials | PsychSift",
  description: "Browse diagnoses and the presentations they are considered in.",
};

type DifferentialDiagnosesRouteProps = {
  searchParams?: Promise<{
    query?: string | string[];
    q?: string | string[];
    focus?: string | string[];
  }>;
};

function firstSearchParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DifferentialDiagnosesRoute({ searchParams }: DifferentialDiagnosesRouteProps) {
  const params = searchParams ? await searchParams : {};
  const query = firstSearchParam(params.query ?? params.q)?.trim() ?? "";
  const focus = firstSearchParam(params.focus)?.trim() ?? "";

  return <DifferentialStreamPage stream="diagnoses" query={query} focus={focus} />;
}
