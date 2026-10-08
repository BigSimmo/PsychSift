/**
 * Pure helpers behind `build-calls.mjs`: they turn captured screens (see `capture.mjs`) into the text of
 * Figma `use_figma` calls. Nothing here reads files, starts servers or talks to any service, so it can be
 * tested with small in-memory fixtures (tests/figma-sync-calls.test.ts).
 *
 * The numeric helpers copy Python's rounding and float printing on purpose. This code replaced a Python
 * tool, and the call files it writes were checked byte for byte against that tool's output.
 */
import { transformSync } from "esbuild";

/** One `use_figma` call may carry at most this many characters of code. */
export const CALL_CHAR_LIMIT = 50000;
/** Soft size for one batch of data (icons or sections) so the builder code still fits under the limit. */
export const DATA_CHUNK_CHARS = 38000;
/** Vertical gap between sections on a page, and the extra room a section keeps under its tallest frame. */
const SECTION_GAP = 160;
const SECTION_PADDING = 200;

/** Figma page for each captured area, and the Live · Area variable mode its colours come from. */
export const AREAS = {
  "my-day": ["7:5", "My Day"],
  notifications: ["7:6", "My Day"],
  roster: ["7:7", "Roster"],
  "open-shifts": ["7:8", "Roster"],
  manage: ["7:9", "Roster"],
  "on-call": ["7:10", "On Call"],
  teaching: ["7:11", "Teaching"],
  assessments: ["7:12", "Teaching"],
  cpd: ["7:13", "CPD"],
  admin: ["7:14", "Admin"],
};
/** Header and navigation overlays all live on one Figma page ("chrome"), each in the mode it was captured in. */
export const CHROME_PAGE = "7:4";
export const CHROME_MODE = {
  "side-menu": "My Day",
  "more-sheet": "Roster",
  "ai-search": "My Day",
  "mode-picker": "My Day",
  rail: "Roster",
};
/** Every Figma page `--swap all` visits (the Icons and Components pages are never swapped). */
export const SWAP_PAGES = [CHROME_PAGE, ...new Set(Object.values(AREAS).map(([page]) => page))];

// ---------------------------------------------------------------------------------------------
// Python-compatible numbers and JSON
// ---------------------------------------------------------------------------------------------

