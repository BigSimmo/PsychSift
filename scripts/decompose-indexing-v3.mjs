import fs from "fs";

const indexFile = "supabase/functions/indexing-v3-agent/index.ts";
const utilsFile = "supabase/functions/indexing-v3-agent/utils.ts";

// One-shot and already applied: a second run would overwrite utils.ts with only a header and
// add a duplicate import block to index.ts, breaking the edge function.
if (fs.existsSync(utilsFile)) {
  console.error(
    `decompose-indexing-v3: ${utilsFile} already exists; the decomposition has been applied. Refusing to rewrite it.`,
  );
  process.exit(1);
}

let content = fs.readFileSync(indexFile, "utf-8");

const utilsToExtract = [
  "normalizeText",
  "tokenize",
  "safeRecord",
  "compactString",
  "uniqueStrings",
  "structuredProfileFromMetadata",
  "stringArrayFrom",
  "textItemsFrom",
  "sourceRegionsFromMetadata",
  "isLowQualityLabel",
  "phraseLabelCandidates",
  "sha256Hex",
  "sleep",
  "normalizeLabel",
  "normalizeLabelCandidate",
  "canonicalUnitType",
  "canonicalFieldType",
];

let utilsContent = `// Extracted utilities for indexing-v3-agent\n\n`;

const regexesToExtract = ["LABEL_STOPWORDS", "GENERIC_LABELS", "CLINICAL_PHRASE_PATTERN"];

let modifiedContent = content;

for (const constName of regexesToExtract) {
  // Match Set(...) consts and multiline regex literals. Avoid `[\s\S]*?;` for
  // regexes: character classes like `[\s:/-]` can confuse naive scanners, and a
  // `/.../gi;` body must be taken as a whole.
  const patterns = [
    new RegExp(`const ${constName} = new Set\\([\\s\\S]*?\\]\\);\\n+`),
    new RegExp(`const ${constName} =\\s*\\n\\s*/[\\s\\S]*?/gi;\\n+`),
    new RegExp(`const ${constName} = [\\s\\S]*?;\\n+`),
  ];
  let matched = false;
  for (const r of patterns) {
    const match = modifiedContent.match(r);
    if (!match) continue;
    utilsContent += `export ` + match[0] + "\n";
    modifiedContent = modifiedContent.replace(r, "");
    matched = true;
    break;
  }
  if (!matched) {
    console.warn(`decompose-indexing-v3: did not extract ${constName}`);
  }
}

for (const fn of utilsToExtract) {
  const r = new RegExp(`(async )?function ${fn}\\([\\s\\S]*?\\n}\\n+`, "g");
  const match = modifiedContent.match(r);
  if (match) {
    // Prefer the async form first. Replacing bare `function` before `async function`
    // yields invalid `async export function` syntax.
    let replaced = match[0];
    if (replaced.startsWith(`async function ${fn}(`)) {
      replaced = replaced.replace(`async function ${fn}(`, `export async function ${fn}(`);
    } else {
      replaced = replaced.replace(`function ${fn}(`, `export function ${fn}(`);
    }
    utilsContent += replaced + "\n";
    modifiedContent = modifiedContent.replace(r, "");
  }
}

const imports = `import {
  ${utilsToExtract.join(",\n  ")}
} from "./utils.ts";\n`;

modifiedContent = modifiedContent.replace(
  'import postgres from "npm:postgres@3.4.7";',
  `import postgres from "npm:postgres@3.4.7";\n` + imports,
);

fs.writeFileSync(utilsFile, utilsContent);
fs.writeFileSync(indexFile, modifiedContent);

console.log("Decomposed into utils.ts");
