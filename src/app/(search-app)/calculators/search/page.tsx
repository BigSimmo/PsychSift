import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CalculatorsSearchPage } from "@/components/calculators";
import { CALCULATOR_RECORD_PARAM, calculatorRecordById } from "@/components/calculators/calculator-routes";

export const metadata: Metadata = {
  title: "Search clinical calculators | PsychSift",
  description: "Search source-cited psychiatry rating scales by indication and name.",
};

type CalculatorsSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function readFirstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function toURLSearchParams(params: Awaited<CalculatorsSearchParams>) {
  const normalized = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => normalized.append(key, item));
    else if (value !== undefined) normalized.set(key, value);
  }
  return normalized;
}

/**
 * Calculator catalogue and submitted searches.
 *
 * Split out of the bare `/calculators` path when that became a redirect onto the
 * shared home: results need a route of their own, or `appModeHomeHref` would send
 * a submitted query back through the redirect and loop.
 *
 * An empty query is now the browsable catalogue (the Tools `/tools` analogue),
 * so Show all on the shared Calculators home can land here. The legacy `?query=`
 * canonicalisation stays on this route so an old deep link still lands on `?q=`.
 */
export default async function CalculatorsSearchRoute({ searchParams }: { searchParams: CalculatorsSearchParams }) {
  const resolvedSearchParams = await searchParams;
  const primaryQuery = readFirstSearchParam(resolvedSearchParams.q)?.trim();
  const legacyQuery = readFirstSearchParam(resolvedSearchParams.query)?.trim();
  const query = primaryQuery || legacyQuery || "";
  const rawCalculatorId = readFirstSearchParam(resolvedSearchParams[CALCULATOR_RECORD_PARAM]);
  const selectedCalculator = calculatorRecordById(rawCalculatorId);

  if (rawCalculatorId !== undefined && !selectedCalculator) {
    const fallbackSearchParams = toURLSearchParams(resolvedSearchParams);
    fallbackSearchParams.delete(CALCULATOR_RECORD_PARAM);
    fallbackSearchParams.delete("query");
    if (query) fallbackSearchParams.set("q", query);
    else fallbackSearchParams.delete("q");
    const suffix = fallbackSearchParams.toString();
    redirect(suffix ? `/calculators/search?${suffix}` : "/?mode=calculators");
  }

  if (selectedCalculator) {
    const isCanonicalSelection =
      typeof resolvedSearchParams[CALCULATOR_RECORD_PARAM] === "string" &&
      resolvedSearchParams[CALCULATOR_RECORD_PARAM] === selectedCalculator.id &&
      resolvedSearchParams.query === undefined;
    if (!isCanonicalSelection) {
      const canonicalSearchParams = toURLSearchParams(resolvedSearchParams);
      canonicalSearchParams.set(CALCULATOR_RECORD_PARAM, selectedCalculator.id);
      if (query) canonicalSearchParams.set("q", query);
      canonicalSearchParams.delete("query");
      redirect(`/calculators/search?${canonicalSearchParams.toString()}`);
    }
    return (
      <CalculatorsSearchPage
        initialQuery={query || selectedCalculator.abbrev}
        initialCalculatorId={selectedCalculator.id}
      />
    );
  }

  if (resolvedSearchParams.query !== undefined) {
    const canonicalSearchParams = toURLSearchParams(resolvedSearchParams);
    if (query) canonicalSearchParams.set("q", query);
    else canonicalSearchParams.delete("q");
    canonicalSearchParams.delete("query");
    const suffix = canonicalSearchParams.toString();
    redirect(suffix ? `/calculators/search?${suffix}` : "/calculators/search");
  }

  return <CalculatorsSearchPage initialQuery={query} />;
}
