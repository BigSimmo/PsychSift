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
const RAW_PATTERN = "pathToFileURL(process.argv[1])";

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
]);

function scriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : scriptFiles(full);
    return /\.(?:ts|mjs)$/.test(entry.name) ? [full] : [];
  });
}

const rawUsers = scriptFiles(path.join(root, "scripts"))
  .filter((file) => readFileSync(file, "utf8").includes(RAW_PATTERN))
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
