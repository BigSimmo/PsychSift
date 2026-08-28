"use client";

import { useDifferentialPresentation } from "@/components/clinical-dashboard/use-differential-catalog";
import { DifferentialContentState } from "@/components/differentials/differential-content-state";
import { DifferentialPresentationWorkflowPage } from "@/components/differentials/differential-presentation-workflow-page";

export function DifferentialPresentationReleasePage({
  query = "",
  presentationSlug,
  selectedIds = [],
}: {
  query?: string;
  presentationSlug: string;
  selectedIds?: string[];
}) {
  const { status, workflow, candidates } = useDifferentialPresentation(presentationSlug);
  if (status !== "ready" || !workflow) {
    return <DifferentialContentState status={status === "ready" ? "error" : status} kind="presentation" />;
  }
  return (
    <DifferentialPresentationWorkflowPage
      query={query}
      selectedIds={selectedIds}
      workflow={workflow}
      candidates={candidates}
    />
  );
}
