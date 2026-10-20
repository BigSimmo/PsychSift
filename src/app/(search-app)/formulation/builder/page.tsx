import type { Metadata } from "next";
import { FormulationBuilderPage } from "@/components/formulation/formulation-builder-page";

export const metadata: Metadata = {
  title: "Builder | Formulation | PsychSift",
  description: "Build a case formulation step by step.",
};

type BuilderRouteProps = {
  searchParams?: Promise<{
    mechanism?: string | string[];
    template?: string | string[];
  }>;
};

export default async function FormulationBuilderRoute({ searchParams }: BuilderRouteProps) {
  const params = searchParams ? await searchParams : {};
  const initialMechanisms = Array.isArray(params.mechanism)
    ? Array.from(new Set(params.mechanism))
    : params.mechanism
      ? [params.mechanism]
      : [];
  const initialTemplate = Array.isArray(params.template) ? params.template[0] : params.template;
  return <FormulationBuilderPage initialMechanisms={initialMechanisms} initialTemplate={initialTemplate} />;
}
