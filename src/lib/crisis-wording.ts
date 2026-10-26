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
  /\b(?:suicid\w*|self[\s-]?harm\w*|kill(?:ing)?\s+my\s?self|kill\s+me|hang(?:ing)?\s+my\s?self|jump(?:ing)?\s+off\s+(?:a|the)\s+(?!deep\b)\w+|end(?:ing)?\s+my\s+(?:own\s+)?life|take\s+my\s+(?:own\s+)?life|want(?:ed)?\s+to\s+(?:die|be\s+dead)|wish\s+i\s+(?:was|were)\s+dead|hurt(?:ing)?\s+my\s?self|overdos\w*|immediate\s+danger|life[\s-]?threatening|(?:cannot|can\s?not|can['’]?t|unable\s+to)\s+keep\s+(?:myself|them|him|her|the\s+patient)\s+safe|suic\w*|(?:take|need|enough)\s+(?:\w+\s+){0,2}?to\s+die|(?:lethal|fatal|deadly)\s+(?:doses?|amounts?|quantit(?:y|ies)|numbers?)|no\s+reason\s+to\s+live|end(?:ing)?\s+it\s+all|better\s+off\s+dead|(?:do\s?n['’]?t|do\s+not)\s+want\s+to\s+(?:be\s+(?:alive|here)|live\b(?!\s+(?:with|in|on|at|near|alone|there|like)\b))|took\s+(?:(?:all|a\s+lot)(?:\s+of)?|\d{2,})\s+(?:\w+\s+){0,3}?(?:pills?|tablets?|meds?|medications?|tabs|panadol|paracetamol|overdos\w*)|(?:hard(?:er|est)?|impossible|difficult)\s+to\s+(?:detect|trace)\b.{0,60}\b(?:took|taken?|swallow\w*)\s+(?:a\s+lot|all|lots|too\s+much|too\s+many|enough|an?\s+overdose)|\b(?:took|taken?|swallow\w*)\s+(?:a\s+lot|all|lots|too\s+much|too\s+many|enough)\b.{0,60}\b(?:undetectable|(?:hard(?:er|est)?|impossible|difficult)\s+to\s+(?:detect|trace)))\b/i;

// Swallowing an amount of medicine ("took a handful of pills", "swallowed a whole packet of
// paracetamol", "took 20 tablets") is an overdose until shown otherwise. Owner decisions 2026-10-26:
// the Services search pins 000 first (D7), and the Answer crisis card shows and adds the Poisons
// Information Centre (D1, D3). A one-digit count ("took 2 tablets")
// and dosing wording ("take 10 x 5 mg") stay quiet.
export const SWALLOWED_AMOUNT =
  /\b(?:took|taken|swallow(?:ed|ing)?|ingest(?:ed|ing)?)\s+(?:a\s+handful\s+of|(?:a|the|my|his|her|their)\s+(?:whole|entire)\s+(?:bottle|packet|pack|box|blister\s+pack|strip|script|prescription|supply)|(?:a|the)\s+(?:bottle|packet|pack|box|blister\s+pack|strip)\s+of|(?:all|a\s+lot)\s+of\s+(?:my|his|her|their|the)\s+(?:pills?|tablets?|meds?|medications?)|all\s+(?:my|his|her|their)\s+(?:pills?|tablets?|meds?|medications?)|\d{2,}\s*x\s*\d|\d{2,}\s+(?:\w+\s+){0,2}?(?:pills?|tablets?|tabs|capsules?|caps|panadol|paracetamol)\b)/i;

// Owner decision 2026-10-26 (D1, "Go ahead with all recommendations"): further suicidal intent and
// method wording the 26 Oct test phrasings missed, each tested against ordinary clinical text that
// must stay quiet ("cut the dose in half", "can't go on leave", "end it with a summary").
const approvedCrisisWordingPattern = new RegExp(
  String.raw`\b(?:` +
    [
      // "wants to die" in other forms
      String.raw`(?:wants?|wanting|wanna)\s+to\s+(?:die|be\s+dead)|wanna\s+die`,
      // not waking up
      String.raw`(?:do\s?n['’]?t|do\s+not)\s+want\s+to\s+wake\s+up|(?:go\s+to\s+sleep|sleep)\s+and\s+(?:never|not)\s+wake\s+up|sleep\s+forever`,
      // "end it" with intent, not "end it with"
      String.raw`(?:going\s+to|gonna|want\s+to|wanna|plan(?:ning)?\s+to|thinking\s+(?:about|of))\s+end(?:ing)?\s+it\b(?!\s+with\b)`,
      // "can't go on" as a whole statement, not "can't go on leave"
      String.raw`can['’]?t\s+go\s+on(?:\s+(?:any\s?more|living|like\s+this))?\s*(?:[.!?,]|$)`,
      // life not worth living
      String.raw`no\s+point\s+(?:in\s+)?living|(?:life\s+)?(?:is\s?n['’]?t|is\s+not|not)\s+worth\s+living|better\s+off\s+without\s+me`,
      String.raw`unaliv\w*`,
      // third-person and other methods
      String.raw`(?:kill(?:ing|ed|s)?|hang(?:ing|ed|s)?|shoot|shooting|shot|gas|gassing|gassed)\s+(?:my|him|her|them|your|one|our)\s?sel(?:f|ves)`,
      // cutting with a body object, not "cut the dose"
      String.raw`cut(?:ting|s)?\s+(?:(?:my|him|her|them|your|one|our)\s?sel(?:f|ves)|(?:my|his|her|their)\s+(?:wrists?|arms?|legs?|thighs?))|slit(?:ting)?\s+(?:my|his|her|their)\s+wrists?`,
      String.raw`(?:step|jump|walk|lie|lay)(?:ping|ed|s)?\s+in\s+front\s+of\s+(?:a|the)\s+(?:train|car|bus|truck)|(?:drive|driving|crash|crashing)\s+(?:my|his|her|their|the)\s+car\s+into`,
    ].join("|") +
    String.raw`)`,
  "i",
);

export function hasCrisisWording(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = text.normalize("NFKC");
  return (
    crisisWordingPattern.test(normalized) ||
    approvedCrisisWordingPattern.test(normalized) ||
    SWALLOWED_AMOUNT.test(normalized)
  );
}

const overdoseWordingPattern = /\b(?:overdos\w*|poison\w*|ingest(?:ed|ion)?)\b/i;

/**
 * Overdose or poisoning wording, or a swallowed amount of medicine (owner decision 2026-10-26, D3):
 * the answer crisis card then adds the Poisons Information Centre.
 */
export function hasOverdoseWording(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = text.normalize("NFKC");
  return overdoseWordingPattern.test(normalized) || SWALLOWED_AMOUNT.test(normalized);
}
