import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  analyzeCkbV2ClassUsage,
  analyzeNextRedirectOnlyRoute,
  buildAdoptionManifest,
  checkAdoptionManifest,
  checkGeneratedAdoptionDocuments,
  deriveSurfaceV2Observation,
  humanReviewerAttributionFailure,
  inspectPng,
  productionPageRoutes,
  productionNextUiEntries,
  reachableSourceFiles,
  validateAdoptionArtifactPath,
  validateLinuxVisualBaselineSet,
} from "../scripts/generate-design-system-adoption.mjs";

const root = path.resolve(__dirname, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function writeFixtureFile(fixtureRoot: string, relativePath: string, content: string | Buffer = "fixture\n") {
  const absolutePath = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

// Mirrors CANONICAL_NON_VISUAL_ROUTES / adoption-contract.json's `nonVisualRouteContracts`.
// The Ward Flow constellation redirect used to be the second entry here; it left this list
// when Ward Flow's sandbox move took every one of its routes out of the production census, and
// the prototype has since been retired entirely. This list is only the fixture set for declared,
// census-tracked non-visual routes.
const NON_VISUAL_REDIRECT_PAGES = ["src/app/(search-app)/documents/source/page.tsx"] as const;

function writeNonVisualRedirectFixtures(fixtureRoot: string) {
  for (const relativePath of NON_VISUAL_REDIRECT_PAGES) {
    writeFixtureFile(fixtureRoot, relativePath, read(relativePath));
  }
}

function createCheckerFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-adoption-check-"));
  writeFixtureFile(
    fixtureRoot,
    "docs/design-system/adoption-contract.json",
    read("docs/design-system/adoption-contract.json"),
  );
  writeFixtureFile(fixtureRoot, ".design-sync/config.json", read(".design-sync/config.json"));
  return fixtureRoot;
}

const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGklEQVQ4jWP4TyFgGDXg/2gY/B8Ng//DIgwAXXj8LuMlDaEAAAAASUVORK5CYII=",
  "base64",
);
const baselineNames = [
  "dashboard-shell.png",
  "dashboard-shell-phone.png",
  "search-results-band.png",
  "search-results-band-phone.png",
  "document-viewer.png",
  "therapy-compass-home.png",
];
const canonicalAwaitingValues = baselineNames.map((name) => JSON.stringify(name.replace(/\.png$/, ""))).join(", ");

