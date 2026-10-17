import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
function fixture() {
  const source = mkdtempSync(join(tmpdir(), "claude-write-safety-"));
  paths.push(source);
  const config = join(source, "config");
  const profile = join(source, ".claude", "cloud-profile");
  const script = join(source, "scripts", "apply-claude-cloud-profile.mjs");
  mkdirSync(dirname(script), { recursive: true });
  mkdirSync(profile, { recursive: true });
  mkdirSync(config);
  cpSync(join(import.meta.dirname, "..", "scripts", "apply-claude-cloud-profile.mjs"), script);
  writeFileSync(join(profile, "settings.json"), JSON.stringify({ managedFlag: true }));
  return {
    source,
    config,
    profile,
    run(prefix = "", skip = "claude-md,skills,memory") {
      const wrapper = join(source, "wrapper.mjs");
      writeFileSync(
        wrapper,
        `${prefix}\nprocess.umask(0);\nawait import('./scripts/apply-claude-cloud-profile.mjs');\n`,
      );
      return spawnSync(process.execPath, [wrapper, "--force", `--skip=${skip}`], {
        encoding: "utf8",
        timeout: 10_000,
        env: { NODE_ENV: "test", HOME: source, CLAUDE_CONFIG_DIR: config },
      });
    },
  };
}

describe("Claude managed-file write safety", () => {
  it.skipIf(process.platform === "win32")(
    "keeps settings and ownership records private under a permissive umask",
    () => {
      const f = fixture();
      writeFileSync(join(f.config, "settings.json"), JSON.stringify({ syntheticHostValue: true }), { mode: 0o600 });
      const result = f.run();
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(readFileSync(join(f.config, "settings.json"), "utf8"))).toEqual({
        syntheticHostValue: true,
        managedFlag: true,
      });
      expect(statSync(join(f.config, "settings.json")).mode & 0o777).toBe(0o600);
      expect(statSync(join(f.config, ".cloud-profile-install.json")).mode & 0o777).toBe(0o600);
    },
  );

  it("preserves a pre-existing temporary-file collision and the original destination", () => {
    const f = fixture();
    const settings = join(f.config, "settings.json");
    writeFileSync(settings, '{"syntheticHostValue":true}\n');
    const result = f.run(
      `import { writeFileSync } from 'node:fs';\nconst collision = process.env.CLAUDE_CONFIG_DIR + '/settings.json.cloud-profile-' + process.pid + '.tmp';\nwriteFileSync(collision, 'host-owned temporary content');\nconsole.log('COLLISION=' + collision);`,
    );
    expect(result.status).toBe(1);
    const collision = result.stdout.match(/^COLLISION=(.+)$/m)?.[1];
    expect(collision).toBeTruthy();
    expect(readFileSync(collision!, "utf8")).toBe("host-owned temporary content");
    expect(readFileSync(settings, "utf8")).toBe('{"syntheticHostValue":true}\n');
  });

  it.skipIf(process.platform === "win32")("retains executable source permissions for installed skill helpers", () => {
    const f = fixture();
    const helper = join(f.profile, "skills", "fixture", "helper.sh");
    mkdirSync(dirname(helper), { recursive: true });
    writeFileSync(helper, "#!/bin/sh\nexit 0\n");
    chmodSync(helper, 0o755);
    const result = f.run("", "settings,claude-md,memory");
    expect(result.status, result.stderr).toBe(0);
    expect(statSync(join(f.config, "skills", "fixture", "helper.sh")).mode & 0o777).toBe(0o755);
  });
});
