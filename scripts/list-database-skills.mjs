import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "..");
export const skillsRoot = path.join(repositoryRoot, ".agents", "skills");
export const catalogPath = path.join(skillsRoot, "catalog.json");
export const repositorySkillSurfaces = [
  { name: "Codex", root: skillsRoot },
  { name: "Claude", root: path.join(repositoryRoot, ".claude", "skills") },
  { name: "Cursor", root: path.join(repositoryRoot, ".cursor", "skills") },
  { name: "Clinical KB plugin", root: path.join(repositoryRoot, "plugins", "clinical-kb", "skills") },
];
export const expectedRepositorySkillSurfaceCounts = {
  Codex: 43,
  Claude: 8,
  Cursor: 15,
  "Clinical KB plugin": 1,
};

function wordCount(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function readAgentMetadata(metadataFile) {
  const content = fs.readFileSync(metadataFile, "utf8");
  return {
    content,
    shortDescription: content.match(/short_description:\s*"([^"]+)"/)?.[1] || "",
    defaultPrompt: content.match(/default_prompt:\s*"([^"]+)"/)?.[1] || "",
  };
}

function readFrontmatter(skillFile) {
  const content = fs.readFileSync(skillFile, "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${skillFile}`);

  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

function walkSkillFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkSkillFiles(absolute));
    else if (entry.isFile() && entry.name === "SKILL.md") files.push(absolute);
  }
  return files;
}

export function discoverRepositorySkillFiles(surfaces = repositorySkillSurfaces) {
  return surfaces
    .flatMap((surface) =>
      walkSkillFiles(surface.root).map((file) => ({
        file,
        relative: path.relative(repositoryRoot, file).replaceAll(path.sep, "/"),
        surface: surface.name,
      })),
    )
    .sort((left, right) => left.relative.localeCompare(right.relative));
}

