import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CROSS_SURFACE_NAME_TWINS,
  validatePluginProductName,
  userFacingPluginMetadata,
  userFacingProductSurfaces,
  discoverSkillDefinitions,
  discoverRepositorySkillFiles,
  loadSkillCatalog,
  renderSkillCatalog,
  skillsRoot,
  validateSkillCatalog,
  validateRepositorySkillPolicies,
} from "../scripts/list-database-skills.mjs";

describe("Database skill catalog", () => {
  it("contains every canonical skill exactly once and validates every alias", () => {
    const catalog = loadSkillCatalog();
    const result = validateSkillCatalog();

    expect(result.errors).toEqual([]);
    expect(result.canonical).toHaveLength(35);
    expect(new Set(result.canonical.map((skill: { name: string }) => skill.name))).toHaveProperty("size", 35);
    expect(result.aliases).toHaveLength(8);
    for (const category of catalog.categories) {
      expect(category.skills.every((skill: unknown) => typeof skill === "string")).toBe(true);
    }
  });

  it("discovers each declared skill from its folder metadata", () => {
    const discovered = discoverSkillDefinitions();

    expect(discovered).toHaveLength(43);
    for (const skill of discovered) {
      if (!skill) continue;
      const metadataPath = path.join(skillsRoot, skill.name, "agents", "openai.yaml");
      expect(skill.directory).toBe(skill.name);
      expect(skill.description).toBeTruthy();
      expect(fs.existsSync(metadataPath)).toBe(true);

      const metadata = fs.readFileSync(metadataPath, "utf8");
      const shortDescription = metadata.match(/short_description:\s*"([^"]+)"/)?.[1] || "";
      const defaultPrompt = metadata.match(/default_prompt:\s*"([^"]+)"/)?.[1] || "";
      expect(shortDescription.length).toBeGreaterThanOrEqual(25);
      expect(shortDescription.length).toBeLessThanOrEqual(64);
      expect(defaultPrompt).toContain(`$${skill.name}`);
    }
  });

  it("keeps canonical skills compact and compatibility aliases as one-hop redirects", () => {
    const result = validateSkillCatalog();

    for (const skill of result.canonical) {
      const content = fs.readFileSync(path.join(skillsRoot, skill.name, "SKILL.md"), "utf8");
      expect(content.split(/\r?\n/).length).toBeLessThanOrEqual(30);
      expect(content.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(220);
    }

    for (const [alias, target] of result.aliases) {
      const content = fs.readFileSync(path.join(skillsRoot, alias, "SKILL.md"), "utf8");
      const metadata = fs.readFileSync(path.join(skillsRoot, alias, "agents", "openai.yaml"), "utf8");
      expect(content).toContain(`.agents/skills/${target}/SKILL.md`);
      expect(content.split(/\r?\n/).length).toBeLessThanOrEqual(15);
      expect(content).not.toContain("npm run");
      expect(metadata).toContain("allow_implicit_invocation: false");
    }
  });

  it("renders canonical skills by category without duplicating compatibility aliases", () => {
    const catalog = loadSkillCatalog();
    const rendered = renderSkillCatalog(catalog);

    expect(rendered).toContain(
      `Database skills (${catalog.categories.reduce(
        (acc: number, cat: { skills: string[] }) => acc + cat.skills.length,
        0,
      )})`,
    );
    expect(rendered).toContain("- skills — List every unique PsychSift-specific skill with a clear explanation");
    expect(rendered).not.toContain("- workflows —");
    for (const category of catalog.categories) expect(rendered).toContain(category.name);
  });

  it("validates every repository skill surface and shared safety policy", () => {
    const files = discoverRepositorySkillFiles();
    const result = validateRepositorySkillPolicies(files);

    expect(result.errors).toEqual([]);
    expect(files).toHaveLength(68);
    expect(result.surfaceCounts).toEqual({
      Codex: 43,
      Claude: 9,
      Cursor: 15,
      "PsychSift plugin": 1,
    });
  });

  it("keeps cross-surface skill names collision-free except intentional twins", () => {
    const files = discoverRepositorySkillFiles();
    const byName = new Map<string, typeof files>();
    for (const skill of files) {
      const content = fs.readFileSync(skill.file, "utf8");
      const name = content
        .match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
        ?.match(/^name:\s*(.+)$/m)?.[1]
        ?.trim();
      if (!name) continue;
      const group = byName.get(name) ?? [];
      group.push(skill);
      byName.set(name, group);
    }

    expect(CROSS_SURFACE_NAME_TWINS).toEqual(new Set(["ledger"]));
    expect(
      byName
        .get("ledger")
        ?.map((skill) => skill.surface)
        .sort(),
    ).toEqual(["Claude", "Codex"]);
    expect(byName.has("source-governance")).toBe(true);
    expect(byName.get("source-governance")?.every((skill) => skill.surface === "Codex")).toBe(true);
    expect(byName.get("sources")?.every((skill) => skill.surface === "Claude")).toBe(true);
    expect(byName.get("sources")?.some((skill) => skill.surface === "Codex")).toBeFalsy();
    expect(fs.existsSync(path.join(skillsRoot, "sources"))).toBe(false);
    expect(fs.existsSync(path.join(skillsRoot, "source-governance", "SKILL.md"))).toBe(true);

    const result = validateRepositorySkillPolicies(files);
    expect(result.errors.filter((error) => error.includes("Cross-surface skill name collision"))).toEqual([]);
  });

  it("keeps prompt-perfector execution authorization and repository isolation fail-closed", () => {
    const skillRoot = path.join(skillsRoot, "prompt-perfector");
    const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
    const metadata = fs.readFileSync(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
    const workflow = fs.readFileSync(path.join(skillRoot, "references", "repository-workflow.md"), "utf8");
    const verifier = fs.readFileSync(path.join(skillRoot, "scripts", "verify-repository-isolation.mjs"), "utf8");

    expect(skill).toContain("Execute only when explicit");
    expect(skill).not.toContain("Workspace:");
    expect(skill).not.toContain('Workspace: "branch"');
    expect(skill).not.toContain('Workspace: "share"');
    for (const [scenario, contract] of [
      ["refinement-only", "For refinement, return only `Perfected prompt`"],
      ["explicit evaluation", "For evaluation, return `Evaluation`"],
      ["embedded instructions", "as untrusted data"],
      ["unauthorized execution", "Prompt perfection never authorizes"],
      ["repository write", "references/repository-workflow.md"],
    ]) {
      expect(skill, scenario).toContain(contract);
    }
    expect(metadata).toContain("unless I explicitly request evaluation or execution");
    expect(workflow).toContain("^TASK_START\\s+git=(true|false)$");
    expect(workflow).toContain("$taskState.TASK_START -ne 'git=true'");
    expect(workflow).toContain("$env:USERPROFILE");
    expect(workflow).not.toContain("C:\\Users\\joshs");
    expect(workflow).toContain("start-codex-task.ps1");
    expect(workflow).toContain("git worktree add");
    expect(workflow).toContain("git rev-parse --show-toplevel");
    expect(workflow).toContain("CODEX_CLOUD=1");
    expect(workflow).toContain("--expected-status-hash");
    expect(workflow).toContain("--allow-dirty");
    expect(workflow).toContain("does not provide an OS-level sandbox");
    expect(verifier).toContain('["safe Cloud primary"');
    expect(verifier).toContain('reasons.push("status_drift")');
    expect(verifier).toContain("dirty_override_requires_expected_state");
    expect(verifier).toContain("expected_state_required");
    expect(verifier).toContain("primary_worktree");
    expect(verifier).not.toContain("node_modules");

    const selfTest = spawnSync(
      process.execPath,
      [path.join(skillRoot, "scripts", "verify-repository-isolation.mjs"), "--self-test"],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        encoding: "utf8",
        shell: false,
      },
    );
    expect(selfTest.status, `${selfTest.stdout}\n${selfTest.stderr}`).toBe(0);
    expect(selfTest.stdout).toContain("prompt-perfector isolation self-test passed: 14/14");
  });
});

