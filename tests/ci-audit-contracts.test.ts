import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

// Contracts pinned by the 2026-09-02 repository audit (package p8a: CI
// workflows and supply chain). Each block names the finding it closes so a
// later edit that reopens the gap fails with the audit's own reasoning.

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path: string) => existsSync(new URL(`../${path}`, import.meta.url));

// Folded in from the 2026-10-06 CI-efficiency handover and extended with #3313's main tree proof:
// the required aggregate demands a Lighthouse success exactly when its producer runs. The real
// aggregate shell is executed against the producer's own `if:` for every event, label, scope,
// draft, refresh and proof combination, so the two conditions cannot drift apart again.
describe("Lighthouse requirement matches its producer", () => {
  type Step = { name?: string; run?: string; env?: Record<string, string> };
  const ci = createRequire(import.meta.url)("js-yaml").load(read(".github/workflows/ci.yml")) as {
    jobs: Record<string, { if?: string; steps?: Step[] }>;
  };

  it("requires success whenever lighthouse-budget is expected to run, and accepts a skip only otherwise", () => {
    const aggregate = ci.jobs["pr-required"].steps?.find((step) => step.name === "Verify required in-scope jobs");
    if (!aggregate?.run || !aggregate.env) throw new Error("missing required aggregate script");
    const producer = String(ci.jobs["lighthouse-budget"].if).replaceAll(
      "labels.*.name",
      "labels.map((label) => label.name)",
    );
    const cases: Array<{ env: Record<string, string>; pass: boolean; label: string }> = [];
    for (const event of ["pull_request", "merge_group", "push", "schedule", "workflow_dispatch"]) {
      for (const perf of [false, true])
        for (const lock of [false, true])
          for (const draft of [false, true])
            for (const label of [false, true])
              for (const skip of [false, true])
                for (const refresh of [false, true])
                  for (const proven of [false, true]) {
                    // Drafts and labels exist only on PRs, the refresh input only on dispatch, and
                    // the tree proof only on main pushes and PR updates.
                    if ((draft || label || skip) && event !== "pull_request") continue;
                    if (refresh && event !== "workflow_dispatch") continue;
                    if (proven && event !== "push" && event !== "pull_request") continue;
                    const github = {
                      event_name: event,
                      event: {
                        pull_request:
                          event === "pull_request"
                            ? {
                                draft,
                                labels: [
                                  ...(label ? [{ name: "lighthouse-budget" }] : []),
                                  ...(skip ? [{ name: "skip-lighthouse-budget" }] : []),
                                ],
                              }
                            : { labels: [] },
                        inputs: event === "workflow_dispatch" ? { refresh_lighthouse_baseline: String(refresh) } : {},
                      },
                    };
                    const needs = {
                      changes: {
                        outputs: {
                          perf_changed: String(perf),
                          lockfile_changed: String(lock),
                          tree_proven_lighthouse: proven ? "true" : "",
                        },
                      },
                    };
                    const expected = Boolean(
                      Function(
                        "github",
                        "needs",
                        "contains",
                        `return (${producer});`,
                      )(github, needs, (values: string[], value: string) => values.includes(value)),
                    );
                    const env: Record<string, string> = {
                      EVENT_NAME: event,
                      PR_DRAFT: String(draft),
                      LIGHTHOUSE_LABEL: String(label),
                      SKIP_LIGHTHOUSE_LABEL: String(skip),
                      REFRESH_LIGHTHOUSE_BASELINE: event === "workflow_dispatch" ? String(refresh) : "",
                      PERF_CHANGED: String(perf),
                      LOCKFILE_CHANGED: String(lock),
                      TREE_PROVEN_LIGHTHOUSE: proven ? "true" : "",
                    };
                    for (const key of Object.keys(aggregate.env)) {
                      if (!(key in env))
                        env[key] = key.endsWith("_RESULT") ? "success" : key.startsWith("TREE_PROVEN_") ? "" : "false";
                    }
                    for (const result of ["success", "skipped", "failure", "cancelled"]) {
                      cases.push({
                        env: { ...env, LIGHTHOUSE_RESULT: result },
                        pass: result === "success" || (!expected && result === "skipped"),
                        label: `${event} perf=${perf} lock=${lock} draft=${draft} label=${label} skip=${skip} refresh=${refresh} proven=${proven} result=${result}`,
                      });
                    }
                  }
    }
    const input = cases
      .map((testCase, index) => {
        const assignments = Object.entries(testCase.env)
          .map(([key, value]) => `${key}='${value}'`)
          .join("\n");
        return `(\n${assignments}\n${aggregate.run}\n) >/dev/null 2>&1\nprintf 'case:${index}:%s\\n' "$?"`;
      })
      .join("\n");
    const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
    const actual = spawnSync(shell, ["-s"], { input, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    expect(actual.error).toBeUndefined();
    const statuses = [...actual.stdout.matchAll(/^case:(\d+):(\d+)$/gm)];
    expect(statuses).toHaveLength(cases.length);
    for (const [, index, status] of statuses)
      expect(status === "0", cases[Number(index)].label).toBe(cases[Number(index)].pass);
    // The matrix really exercises the arms this change is about.
    expect(cases.some((testCase) => testCase.label.startsWith("schedule") && !testCase.pass)).toBe(true);
    expect(
      cases.some(
        (testCase) => /^push perf=false lock=true .*proven=false result=skipped/.test(testCase.label) && !testCase.pass,
      ),
    ).toBe(true);
    expect(cases.some((testCase) => /^push .*proven=true result=skipped/.test(testCase.label) && testCase.pass)).toBe(
      true,
    );
  }, 60_000);
});

/** The `- package-ecosystem: "<name>"` blocks of dependabot.yml, keyed by ecosystem + directory. */
function dependabotEntries(source: string) {
  const entries: Array<{ ecosystem: string; directory: string; body: string }> = [];
  const blocks = source.split(/\n(?=  - package-ecosystem:)/);
  for (const block of blocks) {
    const ecosystem = block.match(/package-ecosystem:\s*"([^"]+)"/)?.[1];
    const directory = block.match(/directory:\s*"([^"]+)"/)?.[1];
    if (ecosystem && directory) entries.push({ ecosystem, directory, body: block });
  }
  return entries;
}

