import type { WorkAreaId } from "@/lib/work-frame/areas";
import type { WorkSetupAreaId } from "@/lib/work-setup/progress";
import { adminTopic } from "@/lib/work-help/topics/admin";
import { alertsTopic } from "@/lib/work-help/topics/alerts";
import { assessTopic } from "@/lib/work-help/topics/assess";
import { callTopic } from "@/lib/work-help/topics/call";
import { cpdTopic } from "@/lib/work-help/topics/cpd";
import { dayTopic } from "@/lib/work-help/topics/day";
import { favouritesTopic } from "@/lib/work-help/topics/favourites";
import { offlineTopic } from "@/lib/work-help/topics/offline";
import { openShiftsTopic } from "@/lib/work-help/topics/open-shifts";
import { privacyTopic } from "@/lib/work-help/topics/privacy";
import { rostTopic } from "@/lib/work-help/topics/rost";
import { searchTopic } from "@/lib/work-help/topics/search";
import { teachTopic } from "@/lib/work-help/topics/teach";
import type { WorkHelpQuestion, WorkHelpTopic, WorkHelpTopicId } from "@/lib/work-help/types";

export type {
  WorkHelpLink,
  WorkHelpQuestion,
  WorkHelpTab,
  WorkHelpTopic,
  WorkHelpTopicId,
} from "@/lib/work-help/types";

/** Area topics in the order the app lists its areas. */
export const WORK_HELP_AREA_TOPICS: readonly WorkHelpTopic[] = [
  dayTopic,
  rostTopic,
  openShiftsTopic,
  teachTopic,
  assessTopic,
  cpdTopic,
  adminTopic,
  callTopic,
  searchTopic,
];

/** Guides that cover the app as a whole. */
export const WORK_HELP_GUIDE_TOPICS: readonly WorkHelpTopic[] = [
  privacyTopic,
  alertsTopic,
  favouritesTopic,
  offlineTopic,
];

export const WORK_HELP_TOPICS: readonly WorkHelpTopic[] = [...WORK_HELP_AREA_TOPICS, ...WORK_HELP_GUIDE_TOPICS];

export const WORK_HELP_HREF = "/my-day/help";

export function workHelpTopicHref(id: WorkHelpTopicId): string {
  return `${WORK_HELP_HREF}?topic=${id}`;
}

export function workHelpTopic(id: string | null | undefined): WorkHelpTopic | null {
  return WORK_HELP_TOPICS.find((topic) => topic.id === id) ?? null;
}

/** The topic a work area's More sheet opens. Every area has one. */
export function workHelpTopicForArea(area: WorkAreaId): WorkHelpTopic {
  return WORK_HELP_AREA_TOPICS.find((topic) => topic.areaId === area) ?? dayTopic;
}

/** Topics that belong to each setup area choice (Roster brings Open shifts with it). */
const SETUP_AREA_TOPICS: Record<WorkSetupAreaId, readonly WorkHelpTopicId[]> = {
  rost: ["rost", "open-shifts"],
  teach: ["teach"],
  assess: ["assess"],
  cpd: ["cpd"],
  admin: ["admin"],
  call: ["call"],
};

/**
 * Area topics with the doctor's own areas first (from Set up Work), then the
 * rest, each group in the app's order. My Day always leads. Nothing is hidden:
 * help for an area they did not pick is still one scroll away.
 */
export function orderedAreaTopics(areas: readonly WorkSetupAreaId[] | null): {
  readonly yours: readonly WorkHelpTopic[];
  readonly others: readonly WorkHelpTopic[];
} {
  if (!areas) return { yours: WORK_HELP_AREA_TOPICS, others: [] };
  const mine = new Set<WorkHelpTopicId>(["day", "search", ...areas.flatMap((area) => SETUP_AREA_TOPICS[area])]);
  return {
    yours: WORK_HELP_AREA_TOPICS.filter((topic) => mine.has(topic.id)),
    others: WORK_HELP_AREA_TOPICS.filter((topic) => !mine.has(topic.id)),
  };
}

/* ------------------------------------------------------------------ search */

export type WorkHelpMatch = {
  readonly topic: WorkHelpTopic;
  /** Matching questions, best first. Empty when only the topic itself matched. */
  readonly questions: readonly WorkHelpQuestion[];
  readonly score: number;
};

/** Lower case, accents and punctuation folded, so "who's on" finds "whos on" and "who is on". */
export function foldHelpText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function helpSearchTerms(query: string): readonly string[] {
  return foldHelpText(query)
    .split(" ")
    .filter((term) => term.length > 0);
}

function wordHit(haystack: string, term: string): boolean {
  // A term matches the start of any word, so "swap" finds "swaps" and "swapping".
  return haystack === term || haystack.startsWith(`${term}`) || haystack.includes(` ${term}`);
}

/**
 * Every term must appear somewhere in the topic (AND), and a question is shown
 * when every term appears in it or in its topic's name. Purely local: nothing
 * typed here is stored or sent anywhere.
 */
export function searchWorkHelp(query: string, topics: readonly WorkHelpTopic[] = WORK_HELP_TOPICS): WorkHelpMatch[] {
  const terms = helpSearchTerms(query);
  if (terms.length === 0) return [];
  const matches: WorkHelpMatch[] = [];
  for (const topic of topics) {
    const head = foldHelpText(`${topic.title} ${topic.summary}`);
    const extra = foldHelpText(
      `${topic.keywords} ${(topic.tabs ?? []).map((tab) => `${tab.label} ${tab.body}`).join(" ")}`,
    );
    const questionTexts = topic.questions.map((question) => ({
      question,
      text: foldHelpText(`${question.q} ${question.a} ${question.link?.label ?? ""}`),
      q: foldHelpText(question.q),
    }));
    const all = `${head} ${extra} ${questionTexts.map((item) => item.text).join(" ")}`;
    if (!terms.every((term) => wordHit(all, term))) continue;
    const scored = questionTexts
      .filter((item) => terms.every((term) => wordHit(item.text, term) || wordHit(head, term)))
      .map((item) => ({ item, score: terms.filter((term) => wordHit(item.q, term)).length * 2 + 1 }))
      .sort((a, b) => b.score - a.score);
    const headScore = terms.filter((term) => wordHit(head, term)).length * 3;
    const score = headScore + (scored[0]?.score ?? 0);
    matches.push({ topic, questions: scored.map(({ item }) => item.question), score });
  }
  return matches.sort((a, b) => b.score - a.score);
}
