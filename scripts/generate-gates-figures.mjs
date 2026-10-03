/**
 * Generates the current-ratchet-figures block in docs/design-system/GATES.md
 * from scripts/design-system-contract-baseline.json.
 *
 * Why this exists: GATES.md carried the same metric as three different
 * hand-typed numbers in three sections, all of them wrong, most of them
 * overstating remaining debt by up to a factor of ten. The document's own §5
 * records the cost — "a row that understates shipped work sends the next
 * session to rebuild it" — and an overstating row costs the same session in the
 * other direction. Numbers a human retypes drift; numbers a script writes do not.
 *
 * Refresh with: npm run design-system:gates-figures:update
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const BASELINE_PATH = fileURLToPath(new URL("../scripts/design-system-contract-baseline.json", import.meta.url));
const GATES_PATH = fileURLToPath(new URL("../docs/design-system/GATES.md", import.meta.url));

const START = "<!-- design-system-contract:figures:start -->";
const END = "<!-- design-system-contract:figures:end -->";

export function renderFigures(baseline) {
  const metrics = baseline.metrics ?? {};
  const debtByPath = baseline.debtByPath ?? {};
  const names = Object.keys(metrics).sort();

  const lines = [
    START,
    "",
    "<!-- Generated from scripts/design-system-contract-baseline.json. Do not edit by hand:",
    "     run `npm run design-system:gates-figures:update`. -->",
    "",
    "| Metric | Current pin | Files pinned |",
    "| ------ | ----------- | ------------ |",
  ];
  for (const name of names) {
    const value = metrics[name];
    const paths = Object.keys(debtByPath[name] ?? {}).length;
    const pin = value === 0 ? "**0** (hard floor)" : String(value);
    lines.push(`| \`${name}\` | ${pin} | ${paths} |`);
  }
  const zeroed = names.filter((name) => metrics[name] === 0).length;
  lines.push(
    "",
    `${names.length} metrics, ${zeroed} of them pinned at zero. A metric at zero is a hard floor:`,
    "the check asserts `value <= baseline`, so any reintroduction fails. A non-zero pin is",
    "recorded debt with per-path pins, so a new occurrence fails even while the total stands.",
    "",
    END,
  );
  return lines.join("\n");
}

/**
 * Locate the single marked block, refusing anything ambiguous. `indexOf` alone takes
 * the FIRST marker pair, so a duplicated or stray marker (a bad merge, a copy-pasted
 * example) would silently retarget both the comparison and the `--write` overwrite at
 * the wrong slice, reporting success while §0 stayed stale. Fail loudly instead.
 */
function blockBounds(document) {
  const starts = [...document.matchAll(new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))];
  const ends = [...document.matchAll(new RegExp(END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))];
  if (starts.length !== 1 || ends.length !== 1) {
    throw new Error(
      `GATES.md must contain exactly one ${START} and one ${END} ` +
        `(found ${starts.length} start, ${ends.length} end). Ambiguous markers would silently ` +
        `retarget the generated block.`,
    );
  }
  const start = starts[0].index;
  const end = ends[0].index;
  if (end < start) throw new Error("GATES.md figures end marker precedes its start marker");
  return { start, end: end + END.length };
}

function replaceBlock(document, rendered) {
  const { start, end } = blockBounds(document);
  return document.slice(0, start) + rendered + document.slice(end);
}

function currentBlock(document) {
  const { start, end } = blockBounds(document);
  return document.slice(start, end);
}

/**
 * Prettier re-pads markdown table cells when it formats GATES.md, so a byte
 * comparison would report drift on every formatted commit. Compare the content
 * instead: collapse runs of spaces and drop blank lines. This is the same
 * approach `generate-design-system-adoption.mjs` takes with its marked sections.
 */
function normalize(block) {
  return block
    .split("\n")
    .map((line) => {
      if (!line.includes("|")) return line.replace(/\s+/g, " ").trim();
      // Split on the cell separator and trim each cell, so Prettier's column
      // padding and its widened alignment dashes both normalise away.
      const cells = line
        .split("|")
        .map((cell) => cell.trim())
        .map((cell) => (/^:?-{2,}:?$/.test(cell) ? "-" : cell.replace(/\s+/g, " ")));
      return cells.join("|");
    })
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

export function generate({ write }) {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const document = readFileSync(GATES_PATH, "utf8");
  const rendered = renderFigures(baseline);
  const stale = normalize(currentBlock(document)) !== normalize(rendered);
  if (write && stale) {
    writeFileSync(GATES_PATH, replaceBlock(document, rendered), "utf8");
  }
  return { changed: stale };
}

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) {
  const write = process.argv.includes("--write");
  const { changed } = generate({ write });
  if (write) {
    console.log(changed ? "GATES.md figures block updated." : "GATES.md figures block already current.");
  } else if (changed) {
    console.error(
      "docs/design-system/GATES.md figures block is out of date.\n" +
        "Refresh with: npm run design-system:gates-figures:update",
    );
    process.exit(1);
  } else {
    console.log("GATES.md figures block is current.");
  }
}