describe("M20: the worker's Python parsing stack has a vulnerability signal", () => {
  const dependabot = read(".github/dependabot.yml");
  const entries = dependabotEntries(dependabot);

  it.each(["/worker/python", "/eval/docling"])("Dependabot watches the pip lock in %s", (directory) => {
    const entry = entries.find((candidate) => candidate.ecosystem === "pip" && candidate.directory === directory);
    expect(entry, `no pip ecosystem entry for ${directory}`).toBeDefined();
    // Both locks are hash-pinned by pip-compile; the entry must say how the
    // hashes are regenerated so a bump is not merged with a stale lock.
    expect(entry!.body).toMatch(/generate:worker-python-lock|check:worker-python-locks/);
  });

  it("keeps a hashed requirements lock at every pip directory Dependabot watches", () => {
    for (const entry of entries.filter((candidate) => candidate.ecosystem === "pip")) {
      const lock = `${entry.directory.replace(/^\//, "")}/requirements.txt`;
      expect(exists(lock), `${lock} missing`).toBe(true);
      expect(read(lock)).toContain("--hash=sha256:");
    }
  });

  it("reports HIGH/CRITICAL image findings where a person sees them", () => {
    const workflow = read(".github/workflows/docker-image.yml");
    const scanIndex = workflow.indexOf("Vulnerability scan (HIGH,CRITICAL)");
    expect(scanIndex).toBeGreaterThan(-1);
    const afterScan = workflow.slice(scanIndex);
    // The scan output is kept, summarised into the job summary, and the
    // follow-up step exits non-zero on HIGH/CRITICAL outside pull-request
    // runs so the scheduled/main run fails and is visible in the Actions tab.
    expect(afterScan).toContain("GITHUB_STEP_SUMMARY");
    expect(afterScan).toMatch(/Fail on HIGH\/CRITICAL image findings/);
    expect(afterScan).toMatch(/github\.event_name != 'pull_request'/);
    expect(afterScan).toMatch(/github\.event_name != 'merge_group'/);
    expect(afterScan).toMatch(/exit 1/);
  });
});

