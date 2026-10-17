import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "..");
const wrapper = join(repo, "scripts", "with-isolated-cloud-home.sh");
const temporary: string[] = [];
function fixture() {
  const path = mkdtempSync(join(tmpdir(), "cloud-isolation-"));
  temporary.push(path);
  return path;
}
function run(
  root: string,
  command: string[] = [
    process.execPath,
    "-e",
    "console.log(JSON.stringify({home:process.env.HOME,codex:process.env.CODEX_HOME,claude:process.env.CLAUDE_CONFIG_DIR,proxy:process.env.HTTPS_PROXY,ca:process.env.SSL_CERT_FILE}))",
  ],
) {
  return spawnSync("bash", [wrapper, "--root", root, "--", ...command], {
    cwd: repo,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      HTTPS_PROXY: "http://synthetic.invalid:8080",
      NODE_EXTRA_CA_CERTS: undefined,
      SSL_CERT_FILE: "/synthetic/host-ca.pem",
      GH_TOKEN: "synthetic-inherited-token",
    },
  });
}
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("explicit isolated Cloud subprocess", () => {
  it("scopes three homes, preserves proxy/CA policy, and leaves parent values unchanged", () => {
    const root = join(fixture(), "scope");
    const oldHome = process.env.HOME;
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      home: join(root, "home"),
      codex: join(root, "codex"),
      claude: join(root, "claude"),
      proxy: "http://synthetic.invalid:8080",
      ca: "/synthetic/host-ca.pem",
    });
    expect(process.env.HOME).toBe(oldHome);
    expect(readdirSync(join(root, "home"))).toEqual([]);
    expect(run(root, ["bash", "-c", "exit 17"]).status).toBe(17);
    expect(
      run(root, [process.execPath, "-e", "process.exit(process.env.GH_TOKEN === 'synthetic-inherited-token' ? 0 : 1)"])
        .status,
    ).toBe(0);
  });
  it("preserves child standard input", () => {
    const root = join(fixture(), "scope");
    const result = spawnSync("bash", [wrapper, "--root", root, "--", "cat"], {
      cwd: repo,
      encoding: "utf8",
      timeout: 10_000,
      input: "synthetic child input\n",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("synthetic child input\n");
  });
  it("refuses unowned existing directories and never runs the child on failure", () => {
    const parent = fixture();
    const root = join(parent, "unowned");
    mkdirSync(root);
    writeFileSync(join(root, "personal"), "preserve");
    const sentinel = join(parent, "child-ran");
    expect(run(root, ["touch", sentinel]).status).not.toBe(0);
    expect(readdirSync(root)).toEqual(["personal"]);
    expect(readFileSync(join(root, "personal"), "utf8")).toBe("preserve");
    expect(readdirSync(parent)).not.toContain("child-ran");
  });
  it("refuses symlink roots, parent components, and replacement config homes", () => {
    const parent = fixture();
    const real = join(parent, "real");
    mkdirSync(real);
    const link = join(parent, "link");
    symlinkSync(real, link);
    expect(run(link).status).not.toBe(0);
    expect(run(join(link, "scope")).status).not.toBe(0);
    expect(readdirSync(real)).toEqual([]);
    const root = join(parent, "owned");
    expect(run(root).status).toBe(0);
    rmSync(join(root, "codex"), { recursive: true });
    symlinkSync(real, join(root, "codex"));
    expect(run(root).status).not.toBe(0);
    expect(readdirSync(real)).toEqual([]);
  });
  it("binds directory ownership to the physical checkout", () => {
    const parent = fixture();
    const root = join(parent, "owned");
    expect(run(root).status).toBe(0);
    const marker = join(root, ".psychsift-cloud-scope.json");
    const ownership = JSON.parse(readFileSync(marker, "utf8"));
    ownership.checkout = "/another-checkout";
    writeFileSync(marker, JSON.stringify(ownership));
    expect(run(root).status).not.toBe(0);
  });
});
