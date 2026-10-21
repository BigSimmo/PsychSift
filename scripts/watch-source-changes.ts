// Weekly source watch: checks whether the public page or file behind each registered
// Western Australian, Australian and UK (NICE) source still looks the way it did last week.
//
// Report only. It reads public web pages and nothing else: no database, no storage,
// no ingestion queue, no OpenAI, and it never edits the register. A difference is not a
// guideline change (pages move, banners rotate, PDFs are re-saved), so the owner reads
// each one and, when the guidance really changed, records it in
// src/data/source-change-events.json, which makes every citing record due for review.
//
// The existing `check-public-source-changes.ts` is not this: on a change it stages a new
// version for indexing, which chunks and embeds. It stays manual.
//
// Last week's fingerprints travel in the weekly issue body (`--state-in`), so the watch
// needs no commits and no repository writes.
//
//   node scripts/run-tsx.mjs scripts/watch-source-changes.ts --out report.md [--state-in state.md] [--limit N]

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const REGISTER_PATH = "src/data/source-acquisitions.json";
export const REPORT_HEADING = "# Weekly source watch";
const STATE_MARKER = "source-watch-state:v1";
/** Hidden count the publishing job reads to decide whether to notify. */
export const ATTENTION_MARKER = "source-watch-attention";
const USER_AGENT = "PsychSift source watch (+https://psychiatry.tools; weekly; contact via GitHub BigSimmo/PsychSift)";
// Checked one at a time, so the worst case (every publisher stalled) is about
// sources x (timeout + 0.5 s pause): 93 sources is about 19 minutes, inside the job's
// 30-minute limit, so even a wide outage still gets reported.
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 25 * 1024 * 1024;

export type WatchedSource = { id: string; title: string; publisher: string; jurisdiction: string; url: string };

export type Fingerprint = {
  url: string;
  hash: string;
  bytes: number;
  contentType: string;
  lastModified: string | null;
};

export type FetchOutcome =
  | { kind: "ok"; finalUrl: string; status: number; contentType: string; lastModified: string | null; body: Uint8Array }
  | { kind: "http"; status: number; finalUrl: string }
  | { kind: "error"; message: string };

export type Disposition = "new" | "unchanged" | "changed" | "moved" | "gone" | "unreachable";

export type WatchResult = {
  source: WatchedSource;
  disposition: Disposition;
  detail: string;
  fingerprint: Fingerprint | null;
};

type RegisterRecord = {
  id: string;
  title: string;
  publisher: string;
  jurisdiction: string;
  canonicalUrl: string | null;
  disposition: string;
};

/**
 * 0 for Western Australia, 1 for the rest of Australia, 2 for the United Kingdom (the NICE
 * guidelines most therapy records cite), null for anything else (not watched).
 */
export function jurisdictionRank(jurisdiction: string): 0 | 1 | 2 | null {
  if (/^(Australia\/WA|Western Australia)$/.test(jurisdiction)) return 0;
  if (/^Australia(\/|$)/.test(jurisdiction)) return 1;
  if (jurisdiction === "United Kingdom") return 2;
  return null;
}

/** Every unrejected register source with a public https address, Western Australian first, UK last. */
export function watchedSources(records: readonly RegisterRecord[]): WatchedSource[] {
  const seen = new Set<string>();
  return records
    .flatMap((record) => {
      const rank = jurisdictionRank(record.jurisdiction);
      if (rank === null || record.disposition === "rejected" || !record.canonicalUrl) return [];
      if (!/^https:\/\//i.test(record.canonicalUrl)) return [];
      return [{ rank, source: { ...record, url: record.canonicalUrl } }];
    })
    .sort((a, b) => a.rank - b.rank || a.source.id.localeCompare(b.source.id))
    .flatMap(({ source }) => {
      if (seen.has(source.id)) return [];
      seen.add(source.id);
      return [
        {
          id: source.id,
          title: source.title,
          publisher: source.publisher,
          jurisdiction: source.jurisdiction,
          url: source.url,
        },
      ];
    });
}

/**
 * The readable text of an HTML page, so a rotated script bundle, a tracking token or
 * a re-indented template is not reported as a change. Dates and times are blanked
 * too: "Last updated", "Page generated" and clocks change without the guidance moving.
 */
export function normaliseHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(head|header|footer|nav)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(
      /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+\d{4}\b/gi,
      "<date>",
    )
    .replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g, "<date>")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "<date>")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi, "<time>")
    .replace(/\s+/g, " ")
    .trim();
}

