/**
 * Suicide, self-harm and immediate-danger wording in a free-text question.
 *
 * Answer mode shows the WA crisis lines above the reply when this matches, whatever the
 * search itself returns: a distressed person typing "I want to kill myself" previously got
 * the same "not covered" refusal as a coffee-machine question, with no numbers at all.
 *
 * Narrower than the Services crisis intent (`service-urgent-routing.ts`) on purpose. That
 * one also fires on bare `crisis`, `acute` and `unsafe`, which are routine in clinical
 * questions ("acute agitation", "crisis team referral") and would put the banner on
 * questions that carry no risk wording. This only matches wording about suicide, self-harm,
 * overdose or immediate danger, including lethal-amount wording ("enough to die", "lethal dose")
 * and "can't keep myself safe", which the 2026-10-21 answer safety audit found unmatched, plus
 * "end it all", "better off dead" and "don't want to be alive/here" (owner decision pending).
 * A 2026-10 audit added first-person method and intent wording it still missed: "hang myself",
 * "jumping off a bridge", "don't want to live", "want to be dead", "kill me" and "took 30 pills"
 * (a two-digit count, so an ordinary "took 2 tablets" stays quiet; owner decision pending).
 * The 2026-10-26 re-audit (A2R-02, owner yes "yes to both") added "took all her lithium tablets"
 * (no "of") and covert-overdose wording such as "hardest to detect if someone took a lot of it".
 * It changes nothing about retrieval or refusal.
 */
const crisisWordingPattern =
  /\b(?:suicid\w*|self[\s-]?harm\w*|kill(?:ing)?\s+my\s?self|kill\s+me|hang(?:ing)?\s+my\s?self|jump(?:ing)?\s+off\s+(?:a|the)\s+(?!deep\b)\w+|end(?:ing)?\s+my\s+(?:own\s+)?life|take\s+my\s+(?:own\s+)?life|want(?:ed)?\s+to\s+(?:die|be\s+dead)|wish\s+i\s+(?:was|were)\s+dead|hurt(?:ing)?\s+my\s?self|overdos\w*|immediate\s+danger|life[\s-]?threatening|(?:cannot|can\s?not|can['’]?t|unable\s+to)\s+keep\s+(?:myself|them|him|her|the\s+patient)\s+safe|suic\w*|(?:take|need|enough)\s+(?:\w+\s+){0,2}?to\s+die|(?:lethal|fatal|deadly)\s+(?:doses?|amounts?|quantit(?:y|ies)|numbers?)|no\s+reason\s+to\s+live|end(?:ing)?\s+it\s+all|better\s+off\s+dead|(?:do\s?n['’]?t|do\s+not)\s+want\s+to\s+(?:be\s+(?:alive|here)|live\b(?!\s+(?:with|in|on|at|near|alone|there|like)\b))|took\s+(?:(?:all|a\s+lot)(?:\s+of)?|\d{2,})\s+(?:\w+\s+){0,3}?(?:pills?|tablets?|meds?|medications?|tabs|panadol|paracetamol|overdos\w*)|(?:hard(?:er|est)?|impossible|difficult)\s+to\s+(?:detect|trace)\b.{0,60}\b(?:took|taken?|swallow\w*)|\b(?:took|taken?|swallow\w*)\b.{0,60}\b(?:undetectable|(?:hard(?:er|est)?|impossible|difficult)\s+to\s+(?:detect|trace)))\b/i;

export function hasCrisisWording(text: string | null | undefined): boolean {
  if (!text) return false;
  return crisisWordingPattern.test(text.normalize("NFKC"));
}

const overdoseWordingPattern = /\b(?:overdos\w*|poison\w*|ingest(?:ed|ion)?)\b/i;

/** Overdose or poisoning wording: the answer crisis card then adds the Poisons Information Centre. */
export function hasOverdoseWording(text: string | null | undefined): boolean {
  if (!text) return false;
  return overdoseWordingPattern.test(text.normalize("NFKC"));
}
