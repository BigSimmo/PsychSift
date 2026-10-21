import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { listLedgerPaths, lookupFilesLine, parseFlags } from "../scripts/branch-review-ledger.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repositoryRoot, "scripts", "branch-review-ledger.mjs");

function lookup(args: string[]) {
  return execFileSync(process.execPath, [script, "lookup", "HEAD", ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

// Every reviewer runs `ledger:lookup` before a review; it must not cost 60 KB of context
// listing every content-addressed record path ahead of the verdict.
describe("ledger:lookup output size", () => {
  it("summarises the sources as counts unless --verbose is passed", () => {
    const sources = [
      "docs/branch-review-ledger.md",
      "docs/archive/branch-review-ledger-2026-q3.md",
      "docs/archive/branch-review-records/aaaa.record.md",
      "docs/archive/branch-review-records/bbbb.record.md",
    ];
    expect(lookupFilesLine(sources)).toBe(
      "files: 2 ledger table(s) + 2 immutable record(s) (pass --verbose to list them)",
    );
    expect(lookupFilesLine(sources, { verbose: true })).toBe(`files: ${sources.join(", ")}`);
    expect(parseFlags(["main", "--verbose", "--scope", "x"]).flags).toMatchObject({ verbose: true, scope: "x" });
  });

  it("keeps every lookup line short by default and still prints the verdict last", () => {
    const output = lookup([]);
    const lines = output.trimEnd().split("\n");
    for (const line of lines) expect(line.length, line.slice(0, 80)).toBeLessThan(400);
    expect(lines.find((line) => line.startsWith("files:"))).toMatch(
      /^files: \d+ ledger table\(s\) \+ \d+ immutable record\(s\)/,
    );
    expect(output).toMatch(/ALREADY REVIEWED|NOT REVIEWED at this HEAD\./);
  });

  it("lists every source path only with --verbose, and always in --json", () => {
    const sources = listLedgerPaths();
    expect(sources.length).toBeGreaterThan(0);
    const verbose = lookup(["--verbose"]);
    const filesLine = verbose.split("\n").find((line) => line.startsWith("files:")) ?? "";
    for (const source of sources) expect(filesLine).toContain(source);
    const json = JSON.parse(lookup(["--json"])) as { sources: string[] };
    expect(json.sources).toEqual(sources);
  });
});
