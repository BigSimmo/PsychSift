import type { Metadata } from "next";
import { FormulationComparePage } from "@/components/formulation/formulation-compare-page";

export const metadata: Metadata = {
  title: "Compare | Formulation | PsychSift",
  description: "Compare formulation models side by side.",
};

type CompareRouteProps = {
  searchParams?: Promise<{ a?: string | string[]; b?: string | string[] }>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FormulationCompareRoute({ searchParams }: CompareRouteProps) {
  const params = searchParams ? await searchParams : {};
  const initialLeft = firstParam(params.a);
  const initialRight = firstParam(params.b);
  return (
    <FormulationComparePage
      key={`${initialLeft ?? ""}:${initialRight ?? ""}`}
      initialLeft={initialLeft}
      initialRight={initialRight}
    />
  );
}
