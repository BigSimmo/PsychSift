/**
 * Token-layer divergence contract.
 *
 * `layout.tsx` mounts `.ckb-v2` unconditionally on <html>, and `.ckb-v2.ckb-v2`
 * (0,2,0) outranks `:root` (0,1,0) on that same element. So for any role BOTH
 * `globals.css` and `ckb-v2-tokens.css` declare, the v2 value is the one that
 * paints and the globals.css declaration is dead — editing it changes nothing,
 * silently, with no lint, no type error and no failing screenshot.
 *
 * The v2 migration is deliberate and unfinished (see docs/design-system/TOKENS.md),
 * so divergence is not banned. It is PINNED: the set below is the reviewed set,
 * and any name that starts diverging, or stops, fails until the pin is updated.
 * That turns an invisible trap into a deliberate, reviewable one.
 *
 * Refresh with: npm run design-system:token-divergence:update
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const GLOBALS = fileURLToPath(new URL("../src/app/globals.css", import.meta.url));
const V2 = fileURLToPath(new URL("../src/app/ckb-v2-tokens.css", import.meta.url));
export const PIN_PATH = fileURLToPath(new URL("../docs/design-system/token-layer-divergences.json", import.meta.url));

/**
 * Every rule block in a stylesheet, as {media, selectors, body}, using real brace
 * matching rather than "slice to the next line-initial `}`". Brace matching is what
 * lets an `@media (forced-colors: active) { … }` wrapper be seen as context rather
 * than terminating the block early.
 */
function ruleBlocks(rawSource) {
  // Strip comments first: otherwise a comment preceding a selector is accumulated
  // into that selector's prelude and the match fails. Replaced with a space rather
  // than removed so `a/**/b` cannot become one token.
  const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, " ");
  const blocks = [];
  const stack = [];
  let index = 0;
  let pending = "";
  while (index < source.length) {
    const character = source[index];
    if (character === "{") {
      const prelude = pending.trim();
      pending = "";
      if (prelude.startsWith("@media") || prelude.startsWith("@supports")) {
        stack.push({ kind: "at", prelude });
        index += 1;
        continue;
      }
      // A rule block: capture its body by matching braces from here.
      let depth = 1;
      let cursor = index + 1;
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === "{") depth += 1;
        else if (source[cursor] === "}") depth -= 1;
        cursor += 1;
      }
      blocks.push({
        media: stack
          .filter((frame) => frame.kind === "at")
          .map((frame) => frame.prelude)
          .join(" "),
        selectors: prelude
          .split(",")
          .map((selector) => selector.trim())
          .filter(Boolean),
        body: source.slice(index + 1, cursor - 1),
      });
      index = cursor;
      continue;
    }
    if (character === "}") {
      stack.pop();
      pending = "";
      index += 1;
      continue;
    }
    if (character === ";") pending = "";
    else pending += character;
    index += 1;
  }
  return blocks;
}

/**
 * Custom-property declarations in a block body. Indentation-insensitive on purpose:
 * an earlier version required exactly two leading spaces, so re-indenting a
 * declaration — a change with no rendered effect — silently dropped it from the
 * comparison and the tool then reported the divergence as resolved.
 */
function declarations(body) {
  const map = new Map();
  if (!body) return map;
  for (const [, name, value] of body.matchAll(/(?:^|;)\s*(--[a-zA-Z0-9-]+)\s*:\s*([^;]+)/g)) {
    map.set(name, value.trim().replace(/\s+/g, " "));
  }
  return map;
}

/**
 * Resolve `var(--x)` chains inside one layer. Two layers can declare the SAME alias
 * text and still paint different colours when the alias itself diverges — dark
 * `--clinical-chat-document` is `var(--surface-inset)` on both sides while
 * `--surface-inset` differs, so a raw string comparison called it identical.
 */
function resolveValue(tokens, value, seen = new Set()) {
  const alias = /^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/.exec(value ?? "");
  if (!alias) return value;
  const name = alias[1];
  if (seen.has(name) || !tokens.has(name)) return value;
  seen.add(name);
  return resolveValue(tokens, tokens.get(name), seen);
}

