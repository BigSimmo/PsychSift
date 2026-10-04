import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The chosen situation, its ticks and the in-page search stay in component
 * state. A new jump link must not put them in the address. Public page paths
 * and public section fragments stay allowed. `going-home` is both a situation
 * and a page, so the page path is allowed and a fragment is not.
 */
const ROOTS = [
  "src/components/first-nations",
  "src/lib/first-nations",
  "src/app/(search-app)/first-nations",
  "src/data/first-nations",
];

const SITUATION_FRAGMENT =
  /#(?:new-admission|wants-to-leave|family-meeting|mental-health-act|sorry-business|going-home)\b/;

function filesUnder(root: string): string[] {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(tsx?|json)$/.test(name) ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function ephemeralUrlHits(source: string): string[] {
  const code = stripComments(source);
  const hits: string[] = [];
  const mutations: ReadonlyArray<readonly [RegExp, string]> = [
    [/\.pushState\s*\(/, "pushState writes the address"],
    [/\.replaceState\s*\(/, "replaceState writes the address"],
    [/location\.hash\s*=/, "assigns location.hash"],
    [/location\.search\s*=/, "assigns location.search"],
    [/location\.href\s*=/, "assigns location.href"],
  ];
  for (const [pattern, why] of mutations) {
    if (pattern.test(code)) hits.push(why);
  }
  if (SITUATION_FRAGMENT.test(code)) hits.push("fragment names a situation");
  if (/[?&](?:situation|tick|q)=/.test(code)) hits.push("query carries ephemeral state");

  const templateRe = /`(?:\\.|[^`\\])*`/g;
  for (const match of code.matchAll(templateRe)) {
    const text = match[0];
    if (text.startsWith("`tel:") || text.startsWith("`data:")) continue;
    const exprs = [...text.matchAll(/\$\{([^{}]*)\}/g)].map((found) => found[1] ?? "");
    const stateful = exprs.filter((expr) => /\b(situation|situations|index|ticked|ticks|query)\b/.test(expr));
    if (stateful.length === 0) continue;
    const start = match.index ?? 0;
    const before = code.slice(Math.max(0, start - 80), start);
    const looksLikeAddress =
      /href\s*[:=]/.test(before) ||
      /location\.(?:hash|search|href)/.test(before) ||
      text.startsWith("`/") ||
      text.startsWith("`#") ||
      text.startsWith("`?") ||
      text.includes("#") ||
      text.includes("?");
    if (looksLikeAddress) hits.push(`address interpolates ${stateful.join(", ")}`);
  }
  return hits;
}

describe("First Nations ephemeral state stays out of the address", () => {
  it("catches a jump link built from the chosen situation", () => {
    expect(ephemeralUrlHits("const href = `#${situation.id}`;")).not.toEqual([]);
    expect(ephemeralUrlHits("history.pushState(null, '', '#family-meeting');")).not.toEqual([]);
    expect(ephemeralUrlHits("href={`/first-nations?q=${query}`}")).not.toEqual([]);
    expect(ephemeralUrlHits('href="/first-nations/going-home"')).toEqual([]);
    expect(ephemeralUrlHits("href={`tel:${c.telephoneUri}`}")).toEqual([]);
    expect(ephemeralUrlHits("href: `${firstNationsPageHref(p.id)}#${section.id}`")).toEqual([]);
  });

  it("finds none in the First Nations pages, components or content", () => {
    const files = ROOTS.flatMap(filesUnder);
    expect(files.length).toBeGreaterThan(10);
    const hits = files.flatMap((file) => ephemeralUrlHits(readFileSync(file, "utf8")).map((hit) => `${file}: ${hit}`));
    expect(hits).toEqual([]);
  });
});
