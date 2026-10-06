import { stableHash } from "@/lib/first-nations/approval";
import type { Approval } from "@/lib/first-nations/content-schema";
import type { ReviewStamp } from "@/lib/first-nations/review-stamp-text";

/** The first subject whose approval record still matches its content's hash wins (block, then its section). */
export function buildReviewStamp(
  sourceTitle: string,
  approvals: readonly Approval[],
  subjects: readonly { subjectId: string; content: unknown }[],
): ReviewStamp {
  for (const { subjectId, content } of subjects) {
    const record = approvals.find((a) => a.subjectId === subjectId);
    if (record && record.contentSha256 === stableHash(content)) {
      return { source: sourceTitle, reviewer: `${record.body}, ${record.role}`, reviewedOn: record.date };
    }
  }
  return { source: sourceTitle, reviewer: null, reviewedOn: null };
}
