import type { Metadata } from "next";

import { CmeSetupRoute } from "@/components/cme/cme-setup-route";
import { CmeStateNotice } from "@/components/cme/cme-state-notice";
import { cmeCarryReturnHref } from "@/lib/cme/carry-return";
import { loadCmePageData } from "@/lib/cme/load-cme-page-data";

export const metadata: Metadata = {
  title: "Set up | CPD | PsychSift",
  description: "Four things to set up once, then the mode runs itself.",
};

export default async function CmeSetupPageRoute({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; edit?: string; carryFrom?: string; carryGoal?: string }>;
}) {
  const query = await searchParams;
  const requestedYear = query.year ? Number(query.year) : undefined;
  const data = await loadCmePageData(
    Number.isInteger(requestedYear) && requestedYear! >= 2000 && requestedYear! <= 2100 ? requestedYear : undefined,
  );
  if (data.state === "signed-out" || data.state === "unavailable") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <CmeStateNotice state={data.state} year={data.year} />
      </main>
    );
  }
  return (
    <CmeSetupRoute
      key={data.year}
      year={data.year}
      set={data.set}
      demoMode={data.demoMode}
      editInitially={query.edit === "1"}
      returnHref={cmeCarryReturnHref(data.year, query.carryFrom, query.carryGoal)}
    />
  );
}
