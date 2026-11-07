#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const projectRoot = process.cwd();
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".md", ".svg", ".txt", ".xml"]);
const forbiddenMarkers = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "OPENAI_SAFETY_IDENTIFIER_SECRET",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT_ID",
  "RAG_QUERY_HASH_SECRET",
  // Match an actual secret *value* (prefix + a long token), not the bare "sb_secret_"
  // prefix string. @supabase/supabase-js's own browser client code legitimately ships
  // that literal prefix (isNewApiKey()/checkApiKeyFormat() in its fetch helpers, used to
  // detect new-format Supabase API keys) — that string alone is not a leaked secret.
  /\bsb_secret_[A-Za-z0-9_-]{20,}\b/,
  "sk-proj-",
  "sk-svcacct-",
];

function textFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && textExtensions.has(extname(entry.name).toLowerCase())) {
        files.push(entryPath);
      }
    }
  }

  visit(root);
  return files;
}

const publicRoot = join(projectRoot, "public");
const requestedDistDir = process.env.NEXT_DIST_DIR?.trim();
// Match next.config.ts: a selected isolated build must never fall back to a different
// successful .next build, or the marker check could inspect unrelated/stale artifacts.
if (requestedDistDir && !/^\.next-playwright\/[a-z0-9-]+\/dist$/i.test(requestedDistDir)) {
  console.error("NEXT_DIST_DIR must be an owned .next-playwright/<run-id>/dist directory.");
  process.exit(1);
}
const distDir = requestedDistDir || ".next";
const clientBuildRoot = join(projectRoot, distDir, "static");

if (!existsSync(clientBuildRoot)) {
  console.error(`Client bundle secret surface check requires ${distDir}/static. Run it after next build.`);
  process.exit(1);
}

// Mask a matched secret *value* so the full token never reaches CI logs. Keeps a
// short, non-sensitive prefix for context and reveals only its length.
function maskSecret(value) {
  const visiblePrefix = value.slice(0, 10);
  return `${visiblePrefix}…[redacted, ${value.length} chars]`;
}

const offenders = new Map();
for (const file of [...textFiles(publicRoot), ...textFiles(clientBuildRoot)]) {
  const content = readFileSync(file, "utf8");
  for (const marker of forbiddenMarkers) {
    // For literal markers the matched text is the constant marker name (safe to log). For
    // regex markers it is the actual matched secret value, which must be masked before logging.
    const isRegexMarker = marker instanceof RegExp;
    const matchedText = isRegexMarker ? content.match(marker)?.[0] : content.includes(marker) ? marker : null;
    if (matchedText) {
      const relativePath = relative(projectRoot, file).replaceAll("\\", "/");
      const displayMarker = isRegexMarker ? maskSecret(matchedText) : matchedText;
      // Dedupe on the raw matched value so distinct secrets in one file are all reported,
      // but only ever store/log the masked placeholder.
      offenders.set(`${relativePath}\0${matchedText}`, { marker: displayMarker, relativePath });
    }
  }
}

if (offenders.size > 0) {
  console.error("Client bundle secret surface check failed:");
  for (const { marker, relativePath } of [...offenders.values()].sort((a, b) => {
    return a.relativePath.localeCompare(b.relativePath) || a.marker.localeCompare(b.marker);
  })) {
    console.error(`- ${relativePath}: ${marker}`);
  }
  process.exit(1);
}

console.log("Client bundle secret surface check passed.");
