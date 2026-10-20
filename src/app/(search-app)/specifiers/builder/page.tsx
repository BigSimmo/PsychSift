import type { Metadata } from "next";
import { SpecifierBuilderPage } from "@/components/specifiers/specifier-builder-page";

export const metadata: Metadata = {
  title: "Builder | Specifiers | PsychSift",
  description: "Build a diagnosis with its specifiers.",
};

type BuilderRouteProps = {
  searchParams?: Promise<{ specifier?: string | string[] }>;
};

export default async function SpecifierBuilderRoute({ searchParams }: BuilderRouteProps) {
  const params = searchParams ? await searchParams : {};
  const initialSpecifiers = Array.isArray(params.specifier)
    ? Array.from(new Set(params.specifier))
    : params.specifier
      ? [params.specifier]
      : [];

  return <SpecifierBuilderPage initialSpecifiers={initialSpecifiers} />;
}
