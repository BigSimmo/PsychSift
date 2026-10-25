import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_NODE_OPTIONS, nextBuildArguments, nextBuildEnvironment } from "../scripts/run-next-build.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

describe("cross-platform next build step (#NM9S1V)", () => {
  it("defaults NODE_OPTIONS to the 8 GiB heap when it is unset or empty", () => {
    expect(DEFAULT_NODE_OPTIONS).toBe("--max-old-space-size=8192");
    expect(nextBuildEnvironment({}).NODE_OPTIONS).toBe("--max-old-space-size=8192");
    expect(nextBuildEnvironment({ NODE_OPTIONS: "" }).NODE_OPTIONS).toBe("--max-old-space-size=8192");
  });

  it("keeps an existing NODE_OPTIONS exactly, as the POSIX default expansion did", () => {
    const env = nextBuildEnvironment({ NODE_OPTIONS: "--max-old-space-size=6144", PATH: "/bin" });
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=6144");
    expect(env.PATH).toBe("/bin");
  });

  it("runs next build --webpack under the same 8 GiB parent heap flag", () => {
    const root = path.join("repo", "root");
    expect(nextBuildArguments(root)).toEqual([
      "--max-old-space-size=8192",
      path.join(root, "node_modules", "next", "dist", "bin", "next"),
      "build",
      "--webpack",
    ]);
  });

  it("keeps POSIX-only inline environment assignments out of the build scripts", () => {
    const build = packageJson.scripts["build:internal"];
    expect(build).toContain("node scripts/run-next-build.mjs");
    expect(build).not.toMatch(/NODE_OPTIONS=/);
    expect(build).not.toContain("${");
  });
});