/** Python's round(x): halves go to the even integer. */
export function pyRound(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Python's round(x, digits) for small digit counts: exact ties go to the even digit. */
export function pyRoundDigits(x, digits) {
  const scaled = x * 2 ** (digits + 1);
  // A tie is a value that is exactly halfway between two results, which only happens for these binary fractions.
  if (Number.isInteger(scaled) && Math.abs(scaled) % 2 === 1) {
    const factor = 10 ** digits;
    const floor = Math.floor(x * factor);
    return (floor % 2 === 0 ? floor : floor + 1) / factor;
  }
  return Number(x.toFixed(digits));
}

/** Python's str(float): whole numbers keep one decimal place ("3.0"). */
export function pyFloatString(value) {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

/** Number of characters as Python's len() counts them (code points, not UTF-16 units). */
export function codePointLength(text) {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
}

/** JSON with only ASCII characters, the way Python's json.dumps writes it by default. */
export function jsonAscii(value) {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** JSON with object keys in sorted order, used to tell whether two styles are the same. */
function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${sortedJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------------------------

/** Make a captured SVG smaller: round long numbers, drop attributes that are the Figma default. */
export function shrinkSvg(markup) {
  let mk = markup.replace(/(\d+\.\d{3,})/g, (found) => pyFloatString(pyRoundDigits(Number.parseFloat(found), 2)));
  const root = /^<svg[^>]*>/.exec(mk)?.[0];
  if (!root) throw new Error(`Icon markup does not start with an <svg> tag: ${markup.slice(0, 80)}`);
  if (root.includes('stroke="currentColor"')) {
    const newRoot = root
      .replaceAll('stroke="currentColor"', 'stroke="#000000"')
      .replaceAll('fill="currentColor"', 'fill="#000000"');
    mk = newRoot + mk.slice(root.length);
    let body = mk.slice(newRoot.length);
    for (const attribute of ['stroke="#000000"', 'stroke-linecap="round"', 'stroke-linejoin="round"']) {
      if (newRoot.includes(attribute)) body = body.replaceAll(` ${attribute}`, "");
    }
    const strokeWidth = /stroke-width="([\d.]+)"/.exec(newRoot);
    if (strokeWidth) body = body.replaceAll(` stroke-width="${strokeWidth[1]}px"`, "");
    if (newRoot.includes('fill="none"')) body = body.replaceAll(' fill="none"', "");
    mk = newRoot + body;
  }
  mk = mk.replace(/ data-[a-z-]+="[^"]*"/g, "");
  mk = mk.replaceAll(' aria-hidden="true"', "");
  mk = mk.replace(/><\/(path|rect|line|circle|polyline|polygon|ellipse)>/g, "/>");
  return mk;
}

/**
 * Give every distinct icon one stable name across all captures.
 *
 * `previous` captures are read first, so an icon that already exists in Figma keeps its old name, and
 * `icons` lists only the icons the current captures add. Entries are `{ file, data }`.
 */
export function buildIconRegistry(current, previous = []) {
  const registry = new Map(); // shrunk markup -> icon name
  const names = new Set();
  const perFile = new Map(); // entry -> { captured key -> icon name }
  for (const entry of [...previous, ...current]) {
    const mapping = {};
    for (const [key, value] of Object.entries(entry.data.svgs ?? {})) {
      const markup = shrinkSvg(value.m);
      if (!registry.has(markup)) {
        const base = key.replace(/(-\d+)+$/, "");
        const width = /width="([\d.]+)"/.exec(markup);
        const size = width ? pyRound(Number.parseFloat(width[1])) : 0;
        let name = `${base}-${size}`;
        let suffix = 2;
        while (names.has(name)) {
          name = `${base}-${size}-${suffix}`;
          suffix += 1;
        }
        names.add(name);
        registry.set(markup, name);
      }
      mapping[key] = registry.get(markup);
    }
    perFile.set(entry, mapping);
  }
  const alreadyInFigma = new Set();
  for (const entry of previous) for (const name of Object.values(perFile.get(entry))) alreadyInFigma.add(name);
  /** @type {[string, string][]} */
  const icons = [...registry.entries()]
    .map(([markup, name]) => /** @type {[string, string]} */ ([name, markup]))
    .filter(([name]) => !alreadyInFigma.has(name))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return { icons, perFile };
}

/** The Figma-runtime code that turns a list `I` of [name, svg] pairs into icon components (skips existing). */
export const ICON_CALL_HEAD = `const P=await figma.getNodeByIdAsync('7:3');await figma.setCurrentPageAsync(P);
let box=P.children.find(n=>n.name==='Icons from main');
if(!box){box=figma.createAutoLayout('HORIZONTAL',{name:'Icons from main',itemSpacing:24,counterAxisSpacing:24});box.layoutWrap='WRAP';box.resize(1600,100);box.primaryAxisSizingMode='FIXED';box.counterAxisSizingMode='AUTO';box.paddingLeft=box.paddingRight=box.paddingTop=box.paddingBottom=40;box.fills=[];box.x=0;box.y=0;}
const have=new Set(box.children.map(c=>c.name));const made=[],bad=[];
for(const [k,m] of I){if(have.has('icon/'+k))continue;try{const n=figma.createNodeFromSvg(m);const c=figma.createComponentFromNode(n);c.name='icon/'+k;c.fills=[];for(const q of c.findAll(()=>true))if('constraints' in q)q.constraints={horizontal:'SCALE',vertical:'SCALE'};box.appendChild(c);made.push(c.id);}catch(e){bad.push(k+': '+e.message);}}
return {made:made.length,bad,total:box.children.length};`;

/** Split icons into call files, each holding about DATA_CHUNK_CHARS of SVG. */
export function iconCalls(icons, chunkChars = DATA_CHUNK_CHARS) {
  const calls = [];
  let chunk = [];
  let size = 0;
  const flush = () => {
    if (!chunk.length) return;
    calls.push({
      name: `icons-${String(calls.length + 1).padStart(2, "0")}.js`,
      text: `const I=${jsonAscii(chunk)};\n${ICON_CALL_HEAD}`,
    });
    chunk = [];
    size = 0;
  };
  for (const [name, markup] of icons) {
    if (size + codePointLength(markup) > chunkChars) flush();
    chunk.push([name, markup]);
    size += codePointLength(markup) + codePointLength(name) + 6;
  }
  flush();
  return calls;
}

// ---------------------------------------------------------------------------------------------
// Compacting one captured screen
// ---------------------------------------------------------------------------------------------

/** Round a coordinate the way the old tool did: whole numbers when close, one decimal otherwise. */
function roundCoordinate(value) {
  return Math.abs(value - pyRound(value)) < 0.26 ? pyRound(value) : pyRoundDigits(value, 1);
}

/**
 * Squash one captured screen into shared tables (colours, box styles, text styles) plus a nested array of
 * nodes that point into them. `iconIds` maps a captured icon key to its index in the frame's icon list.
 * @param {any} capture
 * @param {Record<string, number>} iconIds
 * @param {number | null} [maxHeight]
 */
export function compactCapture(capture, iconIds, maxHeight = null) {
  const colors = [];
  const colorIndex = new Map();
  const styles = [];
  const styleIndex = new Map();
  const textStyles = [];
  const textIndex = new Map();

  const color = (hex) => {
    if (hex === null || hex === undefined) return -1;
    const lower = hex.toLowerCase();
    if (!colorIndex.has(lower)) {
      colorIndex.set(lower, colors.length);
      colors.push(lower);
    }
    return colorIndex.get(lower);
  };

  const boxStyle = (node) => {
    const style = {};
    if (node.bg) style.b = color(node.bg);
    if (node.gr && "st" in node.gr) {
      style.g = [node.gr.a, node.gr.st.map((stop) => [color(stop.c), pyRoundDigits(stop.p, 3)])];
    }
    if (node.bd) style.d = [color(node.bd.c), node.bd.w, ...(node.bd.d ? [1] : [])];
    if (node.br) style.r = node.br;
    const shadows = (node.sh ?? []).filter((shadow) => !shadow.i);
    if (shadows.length) style.s = Math.max(...shadows.map((shadow) => shadow.b)) > 4 ? 2 : 1;
    if (node.bl) style.l = node.bl;
    if (node.clip) style.k = 1;
    if (node.op) style.o = node.op;
    const key = sortedJson(style);
    if (!styleIndex.has(key)) {
      styleIndex.set(key, styles.length);
      styles.push(style);
    }
    return styleIndex.get(key);
  };

  const textStyle = (node) => {
    const key = [node.f, node.wt, node.mono ?? 0, node.lh ?? null, node.ls ?? 0, node.it ?? 0, node.ul ?? 0];
    const id = JSON.stringify(key);
    if (!textIndex.has(id)) {
      textIndex.set(id, textStyles.length);
      textStyles.push(key);
    }
    return textIndex.get(id);
  };

  const walk = (nodes) => {
    const out = [];
    for (const node of nodes) {
      const type = node.t;
      if (maxHeight && (node.y ?? 0) > maxHeight && type !== "g") continue;
      if (type === "x") {
        const flags = (node.wrap ? 1 : 0) | ({ c: 2, r: 4 }[node.al] ?? 0) | (node.el ? 8 : 0) | (node.vc ? 16 : 0);
        out.push([
          node.s,
          roundCoordinate(node.x),
          roundCoordinate(node.y),
          roundCoordinate(node.w),
          roundCoordinate(node.h),
          textStyle(node),
          color(node.c),
          flags,
        ]);
      } else if (type === "s") {
        if (!Object.hasOwn(iconIds, node.k)) continue;
        out.push([
          iconIds[node.k],
          roundCoordinate(node.x),
          roundCoordinate(node.y),
          roundCoordinate(node.w),
          roundCoordinate(node.h),
          color(node.c),
          ...(node.op ? [node.op] : []),
        ]);
      } else if (type === "i") {
        out.push([
          0,
          "img",
          roundCoordinate(node.x),
          roundCoordinate(node.y),
          roundCoordinate(node.w),
          roundCoordinate(node.h),
          0,
          [],
        ]);
      } else if (type === "g") {
        const kids = walk(node.ch);
        if (kids.length) out.push([node.n, kids]);
      } else if (type === "f") {
        out.push([
          1,
          node.n,
          roundCoordinate(node.x),
          roundCoordinate(node.y),
          roundCoordinate(node.w),
          roundCoordinate(node.h),
          boxStyle(node),
          walk(node.ch ?? []),
        ]);
      }
    }
    return out;
  };

  const tree = walk(capture.tree);
  return { c: colors, s: styles, t: textStyles, n: tree };
}

// ---------------------------------------------------------------------------------------------
// Figma-runtime scripts
// ---------------------------------------------------------------------------------------------

/**
 * Minify one of the `figma/*.mjs` functions into the text that runs inside Figma. Returns the minified body and
 * the name of its data parameter (`D`, `PAGE_ID`, or none). `figma` is a global inside Figma, so it stays as is.
 */
export function minifyFigmaFunction(fn) {
  const source = fn.toString();
  const signature = /^async\s+function\s*[\w$]*\s*\(\s*figma\s*(?:,\s*([\w$]+)\s*)?\)\s*\{/.exec(source);
  if (!signature) {
    throw new Error("A Figma script must be `export default async function name(figma[, DATA]) { ... }`.");
  }
  const body = source.slice(signature[0].length, source.lastIndexOf("}"));
  // Wrap in a function so top-level `return` and `await` parse; `figma` and the data name stay free, so esbuild keeps them.
  const result = transformSync(`async function __W(){\n${body}\n}`, { minify: true, target: "es2020" });
  const minified = result.code.trim();
  return {
    dataName: signature[1] ?? null,
    code: minified.slice(minified.indexOf("{") + 1, minified.lastIndexOf("}")),
  };
}

/** The call text for a Figma script: its data constant (when it takes one) followed by the minified body. */
export function figmaCallText(fn, dataValue) {
  const { dataName, code } = minifyFigmaFunction(fn);
  if (!dataName) return code;
  if (dataValue === undefined) throw new Error(`The Figma script needs a value for ${dataName}.`);
  return `const ${dataName}=${dataValue};\n${code}`;
}

/** `use_figma` call text for the Components page. */
export function componentsCallText(componentsFn) {
  return figmaCallText(componentsFn);
}

/** `use_figma` call text that swaps captured headers and tab bars on one page for component instances. */
export function swapCallText(swapFn, pageId) {
  if (!/^\d+:\d+$/.test(pageId)) throw new Error(`Not a Figma page id (expected something like 7:14): ${pageId}`);
  return figmaCallText(swapFn, JSON.stringify(pageId));
}

// ---------------------------------------------------------------------------------------------
// Planning the page calls
// ---------------------------------------------------------------------------------------------

function frameKind(width) {
  return width < 700 ? "Phone" : width < 1000 ? "Tablet" : "Desktop";
}

/** Split a capture file name `area--slug--width.json`; anything else is not a screen capture. */
function parseCaptureName(file) {
  if (!file.endsWith(".json")) return null;
  const parts = file.slice(0, -5).split("--");
  if (parts.length !== 3 || !/^\d+$/.test(parts[2])) return null;
  return { area: parts[0], slug: parts[1], width: Number(parts[2]) };
}

/**
 * Work out every `use_figma` call that draws the captured screens.
 *
 * - `jobs` is the screen list (`jobs.json`); it fixes the order of sections on each page. A job with no
 *   capture is skipped (and listed in `missing`).
 * - `current` / `previous` are `{ file, data }` entries; `previous` only keeps icon names stable.
 * - `yStart` maps a Figma page id to the lowest edge of what is already on it; new sections start below.
 * - `builderFn` is the default export of `figma/builder.mjs`.
 */
export function planPageCalls({
  jobs,
  current,
  previous = [],
  yStart = null,
  builderFn,
  chunkChars = DATA_CHUNK_CHARS,
}) {
  const { icons, perFile } = buildIconRegistry(current, previous);
  const builder = minifyFigmaFunction(builderFn);
  if (builder.dataName !== "D") throw new Error("The builder script must take its data as `D`.");

  const sections = [];
  const sectionKeys = new Set();
  for (const job of jobs) {
    const [area, slug, width] = job.id.split("--");
    if (width === undefined) throw new Error(`Job id must look like area--slug--width: ${job.id}`);
    const key = `${area}--${slug}`;
    if (sectionKeys.has(key)) continue;
    sectionKeys.add(key);
    sections.push({ area, slug, name: job.name });
  }

  const byScreen = new Map();
  for (const entry of current) {
    const parsed = parseCaptureName(entry.file);
    if (!parsed) continue;
    const key = `${parsed.area}--${parsed.slug}`;
    if (!byScreen.has(key)) byScreen.set(key, []);
    byScreen.get(key).push({ ...parsed, entry });
  }

  const missing = [];
  const groups = new Map(); // page -> [{ mode, name, frames }]
  for (const { area, slug, name } of sections) {
    const found = (byScreen.get(`${area}--${slug}`) ?? []).sort((a, b) => a.width - b.width);
    if (!found.length) {
      missing.push(`${area}--${slug}`);
      continue;
    }
    let page;
    let mode;
    if (area === "chrome") {
      page = CHROME_PAGE;
      mode = CHROME_MODE[slug];
      if (!mode)
        throw new Error(`No Figma mode is set for the chrome overlay "${slug}" (see CHROME_MODE in calls-lib.mjs).`);
    } else {
      if (!AREAS[area]) throw new Error(`No Figma page is set for the area "${area}" (see AREAS in calls-lib.mjs).`);
      [page, mode] = AREAS[area];
    }
    const frames = found.map(({ width, entry }) => {
      const mapping = perFile.get(entry);
      const used = [...new Set(Object.values(mapping))].sort();
      const iconIds = Object.fromEntries(Object.entries(mapping).map(([key, value]) => [key, used.indexOf(value)]));
      return {
        ...compactCapture(entry.data, iconIds, entry.data.h),
        label: `${name} · ${frameKind(width)} ${width}`,
        w: entry.data.w,
        h: entry.data.h,
        bg: entry.data.bg,
        i: used,
      };
    });
    if (!groups.has(page)) groups.set(page, []);
    groups.get(page).push({ mode, name, frames });
  }

  const pageCalls = [];
  // Pages this run does not draw keep their old bottom edge, so y-end.json stays a full --y-start.
  /** @type {Record<string, number>} */
  const yEnd = { ...(yStart ?? {}) };
  for (const [page, pageSections] of groups) {
    let y = yStart && page in yStart ? yStart[page] + SECTION_GAP : 0;
    const calls = [];
    let batch = [];
    let batchSize = 0;
    let batchMode = null;
    let batchY = 0;
    for (const { mode, name, frames } of pageSections) {
      const tallest = Math.max(...frames.map((frame) => frame.h));
      // A section too big for one call is split into one frame per call; later parts continue the same section.
      const parts = codePointLength(JSON.stringify(frames)) > chunkChars ? frames.map((frame) => [frame]) : [frames];
      parts.forEach((partFrames, partIndex) => {
        const section = { name, frames: partFrames, y, hmax: tallest };
        if (partIndex) section.cont = 1;
        const size = codePointLength(JSON.stringify(section));
        if (batch.length && (batchSize + size > chunkChars || mode !== batchMode)) {
          calls.push({ mode: batchMode, y0: batchY, sections: batch });
          batch = [];
          batchSize = 0;
        }
        if (!batch.length) {
          batchY = y;
          batchMode = mode;
        }
        batch.push(section);
        batchSize += size;
      });
      y += tallest + SECTION_PADDING + SECTION_GAP;
    }
    if (batch.length) calls.push({ mode: batchMode, y0: batchY, sections: batch });
    yEnd[page] = y - SECTION_GAP;
    calls.forEach((call, index) => {
      const data = { page, mode: call.mode, y0: call.y0, sections: call.sections };
      pageCalls.push({
        name: `page-${page.replace(":", "_")}-${index + 1}.js`,
        text: `const D=${JSON.stringify(data)};\n${builder.code}`,
        sections: call.sections.map((section) => section.name),
      });
    });
  }
  return { icons, iconCalls: iconCalls(icons, chunkChars), pageCalls, yEnd, missing };
}