const THEMES = {
  light: {
    forcedColors: false,
    compat: (selectors) => selectors.some((s) => s === ":root" || s === "@theme"),
    v2: (selectors) => selectors.some((s) => s === ".ckb-v2.ckb-v2"),
  },
  dark: {
    forcedColors: false,
    compat: (selectors) => selectors.some((s) => s === ".dark"),
    v2: (selectors) => selectors.some((s) => s === ".dark .ckb-v2.ckb-v2" || s === ".ckb-v2.dark.ckb-v2"),
  },
  // Forced colours (Windows High Contrast) is a third theme both files declare, and
  // the same specificity trap applies there. It went unmonitored until 2026-09-01,
  // and four roles were already silently dead in it.
  forcedColors: {
    forcedColors: true,
    compat: (selectors) => selectors.some((s) => s === ":root" || s === ".dark"),
    v2: (selectors) =>
      selectors.some((s) => s === ".ckb-v2.ckb-v2" || s === ".dark .ckb-v2.ckb-v2" || s === ".ckb-v2.dark.ckb-v2"),
  },
};

/**
 * Declarations for one theme, from blocks whose CONDITION matches that theme.
 *
 * The base themes take unconditional blocks only. An earlier version tested just
 * `/forced-colors/`, which let any OTHER `@media` block into the base map, where a
 * later responsive override silently replaced the base value — `globals.css` has
 * three such `:root` blocks today (`--mode-home-copy-reserve` twice,
 * `--spacing-mode-home-composer-wide` once). Comparing a narrow-viewport override
 * against an unconditional v2 declaration is comparing two different contexts, and
 * it reports identical when they diverge everywhere the condition does not apply.
 *
 * Conditional non-forced-colors blocks are therefore excluded rather than merged.
 * That is the conservative direction: a token declared ONLY under such a condition
 * goes uncompared instead of being compared wrongly. `unconditionalOnly` is not a
 * synonym for "no media" in the forced-colours case, which is itself a condition and
 * is modelled as its own theme.
 */
function collect(blocks, matches, wantForcedColors) {
  const map = new Map();
  for (const block of blocks) {
    const inForcedColors = /forced-colors/.test(block.media);
    if (wantForcedColors) {
      if (!inForcedColors) continue;
    } else if (block.media !== "") {
      continue;
    }
    if (!matches(block.selectors)) continue;
    for (const [name, value] of declarations(block.body)) map.set(name, value);
  }
  return map;
}

/**
 * Both layers, per theme. An empty map for any side is a hard error rather than a
 * quiet "no divergence": an empty comparison would pass loudly-green.
 *
 * @typedef {{ compat: Map<string, string>, v2: Map<string, string> }} LayerPair
 * @returns {Record<string, LayerPair>} keyed by the theme names in `THEMES`
 */
export function readLayers() {
  const globalsBlocks = ruleBlocks(readFileSync(GLOBALS, "utf8"));
  const v2Blocks = ruleBlocks(readFileSync(V2, "utf8"));
  // Tailwind's `@theme` is an at-rule by syntax but declares tokens like `:root`.
  const themeBlock = readFileSync(GLOBALS, "utf8").match(/@theme\s*\{([\s\S]*?)\n\}/);
  /** @type {Record<string, LayerPair>} */
  const out = {};
  for (const [theme, spec] of Object.entries(THEMES)) {
    const compat = collect(globalsBlocks, spec.compat, spec.forcedColors);
    if (theme === "light" && themeBlock) {
      // `:root` follows `@theme` in source order, so `:root` overlays it.
      const merged = declarations(themeBlock[1]);
      for (const [name, value] of compat) merged.set(name, value);
      out[theme] = { compat: merged, v2: collect(v2Blocks, spec.v2, spec.forcedColors) };
    } else {
      out[theme] = { compat, v2: collect(v2Blocks, spec.v2, spec.forcedColors) };
    }
    if (out[theme].compat.size === 0)
      throw new Error(`globals.css declares no ${theme} tokens — parser or file changed`);
    if (out[theme].v2.size === 0)
      throw new Error(`ckb-v2-tokens.css declares no ${theme} tokens — parser or file changed`);
  }
  return out;
}