describe("M29: the live Web-Vitals default routes can produce a verdict", () => {
  const workflow = read(".github/workflows/live-web-vitals.yml");
  const defaultRoutes = workflow.match(/^\s+default:\s*"((?:\/[^"]*)?)"\s*$/m)?.[1];

  it("declares a default route list", () => {
    expect(defaultRoutes).toBeDefined();
    expect(defaultRoutes!.split(",").length).toBeGreaterThan(0);
  });

  // The summariser deliberately rejects a report whose final URL differs from
  // the requested URL, so a default entry that server-redirects (the retired
  // `/dsm`, `/forms`, `/therapy-compass` mode homes since #2157/#2308) can
  // never be graded. Every default route must therefore resolve to a page.tsx
  // that renders in place. `/` is the one route whose `redirect(` is guarded
  // by legacy query parameters (docs/site-map.md: "Main PsychSift shell"), so
  // its plain GET renders and it is exempt from the redirect check.
  it.each((defaultRoutes ?? "").split(","))("default route %s renders in place rather than redirecting", (route) => {
    const segment = route === "/" ? "" : route.replace(/^\//, "");
    const candidates = [`src/app/(search-app)/${segment}/page.tsx`, `src/app/${segment}/page.tsx`].map((path) =>
      path.replace("//", "/"),
    );
    const page = candidates.find((candidate) => exists(candidate));
    expect(page, `no page.tsx for ${route} (tried ${candidates.join(", ")})`).toBeDefined();
    if (route !== "/") {
      expect(read(page!)).not.toMatch(/\bredirect\(/);
    }
  });

  it("keeps the summariser's test fixture in step with the workflow default", () => {
    const fixture = read("tests/summarise-web-vitals.test.ts").match(/const DEFAULT_ROUTES = "([^"]+)"/)?.[1];
    expect(fixture).toBe(defaultRoutes);
  });

  it("no longer instructs recording the verdict against the closed #017 row", () => {
    expect(workflow).not.toMatch(/Record the verdict in docs\/outstanding-issues\.md against #017/);
  });
});

describe("L36: the advisory SAST workflow runs the same immutable Semgrep image as the blocking gate", () => {
  it("pins sast.yml's container to the digest ci.yml's ingestion gate uses", () => {
    const gateDigest = read(".github/workflows/ci.yml").match(/image: semgrep\/semgrep@(sha256:[0-9a-f]{64})/)?.[1];
    expect(gateDigest).toBeDefined();
    const advisory = read(".github/workflows/sast.yml").match(/^\s+image:\s*(\S+)\s*$/m)?.[1];
    expect(advisory).toBeDefined();
    // `tag@digest` keeps the human-readable version while the digest wins at
    // pull time; a bare mutable tag can be re-pushed upstream.
    expect(advisory).toMatch(/^semgrep\/semgrep(?::[0-9.]+)?@sha256:[0-9a-f]{64}$/);
    expect(advisory!.split("@")[1]).toBe(gateDigest);
  });
});

describe("L37: the Secret Scan workflow holds only the permission it uses", () => {
  it("grants contents: read and nothing else", () => {
    const workflow = read(".github/workflows/secret-scan.yml");
    const block = workflow.match(/^permissions:\n((?:  \S.*\n)+)/m)?.[1] ?? "";
    const grants = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // scripts/run-gitleaks-pinned.mjs never uploads SARIF or reads the PR API;
    // the wider grant was a leftover from gitleaks-action@v3.
    expect(grants).toEqual(["contents: read"]);
    expect(read("scripts/run-gitleaks-pinned.mjs")).not.toMatch(/--report-format|sarif/i);
  });
});

