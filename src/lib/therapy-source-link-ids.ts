import therapySourceLinkMap from "@/data/therapy-source-links.json";

/**
 * Therapy slug → source-register record ids, in the order a page lists them:
 * Western Australian first, then Australian, then international (ledger #05WXHX).
 *
 * The first proposals were read from each record's own reference text (a NICE
 * guideline code it cites, or the RANZCP statement for ECT and rTMS). A proposal
 * renders no link until the owner adopts and signs off the register record
 * (`therapy-source-links.ts`), but it counts for review dates straight away: a
 * confirmed change to a cited source makes the therapy due for review.
 *
 * Kept free of server-only imports so the therapy screens can read it.
 */
export type TherapySourceLinkMap = Readonly<Record<string, readonly string[]>>;

export const therapySourceLinkIds: TherapySourceLinkMap = therapySourceLinkMap;

/** Every register id a therapy record cites, signed off or not. */
export function therapyCitedSourceIds(
  slug: string,
  links: TherapySourceLinkMap = therapySourceLinkIds,
): readonly string[] {
  return Object.hasOwn(links, slug) ? links[slug] : [];
}
