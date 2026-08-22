import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
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
    expect(rendered).toContain("- skills — List every unique Database-specific skill with a clear explanation");
    expect(rendered).not.toContain("- workflows —");
    for (const category of catalog.categories) expect(rendered).toContain(category.name);
  });

  it("validates every repository skill surface and shared safety policy", () => {
    const files = discoverRepositorySkillFiles();
    const result = validateRepositorySkillPolicies(files);

    expect(result.errors).toEqual([]);
    expect(files).toHaveLength(67);
    expect(result.surfaceCounts).toEqual({
      Codex: 43,
      Claude: 8,
      Cursor: 15,
      "Clinical KB plugin": 1,
    });
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
