/** A small, fixed list of everyday words (spec). It runs in the browser; nothing is sent anywhere. */
export const ADMIN_HELP_SYNONYMS: Record<string, readonly string[]> = {
  pay: ["payslip", "salary", "wage", "allowance", "overtime", "claim", "payroll", "packaging"],
  leave: ["holiday", "annual", "carer", "study", "exam", "pdl", "parental", "compassionate"],
  roster: ["shift", "swap", "rota", "nights", "hours"],
  access: ["door", "keycard", "card", "entry", "locked", "swipe"],
  food: ["hungry", "cafeteria", "vending", "meal", "dinner", "eat"],
  login: ["logins", "password", "account", "paging", "pager", "remote", "computer"],
  support: ["wellbeing", "counselling", "stress", "burnout", "talk"],
  taxi: ["cab", "ride", "home", "transport"],
  forms: ["form", "paperwork", "application"],
};

const groups = Object.entries(ADMIN_HELP_SYNONYMS).map(([head, words]) => [head, ...words]);

function variants(word: string): string[] {
  return groups.find((members) => members.includes(word)) ?? [word];
}

export function matchesHelpQuery(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => variants(word).some((variant) => haystack.includes(variant)));
}

/**
 * The everyday words a query also looks for ("hungry" also looks for food,
 * cafeteria, vending, meal, dinner and eat), so Help can say why a row
 * matched. Words the query already holds are left out. Nothing is sent
 * anywhere.
 */
export function helpQueryAlsoLooksFor(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const also = new Set<string>();
  for (const word of words) {
    const group = groups.find((members) => members.includes(word));
    if (!group) continue;
    for (const member of group) if (!words.includes(member)) also.add(member);
  }
  return [...also];
}
