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
 * and "can't keep myself safe", which the 2026-10-21 answer safety audit found unmatched.
 * It changes nothing about retrieval or refusal.
 */
const crisisWordingPattern =
  /\b(?:suicid\w*|self[\s-]?harm\w*|kill(?:ing)?\s+my\s?self|end(?:ing)?\s+my\s+(?:own\s+)?life|take\s+my\s+(?:own\s+)?life|want(?:ed)?\s+to\s+die|wish\s+i\s+(?:was|were)\s+dead|hurt(?:ing)?\s+my\s?self|overdos\w*|immediate\s+danger|life[\s-]?threatening|(?:cannot|can\s?not|can['’]?t|unable\s+to)\s+keep\s+(?:myself|them|him|her|the\s+patient)\s+safe|suic\w*|(?:take|need|enough)\s+to\s+die|(?:lethal|fatal|deadly)\s+(?:dose|amount|quantity|number)|no\s+reason\s+to\s+live|took\s+(?:all|a\s+lot)\s+of)\b/i;

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
