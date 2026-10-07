// Work help content: every topic and question is well formed, every link goes
// to a page the app really has, the copy follows the house style, and search
// finds what a doctor types (and nothing when the word is not there).

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { WORK_SETUP_HREF, workSetupStepHref } from "@/components/work-setup/work-setup-copy";
import {
  foldHelpText,
  helpSearchTerms,
  orderedAreaTopics,
  searchWorkHelp,
  WORK_HELP_AREA_TOPICS,
  WORK_HELP_GUIDE_TOPICS,
  WORK_HELP_HREF,
  WORK_HELP_TOPICS,
  workHelpTopic,
  workHelpTopicForArea,
  workHelpTopicHref,
  type WorkHelpLink,
  type WorkHelpTopic,
} from "@/lib/work-help";
import { WORK_SETUP_STEPS } from "@/lib/work-setup/progress";

/* ------------------------------------------------------------ route index */

const APP_DIR = path.resolve(__dirname, "..", "src", "app");

/** Every page route under src/app, as its URL segments (route groups dropped). */
function collectRoutes(dir: string, segments: readonly string[], out: string[][]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Parallel slots and private folders never make a URL segment of their own.
      if (entry.startsWith("_")) continue;
      if (entry.startsWith("@")) {
        collectRoutes(full, segments, out);
        continue;
      }
      const isGroup = entry.startsWith("(") && entry.endsWith(")");
      collectRoutes(full, isGroup ? segments : [...segments, entry], out);
    } else if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(entry)) {
      out.push([...segments]);
    }
  }
}

const ROUTES: string[][] = [];
collectRoutes(APP_DIR, [], ROUTES);

function matchesRoute(route: readonly string[], parts: readonly string[]): boolean {
  if (route.length === 0) return parts.length === 0;
  const [head, ...rest] = route;
  if (/^\[\[\.\.\..+\]\]$/.test(head)) return true;
  if (/^\[\.\.\..+\]$/.test(head)) return parts.length > 0;
  if (parts.length === 0) return false;
  if (/^\[.+\]$/.test(head)) return matchesRoute(rest, parts.slice(1));
  return head === parts[0] && matchesRoute(rest, parts.slice(1));
}

