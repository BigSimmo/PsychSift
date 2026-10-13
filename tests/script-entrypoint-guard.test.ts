import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * A script that starts itself with `import.meta.url === pathToFileURL(process.argv[1]).href`
 * can exit 0 having done nothing on Windows, where the two sides name the same file
 * differently (drive-letter case, directory junctions, how the launcher passes the path).
 * `isDirectEntrypoint` compares real paths and is the one supported way to decide this.
 * probe-answer-timing.mjs (#7CJGY6) and build-offline-pack.ts, whose check then passed
 * without checking anything, were both caught by it.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Any pathToFileURL(...) call whose argument involves process.argv[1], including wrapped forms such as
// pathToFileURL(path.resolve(process.argv[1])) or pathToFileURL(process.argv[1] ?? ""): all of them
// compare a path the launcher spelled one way with a URL spelled another.
const RAW_PATTERN = /pathToFileURL\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*process\.argv\[1\]/;
// The same mistake built by hand: `file://${process.argv[1]}`, bare or inside new URL(...). On Windows argv
// carries backslashes and a drive letter, so the URL it builds never equals import.meta.url.
const TEMPLATE_PATTERN = /file:\/\/\$\{process\.argv\[1\]\}/;

function usesRawComparison(source: string): boolean {
  if (RAW_PATTERN.test(source)) return true;
  // Comment lines that quote the bad form to warn against it do not count.
  return source.split("\n").some((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line) && TEMPLATE_PATTERN.test(line));
}

// Files that may keep the raw comparison, each with the reason. Remove an entry when the file is
// converted; the second test below fails if an entry no longer needs to be here.
const ALLOWED_RAW = new Map<string, string>([
  [
    "scripts/eval-retrieval.ts",
    "Protected retrieval-ranking tooling (pr-policy ragRankingPatterns): converting it needs owner approval and a RAG impact line.",
  ],
  [
    "scripts/build-ranking-snapshot.ts",
    "Protected retrieval-ranking tooling (pr-policy ragRankingPatterns): converting it needs owner approval and a RAG impact line.",
  ],
  [
    "scripts/sync-open-pr-branches.mjs",
    "Already falls back to an endsWith match on both of its file names, so it still runs on Windows.",
  ],
  [
    "scripts/check-live-deployment-freshness.mjs",
    "Runs from a two-file sparse checkout in live-domain-monitor.yml (Linux only), so it cannot import scripts/lib/is-entrypoint.mjs.",
  ],
  [
    "scripts/check-live-search-results.mjs",
    "Runs from a two-file sparse checkout in live-domain-monitor.yml (Linux only), so it cannot import scripts/lib/is-entrypoint.mjs.",
  ],
  [
    "scripts/check-coverage-inventory.mjs",
    "Keeps the file:// comparison but also falls back to an endsWith match on its own file name, so it still runs on Windows.",
  ],
  [
    "scripts/check-lighthouse-budget.mjs",
    "Keeps the file:// comparison but also falls back to an endsWith match on its own file name, so it still runs on Windows.",
  ],
  [
    "scripts/summarise-web-vitals.mjs",
    "Keeps the file:// comparison but also falls back to an endsWith match on its own file name, so it still runs on Windows.",
  ],
  [
    "scripts/verify-locality-metadata.ts",
    "Keeps the file:// comparison but also falls back to an endsWith match on its own file name, so it still runs on Windows.",
  ],
]);

function scriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : scriptFiles(full);
    return /\.(?:ts|mjs)$/.test(entry.name) ? [full] : [];
  });
}

const rawUsers = scriptFiles(path.join(root, "scripts"))
  .filter((file) => usesRawComparison(readFileSync(file, "utf8")))
  .map((file) => path.relative(root, file).split(path.sep).join("/"))
  .sort();

describe("script entrypoint guard", () => {
  it("does not let a script start itself with the raw pathToFileURL comparison", () => {
    const unexpected = rawUsers.filter((file) => !ALLOWED_RAW.has(file));
    expect(
      unexpected,
      `Use isDirectEntrypoint(import.meta.url) from scripts/lib/is-entrypoint.mjs in: ${unexpected.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the allow-list honest: every entry still uses the raw comparison", () => {
    const stale = [...ALLOWED_RAW.keys()].filter((file) => !rawUsers.includes(file));
    expect(stale, `Remove from ALLOWED_RAW (already converted): ${stale.join(", ")}`).toEqual([]);
  });
});

describe("isDirectEntrypoint", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "entrypoint-guard-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  const helperUrl = new URL("../scripts/lib/is-entrypoint.mjs", import.meta.url).href;
  const script = path.join(dir, "probe.mjs");
  writeFileSync(
    script,
    `import { isDirectEntrypoint } from ${JSON.stringify(helperUrl)};\nconsole.log(isDirectEntrypoint(import.meta.url) ? "RAN" : "SKIPPED");\n`,
  );

  it("runs when the script is the entrypoint", () => {
    expect(execFileSync(process.execPath, [script], { encoding: "utf8" }).trim()).toBe("RAN");
  });

  // Creating a symlink on Windows needs a privilege many accounts lack; the other cases still run there.
  const link = path.join(dir, "linked.mjs");
  let canLink = true;
  try {
    symlinkSync(script, link);
  } catch {
    canLink = false;
  }

  it.skipIf(!canLink)(
    "still runs when started through a link to the script, as with a Windows directory junction",
    () => {
      expect(execFileSync(process.execPath, [link], { encoding: "utf8" }).trim()).toBe("RAN");
    },
  );

  it("does not run when the script is only imported", () => {
    const importer = path.join(dir, "importer.mjs");
    writeFileSync(importer, `import ${JSON.stringify(pathToFileURL(script).href)};\nconsole.log("IMPORTED");\n`);
    const out = execFileSync(process.execPath, [importer], { encoding: "utf8" }).trim().split("\n");
    expect(out).toEqual(["SKIPPED", "IMPORTED"]);
  });
});
