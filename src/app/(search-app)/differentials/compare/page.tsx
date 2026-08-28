import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DifferentialCompareQueuePage } from "@/components/differentials/differential-compare-queue-page";
import { DifferentialPresentationWorkflowPage } from "@/components/differentials/differential-presentation-workflow-page";
import {
  differentialCompareQueueItems,
  getDifferentialRecord,
  resolveDifferentialCompareHandoff,
  resolveDifferentialCompareLaunchHref,
} from "@/lib/differentials";

export const metadata: Metadata = {
  title: "Compare differentials | Clinical KB",
  description: "Compare selected differential diagnoses side by side with safety and bedside context.",
};

type DifferentialCompareRouteProps = {
  searchParams?: Promise<{
    query?: string | string[];
    q?: string | string[];
    ids?: string | string[];
    workspace?: string | string[];
  }>;
};

function firstSearchParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Compare queue: empty state or selected diagnosis ids. Open comparison launches
 * a catalogue presentation workflow, or an ad-hoc workspace (`workspace=1`) when
 * selections span presentations.
 */
export default async function DifferentialCompareRoute({ searchParams }: DifferentialCompareRouteProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const query = firstSearchParam(resolvedSearchParams.query ?? resolvedSearchParams.q)?.trim() ?? "";
  const selectedIds = (firstSearchParam(resolvedSearchParams.ids) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const workspace = firstSearchParam(resolvedSearchParams.workspace)?.trim() === "1";

  if (!workspace) {
    return (
      <DifferentialCompareQueuePage
        query={query}
        items={differentialCompareQueueItems(selectedIds)}
        openComparisonHref={resolveDifferentialCompareLaunchHref(selectedIds, query)}
      />
    );
  }

  const handoff = resolveDifferentialCompareHandoff(selectedIds, query);
  if (handoff.kind === "presentation") {
    redirect(handoff.href);
  }

  // This cross-presentation workspace is a synthetic local comparison, not a
  // public-release presentation route. Bind its generated workflow to the same
  // bundled records that produced the ad-hoc selection.
  const candidates = handoff.selection.workflow.candidates.flatMap((candidate) => {
    const record = getDifferentialRecord(candidate.slug);
    return record ? [{ ...candidate, record }] : [];
  });

  return (
    <DifferentialPresentationWorkflowPage
      query={query}
      selectedIds={handoff.selection.diagnosisIds}
      workflow={handoff.selection.workflow}
      candidates={candidates}
    />
  );
}
