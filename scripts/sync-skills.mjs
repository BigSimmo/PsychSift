import fs from "node:fs";
import path from "node:path";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
import { discoverSkillDefinitions, catalogPath, loadSkillCatalog, skillsRoot } from "./list-database-skills.mjs";

function escapeYamlDoubleQuoted(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function ensureYamlManifest(skill, aliasTarget) {
  const metadataDir = path.join(skillsRoot, skill.directory, "agents");
  const metadataFile = path.join(metadataDir, "openai.yaml");

  if (!fs.existsSync(metadataFile)) {
    fs.mkdirSync(metadataDir, { recursive: true });

    // Create a 25-64 character short description. Pad with a long enough
    // suffix so even empty/3-char seeds still reach the 25-character floor.
    const pad = " for the Database productivity skill catalog";
    let shortDesc = skill.description.trim().split(".")[0];
    if (shortDesc.length < 25) {
      shortDesc = (shortDesc + pad).slice(0, 64);
      if (shortDesc.length < 25) shortDesc = shortDesc.padEnd(25, ".");
    } else if (shortDesc.length > 64) {
      shortDesc = shortDesc.slice(0, 61) + "...";
    }

    // Alias manifests must mention the declared alias name so check:skills /
    // database-skills tests accept them, while still directing agents to the
    // canonical target skill.
    const defaultPrompt = aliasTarget ? `Run $${skill.name} (alias for $${aliasTarget})` : `Run $${skill.name}`;
    const yaml = `name: "${escapeYamlDoubleQuoted(skill.name)}"
short_description: "${escapeYamlDoubleQuoted(shortDesc)}"
default_prompt: "${escapeYamlDoubleQuoted(defaultPrompt)}"
allow_implicit_invocation: ${aliasTarget ? "false" : "true"}
`;
    fs.writeFileSync(metadataFile, yaml, "utf8");
    console.log(`Created manifest for ${skill.name}`);
  }
}

function syncSkills() {
  const discovered = discoverSkillDefinitions();
  const catalog = loadSkillCatalog();

  const existingCanonical = new Set(catalog.categories.flatMap((cat) => (Array.isArray(cat.skills) ? cat.skills : [])));
  const aliases = new Map(Object.entries(catalog.aliases || {}));

  const newSkills = discovered.filter((skill) => !existingCanonical.has(skill.name) && !aliases.has(skill.name));

  if (newSkills.length > 0) {
    const names = newSkills
      .map((skill) => skill.name)
      .sort()
      .join(", ");
    throw new Error(
      `Uncatalogued skill folders: ${names}. Add each folder explicitly to ${path.relative(process.cwd(), catalogPath)} as a canonical skill or compatibility alias.`,
    );
  }

  console.log("Skill catalog is already up to date.");

  for (const skill of discovered) {
    ensureYamlManifest(skill, aliases.get(skill.name));
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  syncSkills();
}
