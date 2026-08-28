"use client";

import { DifferentialDetailPage } from "@/components/differentials/differential-detail-page";
import { DifferentialContentState } from "@/components/differentials/differential-content-state";
import { useDifferentialRecord } from "@/components/clinical-dashboard/use-differential-catalog";

export function DifferentialDiagnosisPageClient({ slug }: { slug: string }) {
  const { status, record, detailContext, governance } = useDifferentialRecord(slug);
  if (status !== "ready" || !record || !detailContext) {
    return <DifferentialContentState status={status === "ready" ? "error" : status} kind="diagnosis" />;
  }
  return <DifferentialDetailPage record={record} detailContext={detailContext} liveGovernance={governance} />;
}
