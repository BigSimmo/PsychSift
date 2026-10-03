// Extracts and curates plain-English summaries of the Mental Health Act 2014 (WA)
// sections cited by the Forms mode.
//
// Every archived form in data/forms-catalog.json records the Act sections it relies on
// in `sourceFacts.sectionCue` (free text, e.g. "sections 66, 91"). Those citations
// resolve to a set of distinct sections. A form's Priority-facts grid can only show the
// tappable "Act sections" card once EVERY section it cites has a reviewed summary, so
// this script owns two artifacts:
//
//   data/mha-2014-sections.source.json   verbatim statutory text, machine-extracted
//   data/mha-2014-sections.json          the curated summaries a clinician signs off
//
// Each reviewed summary carries `sourceTextSha256`, pinned to the exact statutory text
// the reviewer read. If the Act is re-fetched and that text changes, the hash stops
// matching and `--check` fails, forcing re-review instead of shipping a stale clinical
// claim against changed law.
//
//   node scripts/build-mha-act-sections.mjs --refresh   # MANUAL ONLY: fetches the Act
//   node scripts/build-mha-act-sections.mjs --draft     # offline: seed pending stubs
//   node scripts/build-mha-act-sections.mjs --check     # offline: gate, exit 1 on drift
//
// --refresh is the only network-touching build script in this repo. It must never run
// in CI: `check:mha-act-sections` runs --check, which is entirely offline.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import { reviewProblems } from "./lib/clinical-record-review-contract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = join(root, "data", "forms-catalog.json");
const supplementalCuePath = join(root, "data", "forms-act-section-cues.json");
const sourcePath = join(root, "data", "mha-2014-sections.source.json");
const curatedPath = join(root, "data", "mha-2014-sections.json");
const reviewPath = join(root, "docs", "evidence", "mha-2014-section-summaries-review.md");

// Pinned consolidated version. Bumping these three values is a deliberate act: it
// invalidates every sourceTextSha256 whose section text actually changed, which is
// exactly the re-review trigger the hash exists to produce.
//
// Moved from 02-b0-01 on 2026-09-16, because that consolidation was withdrawn: its
// filestore URL returns HTTP 404 and legislation.wa.gov.au no longer lists it among the
// versions of this Act. So the link this app rendered under every Act-section summary was
// dead. 02-b0-02 replaced it at the SAME currency start, 25 September 2025 — the trailing
// pair is the revision of one consolidation at one currency point, and the versions page
// shows no period between them. The in-force law is therefore unchanged and ACT_AS_AT
// does not move; what changed is which document the publisher serves.
export const ACT_VERSION = "02-b0-02";
export const ACT_AS_AT = "2025-09-25";
export const ACT_SOURCE_URL =
  "https://www.legislation.wa.gov.au/legislation/prod/filestore.nsf/FileURL/mrdoc_48919.htm/$FILE/Mental%20Health%20Act%202014%20-%20%5B02-b0-02%5D.html?OpenElement";
const EXTRACTOR_VERSION = 1;
const FORMAT_VERSION = 1;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const normalizeFormCode = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/**
 * Free-text section cue -> ordered, de-duplicated section numbers.
 *
 * Handles every shape present in the catalogue, including the ragged
 * "sections 29,63,67,92,112,129,133,148, 154". The leading word "sections" is
 * non-numeric so the pattern never matches it. Order is first-appearance, never
 * sorted: cue order mirrors the approved form and Form 1A's reviewed order is
 * pinned by tests/forms.test.ts.
 */
export function parseSectionCue(cue) {
  if (typeof cue !== "string") return [];
  return [...new Set(cue.match(/\d+[A-Z]*/g) ?? [])];
}

/**
 * Every section number cited by any form, in numeric order.
 *
 * Three sources: the archive rows' own `sourceFacts.sectionCue`, the supplemental
 * map covering the seven official forms the archive never indexed, and the
 * supplemental `referenceTopics` the Forms "Act and Standards" page lists without any
 * form citing them (s 25 criteria, Tribunal review, ECT approval and the like). All
 * three pass through the same extraction and the same --check gate.
 */