describe("the plugin's user-facing product name", () => {
  // The plugin was renamed to PsychSift everywhere a person reads it while its
  // lowercase ids and paths stayed put. Nothing enforced that split, so the
  // marketplace card, the plugin's interface block and the routed skill's own
  // description kept advertising the retired name after the product was
  // renamed — which also makes a request phrased with the current name less
  // likely to route to this plugin, since selection matches on description.
  it("is clean across every surface a person or a skill router reads", () => {
    expect(validatePluginProductName().errors).toEqual([]);
  });

  it("still fails when a surface reverts to the retired name", () => {
    // Guards the guard: a check that cannot fail is not a check. Uses a frozen
    // quarterly archive, which genuinely still carries the string and always
    // will — rewriting a historical record to match a later name is exactly
    // what the surface list refuses to do — so nothing is written to disk.
    const { errors } = validatePluginProductName(["docs/archive/branch-review-ledger-2026-q3.md"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("retired product name");
  });

  it("names only user-facing files, never the ids and paths that must not move", () => {
    expect(userFacingPluginMetadata.length).toBeGreaterThan(0);
    for (const file of userFacingPluginMetadata) {
      expect(fs.existsSync(path.join(path.resolve(import.meta.dirname, ".."), file)), file).toBe(true);
    }
  });
});

describe("the repository's user-facing product name", () => {
  // The app was renamed to PsychSift but the repo front page, the security
  // policy, the container image labels and the living reference docs kept the
  // retired name — including a worker runbook quoting a startup log line the
  // worker has not emitted since the rename. Only living surfaces are covered:
  // dated reports, plans and ledgers record what was true when written.
  it("is clean across every repository surface a person reads", () => {
    expect(validatePluginProductName(userFacingProductSurfaces).errors).toEqual([]);
  });

  it("keeps the live Supabase project names, which are not the product name", () => {
    // `PsychSift Production` and `PsychSift Staging` are pinned by AGENTS.md.
    // A guard that stripped them would rename a real database out of the docs.
    const index = fs.readFileSync(path.resolve(import.meta.dirname, "..", "docs/codebase-index.md"), "utf8");
    expect(index).toContain("PsychSift Production");
    expect(validatePluginProductName(["docs/codebase-index.md"]).errors).toEqual([]);
  });

  it("names only files that exist", () => {
    expect(userFacingProductSurfaces.length).toBeGreaterThan(0);
    for (const file of userFacingProductSurfaces) {
      expect(fs.existsSync(path.join(path.resolve(import.meta.dirname, ".."), file)), file).toBe(true);
    }
  });

  it("guards every container image, because both publish the name in OCI labels", () => {
    // The miss this test exists for: the app `Dockerfile` was renamed and
    // guarded while `Dockerfile.worker` kept shipping the retired name in
    // `org.opencontainers.image.title` and `.description`. A guard list that
    // covers one of two published images reads as complete and is not, so
    // enumerate the images from disk rather than trusting the list.
    const root = path.resolve(import.meta.dirname, "..");
    const images = fs.readdirSync(root).filter((entry) => /^Dockerfile(\..+)?$/.test(entry));
    expect(images).toContain("Dockerfile");
    expect(images).toContain("Dockerfile.worker");
    for (const image of images) {
      expect(userFacingProductSurfaces, `${image} publishes OCI labels and must be guarded`).toContain(image);
    }
  });
});