function localMarkdownLinks(content) {
  return [...content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, ""))
    .filter((target) => target && !/^(?:https?:|mailto:|#)/i.test(target))
    .map((target) => target.split("#", 1)[0])
    .filter(Boolean);
}

export function validateRepositorySkillPolicies(
  files = discoverRepositorySkillFiles(),
  packageScripts = Object.keys(JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")).scripts),
) {
  const errors = [];
  const scripts = new Set(packageScripts);
  const byRelative = new Map();

  for (const skill of files) {
    const content = fs.readFileSync(skill.file, "utf8");
    byRelative.set(skill.relative, content);
    let frontmatter;
    try {
      frontmatter = readFrontmatter(skill.file);
    } catch (error) {
      errors.push(`${skill.relative}: ${error.message}`);
      continue;
    }
    if (!frontmatter.name?.trim()) errors.push(`${skill.relative}: missing skill name`);
    if (!frontmatter.description?.trim()) errors.push(`${skill.relative}: missing skill description`);

    for (const target of localMarkdownLinks(content)) {
      const resolved = path.resolve(path.dirname(skill.file), target);
      if (!fs.existsSync(resolved)) errors.push(`${skill.relative}: broken local link ${target}`);
    }

    for (const match of content.matchAll(/npm run ([A-Za-z0-9:_*-]+)/g)) {
      const command = match[1];
      if (command.includes("*") || command.endsWith(":")) continue;
      if (!scripts.has(command)) errors.push(`${skill.relative}: unknown npm script ${command}`);
    }

    if (/update `docs\/branch-review-ledger\.md`/i.test(content)) {
      errors.push(`${skill.relative}: instructs direct review-ledger mutation`);
    }
    if (
      /npm run (?:verify:release|check:supabase-project)/.test(content) &&
      !/(?:approval|confirmation)/i.test(content)
    ) {
      errors.push(`${skill.relative}: mentions a provider-backed gate without an approval boundary`);
    }
  }

  const requireContract = (relative, fragments) => {
    const content = byRelative.get(relative);
    if (!content) {
      errors.push(`${relative}: required skill is missing`);
      return;
    }
    for (const fragment of fragments) {
      if (!content.includes(fragment)) errors.push(`${relative}: missing policy contract ${JSON.stringify(fragment)}`);
    }
  };

  requireContract(".claude/skills/issues/SKILL.md", [
    "creates one validated UUID JSON file",
    "never edit the canonical ledger",
    "commit only the newly created request file(s)",
    "git add -- docs/outstanding-issues-inbox/<uuid>.json",
  ]);
  requireContract(".claude/skills/ledger/SKILL.md", [
    "create no request and do not change the canonical ledger",
    "Do not refresh",
    "commit only the newly created request file(s)",
  ]);
  requireContract(".cursor/skills/supabase/SKILL.md", [
    "prove the target is a disposable local development database",
    "never use `execute_sql`",
    "require explicit user approval",
  ]);
  requireContract(".cursor/skills/cursor-codebase-indexing/SKILL.md", [
    "Do not delete or rename the application-wide Cursor cache automatically",
    "Indexing is provider-backed",
  ]);
  requireContract(".claude/skills/handoff/SKILL.md", [
    "never unstage",
    "mutate another session's index entries",
    "run `npm run format`",
  ]);
  requireContract(".claude/skills/prlanded/SKILL.md", [
    "require an explicit cleanup request",
    "does not itself authorize deletion",
  ]);
  requireContract(".cursor/skills/release-readiness-review/SKILL.md", [
    "Use `npm run verify:pr-local`",
    "requires user approval",
    "`npm run check:supabase-project` is provider-backed",
  ]);
  requireContract(".cursor/skills/testing-review/SKILL.md", ["`verify:release` only after explicit user approval"]);
  requireContract("plugins/clinical-kb/skills/clinical-kb-workflow/SKILL.md", [
    "use `npm run verify:pr-local`",
    "explicitly requests release confidence",
    "do not run it without explicit user approval",
  ]);

  const cursorReviewSkills = [
    "accessibility-review",
    "ai-architecture-review",
    "api-review",
    "code-quality-review",
    "design-review",
    "frontend-architecture-review",
    "performance-review",
    "release-readiness-review",
    "repo-auditor",
    "security-review",
    "supabase-postgres-best-practices",
    "testing-review",
    "ux-review",
  ];
  for (const name of cursorReviewSkills) {
    requireContract(`.cursor/skills/${name}/SKILL.md`, [
      "use `npm run ledger:append` to create an immutable review record",
      "never edit the frozen `docs/branch-review-ledger.md` table",
    ]);
  }

  const indexing = byRelative.get(".cursor/skills/cursor-codebase-indexing/SKILL.md") ?? "";
  if (indexing.includes("Bash(cmd:*)")) {
    errors.push(".cursor/skills/cursor-codebase-indexing/SKILL.md: grants unrestricted shell access");
  }

  const surfaceCounts = Object.fromEntries(
    repositorySkillSurfaces.map((surface) => [
      surface.name,
      files.filter((file) => file.surface === surface.name).length,
    ]),
  );
  for (const [surface, expected] of Object.entries(expectedRepositorySkillSurfaceCounts)) {
    const actual = surfaceCounts[surface] ?? 0;
    if (actual !== expected) {
      errors.push(`Repository skill inventory mismatch for ${surface}: expected ${expected}, found ${actual}`);
    }
  }
  return { errors, files, surfaceCounts };
}

export function loadSkillCatalog(file = catalogPath) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function discoverSkillDefinitions(root = skillsRoot) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillFile = path.join(root, entry.name, "SKILL.md");
      if (!fs.existsSync(skillFile)) return null;
      const frontmatter = readFrontmatter(skillFile);
      return { directory: entry.name, name: frontmatter.name, description: frontmatter.description };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function validateSkillCatalog(catalog = loadSkillCatalog(), discovered = discoverSkillDefinitions()) {
  const errors = [];
  if (catalog.version !== 1) errors.push(`Unsupported catalog version: ${catalog.version}`);
  const categories = Array.isArray(catalog.categories) ? catalog.categories : [];
  if (categories.length === 0) errors.push("Catalog must contain at least one category");
  for (const category of categories) {
    if (typeof category.name !== "string" || !category.name.trim()) errors.push("Catalog category is missing a name");
    if (!Array.isArray(category.skills) || category.skills.length === 0) {
      errors.push(`Catalog category has no skills: ${category.name || "unnamed"}`);
    }
  }

  const categoryNames = categories.map((category) => category.name);
  const canonical = categories.flatMap((category) =>
    (Array.isArray(category.skills) ? category.skills : []).map((name) => ({ name, category: category.name })),
  );
  const canonicalNames = canonical.map((skill) => skill.name);
  const aliases = Object.entries(catalog.aliases || {});
  const aliasNames = aliases.map(([alias]) => alias);
  const aliasTargets = new Map(aliases);
  const discoveredByName = new Map(discovered.map((skill) => [skill.name, skill]));
  const discoveredNames = discovered.map((skill) => skill.name);
  const descriptions = new Map();

  for (const [label, names] of [
    ["category", categoryNames],
    ["canonical skill", canonicalNames],
    ["alias", aliasNames],
    ["discovered skill", discoveredNames],
  ]) {
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicates.length) errors.push(`Duplicate ${label} names: ${[...new Set(duplicates)].join(", ")}`);
  }

  for (const skill of canonical) {
    if (!/^[a-z0-9-]+$/.test(skill.name)) errors.push(`Invalid canonical skill name: ${skill.name}`);
    const discoveredSkill = discoveredByName.get(skill.name);
    if (!discoveredSkill) errors.push(`Missing canonical skill folder: ${skill.name}`);
    else if (discoveredSkill.directory !== skill.name) {
      errors.push(`Canonical skill directory mismatch: ${skill.name} is in ${discoveredSkill.directory}`);
    } else {
      descriptions.set(skill.name, discoveredSkill.description);
    }
  }

  for (const [alias, target] of aliases) {
    if (!canonicalNames.includes(target)) errors.push(`Alias ${alias} targets missing canonical skill ${target}`);
    if (canonicalNames.includes(alias)) errors.push(`Alias duplicates canonical skill: ${alias}`);
    if (!discoveredByName.has(alias)) errors.push(`Missing compatibility alias folder: ${alias}`);
  }

  const allowed = new Set([...canonicalNames, ...aliasNames]);
  for (const skill of discovered) {
    if (!allowed.has(skill.name)) errors.push(`Uncatalogued Database skill: ${skill.name}`);
    if (skill.name !== skill.directory)
      errors.push(`Skill name/directory mismatch: ${skill.directory} declares ${skill.name}`);
    if (!skill.description?.trim()) errors.push(`Missing skill description: ${skill.name}`);
    if (wordCount(skill.description) > 60) errors.push(`Skill description exceeds 60 words: ${skill.name}`);

    const skillFile = path.join(skillsRoot, skill.directory, "SKILL.md");
    const skillContent = fs.readFileSync(skillFile, "utf8");
    const lineCount = skillContent.split(/\r?\n/).length;
    const metadataFile = path.join(skillsRoot, skill.directory, "agents", "openai.yaml");
    if (!fs.existsSync(metadataFile)) {
      errors.push(`Missing agents/openai.yaml: ${skill.name}`);
      continue;
    }

    const metadata = readAgentMetadata(metadataFile);
    if (metadata.shortDescription.length < 25 || metadata.shortDescription.length > 64) {
      errors.push(`Invalid short_description length for ${skill.name}: ${metadata.shortDescription.length}`);
    }
    if (!metadata.defaultPrompt.includes(`$${skill.name}`)) {
      errors.push(`default_prompt does not mention $${skill.name}`);
    }

    const aliasTarget = aliasTargets.get(skill.name);
    if (aliasTarget) {
      if (!skillContent.includes(`.agents/skills/${aliasTarget}/SKILL.md`)) {
        errors.push(`Alias ${skill.name} does not redirect to ${aliasTarget}`);
      }
      if (lineCount > 15) errors.push(`Alias skill is too long: ${skill.name} (${lineCount} lines)`);
      if (skillContent.includes("npm run")) errors.push(`Alias duplicates executable procedure: ${skill.name}`);
      if (!metadata.content.includes("allow_implicit_invocation: false")) {
        errors.push(`Alias allows implicit invocation: ${skill.name}`);
      }
    } else {
      if (lineCount > 30) errors.push(`Canonical skill is too long: ${skill.name} (${lineCount} lines)`);
      if (wordCount(skillContent) > 220) errors.push(`Canonical skill exceeds 220 words: ${skill.name}`);
    }
  }

  return { errors, canonical, aliases, discovered, descriptions };
}

export function summarizeSkillDescription(description) {
  return String(description || "")
    .split(/\.\s+Use\b/, 1)[0]
    .trim()
    .replace(/\.$/, "");
}

export function renderSkillCatalog(catalog = loadSkillCatalog(), discovered = discoverSkillDefinitions()) {
  const validation = validateSkillCatalog(catalog, discovered);
  if (validation.errors.length) throw new Error(validation.errors.join("\n"));

  const descriptions = validation.descriptions;
  const lines = [`Database skills (${validation.canonical.length})`, ""];
  for (const category of catalog.categories) {
    lines.push(category.name);
    for (const name of category.skills) {
      lines.push(`- ${name} — ${summarizeSkillDescription(descriptions.get(name))}.`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function run(argv = process.argv.slice(2)) {
  const catalog = loadSkillCatalog();
  const validation = validateSkillCatalog(catalog);
  const repositoryValidation = validateRepositorySkillPolicies();
  const errors = [...validation.errors, ...repositoryValidation.errors];
  if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
    return;
  }

  if (argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          count: validation.canonical.length,
          categories: catalog.categories,
          repositorySkillFiles: repositoryValidation.files.length,
          surfaces: repositoryValidation.surfaceCounts,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (argv.includes("--check")) {
    console.log(
      `Database skill system valid: ${validation.canonical.length} canonical skills, ${validation.aliases.length} aliases, ` +
        `${repositoryValidation.files.length} repository SKILL.md files across ${Object.keys(repositoryValidation.surfaceCounts).length} surfaces.`,
    );
    return;
  }
  console.log(renderSkillCatalog(catalog));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) run();
