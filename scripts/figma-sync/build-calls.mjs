#!/usr/bin/env node
/**
 * Turn captured work-mode screens into ready-to-paste Figma `use_figma` calls. Offline: it reads the JSON
 * that `capture.mjs` wrote and writes text files. It never opens a browser, a server or Figma.
 *
 * Usage:
 *   node scripts/figma-sync/build-calls.mjs [--captures DIR] [--out DIR]
 *       [--previous DIR] [--y-start FILE] [--jobs FILE]
 *   node scripts/figma-sync/build-calls.mjs --components [--out DIR]
 *   node scripts/figma-sync/build-calls.mjs --swap 7:14 [--swap 7:5 ...] | --swap all [--out DIR]
 *
 *   --captures  folder of capture JSON from capture.mjs   (default .tmp-visual/figma-sync/captures)
 *   --out       folder the call files are written to       (default .tmp-visual/figma-sync/calls)
 *   --previous  folder of an earlier capture run already drawn in Figma. Icons keep their old names and only
 *               icons that are new in --captures get an icon call.
 *   --y-start   JSON file mapping a Figma page id to the lowest edge of what is already on that page; new
 *               sections start below it. Without it every page starts at the top. A run writes y-end.json
 *               beside the call files in the same format, ready to be the next run's --y-start.
 *   --jobs      the screen list that fixes section order    (default scripts/figma-sync/jobs.json)
 *   --components  write components.js (rebuilds the Components page)
 *   --swap      write swap-<page>.js (replaces captured headers and tab bars with component instances)
 *
 * Every call file stays under 50,000 characters, the most one `use_figma` call accepts; the run fails if one
 * does not.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CALL_CHAR_LIMIT, componentsCallText, planPageCalls, SWAP_PAGES, swapCallText } from "./calls-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");
const scratchRoot = path.join(projectRoot, ".tmp-visual", "figma-sync");

function fail(message) {
  console.error(`[figma-sync:build] ${message}`);
  process.exit(1);
}

function readEntries(dir) {
  if (!fs.existsSync(dir)) fail(`Folder not found: ${dir}`);
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({ file, data: JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) }));
}

async function loadFigmaScript(name) {
  return (await import(pathToFileURL(path.join(here, "figma", `${name}.mjs`)).href)).default;
}

/** Remove call files an earlier run left behind so a stale page call is never pasted by mistake. */
function clearGenerated(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of fs.readdirSync(outDir)) {
    if (/^(icons|page)-.*\.js$/.test(file)) fs.rmSync(path.join(outDir, file));
  }
}

const { values } = parseArgs({
  options: {
    captures: { type: "string" },
    previous: { type: "string" },
    out: { type: "string" },
    "y-start": { type: "string" },
    jobs: { type: "string" },
    components: { type: "boolean", default: false },
    swap: { type: "string", multiple: true },
  },
  strict: true,
});

const outDir = path.resolve(values.out ?? path.join(scratchRoot, "calls"));
const oversize = [];

function writeCall(name, text) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, text);
  const size = text.length;
  if (size > CALL_CHAR_LIMIT) oversize.push(`${name} (${size} characters)`);
  return size;
}

if (values.components || values.swap?.length) {
  fs.mkdirSync(outDir, { recursive: true });
  if (values.components) {
    const size = writeCall("components.js", componentsCallText(await loadFigmaScript("components")));
    console.log(`components.js  ${size} characters`);
  }
  if (values.swap?.length) {
    const swapFn = await loadFigmaScript("swap");
    const pages = values.swap.flatMap((page) => (page === "all" ? SWAP_PAGES : [page]));
    for (const page of new Set(pages)) {
      const name = `swap-${page.replace(":", "_")}.js`;
      console.log(`${name}  ${writeCall(name, swapCallText(swapFn, page))} characters`);
    }
  }
} else {
  const capturesDir = path.resolve(values.captures ?? path.join(scratchRoot, "captures"));
  const jobsFile = path.resolve(values.jobs ?? path.join(here, "jobs.json"));
  const jobs = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
  const current = readEntries(capturesDir);
  const previous = values.previous ? readEntries(path.resolve(values.previous)) : [];
  const yStart = values["y-start"] ? JSON.parse(fs.readFileSync(path.resolve(values["y-start"]), "utf8")) : null;
  if (!current.length) fail(`No capture JSON found in ${capturesDir}. Run capture.mjs first.`);

  const plan = planPageCalls({ jobs, current, previous, yStart, builderFn: await loadFigmaScript("builder") });
  clearGenerated(outDir);

  console.log(`icons ${plan.icons.length} new`);
  for (const call of plan.iconCalls) console.log(`${call.name}  ${writeCall(call.name, call.text)} characters`);
  for (const call of plan.pageCalls) {
    console.log(`${call.name}  ${writeCall(call.name, call.text)} characters  ${call.sections.join(", ")}`);
  }
  fs.writeFileSync(path.join(outDir, "y-end.json"), `${JSON.stringify(plan.yEnd, null, 2)}\n`);
  console.log(`calls ${plan.iconCalls.length + plan.pageCalls.length}, written to ${outDir}`);
  if (plan.missing.length) {
    const shown = plan.missing.slice(0, 12).join(", ");
    const more = plan.missing.length > 12 ? ` and ${plan.missing.length - 12} more` : "";
    console.warn(`No capture for ${plan.missing.length} screen(s), skipped: ${shown}${more}`);
  }
}

if (oversize.length) {
  fail(`Over the ${CALL_CHAR_LIMIT}-character limit for one use_figma call: ${oversize.join("; ")}`);
}