export function citedSections(catalog, supplemental) {
  const cited = new Set();
  for (const form of catalog.forms ?? []) {
    for (const section of parseSectionCue(form?.sourceFacts?.sectionCue)) cited.add(section);
  }
  for (const form of supplemental?.forms ?? []) {
    for (const section of form?.sections ?? []) cited.add(section);
  }
  for (const topic of supplemental?.referenceTopics ?? []) {
    for (const section of topic?.sections ?? []) cited.add(section);
  }
  return [...cited].sort(compareSections);
}

function compareSections(a, b) {
  const numeric = parseInt(a, 10) - parseInt(b, 10);
  return numeric !== 0 ? numeric : a.localeCompare(b);
}

/**
 * Normalises the Act HTML to trimmed, non-empty text lines.
 *
 * Replacing each tag with a newline (rather than stripping it) is what makes section
 * markers detectable: a heading renders as a bare number line followed by a line
 * starting with ".". It also means the table of contents — where the number, heading
 * and page number share one text node — produces no such pair, so no de-duplication
 * pass is needed.
 */
export function actTextLines(html) {
  return (
    html
      .replace(/<[^>]*>/g, "\n")
      .replace(/&#160;|&nbsp;/g, " ")
      .replace(/&#8217;|&rsquo;/g, "’")
      .replace(/&#8216;|&lsquo;/g, "‘")
      .replace(/&#8212;|&mdash;/g, "—")
      // Non-breaking hyphen: the Act uses it in compounds like "non-compliance".
      .replace(/&#8209;/g, "-")
      .replace(/&#8211;|&ndash;/g, "–")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
  );
}

/**
 * Ordered section markers. The heading-length guard rejects subsection numbering,
 * where the following line is a bare ".".
 */
export function sectionMarkers(lines) {
  const markers = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const heading = lines[index + 1];
    if (/^\d+[A-Z]*$/.test(lines[index]) && heading.startsWith(".") && heading.length > 4) {
      markers.push({ index, section: lines[index], heading: heading.slice(1).trim() });
    }
  }
  return markers;
}

/** Extracts the requested sections' heading and verbatim body text. */
export function extractSections(html, wanted) {
  const lines = actTextLines(html);
  const markers = sectionMarkers(lines);
  const bySection = new Map(markers.map((marker, position) => [marker.section, { ...marker, position }]));

  const missing = wanted.filter((section) => !bySection.has(section));
  if (missing.length) {
    throw new Error(
      `Act extraction found no heading for section(s): ${missing.join(", ")}. ` +
        `The cue may be wrong, or the Act structure changed — do not ship a chip with no title.`,
    );
  }

  return wanted.map((section) => {
    const marker = bySection.get(section);
    const next = markers[marker.position + 1];
    const body = lines.slice(marker.index + 2, next ? next.index : lines.length).join("\n");
    if (!marker.heading) throw new Error(`Section ${section} extracted with an empty heading.`);
    if (!body.trim()) throw new Error(`Section ${section} extracted with empty body text.`);
    return { section, heading: marker.heading, text: body, textSha256: sha256(body) };
  });
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

async function refresh() {
  const catalog = readJson(catalogPath);
  const supplemental = readJson(supplementalCuePath);
  const wanted = citedSections(catalog, supplemental);
  process.stdout.write(`Fetching Mental Health Act 2014 (WA) ${ACT_VERSION}…\n`);
  const response = await fetch(ACT_SOURCE_URL);
  if (!response.ok) throw new Error(`Act fetch failed: HTTP ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sections = extractSections(bytes.toString("utf8"), wanted);
  writeJson(sourcePath, {
    exportMetadata: {
      format: "mha-2014-act-section-source",
      formatVersion: FORMAT_VERSION,
      sourceUrl: ACT_SOURCE_URL,
      actVersion: ACT_VERSION,
      actAsAt: ACT_AS_AT,
      fetchedAt: new Date().toISOString(),
      documentSha256: sha256(bytes),
      extractorVersion: EXTRACTOR_VERSION,
      counts: { sections: sections.length },
    },
    sections,
  });
  process.stdout.write(`Wrote ${sections.length} extracted sections to ${sourcePath}.\n`);
}

function draft() {
  const source = readJson(sourcePath);
  const catalog = readJson(catalogPath);
  const supplemental = readJson(supplementalCuePath);
  let curated;
  try {
    curated = readJson(curatedPath);
  } catch {
    curated = { exportMetadata: {}, sections: [] };
  }
  const existing = new Map((curated.sections ?? []).map((entry) => [entry.section, entry]));

  // Never overwrite a written summary — --draft only ever adds stubs.
  const sections = source.sections.map((entry) => {
    const prior = existing.get(entry.section);
    if (prior) return { ...prior, title: entry.heading };
    return { section: entry.section, title: entry.heading, status: "pending" };
  });
  const tally = (status) => sections.filter((entry) => entry.status === status).length;

  writeJson(curatedPath, {
    exportMetadata: {
      format: "mha-2014-act-section-summaries",
      formatVersion: FORMAT_VERSION,
      actVersion: source.exportMetadata.actVersion,
      actAsAt: source.exportMetadata.actAsAt,
      sourceUrl: source.exportMetadata.sourceUrl,
      generatedAt: new Date().toISOString(),
      counts: {
        sections: sections.length,
        reviewed: tally("reviewed"),
        drafted: tally("drafted"),
        pending: tally("pending"),
      },
    },
    sections,
  });

  writeFileSync(reviewPath, reviewSheet(source, sections, catalog, supplemental));
  process.stdout.write(
    `Wrote ${sections.length} curated entries (${tally("reviewed")} reviewed, ${tally("drafted")} drafted, ` +
      `${tally("pending")} pending) to ${curatedPath} and the review sheet to ${reviewPath}.\n`,
  );
}

function citingForms(catalog, supplemental, section) {
  const fromCatalog = (catalog.forms ?? [])
    .filter((form) => parseSectionCue(form?.sourceFacts?.sectionCue).includes(section))
    .map((form) => `Form ${form.form}`);
  const fromSupplemental = (supplemental?.forms ?? [])
    .filter((form) => (form.sections ?? []).includes(section))
    .map((form) => `Form ${form.code}`);
  const fromTopics = (supplemental?.referenceTopics ?? [])
    .filter((topic) => (topic.sections ?? []).includes(section))
    .map((topic) => `Act and Standards page (${topic.title})`);
  return [...new Set([...fromCatalog, ...fromSupplemental, ...fromTopics])];
}

function reviewSheet(source, sections, catalog, supplemental) {
  const header = [
    "# Mental Health Act 2014 (WA) — section summary review sheet",
    "",
    "<!-- Generated by scripts/build-mha-act-sections.mjs --draft. Do not hand-edit. -->",
    "",
    `Act version **${source.exportMetadata.actVersion}**, as at **${source.exportMetadata.actAsAt}**.`,
    `Source: <${source.exportMetadata.sourceUrl}>`,
    "",
    "Each entry below pairs the verbatim statutory text with the drafted plain-English",
    "summary shown when a reader taps that section number on a form page. A reviewer",
    "signs off by confirming the summary against the Act text quoted here, then recording",
    "sign-off via `npm run clinical:review`.",
    "",
    "---",
    "",
  ];
  const byCuratedSection = new Map(sections.map((entry) => [entry.section, entry]));
  const body = source.sections.map((entry) => {
    const curated = byCuratedSection.get(entry.section);
    const cited = citingForms(catalog, supplemental, entry.section);
    return [
      `### s${entry.section} — ${entry.heading}`,
      "",
      `**Act text (${source.exportMetadata.actVersion}, as at ${source.exportMetadata.actAsAt})**`,
      "",
      entry.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n>\n"),
      "",
      `**Drafted summary** (status: ${curated?.status ?? "pending"})`,
      "",
      curated?.summary ? `> ${curated.summary}` : "> _Not written yet._",
      "",
      `Cited by: ${cited.length ? cited.join(", ") : "_none_"}`,
      "",
      `Source text SHA-256: \`${entry.textSha256}\``,
      "",
      "Reviewed by: ______________________   Date: ______________",
      "",
      "---",
      "",
    ].join("\n");
  });
  return `${[...header, ...body].join("\n")}`;
}

/**
 * Offline gate. Returns the problems found so tests can assert on them directly
 * rather than shelling out.
 */
export function checkProblems({ source, curated, catalog, supplemental }) {
  const problems = [];
  const sourceBySection = new Map(source.sections.map((entry) => [entry.section, entry]));
  const curatedBySection = new Map(curated.sections.map((entry) => [entry.section, entry]));

  for (const section of citedSections(catalog, supplemental)) {
    if (!sourceBySection.has(section)) {
      problems.push(`Form cue cites section ${section}, which is absent from the Act extraction.`);
    }
    if (!curatedBySection.has(section)) {
      problems.push(`Form cue cites section ${section}, which has no curated entry.`);
    }
  }

  for (const entry of curated.sections) {
    const origin = sourceBySection.get(entry.section);
    if (!origin) {
      problems.push(`Curated section ${entry.section} has no matching Act extraction (orphan entry).`);
      continue;
    }
    if (entry.title !== origin.heading) {
      problems.push(
        `Curated section ${entry.section} title "${entry.title}" does not match the Act heading "${origin.heading}".`,
      );
    }
    if (!["reviewed", "drafted", "pending"].includes(entry.status)) {
      problems.push(`Curated section ${entry.section} has unknown status "${entry.status}".`);
      continue;
    }
    if (entry.status === "pending") {
      if (entry.summary?.trim()) {
        problems.push(`Pending section ${entry.section} carries a summary — set status to "drafted".`);
      }
      continue;
    }

    // Both drafted and reviewed summaries are pinned to the exact text they were written
    // from, so amended law invalidates them either way.
    if (!entry.summary?.trim()) problems.push(`Section ${entry.section} is ${entry.status} but has no summary.`);
    if (entry.sourceTextSha256 !== origin.textSha256) {
      problems.push(
        `Section ${entry.section} is pinned to stale Act text — the summary must be rewritten and re-reviewed ` +
          `against ${source.exportMetadata.actVersion}.`,
      );
    }
    if (entry.status !== "reviewed") continue;

    // Only a reviewed entry claims a named clinician signed it off, so only it needs one.
    if (!entry.reviewedBy?.trim()) problems.push(`Reviewed section ${entry.section} has no reviewedBy.`);
    if (!entry.reviewedAt?.trim()) problems.push(`Reviewed section ${entry.section} has no reviewedAt.`);
  }

  // The sign-off contract (npm run clinical:review): a public, non-placeholder reviewer, a
  // past UTC timestamp, no partial attestation on an unreviewed entry, and a
  // reviewedContentSha256 pin over the title, summary and sourceTextSha256. Editing a
  // reviewed summary after sign-off breaks the pin and fails this gate, forcing re-review.
  problems.push(...reviewProblems(curated.sections, "section"));

  // A form is only a conflict when the catalogue row carries a cue of its OWN. Catalogue
  // membership is not a cue: the seven forms the archive never indexed now have catalogue
  // rows for their operational guidance, and their section mapping still comes from the
  // supplemental map -- which is where the checkable `basis` for it lives. Deleting those
  // entries would leave those forms with no Act sections at all.
  const catalogCodes = new Set(
    (catalog.forms ?? [])
      .filter((form) => parseSectionCue(form?.sourceFacts?.sectionCue).length > 0)
      .map((form) => normalizeFormCode(form.form)),
  );
  for (const form of supplemental?.forms ?? []) {
    if (!form.sections?.length) problems.push(`Supplemental cue for Form ${form.code} lists no sections.`);
    if (!form.basis?.trim()) {
      // The basis is what makes an asserted mapping checkable rather than folklore.
      problems.push(`Supplemental cue for Form ${form.code} has no stated basis.`);
    }
    if (!["reviewed", "drafted"].includes(form.status)) {
      problems.push(`Supplemental cue for Form ${form.code} has unknown status "${form.status}".`);
    }
    if (form.status === "reviewed" && (!form.reviewedBy?.trim() || !form.reviewedAt?.trim())) {
      problems.push(`Reviewed supplemental cue for Form ${form.code} needs reviewedBy and reviewedAt.`);
    }
    if (catalogCodes.has(normalizeFormCode(form.code))) {
      problems.push(
        `Form ${form.code} has both a catalogue section cue and a supplemental one — remove the supplemental entry.`,
      );
    }
  }

  // Reference topics carry no form, so their basis is the only thing that makes the
  // topic-to-section mapping checkable; the ids key the page's anchors.
  const topicIds = new Set();
  for (const topic of supplemental?.referenceTopics ?? []) {
    const label = topic?.id ?? "(no id)";
    if (!topic?.id?.trim()) problems.push("A reference topic has no id.");
    else if (topicIds.has(topic.id)) problems.push(`Reference topic id ${topic.id} is used more than once.`);
    else topicIds.add(topic.id);
    if (!topic?.title?.trim()) problems.push(`Reference topic ${label} has no title.`);
    if (!topic?.sections?.length) problems.push(`Reference topic ${label} lists no sections.`);
    if (!topic?.basis?.trim()) problems.push(`Reference topic ${label} has no stated basis.`);
  }

  const sourceMeta = source.exportMetadata;
  const curatedMeta = curated.exportMetadata;
  if (curatedMeta.actVersion !== sourceMeta.actVersion || curatedMeta.actAsAt !== sourceMeta.actAsAt) {
    problems.push("Curated and extracted Act version metadata disagree.");
  }
  const tally = (status) => curated.sections.filter((entry) => entry.status === status).length;
  if (
    curatedMeta.counts?.sections !== curated.sections.length ||
    curatedMeta.counts?.reviewed !== tally("reviewed") ||
    curatedMeta.counts?.drafted !== tally("drafted") ||
    curatedMeta.counts?.pending !== tally("pending")
  ) {
    problems.push("Curated exportMetadata.counts does not match the section list.");
  }
  return problems;
}

export function loadForCheck() {
  return {
    source: readJson(sourcePath),
    curated: readJson(curatedPath),
    catalog: readJson(catalogPath),
    supplemental: readJson(supplementalCuePath),
  };
}

function check() {
  const loaded = loadForCheck();
  const problems = checkProblems(loaded);
  if (problems.length) {
    throw new Error(`Act section data is inconsistent:\n  - ${problems.join("\n  - ")}`);
  }
  const tally = (status) => loaded.curated.sections.filter((entry) => entry.status === status).length;
  const total = loaded.curated.sections.length;
  process.stdout.write(
    `Act section data is current (${total} sections cited by forms, ${tally("reviewed")} reviewed, ` +
      `${tally("drafted")} drafted, ${tally("pending")} pending; ` +
      `Act ${loaded.source.exportMetadata.actVersion} as at ${loaded.source.exportMetadata.actAsAt}).\n`,
  );
}

// `file://${process.argv[1]}` is not a valid comparison on Windows because argv
// carries backslashes and the URL has an extra leading slash. Use the same
// cross-platform conversion as the repository's other directly invoked scripts.
const isEntrypoint = isDirectEntrypoint(import.meta.url);
if (isEntrypoint) {
  if (process.argv.includes("--refresh")) await refresh();
  else if (process.argv.includes("--draft")) draft();
  else if (process.argv.includes("--check")) check();
  else {
    process.stderr.write("Usage: build-mha-act-sections.mjs --refresh | --draft | --check\n");
    process.exit(2);
  }
}