function pathOf(href: string): string {
  return href.split(/[?#]/)[0];
}

function routeExists(href: string): boolean {
  const parts = pathOf(href).split("/").filter(Boolean);
  return ROUTES.some((route) => matchesRoute(route, parts));
}

/* ------------------------------------------------------------- copy index */

type Copy = { readonly where: string; readonly text: string };

function topicLinks(topic: WorkHelpTopic): { readonly where: string; readonly link: WorkHelpLink }[] {
  return [
    ...topic.questions.flatMap((question) =>
      question.link ? [{ where: `${topic.id}.${question.id}.link`, link: question.link }] : [],
    ),
    ...(topic.setUp ?? []).map((link, index) => ({ where: `${topic.id}.setUp[${index}]`, link })),
  ];
}

/** Everything a doctor reads. Keywords are search-only and never shown. */
function topicCopy(topic: WorkHelpTopic): Copy[] {
  return [
    { where: `${topic.id}.title`, text: topic.title },
    { where: `${topic.id}.summary`, text: topic.summary },
    ...(topic.tabs ?? []).flatMap((tab, index) => [
      { where: `${topic.id}.tabs[${index}].label`, text: tab.label },
      { where: `${topic.id}.tabs[${index}].body`, text: tab.body },
    ]),
    ...topic.questions.flatMap((question) => [
      { where: `${topic.id}.${question.id}.q`, text: question.q },
      { where: `${topic.id}.${question.id}.a`, text: question.a },
    ]),
    ...topicLinks(topic).map(({ where, link }) => ({ where: `${where}.label`, text: link.label })),
  ];
}

const ALL_COPY = WORK_HELP_TOPICS.flatMap(topicCopy);
const ALL_LINKS = WORK_HELP_TOPICS.flatMap(topicLinks);

/* ------------------------------------------------------------------ tests */

describe("route index sanity", () => {
  it("finds the app's pages, with route groups transparent and dynamic segments matching", () => {
    expect(ROUTES.length).toBeGreaterThan(50);
    expect(routeExists("/roster")).toBe(true);
    expect(routeExists("/my-day/help")).toBe(true);
    expect(routeExists("/teaching/session/abc-123")).toBe(true);
    expect(routeExists("/roster/definitely-not-a-page")).toBe(false);
    expect(routeExists("/not-a-route-at-all")).toBe(false);
  });
});

describe("topic structure", () => {
  it("every topic id is unique", () => {
    const ids = WORK_HELP_TOPICS.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("area and guide lists hold topics of the matching kind", () => {
    for (const topic of WORK_HELP_AREA_TOPICS) expect(topic.kind, topic.id).toBe("area");
    for (const topic of WORK_HELP_GUIDE_TOPICS) expect(topic.kind, topic.id).toBe("guide");
  });

  it.each(WORK_HELP_TOPICS.map((topic) => [topic.id, topic] as const))(
    "%s: question ids are unique, kebab-case, and every question has a q and an a",
    (_id, topic) => {
      const ids = topic.questions.map((question) => question.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(topic.questions.length).toBeGreaterThan(0);
      for (const question of topic.questions) {
        expect(question.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(question.q.trim().length, `${topic.id}.${question.id}.q`).toBeGreaterThan(0);
        expect(question.a.trim().length, `${topic.id}.${question.id}.a`).toBeGreaterThan(0);
        expect(question.q.trim().endsWith("?"), `${topic.id}.${question.id}.q ends in ?`).toBe(true);
      }
      expect(topic.title.trim().length).toBeGreaterThan(0);
      expect(topic.summary.trim().length).toBeGreaterThan(0);
    },
  );

  it("topic lookups find each topic, and an unknown id finds none", () => {
    for (const topic of WORK_HELP_TOPICS) expect(workHelpTopic(topic.id)).toBe(topic);
    expect(workHelpTopic("nope")).toBeNull();
    expect(workHelpTopic(null)).toBeNull();
    expect(workHelpTopic(undefined)).toBeNull();
  });

  it("each work area opens its own topic", () => {
    expect(workHelpTopicForArea("rost").id).toBe("rost");
    expect(workHelpTopicForArea("call").id).toBe("call");
    expect(workHelpTopicForArea("day").id).toBe("day");
  });
});

describe("links go to real pages", () => {
  it("there are links to check", () => {
    expect(ALL_LINKS.length).toBeGreaterThan(20);
  });

  it.each(ALL_LINKS.map(({ where, link }) => [where, link.href] as const))(
    "%s (%s) is an internal path to a page that exists",
    (_where, href) => {
      expect(href.startsWith("/")).toBe(true);
      expect(href.startsWith("//")).toBe(false);
      expect(routeExists(href)).toBe(true);
    },
  );

  it("help and setup's own addresses are real pages", () => {
    expect(routeExists(WORK_HELP_HREF)).toBe(true);
    expect(routeExists(WORK_SETUP_HREF)).toBe(true);
    for (const topic of WORK_HELP_TOPICS) expect(routeExists(workHelpTopicHref(topic.id))).toBe(true);
    for (const step of WORK_SETUP_STEPS) expect(routeExists(workSetupStepHref(step))).toBe(true);
  });

  // The help centre renders a question link as "Open {label}", so a label that
  // starts with "Open" would read "Open Open Renewals".
  it('no question link label starts with "Open"', () => {
    for (const topic of WORK_HELP_TOPICS) {
      for (const question of topic.questions) {
        if (question.link) expect(question.link.label, `${topic.id}/${question.id}`).not.toMatch(/^Open\b/i);
      }
    }
  });
});

describe("house style", () => {
  it("there is copy to check", () => {
    expect(ALL_COPY.length).toBeGreaterThan(100);
  });

  it("no semicolons in any user-facing copy", () => {
    expect(ALL_COPY.filter((item) => item.text.includes(";")).map((item) => item.where)).toEqual([]);
  });

  it("no arrows in any user-facing copy", () => {
    expect(ALL_COPY.filter((item) => /[→←⇒➔]|->/.test(item.text)).map((item) => item.where)).toEqual([]);
  });

  it.each([
    ["color", /\bcolor/i],
    ["organize", /\borganiz/i],
    ["center", /\bcenter\b/i],
    ["favorite", /\bfavorite/i],
    ["behavior", /\bbehavior/i],
    ["license (noun)", /\blicense\b/i],
  ])("Australian spelling: no %s", (_word, pattern) => {
    expect(ALL_COPY.filter((item) => pattern.test(item.text)).map((item) => item.where)).toEqual([]);
  });

  it("no doubled spaces or stray leading/trailing spaces", () => {
    expect(ALL_COPY.filter((item) => /\s{2,}|^\s|\s$/.test(item.text)).map((item) => item.where)).toEqual([]);
  });
});

describe("orderedAreaTopics", () => {
  it("without a setup choice lists every area topic as yours", () => {
    const { yours, others } = orderedAreaTopics(null);
    expect(yours).toEqual(WORK_HELP_AREA_TOPICS);
    expect(others).toEqual([]);
  });

  it("puts the chosen areas first, with My Day and Search always included, and Roster bringing Open shifts", () => {
    const { yours, others } = orderedAreaTopics(["rost"]);
    expect(yours.map((topic) => topic.id)).toEqual(["day", "rost", "open-shifts", "search"]);
    expect(others.map((topic) => topic.id)).toEqual(["teach", "assess", "cpd", "admin", "call"]);
  });

  it("hides nothing: yours and others together are every area topic", () => {
    const { yours, others } = orderedAreaTopics(["teach", "call"]);
    expect([...yours, ...others].map((topic) => topic.id).sort()).toEqual(
      WORK_HELP_AREA_TOPICS.map((topic) => topic.id).sort(),
    );
  });
});

describe("folding and terms", () => {
  it("lower-cases, removes accents and apostrophes, and turns punctuation into spaces", () => {
    expect(foldHelpText("Café ÉCOLE")).toBe("cafe ecole");
    expect(foldHelpText("who's on")).toBe("whos on");
    expect(foldHelpText("  swap/leave--now!  ")).toBe("swap leave now");
  });

  // Phones type a curly apostrophe by default, so it folds away like a straight one.
  it("folds a curly apostrophe like a straight one", () => {
    expect(foldHelpText("Who\u2019s on?")).toBe("whos on");
  });

  it("splits a query into folded terms and drops empties", () => {
    expect(helpSearchTerms("  Swap   LEAVE ")).toEqual(["swap", "leave"]);
    expect(helpSearchTerms("   ")).toEqual([]);
    expect(helpSearchTerms("?!")).toEqual([]);
  });
});

describe("searchWorkHelp", () => {
  it("an empty query finds nothing", () => {
    expect(searchWorkHelp("")).toEqual([]);
    expect(searchWorkHelp("   ")).toEqual([]);
  });

  it('"swap" finds Roster first, with the swap question first', () => {
    const matches = searchWorkHelp("swap");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].topic.id).toBe("rost");
    expect(matches[0].questions[0].id).toBe("swap-shift");
  });

  it("matches the start of words, so swap finds swaps", () => {
    const rost = searchWorkHelp("swap").find((match) => match.topic.id === "rost");
    expect(rost).toBeDefined();
  });

  it("a nonsense word finds nothing", () => {
    expect(searchWorkHelp("xyzzyqq")).toEqual([]);
    expect(searchWorkHelp("zzqv blorp")).toEqual([]);
  });

  it("folds case and accents in the query", () => {
    const plain = searchWorkHelp("swap").map((match) => match.topic.id);
    expect(searchWorkHelp("SWAP").map((match) => match.topic.id)).toEqual(plain);
    expect(searchWorkHelp("Swáp").map((match) => match.topic.id)).toEqual(plain);
  });

  it("multi-word queries need every term (AND)", () => {
    const both = searchWorkHelp("swap leave");
    expect(both.map((match) => match.topic.id)).toContain("rost");
    for (const match of both) {
      const text = foldHelpText(
        [
          match.topic.title,
          match.topic.summary,
          match.topic.keywords,
          ...(match.topic.tabs ?? []).flatMap((tab) => [tab.label, tab.body]),
          ...match.topic.questions.flatMap((question) => [question.q, question.a, question.link?.label ?? ""]),
        ].join(" "),
      );
      expect(text).toMatch(/(^| )swap/);
      expect(text).toMatch(/(^| )leave/);
    }
    // A real word paired with a nonsense one finds nothing.
    expect(searchWorkHelp("swap xyzzyqq")).toEqual([]);
    // Adding a term never widens the results.
    const swapOnly = new Set(searchWorkHelp("swap").map((match) => match.topic.id));
    for (const match of both) expect(swapOnly.has(match.topic.id)).toBe(true);
  });

  it("a more specific query puts the matching question first", () => {
    const rost = searchWorkHelp("plan leave").find((match) => match.topic.id === "rost");
    expect(rost?.questions[0].id).toBe("plan-leave");
  });

  it("returns matches best first", () => {
    const matches = searchWorkHelp("leave");
    const scores = matches.map((match) => match.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("searches only the topics it is given", () => {
    const rost = WORK_HELP_TOPICS.filter((topic) => topic.id === "rost");
    expect(searchWorkHelp("swap", rost).map((match) => match.topic.id)).toEqual(["rost"]);
    const call = WORK_HELP_TOPICS.filter((topic) => topic.id === "call");
    expect(searchWorkHelp("payslip", call)).toEqual([]);
  });
});

// The route index reads the real src/app tree, so a moved app directory would
// silently make every route "missing". Keep that failure loud and specific.
it("the app directory exists where the route index looks", () => {
  expect(existsSync(APP_DIR)).toBe(true);
});
