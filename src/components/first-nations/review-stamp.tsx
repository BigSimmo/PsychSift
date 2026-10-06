import { reviewStampText, type ReviewStamp as ReviewStampData } from "@/lib/first-nations/review-stamp-text";

/** One muted line of provenance under a card, drawn only from the content files' own source and approval data. */
export function ReviewStamp({ stamp }: { stamp?: ReviewStampData | undefined }) {
  if (!stamp) return null;
  return (
    <p data-fn-part="review-stamp" className="text-2xs text-[color:var(--text-muted)]">
      {reviewStampText(stamp)}
    </p>
  );
}