/**
 * `{ <theme>: { "--surface": { compat, v2 } } }` for every role both layers declare
 * whose RESOLVED value differs. Resolution matters in both directions: identical
 * alias text over a diverging alias is a real divergence, and different text that
 * resolves to the same value is not one.
 */
export function computeDivergences() {
  const layers = readLayers();
  const result = {};
  for (const [theme, { compat, v2 }] of Object.entries(layers)) {
    const diverging = {};
    for (const [name, compatValue] of compat) {
      if (!v2.has(name)) continue;
      const v2Value = v2.get(name);
      if (resolveValue(compat, compatValue) === resolveValue(v2, v2Value)) continue;
      diverging[name] = { compat: compatValue, v2: v2Value };
    }
    result[theme] = Object.fromEntries(
      Object.keys(diverging)
        .sort()
        .map((key) => [key, diverging[key]]),
    );
  }
  return result;
}

export function readPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function writePin(divergences) {
  const payload = {
    $comment:
      "Roles declared in BOTH globals.css and ckb-v2-tokens.css with different values. " +
      "The v2 value paints; the globals.css value is dead. Reviewed set — refresh with " +
      "`npm run design-system:token-divergence:update` and say in the PR why each change is right.",
    generatedBy: "scripts/token-layer-divergences.mjs",
    counts: Object.fromEntries(Object.entries(divergences).map(([theme, roles]) => [theme, Object.keys(roles).length])),
    divergences,
  };
  writeFileSync(PIN_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

/** Human-readable drift between the pinned set and the stylesheets, or []. */
export function diffAgainstPin(divergences = computeDivergences(), pin = readPin()) {
  const problems = [];
  const derivedCounts = Object.fromEntries(
    Object.entries(pin.divergences ?? {}).map(([theme, roles]) => [theme, Object.keys(roles).length]),
  );
  const pinCounts = pin.counts ?? {};
  for (const theme of new Set([...Object.keys(derivedCounts), ...Object.keys(pinCounts)])) {
    if (pinCounts[theme] !== derivedCounts[theme]) {
      problems.push(
        `counts.${theme} is ${JSON.stringify(pinCounts[theme])} but divergences.${theme} has ${derivedCounts[theme] ?? 0} roles; refresh the pin so counts match.`,
      );
    }
  }
  for (const theme of Object.keys(divergences)) {
    const actual = divergences[theme];
    const pinned = pin.divergences?.[theme] ?? {};
    for (const name of Object.keys(actual)) {
      if (!(name in pinned)) {
        problems.push(
          `${theme}: ${name} newly diverges (globals.css "${actual[name].compat}" vs v2 "${actual[name].v2}"). ` +
            `The v2 value paints, so the globals.css edit does nothing. Change both together, or pin it deliberately.`,
        );
        continue;
      }
      if (pinned[name].v2 !== actual[name].v2 || pinned[name].compat !== actual[name].compat) {
        problems.push(`${theme}: ${name} still diverges but its values changed; re-review and refresh the pin.`);
      }
    }
    for (const name of Object.keys(pinned)) {
      if (!(name in actual)) {
        problems.push(`${theme}: ${name} no longer diverges — remove it from the pin so the count keeps falling.`);
      }
    }
  }
  return problems;
}

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) {
  const divergences = computeDivergences();
  const counts = Object.entries(divergences)
    .map(([theme, roles]) => `${theme} ${Object.keys(roles).length}`)
    .join("; ");
  if (process.argv.includes("--write")) {
    writePin(divergences);
    console.log(`Token-layer divergence pin written (${counts}).`);
  } else {
    const problems = diffAgainstPin(divergences);
    if (problems.length > 0) {
      console.error("Token-layer divergence pin is out of date:");
      for (const problem of problems) console.error(`  - ${problem}`);
      console.error("\nRefresh with: npm run design-system:token-divergence:update");
      process.exit(1);
    }
    console.log(`Token-layer divergence pin matches (${counts}).`);
  }
}