function isHtml(contentType: string): boolean {
  return /text\/html|application\/xhtml/i.test(contentType);
}

export function fingerprintOf(input: {
  url: string;
  contentType: string;
  lastModified: string | null;
  body: Uint8Array;
}): Fingerprint {
  const content = isHtml(input.contentType)
    ? normaliseHtml(new TextDecoder("utf-8", { fatal: false }).decode(input.body))
    : input.body;
  return {
    url: input.url,
    hash: createHash("sha256").update(content).digest("hex"),
    bytes: input.body.byteLength,
    contentType: input.contentType.split(";")[0]?.trim() || "unknown",
    lastModified: input.lastModified,
  };
}

/** Same address once case, a trailing slash and an http-to-https upgrade are ignored. */
export function sameAddress(a: string, b: string): boolean {
  const canonical = (value: string) => {
    try {
      const url = new URL(value);
      url.hash = "";
      return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "").toLowerCase()}${url.search}`;
    } catch {
      return value;
    }
  };
  return canonical(a) === canonical(b);
}

export function classify(source: WatchedSource, outcome: FetchOutcome, previous: Fingerprint | undefined): WatchResult {
  if (outcome.kind === "error") {
    return { source, disposition: "unreachable", detail: outcome.message, fingerprint: previous ?? null };
  }
  if (outcome.kind === "http") {
    if (outcome.status === 404 || outcome.status === 410) {
      return { source, disposition: "gone", detail: `HTTP ${outcome.status}`, fingerprint: previous ?? null };
    }
    return {
      source,
      disposition: "unreachable",
      detail: `HTTP ${outcome.status} (blocked or unavailable; not a change)`,
      fingerprint: previous ?? null,
    };
  }
  const fingerprint = fingerprintOf({ ...outcome, url: source.url });
  if (!sameAddress(outcome.finalUrl, source.url)) {
    return { source, disposition: "moved", detail: `now redirects to ${outcome.finalUrl}`, fingerprint };
  }
  if (!previous) return { source, disposition: "new", detail: "first fingerprint recorded", fingerprint };
  if (previous.hash === fingerprint.hash) {
    return { source, disposition: "unchanged", detail: "", fingerprint };
  }
  const bits = [`content differs from last week (${previous.bytes} to ${fingerprint.bytes} bytes)`];
  if (fingerprint.lastModified && fingerprint.lastModified !== previous.lastModified) {
    bits.push(`server says last modified ${fingerprint.lastModified}`);
  }
  return { source, disposition: "changed", detail: bits.join("; "), fingerprint };
}

/** Last week's fingerprints, read from the hidden block in last week's report. */
export function parseState(markdown: string): Record<string, Fingerprint> {
  const match = new RegExp(`<!-- ${STATE_MARKER}\\s+([A-Za-z0-9+/=]+)\\s+-->`).exec(markdown);
  if (!match) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, Fingerprint>;
  } catch {
    return {};
  }
}

function serialiseState(results: readonly WatchResult[]): string {
  const state = Object.fromEntries(
    results.flatMap((result) => (result.fingerprint ? [[result.source.id, result.fingerprint] as const] : [])),
  );
  return `<!-- ${STATE_MARKER} ${Buffer.from(JSON.stringify(state), "utf8").toString("base64")} -->`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

const SECTION_ORDER: { disposition: Disposition; heading: string; note: string }[] = [
  {
    disposition: "changed",
    heading: "Changed since last week",
    note: "Open each one and check whether the guidance itself changed. If it did, record it in `src/data/source-change-events.json`; every record citing it then shows its review as due now.",
  },
  {
    disposition: "moved",
    heading: "Moved",
    note: "The address now redirects. Check the new page is the same document and update the register address.",
  },
  {
    disposition: "gone",
    heading: "Gone",
    note: "The address returns not found. The source may have been withdrawn or moved.",
  },
  {
    disposition: "unreachable",
    heading: "Could not check",
    note: "Blocked, timed out or unavailable. These are not changes; check by hand if one stays unreachable.",
  },
  { disposition: "new", heading: "First check", note: "Fingerprint recorded; compared from next week." },
];

export function renderReport(results: readonly WatchResult[], checkedOn: string): string {
  const count = (disposition: Disposition) => results.filter((result) => result.disposition === disposition).length;
  const lines = [
    REPORT_HEADING,
    "",
    `Checked ${checkedOn}: ${results.length} Western Australian, Australian and UK sources. ` +
      `${count("changed")} changed, ${count("moved")} moved, ${count("gone")} gone, ` +
      `${count("unreachable")} could not be checked, ${count("unchanged")} unchanged, ${count("new")} checked for the first time.`,
    "",
    "Report only: nothing here changes a page. A difference is not a guideline change until you confirm it.",
  ];
  for (const section of SECTION_ORDER) {
    const rows = results.filter((result) => result.disposition === section.disposition);
    if (!rows.length) continue;
    lines.push(
      "",
      `## ${section.heading} (${rows.length})`,
      "",
      section.note,
      "",
      "| Source | Publisher | Detail |",
      "| --- | --- | --- |",
    );
    for (const row of rows) {
      lines.push(
        `| [${escapeCell(row.source.title)}](${row.source.url}) \`${row.source.id}\` | ${escapeCell(row.source.publisher)} | ${escapeCell(row.detail)} |`,
      );
    }
  }
  const attention = count("changed") + count("moved") + count("gone");
  lines.push("", `<!-- ${ATTENTION_MARKER}:${attention} -->`, serialiseState(results));
  return `${lines.join("\n")}\n`;
}