function git(fixtureRoot: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: fixtureRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commitFixture(fixtureRoot: string, message: string) {
  git(fixtureRoot, ["add", "-A"]);
  git(fixtureRoot, ["commit", "-q", "-m", message]);
  return git(fixtureRoot, ["rev-parse", "HEAD"]);
}

function withAwaitingValues(sourceText: string, values: string) {
  return sourceText.replace(
    /(const\s+AWAITING_BASELINE(?:\s*:\s*[^=]+)?\s*=\s*new Set\()\[[\s\S]*?\](\);)/,
    `$1[${values}]$2`,
  );
}

function setCurrentAwaitingValues(fixtureRoot: string, values: string) {
  writeFixtureFile(
    fixtureRoot,
    "tests/ui-visual-baseline.spec.ts",
    withAwaitingValues(read("tests/ui-visual-baseline.spec.ts"), values),
  );
}

/**
 * Seeds a fixture repository whose candidate-source commit declares the canonical
 * six as awaiting a baseline — the state a capture run is taken from.
 *
 * The default is the explicit canonical list rather than whatever
 * `tests/ui-visual-baseline.spec.ts` happens to say right now. Inheriting the live
 * file made every fixture depend on the repository not having adopted its baselines
 * yet, so the commit that finally empties `AWAITING_BASELINE` — the outcome this
 * contract exists to permit — turned the fixture's own candidate head into "must
 * contain exactly the canonical six ids" and failed the two `toEqual([])` cases.
 * A fixture states its precondition; it does not borrow it from the tree under test.
 */
function initialiseCandidateRepository(fixtureRoot: string, awaitingValues: string = canonicalAwaitingValues) {
  git(fixtureRoot, ["init", "-q"]);
  git(fixtureRoot, ["config", "user.email", "fixture@example.invalid"]);
  git(fixtureRoot, ["config", "user.name", "Fixture"]);
  writeFixtureFile(fixtureRoot, "src/app/page.tsx", "export default function Page() { return null; }\n");
  writeFixtureFile(
    fixtureRoot,
    "tests/ui-visual-baseline.spec.ts",
    withAwaitingValues(read("tests/ui-visual-baseline.spec.ts"), awaitingValues),
  );
  return commitFixture(fixtureRoot, "candidate source");
}

function writeBaselineSet(
  fixtureRoot: string,
  {
    platform = "linux",
    reviewStatus = "approved",
    candidateNames = baselineNames,
    hashOverride,
    candidateSourceHead = git(fixtureRoot, ["rev-parse", "HEAD"]),
    reviewedBy = "Fixture Reviewer",
    reviewerLogin,
  }: {
    platform?: string;
    reviewStatus?: string;
    candidateNames?: string[];
    hashOverride?: string;
    candidateSourceHead?: string;
    reviewedBy?: string;
    reviewerLogin?: string;
  } = {},
) {
  const paths = candidateNames.map((name) => `tests/__screenshots__/linux/${name}`);
  for (const baselinePath of paths) writeFixtureFile(fixtureRoot, baselinePath, validPng);
  const candidates = paths.map((baselinePath, index) => ({
    id: candidateNames[index].replace(/\.png$/, ""),
    path: baselinePath,
    sha256: index === 0 && hashOverride ? hashOverride : createHash("sha256").update(validPng).digest("hex"),
    width: 16,
    height: 16,
  }));
  const provenance = {
    schemaVersion: 2,
    platform,
    runnerImage: "ubuntu-24.04",
    candidateSourceHead,
    review: {
      status: reviewStatus,
      reviewerType: "human",
      candidateSourceHead,
      reviewedBy,
      ...(reviewerLogin ? { reviewerLogin } : {}),
      reviewedAt: "2026-08-05T00:00:00.000Z",
    },
    source: {
      kind: "hosted-ci-artifact",
      candidateSourceHead,
      runId: "12345",
      artifactName: "visual-baseline-12345",
    },
    candidates,
  };
  writeFixtureFile(
    fixtureRoot,
    "tests/__screenshots__/linux/provenance.json",
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  return {
    paths,
    provenance,
    trackedFiles: new Set([...paths, "tests/__screenshots__/linux/provenance.json"]),
  };
}

describe("design-system adoption manifest", () => {
  it.each([
    {
      name: "literal class",
      source: `export function Root() { return <main className="ckb-v2 page" />; }`,
      expected: { literalCkbV2: true, dynamicCkbV2: false },
    },
    {
      name: "literal class helper argument",
      source: `export function Root() { return <main className={cn("page", "ckb-v2")} />; }`,
      expected: { literalCkbV2: true, dynamicCkbV2: false },
    },
    {
      name: "literal token beside a theme interpolation",
      source:
        "export function Root({ theme }: { theme: string }) { return <main className={`page ckb-v2 ${theme}`} />; }",
      expected: { literalCkbV2: true, dynamicCkbV2: false },
    },
    {
      name: "array join",
      source: `export function Root() { return <main className={["ckb", "v2"].join("-")} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: true },
    },
    {
      name: "concatenated version",
      source: `export function Root({ version }: { version: string }) { return <main className={"ckb-" + version} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: true },
    },
    {
      name: "class helper concatenation",
      source: `export function Root({ version }: { version: string }) { return <main className={cn("page", "ckb-" + version)} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: true },
    },
    {
      name: "bound array join",
      source: `const shell = ["ckb", "v2"].join("-"); export function Root() { return <main className={clsx("page", shell)} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: true },
    },
    {
      name: "string replace",
      source: `export function Root() { return <main className={"ckb_v2".replace("_", "-")} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: true },
    },
    {
      name: "filtered array join",
      source: `export function Root() { return <main className={["ckb-v2"].filter(Boolean).join(" ")} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: true },
    },
    {
      name: "unresolved call with static token evidence",
      source: `export function Root() { return <main className={normalise("ckb", "v2")} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: true },
    },
    {
      name: "sibling function shadowing",
      source:
        `export function First({ version }: { version: string }) { const shell = "ckb-" + version; return <main className={shell} />; } ` +
        `export function Second() { const shell = "page"; return <main className={shell} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: true },
    },
    {
      name: "nested lexical shadowing",
      source:
        `export function Root({ version }: { version: string }) { const shell = "ckb-" + version; ` +
        `{ const shell = "page"; void shell; } return <main className={shell} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: true },
    },
    {
      name: "default parameter binding",
      source:
        `export function Root({ version }: { version: string }, shell = "ckb-" + version) { ` +
        `return <main className={shell} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: true },
    },
    {
      name: "parameter shadows outer binding",
      source: `const shell = "ckb-v2"; export function Root(shell: string) { return <main className={shell} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: false },
    },
    {
      name: "unrelated dynamic class",
      source:
        `export function Root({ state }: { state: string }) { return <main className={cn("page", ` +
        "`state-${state}`" +
        `)} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: false },
    },
  ])("classifies $name without regex gaps", ({ source, expected }) => {
    expect(analyzeCkbV2ClassUsage("src/components/fixture-root.tsx", source)).toEqual(expected);
  });

  it("scopes the global observation to the declared html element", () => {
    const source =
      `const nested = { className: "ckb-v2" }; ` +
      `export function Root() { return <html className="page"><body className="ckb-v2" {...nested} /></html>; }`;
    expect(analyzeCkbV2ClassUsage("src/app/layout.tsx", source, { elementName: "html" })).toEqual({
      literalCkbV2: false,
      dynamicCkbV2: false,
    });
  });

  it.each([
    {
      name: "inline literal spread",
      source: `export function Root() { return <html {...{ className: "ckb-v2" }} />; }`,
      expected: { literalCkbV2: true, dynamicCkbV2: false },
    },
    {
      name: "bound literal spread",
      source: `const props = { className: "ckb-v2" }; export function Root() { return <html {...props} />; }`,
      expected: { literalCkbV2: true, dynamicCkbV2: false },
    },
    {
      name: "dynamic spread",
      source:
        `const props = { className: ["ckb", "v2"].join("-") }; ` +
        `export function Root() { return <html {...props} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: true },
    },
    {
      name: "unresolved spread",
      source: `export function Root(props: object) { return <html {...props} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: true },
    },
    {
      name: "safe object spread",
      source: `const props = { lang: "en" }; export function Root() { return <html {...props} />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: false },
    },
    {
      name: "body-only spread",
      source: `export function Root() { return <html><body {...{ className: "ckb-v2" }} /></html>; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: false },
    },
    {
      name: "wrong element literal",
      source: `export function Root() { return <section className="ckb-v2" />; }`,
      expected: { literalCkbV2: false, dynamicCkbV2: false },
    },
  ])("classifies global html $name", ({ source, expected }) => {
    expect(analyzeCkbV2ClassUsage("src/app/layout.tsx", source, { elementName: "html" })).toEqual(expected);
  });

  it("distinguishes direct literal mounts from global-root inheritance", () => {
    const globalShell = { file: "src/app/layout.tsx", literalCkbV2: true };
    expect(
      deriveSurfaceV2Observation({
        globalShell,
        roots: [
          { file: "src/app/first/page.tsx", literalCkbV2: false },
          { file: "src/components/direct.tsx", literalCkbV2: true },
        ],
      }),
    ).toEqual({
      observedShellState: "v2",
      v2ShellMounted: true,
      v2MountMode: "inherited-global-root",
      inheritedFrom: "src/app/layout.tsx",
      directV2MountFiles: ["src/components/direct.tsx"],
    });

    expect(
      deriveSurfaceV2Observation({
        globalShell: { file: "src/app/layout.tsx", literalCkbV2: false },
        roots: [{ file: "src/components/direct.tsx", literalCkbV2: true }],
      }),
    ).toMatchObject({
      observedShellState: "v2",
      v2MountMode: "direct-literal",
      inheritedFrom: null,
    });
  });

  it("derives redirect-only proof from every terminal path in the route source", () => {
    expect(
      analyzeNextRedirectOnlyRoute(
        "src/app/redirect/page.tsx",
        `import { redirect as nextRedirect } from "next/navigation";
         export default async function RedirectPage({ valid }: { valid: boolean }) {
           await Promise.resolve();
           if (!valid) nextRedirect("/search");
           nextRedirect("/detail");
         }`,
      ),
    ).toMatchObject({
      importsNextRedirect: true,
      hasDefaultFunction: true,
      hasJsx: false,
      terminalOutcomes: ["redirect"],
      redirectOnly: true,
    });

    expect(
      analyzeNextRedirectOnlyRoute(
        "src/app/redirect/page.tsx",
        `import { redirect } from "next/navigation";
         export default function RedirectPage({ valid }: { valid: boolean }) {
           if (valid) redirect("/detail");
           return null;
         }`,
      ).redirectOnly,
    ).toBe(false);
    expect(
      analyzeNextRedirectOnlyRoute(
        "src/app/redirect/page.tsx",
        `import { redirect } from "next/navigation";
         export default function RedirectPage() { return <main>Visual route</main>; }`,
      ).redirectOnly,
    ).toBe(false);
    expect(
      analyzeNextRedirectOnlyRoute(
        "src/app/redirect/page.tsx",
        `function redirect(path: string): never { throw new Error(path); }
         export default function RedirectPage() { redirect("/detail"); }`,
      ).redirectOnly,
    ).toBe(false);
  });

  it("recognises the pinned legacy source route as redirect-only", () => {
    expect(
      analyzeNextRedirectOnlyRoute(
        "src/app/(search-app)/documents/source/page.tsx",
        read("src/app/(search-app)/documents/source/page.tsx"),
      ).redirectOnly,
    ).toBe(true);
  });

  it("fails the adoption contract when a declared root constructs ckb-v2", () => {
    const current = JSON.parse(read("docs/design-system/adoption-manifest.json"));
    const manifest = {
      ...current,
      surfaces: [
        {
          id: "fixture",
          shellState: "compatibility",
          permittedComponentFamilies: [],
          roots: [
            {
              file: "src/components/fixture-root.tsx",
              exists: true,
              imports: [],
              importedFamilies: [],
              literalCkbV2: false,
              dynamicCkbV2: true,
            },
          ],
        },
      ],
    };

    expect(checkAdoptionManifest(manifest)).toContain(
      "fixture root dynamically constructs ckb-v2: src/components/fixture-root.tsx",
    );
  });

  it("fails closed when a production page route has no declared owner", () => {
    const current = JSON.parse(read("docs/design-system/adoption-manifest.json"));
    const manifest = {
      ...current,
      routeCoverage: {
        ...current.routeCoverage,
        undeclared: ["src/app/unowned/page.tsx"],
      },
    };

    expect(checkAdoptionManifest(manifest)).toContain("production page route is undeclared: src/app/unowned/page.tsx");
  });

  it("requires documentation for non-owned route and shared-shell dispositions", () => {
    const current = JSON.parse(read("docs/design-system/adoption-manifest.json"));
    const manifest = {
      ...current,
      surfaces: current.surfaces.map((surface: { id: string }) =>
        surface.id === "documents-source-legacy-redirect" ? { ...surface, documentedDisposition: null } : surface,
      ),
    };

    const failures = checkAdoptionManifest(manifest);
    expect(failures).toContain("documents-source-legacy-redirect legacy-redirect disposition is undocumented");
  });

  // The "models the retired constellation route as a non-visual legacy redirect" test that used
  // to live here asserted the shape of the "ward-management-constellation-legacy-redirect" and
  // "ward-management" surfaces. Both left docs/design-system/adoption-contract.json (and the
  // manifest it generates) when Ward Flow's sandbox move took the whole prototype out of the
  // production census — see the "66 = 59 + 6 + 1" comment above. Care Plan and Caring Contacts,
  // the two other developer-gated mockups, were never declared as surfaces here at all, so Ward
  // Flow leaving this contract is convergence with the existing pattern, not a new gap: nothing
  // else in this file asserts a per-mockup surface shape for them either.

  it("does not let a visual catalogue opt out by relabelling itself as a legacy redirect", () => {
    const current = JSON.parse(read("docs/design-system/adoption-manifest.json"));
    const catalogue = current.surfaces.find((surface: { id: string }) => surface.id === "catalogues-forms-and-info");
    const relabelled = {
      ...catalogue,
      disposition: "legacy-redirect",
      routes: ["src/app/(search-app)/documents/source/page.tsx"],
      routeRoots: false,
      roots: [],
      documentedDisposition: "Relabelled to suppress visual proof.",
      proofApplicability: "not-applicable",
      proof: Object.fromEntries(
        current.requiredProofCategories.map((category: string) => [
          category,
          { status: "not-applicable", evidence: [] },
        ]),
      ),
      baseline: { status: "not-applicable", files: [] },
    };
    const failures = checkAdoptionManifest({
      ...current,
      surfaces: current.surfaces.map((surface: { id: string }) =>
        surface.id === relabelled.id ? relabelled : surface,
      ),
    });

    expect(failures).toContain("catalogues-forms-and-info disposition drifted from the adoption contract");
    expect(failures).toContain("catalogues-forms-and-info routes drifted from the adoption contract");
    expect(failures).toContain(
      "catalogues-forms-and-info proof applicability disagrees with its source-derived route topology",
    );
    expect(failures).toContain(
      "catalogues-forms-and-info may omit visual proof only when the pinned route is statically redirect-only",
    );
  });

  it("fails closed when a v2-adopted surface omits required proof", () => {
    const current = JSON.parse(read("docs/design-system/adoption-manifest.json"));
    const incompleteProof = { ...current.surfaces[0].proof };
    delete incompleteProof.browser;
    const manifest = {
      ...current,
      surfaces: [
        {
          ...current.surfaces[0],
          id: "fixture-v2",
          declaredShellState: "v2",
          proof: incompleteProof,
        },
      ],
    };

    expect(checkAdoptionManifest(manifest)).toContain("fixture-v2 surface proof is missing browser");
  });

  it("requires passed evidence for declared v2 (baseline may be not-committed while pending)", () => {
    const current = JSON.parse(read("docs/design-system/adoption-manifest.json"));
    const declaredV2 = {
      ...current.surfaces[0],
      id: "fixture-v2",
      declaredShellState: "v2",
      proof: {
        ...current.surfaces[0].proof,
        dark: { status: "passed", evidence: [] },
        browser: { status: "unverified", evidence: [] },
      },
      baseline: { status: "not-committed", files: [] },
    };
    const failures = checkAdoptionManifest({ ...current, surfaces: [declaredV2] });

    expect(failures).toContain("fixture-v2 dark proof is passed without evidence");
    expect(failures).toContain("fixture-v2 v2 adoption requires passed browser proof");
    expect(failures).not.toContain("fixture-v2 v2 adoption requires a committed visual baseline");
  });

  it("rejects not-applicable baseline for a declared v2 visual surface", () => {
    const current = JSON.parse(read("docs/design-system/adoption-manifest.json"));
    const declaredV2 = {
      ...current.surfaces[0],
      id: "fixture-v2",
      declaredShellState: "v2",
      proofApplicability: "required",
      baseline: { status: "not-applicable", files: [] },
    };
    const failures = checkAdoptionManifest({ ...current, surfaces: [declaredV2] });
    expect(failures).toContain("fixture-v2 v2 adoption requires a visual baseline (committed or not-committed)");
  });

  it("rejects not-committed baselines that list files before screenshots are committed", () => {
    const current = JSON.parse(read("docs/design-system/adoption-manifest.json"));
    const declaredV2 = {
      ...current.surfaces[0],
      id: "fixture-v2",
      declaredShellState: "v2",
      baseline: {
        status: "not-committed",
        files: ["tests/__screenshots__/linux/dashboard-shell.png"],
      },
    };
    const failures = checkAdoptionManifest({ ...current, surfaces: [declaredV2] });
    expect(failures).toContain(
      "fixture-v2 surface baseline is not-committed but lists files; keep files empty until screenshots are committed",
    );
  });

  it("allows the documented non-visual redirect to declare v2 without fabricated visual proof", () => {
    const current = JSON.parse(read("docs/design-system/adoption-manifest.json"));
    const fixtureRoot = createCheckerFixture();
    try {
      writeFixtureFile(fixtureRoot, "tests/proof.test.ts");
      writeNonVisualRedirectFixtures(fixtureRoot);
      initialiseCandidateRepository(fixtureRoot);
      setCurrentAwaitingValues(fixtureRoot, "");
      const baselineSet = writeBaselineSet(fixtureRoot);
      const proof = Object.fromEntries(
        current.requiredProofCategories.map((category: string) => [
          category,
          { status: "passed", evidence: ["tests/proof.test.ts"] },
        ]),
      );
      const promoted = {
        ...current,
        surfaces: current.surfaces.map((surface: { proofApplicability: string }, index: number) =>
          surface.proofApplicability === "not-applicable"
            ? { ...surface, declaredShellState: "v2" }
            : {
                ...surface,
                declaredShellState: "v2",
                proof,
                baseline: {
                  status: "committed",
                  files: [baselineSet.paths[index % baselineSet.paths.length]],
                },
              },
        ),
      };
      const failures = checkAdoptionManifest(promoted, {
        root: fixtureRoot,
        trackedFiles: new Set(["tests/proof.test.ts", ...baselineSet.trackedFiles]),
      });

      expect(failures).toEqual([]);
    } finally {
      fs.rmSync(fixtureRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("rejects not-applicable proof on a visual surface", () => {
    const current = JSON.parse(read("docs/design-system/adoption-manifest.json"));
    const surface = {
      ...current.surfaces.find((candidate: { disposition: string }) => candidate.disposition === "owned"),
      proofApplicability: "not-applicable",
      proof: Object.fromEntries(
        current.requiredProofCategories.map((category: string) => [
          category,
          { status: "not-applicable", evidence: [] },
        ]),
      ),
      baseline: { status: "not-applicable", files: [] },
    };
    const failures = checkAdoptionManifest({ ...current, surfaces: [surface] });

    expect(failures).toContain(`${surface.id} proof applicability disagrees with its source-derived route topology`);
    expect(failures).toContain(
      `${surface.id} may omit visual proof only when the pinned route is statically redirect-only`,
    );
  });

  it("requires classified tracked regular files for proof and Linux visual baselines", () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-adoption-artifacts-"));
    try {
      writeFixtureFile(fixtureRoot, "AGENTS.md");
      writeFixtureFile(fixtureRoot, "tests/proof.test.ts");
      writeFixtureFile(fixtureRoot, "tests/README.md");
      writeFixtureFile(fixtureRoot, "tests/untracked.test.ts");
      writeFixtureFile(fixtureRoot, "tests/__screenshots__/linux/surface.png", validPng);
      writeFixtureFile(fixtureRoot, "tests/__screenshots__/linux/not-a-png.png");
      writeFixtureFile(fixtureRoot, "tests/__screenshots__/linux/surface-windows.png", validPng);
      writeFixtureFile(fixtureRoot, "public/arbitrary.png");
      const trackedFiles = new Set([
        "AGENTS.md",
        "tests/proof.test.ts",
        "tests/README.md",
        "tests/__screenshots__/linux/surface.png",
        "tests/__screenshots__/linux/not-a-png.png",
        "tests/__screenshots__/linux/surface-windows.png",
        "public/arbitrary.png",
      ]);

      expect(
        validateAdoptionArtifactPath("tests/proof.test.ts", { root: fixtureRoot, trackedFiles, kind: "proof" }),
      ).toEqual([]);
      expect(
        validateAdoptionArtifactPath("tests/__screenshots__/linux/surface.png", {
          root: fixtureRoot,
          trackedFiles,
          kind: "visual-baseline",
        }),
      ).toEqual([]);
      expect(validateAdoptionArtifactPath(".", { root: fixtureRoot, trackedFiles, kind: "proof" })).toContain(
        "must reference an existing regular file",
      );
      expect(
        validateAdoptionArtifactPath("../outside.md", { root: fixtureRoot, trackedFiles, kind: "proof" }),
      ).toContain("must stay within the repository root");
      expect(validateAdoptionArtifactPath("AGENTS.md", { root: fixtureRoot, trackedFiles, kind: "proof" })).toContain(
        "must be a test/spec or a design-system evidence document",
      );
      expect(
        validateAdoptionArtifactPath("tests/README.md", { root: fixtureRoot, trackedFiles, kind: "proof" }),
      ).toContain("must be a test/spec or a design-system evidence document");
      expect(
        validateAdoptionArtifactPath("tests/untracked.test.ts", { root: fixtureRoot, trackedFiles, kind: "proof" }),
      ).toContain("must reference a Git-tracked file");
      expect(
        validateAdoptionArtifactPath("tests/missing.test.ts", {
          root: fixtureRoot,
          trackedFiles: new Set(["tests/missing.test.ts"]),
          kind: "proof",
        }),
      ).toContain("must reference an existing regular file");
      expect(
        validateAdoptionArtifactPath("public/arbitrary.png", {
          root: fixtureRoot,
          trackedFiles,
          kind: "visual-baseline",
        }),
      ).toContain("must be a Linux visual baseline under tests/__screenshots__/linux/");
      expect(
        validateAdoptionArtifactPath("tests/__screenshots__/linux/not-a-png.png", {
          root: fixtureRoot,
          trackedFiles,
          kind: "visual-baseline",
        }),
      ).toContain("must contain a PNG file signature");
      expect(
        validateAdoptionArtifactPath("tests/__screenshots__/linux/surface-windows.png", {
          root: fixtureRoot,
          trackedFiles,
          kind: "visual-baseline",
        }),
      ).toContain("visual baseline filename must not claim a non-Linux platform");
    } finally {
      fs.rmSync(fixtureRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("rejects PNG headers, corrupt images and impossible dimensions", () => {
    expect(inspectPng(validPng)).toMatchObject({ valid: true, width: 16, height: 16, failures: [] });
    expect(inspectPng(validPng.subarray(0, 8)).failures).toContain("PNG is missing IHDR");
    expect(inspectPng(validPng.subarray(0, validPng.length - 4)).valid).toBe(false);
    const zeroDimensions = Buffer.from(validPng);
    zeroDimensions.fill(0, 16, 24);
    expect(inspectPng(zeroDimensions).failures).toContain(
      "PNG dimensions must be between 16 and 20000 pixels with a sane total area",
    );
  });

  it("requires exact hosted-Linux provenance for all six committed visual baselines", { timeout: 90_000 }, () => {
    const validRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-valid-"));
    const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-missing-"));
    const hashRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-hash-"));
    const platformRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-platform-"));
    const reviewRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-review-"));
    const attributionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-attribution-"));
    const serviceAccountRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-service-account-"));
    const smuggledLoginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-smuggled-login-"));
    const approvedLoginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-approved-login-"));
    const singleTokenDisplayRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-single-token-"));
    const countRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-count-"));
    try {
      for (const fixtureRoot of [
        validRoot,
        missingRoot,
        hashRoot,
        platformRoot,
        reviewRoot,
        attributionRoot,
        serviceAccountRoot,
        smuggledLoginRoot,
        approvedLoginRoot,
        singleTokenDisplayRoot,
        countRoot,
      ])
        initialiseCandidateRepository(fixtureRoot);
      for (const fixtureRoot of [
        validRoot,
        missingRoot,
        hashRoot,
        platformRoot,
        reviewRoot,
        attributionRoot,
        serviceAccountRoot,
        smuggledLoginRoot,
        approvedLoginRoot,
        singleTokenDisplayRoot,
        countRoot,
      ])
        setCurrentAwaitingValues(fixtureRoot, "");
      const valid = writeBaselineSet(validRoot);
      expect(
        validateLinuxVisualBaselineSet(valid.paths, { root: validRoot, trackedFiles: valid.trackedFiles }),
      ).toEqual([]);

      for (const baselinePath of baselineNames.map((name) => `tests/__screenshots__/linux/${name}`))
        writeFixtureFile(missingRoot, baselinePath, validPng);
      expect(
        validateLinuxVisualBaselineSet(
          baselineNames.map((name) => `tests/__screenshots__/linux/${name}`),
          { root: missingRoot, trackedFiles: new Set() },
        ),
      ).toContain(
        "visual baseline provenance tests/__screenshots__/linux/provenance.json: must reference an existing regular file",
      );

      const badHash = writeBaselineSet(hashRoot, { hashOverride: "0".repeat(64) });
      expect(
        validateLinuxVisualBaselineSet(badHash.paths, { root: hashRoot, trackedFiles: badHash.trackedFiles }),
      ).toContain(`visual baseline provenance candidate ${badHash.paths[0]} has a SHA-256 mismatch`);

      const wrongPlatform = writeBaselineSet(platformRoot, {
        platform: "win32",
        reviewedBy: "Claude Code — automated adopt; human confirmation pending",
      });
      const wrongPlatformFailures = validateLinuxVisualBaselineSet(wrongPlatform.paths, {
        root: platformRoot,
        trackedFiles: wrongPlatform.trackedFiles,
      });
      expect(wrongPlatformFailures).toContain("visual baseline provenance platform must be linux");
      expect(wrongPlatformFailures).toContain(
        "visual baseline provenance human reviewer attribution must be a verified human identity, not an automated, bot, AI, or pending review",
      );

      const copilotReview = writeBaselineSet(attributionRoot, { reviewedBy: "GitHub Copilot" });
      expect(
        validateLinuxVisualBaselineSet(copilotReview.paths, {
          root: attributionRoot,
          trackedFiles: copilotReview.trackedFiles,
        }),
      ).toContain(
        "visual baseline provenance human reviewer attribution must be a verified human identity, not an automated, bot, AI, or pending review",
      );

      const genericBotReview = writeBaselineSet(attributionRoot, { reviewedBy: "automated review bot" });
      expect(
        validateLinuxVisualBaselineSet(genericBotReview.paths, {
          root: attributionRoot,
          trackedFiles: genericBotReview.trackedFiles,
        }),
      ).toContain(
        "visual baseline provenance human reviewer attribution must be a verified human identity, not an automated, bot, AI, or pending review",
      );

      const pendingApproval = writeBaselineSet(attributionRoot, { reviewedBy: "human approval pending" });
      expect(
        validateLinuxVisualBaselineSet(pendingApproval.paths, {
          root: attributionRoot,
          trackedFiles: pendingApproval.trackedFiles,
        }),
      ).toContain(
        "visual baseline provenance human reviewer attribution must be a verified human identity, not an automated, bot, AI, or pending review",
      );

      const serviceAccountLogin = writeBaselineSet(serviceAccountRoot, { reviewedBy: "build-service" });
      expect(
        validateLinuxVisualBaselineSet(serviceAccountLogin.paths, {
          root: serviceAccountRoot,
          trackedFiles: serviceAccountLogin.trackedFiles,
        }),
      ).toContain("visual baseline provenance human reviewer GitHub login must be on the project allowlist");

      const approvedHumanLogin = writeBaselineSet(approvedLoginRoot, { reviewedBy: "BigSimmo" });
      expect(
        validateLinuxVisualBaselineSet(approvedHumanLogin.paths, {
          root: approvedLoginRoot,
          trackedFiles: approvedHumanLogin.trackedFiles,
        }),
      ).toEqual([]);

      const singleTokenDisplayName = writeBaselineSet(singleTokenDisplayRoot, { reviewedBy: "Alice" });
      expect(
        validateLinuxVisualBaselineSet(singleTokenDisplayName.paths, {
          root: singleTokenDisplayRoot,
          trackedFiles: singleTokenDisplayName.trackedFiles,
        }),
      ).toEqual([]);

      const smuggledServiceLogin = writeBaselineSet(smuggledLoginRoot, {
        reviewedBy: "Alice",
        reviewerLogin: "build-service",
      });
      expect(
        validateLinuxVisualBaselineSet(smuggledServiceLogin.paths, {
          root: smuggledLoginRoot,
          trackedFiles: smuggledServiceLogin.trackedFiles,
        }),
      ).toContain("visual baseline provenance human reviewer GitHub login must be on the project allowlist");

      const unreviewed = writeBaselineSet(reviewRoot, { reviewStatus: "pending" });
      expect(
        validateLinuxVisualBaselineSet(unreviewed.paths, {
          root: reviewRoot,
          trackedFiles: unreviewed.trackedFiles,
        }),
      ).toContain("visual baseline provenance requires an approved timestamped human review");

      const fiveCandidates = writeBaselineSet(countRoot, { candidateNames: baselineNames.slice(0, 5) });
      expect(
        validateLinuxVisualBaselineSet(fiveCandidates.paths, {
          root: countRoot,
          trackedFiles: fiveCandidates.trackedFiles,
        }),
      ).toContain("visual baseline provenance must contain exactly 6 candidates");
    } finally {
      for (const fixtureRoot of [
        validRoot,
        missingRoot,
        hashRoot,
        platformRoot,
        reviewRoot,
        attributionRoot,
        serviceAccountRoot,
        smuggledLoginRoot,
        approvedLoginRoot,
        singleTokenDisplayRoot,
        countRoot,
      ])
        fs.rmSync(fixtureRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("keeps GitHub-login allowlisting off the display-name field", () => {
    expect(humanReviewerAttributionFailure("Alice")).toBeNull();
    expect(humanReviewerAttributionFailure({ displayName: "Alice" })).toBeNull();
    expect(humanReviewerAttributionFailure({ displayName: "Fixture Reviewer" })).toBeNull();
    expect(humanReviewerAttributionFailure({ login: "BigSimmo" })).toBeNull();
    expect(humanReviewerAttributionFailure({ login: "BigSimmo", displayName: "Alice" })).toBeNull();

    expect(humanReviewerAttributionFailure("build-service")).toBe(
      "visual baseline provenance human reviewer GitHub login must be on the project allowlist",
    );
    expect(humanReviewerAttributionFailure({ login: "build-service" })).toBe(
      "visual baseline provenance human reviewer GitHub login must be on the project allowlist",
    );
    expect(humanReviewerAttributionFailure({ login: "Alice" })).toBe(
      "visual baseline provenance human reviewer GitHub login must be on the project allowlist",
    );
    expect(humanReviewerAttributionFailure({ login: "build-service", displayName: "Alice" })).toBe(
      "visual baseline provenance human reviewer GitHub login must be on the project allowlist",
    );
  });

  it("pins baseline provenance to the canonical six target ids and paths", () => {
    const arbitraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-arbitrary-"));
    const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-target-missing-"));
    const extraRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-baseline-target-extra-"));
    try {
      for (const fixtureRoot of [arbitraryRoot, missingRoot, extraRoot]) initialiseCandidateRepository(fixtureRoot);
      for (const fixtureRoot of [arbitraryRoot, missingRoot, extraRoot]) setCurrentAwaitingValues(fixtureRoot, "");

      const arbitrary = writeBaselineSet(arbitraryRoot, {
        candidateNames: ["one.png", "two.png", "three.png", "four.png", "five.png", "six.png"],
      });
      expect(
        validateLinuxVisualBaselineSet(arbitrary.paths, {
          root: arbitraryRoot,
          trackedFiles: arbitrary.trackedFiles,
        }),
      ).toEqual(
        expect.arrayContaining([
          "visual baseline provenance candidates must exactly match the canonical six ids and paths",
          "committed surface baselines must exactly match the canonical six Linux targets",
        ]),
      );

      const missing = writeBaselineSet(missingRoot, { candidateNames: baselineNames.slice(0, 5) });
      expect(
        validateLinuxVisualBaselineSet(missing.paths, {
          root: missingRoot,
          trackedFiles: missing.trackedFiles,
        }),
      ).toEqual(
        expect.arrayContaining([
          "visual baseline provenance must contain exactly 6 candidates",
          "visual baseline provenance candidates must exactly match the canonical six ids and paths",
          "committed surface baselines must exactly match the canonical six Linux targets",
        ]),
      );

      const extra = writeBaselineSet(extraRoot, { candidateNames: [...baselineNames, "extra-target.png"] });
      expect(
        validateLinuxVisualBaselineSet(extra.paths, {
          root: extraRoot,
          trackedFiles: extra.trackedFiles,
        }),
      ).toEqual(
        expect.arrayContaining([
          "visual baseline provenance must contain exactly 6 candidates",
          "visual baseline provenance candidates must exactly match the canonical six ids and paths",
          "committed surface baselines must exactly match the canonical six Linux targets",
        ]),
      );
    } finally {
      for (const fixtureRoot of [arbitraryRoot, missingRoot, extraRoot])
        fs.rmSync(fixtureRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("accepts a first adoption or a refresh, and nothing else", { timeout: 90_000 }, () => {
    const exactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-awaiting-exact-"));
    const refreshRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-awaiting-refresh-"));
    const retainedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-awaiting-retained-"));
    const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-awaiting-missing-"));
    const extraRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-awaiting-extra-"));
    const dynamicRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-awaiting-dynamic-"));
    const spreadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-awaiting-spread-"));
    const duplicateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-awaiting-duplicate-"));
    const fixtureRoots = [
      exactRoot,
      refreshRoot,
      retainedRoot,
      missingRoot,
      extraRoot,
      dynamicRoot,
      spreadRoot,
      duplicateRoot,
    ];
    try {
      initialiseCandidateRepository(exactRoot, canonicalAwaitingValues);
      setCurrentAwaitingValues(exactRoot, "");
      const exact = writeBaselineSet(exactRoot);
      expect(
        validateLinuxVisualBaselineSet(exact.paths, { root: exactRoot, trackedFiles: exact.trackedFiles }),
      ).toEqual([]);

      // A REFRESH binds too: empty at both ends, suite byte-identical. This is the
      // ordinary case once baselines exist — a surface is deliberately re-shot and
      // its goldens replaced. Without it the six-to-empty transition was satisfiable
      // exactly once, so the first intentional design change would have left the
      // goldens red with no supported way to re-adopt them.
      initialiseCandidateRepository(refreshRoot, "");
      setCurrentAwaitingValues(refreshRoot, "");
      const refresh = writeBaselineSet(refreshRoot);
      expect(
        validateLinuxVisualBaselineSet(refresh.paths, { root: refreshRoot, trackedFiles: refresh.trackedFiles }),
      ).toEqual([]);

      initialiseCandidateRepository(retainedRoot, canonicalAwaitingValues);
      setCurrentAwaitingValues(retainedRoot, JSON.stringify("dashboard-shell"));
      const retained = writeBaselineSet(retainedRoot);
      expect(
        validateLinuxVisualBaselineSet(retained.paths, {
          root: retainedRoot,
          trackedFiles: retained.trackedFiles,
        }),
      ).toContain("current AWAITING_BASELINE must be empty after committing all six baselines");

      initialiseCandidateRepository(
        missingRoot,
        baselineNames
          .slice(0, 5)
          .map((name) => JSON.stringify(name.replace(/\.png$/, "")))
          .join(", "),
      );
      setCurrentAwaitingValues(missingRoot, "");
      const missing = writeBaselineSet(missingRoot);
      expect(
        validateLinuxVisualBaselineSet(missing.paths, {
          root: missingRoot,
          trackedFiles: missing.trackedFiles,
        }),
      ).toContain(
        "candidateSourceHead AWAITING_BASELINE must be either the canonical six ids (first adoption) or empty (refresh)",
      );

      initialiseCandidateRepository(extraRoot, `${canonicalAwaitingValues}, "extra-target"`);
      setCurrentAwaitingValues(extraRoot, "");
      const extra = writeBaselineSet(extraRoot);
      expect(
        validateLinuxVisualBaselineSet(extra.paths, { root: extraRoot, trackedFiles: extra.trackedFiles }),
      ).toContain(
        "candidateSourceHead AWAITING_BASELINE must be either the canonical six ids (first adoption) or empty (refresh)",
      );

      initialiseCandidateRepository(dynamicRoot, "BASELINE_IDS");
      setCurrentAwaitingValues(dynamicRoot, "");
      const dynamic = writeBaselineSet(dynamicRoot);
      expect(
        validateLinuxVisualBaselineSet(dynamic.paths, {
          root: dynamicRoot,
          trackedFiles: dynamic.trackedFiles,
        }),
      ).toContain(
        "candidateSourceHead AWAITING_BASELINE must be a static literal Set: must contain only string literals",
      );

      initialiseCandidateRepository(spreadRoot, "...BASELINE_IDS");
      setCurrentAwaitingValues(spreadRoot, "");
      const spread = writeBaselineSet(spreadRoot);
      expect(
        validateLinuxVisualBaselineSet(spread.paths, { root: spreadRoot, trackedFiles: spread.trackedFiles }),
      ).toContain("candidateSourceHead AWAITING_BASELINE must be a static literal Set: must not use spread values");

      initialiseCandidateRepository(duplicateRoot, `${canonicalAwaitingValues}, ${JSON.stringify("dashboard-shell")}`);
      setCurrentAwaitingValues(duplicateRoot, "");
      const duplicate = writeBaselineSet(duplicateRoot);
      expect(
        validateLinuxVisualBaselineSet(duplicate.paths, {
          root: duplicateRoot,
          trackedFiles: duplicate.trackedFiles,
        }),
      ).toContain("candidateSourceHead AWAITING_BASELINE must be a static literal Set: must not contain duplicate ids");
    } finally {
      for (const fixtureRoot of fixtureRoots)
        fs.rmSync(fixtureRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("binds hosted generation and human approval to an existing ancestor candidate source", () => {
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-source-malformed-"));
    const nonexistentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-source-nonexistent-"));
    const nonAncestorRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-source-nonancestor-"));
    const reviewMismatchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-source-review-mismatch-"));
    try {
      for (const fixtureRoot of [malformedRoot, nonexistentRoot, nonAncestorRoot, reviewMismatchRoot])
        initialiseCandidateRepository(fixtureRoot);
      for (const fixtureRoot of [malformedRoot, nonexistentRoot, reviewMismatchRoot])
        setCurrentAwaitingValues(fixtureRoot, "");

      const malformed = writeBaselineSet(malformedRoot, { candidateSourceHead: "not-a-sha" });
      expect(
        validateLinuxVisualBaselineSet(malformed.paths, {
          root: malformedRoot,
          trackedFiles: malformed.trackedFiles,
        }),
      ).toContain("visual baseline provenance candidateSourceHead must be a full Git SHA");

      const nonexistent = writeBaselineSet(nonexistentRoot, { candidateSourceHead: "f".repeat(40) });
      expect(
        validateLinuxVisualBaselineSet(nonexistent.paths, {
          root: nonexistentRoot,
          trackedFiles: nonexistent.trackedFiles,
        }),
      ).toContain("visual baseline provenance candidateSourceHead must identify an existing commit");

      const baseHead = git(nonAncestorRoot, ["rev-parse", "HEAD"]);
      git(nonAncestorRoot, ["checkout", "-q", "-b", "candidate"]);
      writeFixtureFile(nonAncestorRoot, "candidate-marker.txt");
      const siblingHead = commitFixture(nonAncestorRoot, "sibling candidate");
      git(nonAncestorRoot, ["checkout", "-q", "-b", "validation", baseHead]);
      setCurrentAwaitingValues(nonAncestorRoot, "");
      const nonAncestor = writeBaselineSet(nonAncestorRoot, { candidateSourceHead: siblingHead });
      expect(
        validateLinuxVisualBaselineSet(nonAncestor.paths, {
          root: nonAncestorRoot,
          trackedFiles: nonAncestor.trackedFiles,
        }),
      ).toContain("visual baseline provenance candidateSourceHead must be an ancestor of current HEAD");

      const reviewMismatch = writeBaselineSet(reviewMismatchRoot);
      reviewMismatch.provenance.review.candidateSourceHead = "0".repeat(40);
      writeFixtureFile(
        reviewMismatchRoot,
        "tests/__screenshots__/linux/provenance.json",
        `${JSON.stringify(reviewMismatch.provenance, null, 2)}\n`,
      );
      expect(
        validateLinuxVisualBaselineSet(reviewMismatch.paths, {
          root: reviewMismatchRoot,
          trackedFiles: reviewMismatch.trackedFiles,
        }),
      ).toContain("visual baseline provenance requires an approved timestamped human review");
    } finally {
      for (const fixtureRoot of [malformedRoot, nonexistentRoot, nonAncestorRoot, reviewMismatchRoot])
        fs.rmSync(fixtureRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("rejects runtime or visual-suite drift after the candidate source commit", () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-source-runtime-drift-"));
    const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-source-suite-drift-"));
    try {
      initialiseCandidateRepository(runtimeRoot);
      setCurrentAwaitingValues(runtimeRoot, "");
      writeFixtureFile(runtimeRoot, "src/app/page.tsx", "export default function Page() { return <main />; }\n");
      const runtimeDrift = writeBaselineSet(runtimeRoot);
      expect(
        validateLinuxVisualBaselineSet(runtimeDrift.paths, {
          root: runtimeRoot,
          trackedFiles: runtimeDrift.trackedFiles,
        }),
      ).toContain("post-candidate repository change is not baseline-only: src/app/page.tsx");

      initialiseCandidateRepository(suiteRoot);
      writeFixtureFile(
        suiteRoot,
        "tests/ui-visual-baseline.spec.ts",
        withAwaitingValues(
          read("tests/ui-visual-baseline.spec.ts").replace('route: "/therapy-compass"', 'route: "/services"'),
          "",
        ),
      );
      const suiteDrift = writeBaselineSet(suiteRoot);
      expect(
        validateLinuxVisualBaselineSet(suiteDrift.paths, {
          root: suiteRoot,
          trackedFiles: suiteDrift.trackedFiles,
        }),
      ).toContain("visual suite changed after candidate capture beyond the AWAITING_BASELINE declaration");
    } finally {
      for (const fixtureRoot of [runtimeRoot, suiteRoot])
        fs.rmSync(fixtureRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("pins the global shell declaration even if a manifest and edited contract agree", () => {
    const current = JSON.parse(read("docs/design-system/adoption-manifest.json"));
    const fixtureRoot = createCheckerFixture();
    try {
      const contract = JSON.parse(
        fs.readFileSync(path.join(fixtureRoot, "docs/design-system/adoption-contract.json"), "utf8"),
      );
      contract.globalShellRoot = { file: "src/app/not-the-root.tsx", element: "body" };
      fs.writeFileSync(
        path.join(fixtureRoot, "docs/design-system/adoption-contract.json"),
        `${JSON.stringify(contract, null, 2)}\n`,
      );
      const manifest = {
        ...current,
        globalShell: {
          ...current.globalShell,
          file: contract.globalShellRoot.file,
          element: contract.globalShellRoot.element,
        },
      };

      expect(checkAdoptionManifest(manifest, { root: fixtureRoot, trackedFiles: new Set() })).toContain(
        "globalShellRoot must remain src/app/layout.tsx / html",
      );
    } finally {
      fs.rmSync(fixtureRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("discovers production pages while excluding api and mockup trees", () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-routes-"));
    try {
      for (const route of ["src/app/real/page.tsx", "src/app/api/debug/page.tsx", "src/app/mockups/demo/page.tsx"]) {
        const absolutePath = path.join(fixtureRoot, route);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, "export default function Page() { return null; }\n");
      }
      expect(productionPageRoutes(fixtureRoot)).toEqual(["src/app/real/page.tsx"]);
    } finally {
      fs.rmSync(fixtureRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("discovers all Next UI convention entries while excluding api and mockup trees", () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-next-entries-"));
    try {
      // The root-level "loading" entry is deliberately not used here: that exact file was
      // retired from src/app (root loading skeleton duplicated every ward screen in the DOM),
      // and check-mockup-retirement.mjs's Tier C scan flags ANY surviving file that still
      // names a retired path verbatim — including a synthetic fixture string with no real
      // import. The "loading" convention type is still exercised, just nested, so coverage
      // for it is unchanged; deliberately not spelling the retired path out here either, so
      // this comment cannot itself trip that same scan.
      const productionEntries = [
        "src/app/page.tsx",
        "src/app/layout.tsx",
        "src/app/error.tsx",
        "src/app/not-found.tsx",
        "src/app/nested/layout.tsx",
        "src/app/nested/loading.tsx",
        "src/app/nested/template.tsx",
        "src/app/nested/default.tsx",
        "src/app/nested/forbidden.ts",
      ];
      for (const entry of [
        ...productionEntries,
        "src/app/api/demo/loading.tsx",
        "src/app/mockups/demo/loading.tsx",
        "src/app/nested/helper.tsx",
      ])
        writeFixtureFile(fixtureRoot, entry, "export default function Entry() { return null; }\n");

      expect(productionNextUiEntries(fixtureRoot)).toEqual(productionEntries.sort());
    } finally {
      fs.rmSync(fixtureRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("derives component reachability from production entries rather than reference imports", () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "design-system-reachability-"));
    try {
      writeFixtureFile(
        fixtureRoot,
        "src/app/page.tsx",
        `import { Mounted } from "@/components/mounted"; export default function Page() { return <Mounted />; }\n`,
      );
      writeFixtureFile(
        fixtureRoot,
        "src/components/mounted.tsx",
        `import { Leaf } from "./leaf"; export function Mounted() { return <Leaf />; }\n`,
      );
      writeFixtureFile(fixtureRoot, "src/components/leaf.tsx", `export function Leaf() { return null; }\n`);
      writeFixtureFile(
        fixtureRoot,
        "src/components/reference-only.tsx",
        `import { ReferenceLeaf } from "./reference-leaf"; export function ReferenceOnly() { return <ReferenceLeaf />; }\n`,
      );
      writeFixtureFile(
        fixtureRoot,
        "src/components/reference-leaf.tsx",
        `export function ReferenceLeaf() { return null; }\n`,
      );

      expect([...reachableSourceFiles(["src/app/page.tsx"], { root: fixtureRoot })].sort()).toEqual([
        "src/app/page.tsx",
        "src/components/leaf.tsx",
        "src/components/mounted.tsx",
      ]);
    } finally {
      fs.rmSync(fixtureRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  // Full-repo rebuild + deep equality is intentionally heavy; under coverage instrumentation
  // of scripts/** this exceeds Vitest's default 30s (CI Unit coverage on 4b85f0e2 timed out).
  it("is deterministic and records declared global v2 adoption", { timeout: 90_000 }, () => {
    const manifest = JSON.parse(read("docs/design-system/adoption-manifest.json"));
    expect(manifest).toEqual(buildAdoptionManifest({ root }));
    expect(manifest.schemaVersion).toBe(7);
    // DS-P2-21 barrel: componentSrcMap stays on ui-primitives.tsx; `export *`
    // from primitive-recipes still counts as a declared-source export.
    for (const name of ["AsyncButton", "EmptyState", "IconButton", "ToggleSwitch"]) {
      const component = manifest.components.find((candidate: { name: string }) => candidate.name === name);
      expect(component.source, `${name} source map`).toBe("src/components/ui-primitives.tsx");
      expect(component.sourceExported, `${name} barrel re-export`).toBe(true);
    }
    expect(manifest.globalShell).toMatchObject({
      file: "src/app/layout.tsx",
      element: "html",
      literalCkbV2: true,
      observedShellState: "v2",
    });
    expect(manifest.adoption.literalCkbV2RootCount).toBe(1);
    expect(manifest.adoption.v2MountedSurfaceCount).toBe(manifest.surfaces.length);
    expect(manifest.adoption.declaredV2SurfaceCount).toBe(manifest.surfaces.length);
    expect(
      manifest.components.every(
        (component: Record<string, unknown>) =>
          typeof component.built === "boolean" &&
          typeof component.locallyRegistered === "boolean" &&
          typeof component.v2ShellMounted === "boolean" &&
          typeof component.proofDeclared === "boolean" &&
          typeof component.baselineCommitted === "boolean",
      ),
    ).toBe(true);
    for (const component of manifest.components) {
      expect(component.directImportFiles, `${component.name} direct imports must be deterministic`).toEqual(
        [...component.directImportFiles].sort(),
      );
      expect(component.productImportFiles, `${component.name} product imports must be deterministic`).toEqual(
        [...component.productImportFiles].sort(),
      );
      expect(component.testFiles, `${component.name} test evidence must be deterministic`).toEqual(
        [...component.testFiles].sort(),
      );
    }
    // `Quantity` and `AnswerCard` left this list on 6 Aug 2026 when the live answer
    // surface adopted the card (`answer-result-surface.tsx`); `Button` left it on
    // 8 Aug 2026 when `AccessibleTable`'s expand control stopped being a hand-rolled
    // recipe (COMPONENTS §0.4, ledger #263). What remains is still genuinely
    // reference-only; the assertion is a snapshot of adoption state, so moving a
    // component out of it is the expected shape of an adoption change, not a
    // weakened guard.
    // `ConfirmDialog` left this list on 23 Aug 2026 when the settings surface put
    // its two destructive privacy actions ("Clear saved items", "Reset
    // preferences") behind a real confirmation instead of a single tap. Nothing
    // in the reference-only set is reference-only any more, so the guard now
    // rests entirely on the adopted half below.
    const referenceOnlyComponents: string[] = [];
    for (const name of referenceOnlyComponents) {
      const component = manifest.components.find((candidate: { name: string }) => candidate.name === name);
      expect(component.productImportFiles, `${name} should remain reference-only`).toEqual([]);
      expect(component.v2ShellMounted, `${name} should not claim a production v2 mount`).toBe(false);
    }
    // The other half of the same guard: an adopted component must actually be mounted,
    // so "adopted" can never mean an import with no production shell behind it.
    for (const name of ["AnswerCard", "Quantity", "Button", "ConfirmDialog"]) {
      const component = manifest.components.find((candidate: { name: string }) => candidate.name === name);
      expect(component.productImportFiles.length, `${name} should be product-adopted`).toBeGreaterThan(0);
      expect(component.v2ShellMounted, `${name} should carry a production v2 mount`).toBe(true);
    }
    expect(
      manifest.components.find((component: { name: string }) => component.name === "Button").directImportFiles,
    ).toContain("src/components/ui/confirm-dialog.tsx");
    expect(
      manifest.components.find((component: { name: string }) => component.name === "Quantity").directImportFiles,
    ).toContain("src/components/ui/dose-line.tsx");

    const skeleton = manifest.components.find((component: { name: string }) => component.name === "Skeleton");
    expect(skeleton.productImportFiles).toEqual(
      expect.arrayContaining([
        "src/app/(search-app)/differentials/diagnoses/[slug]/loading.tsx",
        "src/app/(search-app)/differentials/presentations/[slug]/loading.tsx",
        "src/app/(search-app)/medications/[slug]/loading.tsx",
      ]),
    );
    expect(skeleton.v2ShellMounted).toBe(true);
    expect(
      manifest.surfaces.every(
        (surface: { declaredShellState: string; observedShellState: string; v2MountMode: string }) =>
          surface.declaredShellState === "v2" &&
          surface.observedShellState === "v2" &&
          surface.v2MountMode === "inherited-global-root",
      ),
    ).toBe(true);
    expect(
      manifest.components.every(
        (component: { productImportFiles: string[]; v2ShellMounted: boolean; v2MountMode: string }) =>
          component.productImportFiles.length > 0
            ? component.v2ShellMounted && component.v2MountMode === "inherited-global-root"
            : !component.v2ShellMounted && component.v2MountMode === "none",
      ),
    ).toBe(true);
    expect(
      manifest.surfaces.every(
        (surface: { proof: Record<string, unknown>; baseline: { status: string } }) =>
          Object.keys(surface.proof).sort().join("|") === "browser|compact320|dark|forcedColours|print" &&
          ["committed", "not-committed", "not-applicable"].includes(surface.baseline.status),
      ),
    ).toBe(true);
    // 101 = 92 prior census + 9 CME routes: the dashboard (`/cme`), the log and one entry
    // (`/cme/log`, `/cme/log/[id]`), the entry form (`/cme/new`), routines, the development plan,
    // the programme, first-run setup and dashboard customise. All nine were already declared in
    // `adoption-contract.json` under `catalogues-forms-and-info` before the routes existed, so
    // this number moving is what closes that gap rather than opening one. Prior 92 = 91 prior
    // census + 1: `/on-call/who-is-who`.
    // 91 = 90 prior census + 1 On Call route: `/on-call/card`, the printable essentials card
    // (Task 13) built from entries flagged `includeOnCard`. Prior 90 = 82 prior census + 8 On Call
    // routes: the redirect stub (`/on-call`), the six section pages (contacts, playbook,
    // referrals, orientation, education, logistics), and `/on-call/search`. Prior 82 = 76 prior
    // census + 6 Sources routes (the sixth is
    // `/sources/search`, which took the catalogue over when `/sources` became a mode home of its
    // own). Prior 76 = 59 + 6 + 10 + 1: the 59 production pages that preceded both changes, the six
    // `<mode>/search` routes home consolidation split out of the bare paths, the Caring
    // Contacts workspace's ten screens (Today; the Patients caseload from Phase 2B Task 5;
    // the per-patient overview from Task 6; the activation wizard from Task 7; the Schedule
    // from Task 13; the Templates library from Task 15 and one version's detail from Task 16;
    // Guidance and Reports from Task 19, the Team roster from Task 18, and the manual Referral Intake
    // fallback from Phase 5), plus `/factsheets/topics`. The sixteen-route Ward Flow synthetic patient-flow prototype (mode
    // home, eight remaining workspace routes, ED/ward/officer role screens, the per-patient
    // detail route, the Phase 4 shift handover, escalation board and patient search, and the
    // retired constellation redirect) that used to bring this to 82 left the production census
    // entirely in the sandbox move to the developer-gated mockups area (it has since been
    // retired), and `discoveredRoutes` excludes every `/mockups` route. Redirect stubs keep legacy deep links
    // resolving and still count as declared routes. This is a census, so a route nobody
    // intended to add still fails the contract.
    //
    // 92 -> 93 on 2026-09-20: `/on-call/compliance`, the second On Call page that is a view
    // over a stored section rather than a section of its own. It is a real production route
    // with its own `page.tsx`, so it is declared in `adoption-contract.json` beside its six
    // sibling On Call pages. Bumped deliberately, with the route named, because a bump with
    // no name is how this census stops being one.
    //
    // 93 -> 102 on 2026-09-21 (PR #2902 merge with main): nine CME routes under
    // `/cme/**` (dashboard, log, log/[id], new, routines, plan, programme, setup,
    // customise) landed on the same catalogue surface. Bumped deliberately, with
    // the routes named, because a bump with no name is how this census stops being one.
    //
    // 102 -> 103 on 2026-09-21: `/auth/reset-password` adds the password-recovery
    // destination used by the PKCE email callback. It is a real production route
    // and is declared in `adoption-contract.json`.
    //
    // 105 -> 111 on 2026-09-25: six new routes, each a real production page declared in
    // `adoption-contract.json`: `/cme/check` (year check), `/cme/calendar`, and On Call's
    // `/on-call/now` (who to call now), `/on-call/check` (entries due a check),
    // `/on-call/first-night` and `/on-call/calendar`.
    //
    // 111 -> 112 on 2026-09-25: `/forms/act`, the Forms "Act and Standards" reference page
    // (drafted Mental Health Act 2014 section summaries and the Chief Psychiatrist's
    // Standards), declared in `adoption-contract.json` on the catalogues surface.
    //
    // 112 -> 114 on 2026-09-26: `/cme/learning`, the CME WA learning directory, and
    // `/cme/training`, the CME trainee timeline.
    //
    // 114 -> 115 on 2026-09-26: `/on-call/shifts`, On Call "My shifts", the owner's own roster.
    //
    // 115 -> 116 on 2026-09-26: `/psychiatry`, the Psychiatry mode's dashboard.
    //
    // 116 -> 105 on 2026-09-26: the Caring Contacts prototype was retired, taking its eleven
    // workspace routes (Today, Patients, one patient, the activation wizard, Schedule, Templates,
    // one template, Guidance, Reports, Team and the manual Referral Intake) out of the census.
    //
    // 105 -> 106 on 2026-09-26: `/my-work`, the My Work mode's dashboard.
    //
    // 106 -> 116 on 2026-09-26: the First Nations mode home, its eight section pages
    //   and its pocket card (`/first-nations/card`).
    //
    // 116 -> 120 on 2026-09-27: the rebuilt On Call's shift pages `/on-call/call`,
    // `/on-call/refer`, `/on-call/find` and `/on-call/whos-on` (Who's on hidden from the
    // menu behind its flag, but still a route).
    //
    // 120 -> 122 on 2026-09-27: Roster's registration and Release 1 screens, merged in:
    // `/on-call/shifts` deleted (proxy redirect), `/on-call/calendar` moved to `/roster/calendar`,
    // and Roster's Today (`/roster`), `/roster/shifts` and `/roster/settings` added — net plus two.
    // 122 -> 127: Admin Today, Renewals, New job, its Records page and Help.
    // 127 -> 144: the 17 Teaching routes; 144 -> 148: Roster Team, Requests, Manage and Join.
    // 148 -> 149: Roster Swaps. 149 -> 150: Admin's credential pack (`/admin/new-job/pack`).
    // The owner-only developer panel remains outside production route coverage.
    expect(manifest.routeCoverage.discovered).toHaveLength(150);
    expect(manifest.routeCoverage.declared).toEqual(manifest.routeCoverage.discovered);
    expect(manifest.routeCoverage.undeclared).toEqual([]);
    expect(manifest.routeCoverage.missing).toEqual([]);
    expect(manifest.routeCoverage.duplicates).toEqual([]);
  });

  it(
    "accepts declared v2 with passed proof (baseline may be not-committed while pending Linux screenshots)",
    { timeout: 90_000 },
    () => {
      const manifest = buildAdoptionManifest({ root });
      const failures = checkAdoptionManifest(manifest, { root });
      expect(failures).toEqual([]);
    },
  );

  it("keeps generated adoption sections synchronized with the manifest", () => {
    const manifest = JSON.parse(read("docs/design-system/adoption-manifest.json"));
    const componentsDocument = read("docs/design-system/COMPONENTS.md");
    const adoptionDocument = read("docs/design-system/ADOPTION.md");
    expect(checkGeneratedAdoptionDocuments(manifest, { componentsDocument, adoptionDocument })).toEqual([]);
    const expected = `Registered public components: ${manifest.summary.registeredComponentCount}`;
    expect(componentsDocument).toContain(expected);
    expect(adoptionDocument).toContain(expected);
    expect(componentsDocument).toMatch(/\|\s*Component\s*\|\s*Family\s*\|\s*Built\s*\|\s*Locally registered\s*\|/);
    expect(adoptionDocument).toMatch(/\|\s*Surface\s*\|\s*Disposition\s*\|\s*Routes\s*\|\s*Roots\s*\|/);

    expect(
      checkGeneratedAdoptionDocuments(manifest, {
        componentsDocument: componentsDocument.replace(
          /(<!-- adoption-manifest:maturity:start -->[\s\S]*?)`Button`/,
          "$1`BogusButton`",
        ),
        adoptionDocument,
      }),
    ).toContain("docs/design-system/COMPONENTS.md generated maturity section is out of date");
    expect(
      checkGeneratedAdoptionDocuments(manifest, {
        componentsDocument,
        adoptionDocument: adoptionDocument.replace(
          /(<!-- adoption-manifest:adoption:start -->[\s\S]*?)`root-shell-and-settings`/,
          "$1`bogus-surface`",
        ),
      }),
    ).toContain("docs/design-system/ADOPTION.md generated adoption section is out of date");
  });

  it("keeps the AnswerCard and AccessibleTable gate prose aligned with landed contracts", () => {
    const components = read("docs/design-system/COMPONENTS.md");
    const gates = read("docs/design-system/GATES.md");
    expect(components).toMatch(
      /Required\s+verification\/state props, structured actions and the fifth `ungrounded` state are implemented/,
    );
    expect(components).toMatch(/missing cells already render `MissingValue`, never a bare dash/);
    expect(components).not.toContain("Missing clinical data renders as a bare dash (`AccessibleTable` today)");
    expect(components).not.toContain("`AccessibleTable`'s bare-dash cells are adoption work");
    expect(components).toMatch(/already composed inside `AnswerFooter`, `DateDisplay`, and\s+`AccessibleTable`/);
    expect(gates).toMatch(/Render `AnswerCard` without[\s\S]*implemented-blocking in `AnswerCard`/);
    expect(gates).toMatch(/Use a bare dash[\s\S]*implemented-partial — `AccessibleTable` composes `MissingValue`/);
  });

  it("does not re-teach per-step type companions in SPEC, conventions, or GATES §4", () => {
    const spec = read("docs/design-system/SPEC.md");
    const conventions = read(".design-sync/conventions.md");
    const gates = read("docs/design-system/GATES.md");
    const typeSection = spec.split("### 4.5 Type")[1]?.split("### 4.6")[0] ?? "";
    const evidenceSection = gates.split("## 4 · Recorded verification evidence")[1]?.split("###")[0] ?? "";

    expect(spec).not.toContain("each with its own line-height");
    expect(spec).not.toContain(":194-204");
    expect(typeSection).toContain("--leading-prose");
    expect(typeSection).toContain("--text-hero--line-height");
    expect(conventions).not.toMatch(/per-step\s+line-height\s+and\s+tracking/);
    expect(evidenceSection).toMatch(/raw colours 0\b/);
    expect(evidenceSection).not.toMatch(/not re-run for this document set/);

    for (const doc of [typeSection, conventions]) {
      for (const step of ["xs", "sm", "body", "md", "lg", "xl"] as const) {
        expect(doc, `${step} -lh companion`).not.toContain(`--text-${step}-lh`);
        expect(doc, `${step} -tr companion`).not.toContain(`--text-${step}-tr`);
        expect(doc, `${step} --line-height companion`).not.toContain(`--text-${step}--line-height`);
      }
      expect(doc).toContain("--text-hero--line-height");
      expect(doc).toContain("--text-hero-tr");
    }
  });
});