describe("L38: the @claude workflows enforce the collaborator boundary they describe", () => {
  const trusted = `contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)`;
  const trustedReview = `contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.review.author_association)`;

  it.each([".github/workflows/claude.yml"])("%s admits only owner, member or collaborator authors", (path) => {
    const workflow = read(path);
    const condition = workflow.match(/^    if: >\n((?:      .*\n)+)/m)?.[1] ?? "";
    expect(condition).toContain("issue_comment");
    // Every trigger arm carries its own association gate, so a read-only or
    // outside account that can comment cannot start a run that holds
    // write/id-token permissions.
    const arms = condition.split(/\)\s*\|\|\s*\n/);
    expect(arms.length).toBeGreaterThanOrEqual(3);
    for (const arm of arms) {
      expect(arm, `arm without an author_association gate:\n${arm}`).toMatch(
        arm.includes("pull_request_review'") && !arm.includes("review_comment")
          ? new RegExp(trustedReview.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          : new RegExp(trusted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
  });

  it("describes the enforced gate in the claude.yml header", () => {
    expect(read(".github/workflows/claude.yml")).toMatch(/owner, member or collaborator/i);
  });
});

describe("L54: every script a Dockerfile copies is a Railway watch pattern for that service", () => {
  const copiedScripts = (dockerfile: string) =>
    Array.from(new Set(Array.from(read(dockerfile).matchAll(/^COPY (scripts\/[\w.-]+) /gm), (match) => match[1])));

  it.each([
    ["Dockerfile", "railway.app.json"],
    ["Dockerfile.worker", "railway.worker.json"],
  ])("%s scripts are watched by %s", (dockerfile, railwayConfig) => {
    const watch = (JSON.parse(read(railwayConfig)) as { build: { watchPatterns: string[] } }).build.watchPatterns;
    const scripts = copiedScripts(dockerfile);
    expect(scripts.length).toBeGreaterThan(0);
    // A change to an image-build-time script alone must rebuild the image,
    // otherwise the deployed image runs a script version main no longer has.
    for (const script of scripts) {
      expect(watch, `${railwayConfig} does not watch ${script}`).toContain(`/${script}`);
    }
  });
});

describe("L55: allowScripts describes the install scripts the lock actually runs", () => {
  type LockPackage = { version?: string; hasInstallScript?: boolean; optional?: boolean };
  const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, LockPackage> };
  const manifest = JSON.parse(read("package.json")) as { allowScripts?: Record<string, boolean> };
  const allowScripts = manifest.allowScripts ?? {};
  const lockVersions = new Map<string, Set<string>>();
  for (const [path, entry] of Object.entries(lock.packages)) {
    const name = path.replace(/^.*node_modules\//, "");
    if (!path || !entry.version) continue;
    if (!lockVersions.has(name)) lockVersions.set(name, new Set());
    lockVersions.get(name)!.add(entry.version);
  }

  it("names only name@version pairs that exist in package-lock.json", () => {
    for (const key of Object.keys(allowScripts)) {
      const at = key.lastIndexOf("@");
      const name = key.slice(0, at);
      const version = key.slice(at + 1);
      expect(lockVersions.get(name), `${key}: ${name} is not in the lock`).toBeDefined();
      expect(Array.from(lockVersions.get(name)!), `${key}: lock has a different version`).toContain(version);
    }
  });

  it("covers every non-optional package whose install script npm will run", () => {
    // Optional packages are platform-gated (fsevents on darwin) and never
    // install on the Linux CI and Railway paths this policy protects.
    const uncovered = Object.entries(lock.packages)
      .filter(([path, entry]) => path !== "" && entry.hasInstallScript && !entry.optional)
      .map(([path, entry]) => `${path.replace(/^.*node_modules\//, "")}@${entry.version}`)
      .filter((key) => allowScripts[key] !== true);
    expect(uncovered).toEqual([]);
  });
});

describe("L91: every CODEOWNERS pattern matches something in the tree", () => {
  const patterns = read(".github/CODEOWNERS")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s+/)[0])
    .filter((pattern) => pattern !== "*");

  function matches(pattern: string) {
    const relative = pattern.replace(/^\//, "");
    if (relative.endsWith("/")) return existsSync(new URL(`../${relative}`, import.meta.url));
    if (!relative.includes("*")) return exists(relative);
    const slash = relative.lastIndexOf("/");
    const dir = relative.slice(0, slash);
    const glob = new RegExp(
      `^${relative
        .slice(slash + 1)
        .replace(/[.]/g, "\\.")
        .replace(/\*/g, ".*")}$`,
    );
    if (!existsSync(new URL(`../${dir}`, import.meta.url))) return false;
    return readdirSync(new URL(`../${dir}/`, import.meta.url)).some((name) => glob.test(name));
  }

  it.each(patterns)("%s names an existing surface", (pattern) => {
    expect(matches(pattern), `${pattern} matches no file — review routing would silently fall to the catch-all`).toBe(
      true,
    );
  });

  it("routes review on the RAG directory, not the pre-#994 flat files", () => {
    expect(patterns).toContain("/src/lib/rag/");
    expect(patterns).not.toContain("/src/lib/rag.ts");
    expect(patterns).not.toContain("/src/lib/rag-*.ts");
  });
});

describe("L129: every override in package.json matches a lock entry and has a recorded rationale", () => {
  type LockPackage = { version?: string };
  const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, LockPackage> };
  const overrides = (JSON.parse(read("package.json")) as { overrides: Record<string, unknown> }).overrides;
  const majorsOf = (name: string) =>
    new Set(
      Object.entries(lock.packages)
        .filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`))
        .map(([, entry]) => entry.version?.split(".")[0]),
    );
  const rationaleSection = () => {
    const doc = read("docs/framework-dependency-modernization-checklist.md");
    return doc.slice(doc.indexOf("## Overrides"));
  };
  // An override may deliberately outlive its lock match: a defensive pre-pin keeps a
  // major on a patched release for the day a transitive bump reintroduces it. Deleting
  // one silently drops that protection, so a pre-pin is exempt from the dead-override
  // rule only while its row in the rationale table is marked `pre-pin` and says why.
  const prePinned = () =>
    new Set([...rationaleSection().matchAll(/^\|\s*`([^`]+)`[^|]*\|\s*pre-pin\s*\|/gm)].map((match) => match[1]));

  it("keeps no major-scoped override that matches nothing in the lock and is not a recorded pre-pin", () => {
    const exempt = prePinned();
    const dead = Object.keys(overrides)
      .filter((key) => /^[^@].*@\d+$/.test(key))
      .filter((key) => !exempt.has(key))
      .filter((key) => {
        const [name, major] = key.split("@");
        return !majorsOf(name).has(major);
      });
    expect(dead).toEqual([]);
  });

  it("lets a pre-pin claim the exemption only for an override that actually exists", () => {
    const stray = [...prePinned()].filter((key) => !(key in overrides));
    expect(stray, "a pre-pin row names an override package.json no longer carries").toEqual([]);
  });

  it("records why each override exists in the dependency checklist", () => {
    const doc = read("docs/framework-dependency-modernization-checklist.md");
    const section = doc.slice(doc.indexOf("## Overrides"));
    expect(section.length).toBeGreaterThan(0);
    for (const key of Object.keys(overrides)) {
      const name = key.replace(/@\d+$/, "");
      const recorded = section.includes(`\`${key}\``) || section.includes(`\`${name}\``);
      expect(recorded, `no rationale recorded for override ${key}`).toBe(true);
    }
  });
});

describe("L20: Dependabot cannot move @types/node across a major on its own", () => {
  it("ignores semver-major updates for @types/node in the npm ecosystem", () => {
    const npm = dependabotEntries(read(".github/dependabot.yml")).find((entry) => entry.ecosystem === "npm");
    expect(npm).toBeDefined();
    const ignore = npm!.body.slice(npm!.body.indexOf("ignore:"));
    // The types line must track engines.node (24.x); a major bump from
    // Dependabot #549 is how the current 26.x mismatch arrived.
    expect(ignore).toMatch(/dependency-name:\s*"@types\/node"\n\s+update-types:\s*\["version-update:semver-major"\]/);
  });
});
