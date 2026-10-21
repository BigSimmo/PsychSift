#!/usr/bin/env node
/**
 * WA learning directory weekly report (#R2FNTJ, owner decision 21 Oct 2026: a weekly report-only check).
 *
 * Reads src/data/cme/wa-learning-directory.json and reports what a person should recheck: a list or
 * an entry not checked recently, events long finished that can come out, cancelled events, dates
 * nobody confirmed, and organiser links that did not answer. Report only: it never edits the file,
 * never opens a pull request and blocks nothing. The only network calls are plain GET requests to
 * the organisers' own public pages, and `--offline` skips those.
 *
 * Usage: node scripts/cme/learning-directory-weekly.mjs [--out <file>] [--offline]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPORT_HEADING = "# WA learning directory weekly report";
/** An entry not checked for longer than this is listed for a recheck. */
export const ENTRY_RECHECK_AFTER_DAYS = 30;
/** Matches LEARNING_DIRECTORY_STALE_AFTER_DAYS, when the app itself starts flagging the list. */
export const LIST_STALE_AFTER_DAYS = 45;
/** A finished event older than this has served its Past purpose and can come out of the file. */
export const REMOVE_FINISHED_AFTER_DAYS = 90;

const MS_PER_DAY = 86_400_000;
const LINK_TIMEOUT_MS = 15_000;

/** Today's calendar date in Perth, as YYYY-MM-DD. */
export function perthToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Perth" }).format(now);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

function line(item, detail) {
  return `- ${item.title} (\`${item.id}\`): ${detail}`;
}

/**
 * Builds the report markdown. `linkResults` maps a URL to `{ ok, detail }`; null means the link
 * check was skipped.
 */
export function buildLearningDirectoryReport({ directory, todayPerth, linkResults = null }) {
  const items = Array.isArray(directory?.items) ? directory.items : [];
  const listAge = daysBetween(directory.lastCheckedOn, todayPerth);
  const recheck = items.filter((item) => daysBetween(item.lastCheckedOn, todayPerth) > ENTRY_RECHECK_AFTER_DAYS);
  const removable = items.filter((item) => {
    const finishesOn = item.endsOn ?? item.startsOn;
    return (
      item.kind !== "recorded" &&
      finishesOn !== null &&
      daysBetween(finishesOn, todayPerth) > REMOVE_FINISHED_AFTER_DAYS
    );
  });
  const cancelled = items.filter((item) => item.cancelled === true);
  const unconfirmed = items.filter((item) => item.datesConfirmed === false);
  const brokenLinks = [];
  if (linkResults) {
    for (const item of items) {
      for (const [label, url] of [
        ["details link", item.url],
        ["source link", item.sourceUrl],
      ]) {
        const result = linkResults.get(url);
        if (result && !result.ok) brokenLinks.push(line(item, `${label} ${result.detail}`));
      }
    }
  }

  const section = (title, rows, empty) => ["", `## ${title}`, "", ...(rows.length ? rows : [empty])];
  const listStale = listAge > LIST_STALE_AFTER_DAYS;
  const actions = recheck.length + removable.length + cancelled.length + unconfirmed.length + brokenLinks.length;
  return [
    REPORT_HEADING,
    "",
    `Perth date ${todayPerth}. ${items.length} entries. The list was last checked on ${directory.lastCheckedOn} (${listAge} days ago)${
      listStale ? ", so the app is already showing it as possibly out of date" : ""
    }.`,
    "",
    actions === 0 && !listStale
      ? "Nothing needs a recheck this week."
      : "Each item below needs a person to look at the organiser's page and update `src/data/cme/wa-learning-directory.json` in a pull request. This report changes nothing itself.",
    ...section(
      `Not checked for more than ${ENTRY_RECHECK_AFTER_DAYS} days`,
      recheck.map((item) => line(item, `last checked ${item.lastCheckedOn}`)),
      "None.",
    ),
    ...section(
      "Links that did not answer",
      brokenLinks,
      linkResults ? "None. Every link answered." : "Not checked this run (offline).",
    ),
    ...section(
      "Cancelled, still listed",
      cancelled.map((item) => line(item, `cancelled, finishes ${item.endsOn ?? item.startsOn ?? "undated"}`)),
      "None.",
    ),
    ...section(
      "Dates not confirmed",
      unconfirmed.map((item) => line(item, "check whether the organiser has published a date")),
      "None.",
    ),
    ...section(
      `Finished more than ${REMOVE_FINISHED_AFTER_DAYS} days ago, can be removed`,
      removable.map((item) => line(item, `finished ${item.endsOn ?? item.startsOn}`)),
      "None.",
    ),
    "",
  ].join("\n");
}

async function checkLink(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
      headers: { "User-Agent": "PsychSift learning directory weekly check" },
    });
    await response.body?.cancel();
    return response.ok
      ? { ok: true, detail: `answered ${response.status}` }
      : { ok: false, detail: `answered ${response.status}` };
  } catch (error) {
    return { ok: false, detail: `did not answer (${error?.name === "TimeoutError" ? "timed out" : "network error"})` };
  }
}

async function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const outIndex = argv.indexOf("--out");
  const out = outIndex >= 0 ? argv[outIndex + 1] : null;
  const offline = argv.includes("--offline");
  const directory = JSON.parse(readFileSync(resolve(root, "src/data/cme/wa-learning-directory.json"), "utf8"));
  let linkResults = null;
  if (!offline) {
    const urls = [...new Set(directory.items.flatMap((item) => [item.url, item.sourceUrl]))];
    linkResults = new Map(await Promise.all(urls.map(async (url) => [url, await checkLink(url)])));
  }
  const report = buildLearningDirectoryReport({ directory, todayPerth: perthToday(), linkResults });
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), report);
  } else {
    process.stdout.write(report);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