async function fetchSource(url: string): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { kind: "http", status: response.status, finalUrl: response.url || url };
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) {
      await response.body?.cancel();
      return { kind: "error", message: `larger than ${MAX_BYTES} bytes` };
    }
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > MAX_BYTES) return { kind: "error", message: `larger than ${MAX_BYTES} bytes` };
    return {
      kind: "ok",
      finalUrl: response.url || url,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "unknown",
      lastModified: response.headers.get("last-modified"),
      body,
    };
  } catch (error) {
    const message = error instanceof Error ? (error.name === "AbortError" ? "timed out" : error.message) : "failed";
    return { kind: "error", message };
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs(argv: string[]) {
  let out: string | undefined;
  let stateIn: string | undefined;
  let limit: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--out") out = argv[++index];
    else if (token === "--state-in") stateIn = argv[++index];
    else if (token === "--limit") limit = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!out) throw new Error("--out <path> is required.");
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
    throw new Error("--limit must be a positive integer.");
  return { out, stateIn, limit };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const register = JSON.parse(readFileSync(path.resolve(REGISTER_PATH), "utf8")) as RegisterRecord[];
  const sources = watchedSources(register).slice(0, args.limit);
  let previousState: Record<string, Fingerprint> = {};
  if (args.stateIn) {
    try {
      previousState = parseState(readFileSync(args.stateIn, "utf8"));
    } catch {
      previousState = {};
    }
  }
  const results: WatchResult[] = [];
  // One request at a time, with a pause: these are small public-sector sites.
  for (const source of sources) {
    results.push(classify(source, await fetchSource(source.url), previousState[source.id]));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const report = renderReport(results, new Date().toISOString().slice(0, 10));
  mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  writeFileSync(args.out, report);
  const changed = results.filter((result) => ["changed", "moved", "gone"].includes(result.disposition)).length;
  console.log(`[source-watch] checked ${results.length} sources; ${changed} need a look. Report: ${args.out}`);
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Source watch failed.");
    process.exit(1);
  });
}
