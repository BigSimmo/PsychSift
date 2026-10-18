import { describe, expect, it } from "vitest";
import {
  botSensitiveCommitViolations,
  evaluatePullRequestPolicy,
  isBotAuthor,
  isBotSensitivePath,
} from "../scripts/pr-policy.mjs";

const bot = { login: "qodo-merge-pro[bot]", email: "" };
const human = { login: "BigSimmo", email: "87357024+BigSimmo@users.noreply.github.com" };

describe("PR policy: bot-authored sensitive changes", () => {
  it("recognises bot authors by login suffix, known login and noreply email", () => {
    expect(isBotAuthor(bot)).toBe(true);
    expect(isBotAuthor({ login: "dependabot[bot]" })).toBe(true);
    expect(isBotAuthor({ login: "Qodo-Merge-Pro" })).toBe(true);
    expect(isBotAuthor({ login: "", email: "49699333+dependabot[bot]@users.noreply.github.com" })).toBe(true);
    expect(isBotAuthor({ login: "", email: "123+coderabbitai@users.noreply.github.com" })).toBe(true);
    expect(isBotAuthor(human)).toBe(false);
    expect(isBotAuthor(undefined)).toBe(false);
  });

  it("treats supabase, backend infra SQL and clinical paths as sensitive", () => {
    expect(isBotSensitivePath("supabase/migrations/20261018000000_x.sql")).toBe(true);
    expect(isBotSensitivePath("backend/api/infra/schema.sql")).toBe(true);
    expect(isBotSensitivePath("backend/infra/seed.sql")).toBe(true);
    expect(isBotSensitivePath("src/lib/clinical-thresholds.ts")).toBe(true);
    expect(isBotSensitivePath("package.json")).toBe(false);
    expect(isBotSensitivePath("docs/README.md")).toBe(false);
    expect(isBotSensitivePath("backend/api/infra/notes.md")).toBe(false);
  });

  it("flags only bot commits whose own files are sensitive", () => {
    expect(
      botSensitiveCommitViolations([{ sha: "a".repeat(40), author: bot, files: ["supabase/functions/x/index.ts"] }]),
    ).toHaveLength(1);
    expect(
      botSensitiveCommitViolations([
        { sha: "b".repeat(40), author: human, files: ["supabase/migrations/1_x.sql"] },
        { sha: "c".repeat(40), author: bot, files: ["README.md"] },
      ]),
    ).toEqual([]);
    expect(
      botSensitiveCommitViolations([
        { sha: "d".repeat(40), author: { login: "dependabot[bot]" }, files: ["package.json", "package-lock.json"] },
      ]),
    ).toEqual([]);
  });

  it("fails closed when a bot commit's files are unknown", () => {
    expect(botSensitiveCommitViolations([{ sha: "e".repeat(40), author: bot }])[0]).toMatch(/failing closed/);
  });

  it("blocks evaluatePullRequestPolicy only when commits are supplied and violate", () => {
    const base = {
      title: "chore: tidy",
      body: "",
      headRef: "chore/tidy",
      files: ["README.md"],
      fileStatuses: [{ filename: "README.md", status: "modified", previous_filename: null }],
    };
    const bad = evaluatePullRequestPolicy({
      ...base,
      commits: [{ sha: "f".repeat(40), author: bot, files: ["supabase/config.toml"] }],
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(" ")).toMatch(/Bot-authored commit/);
    const withoutCommits = evaluatePullRequestPolicy(base);
    const withCleanCommits = evaluatePullRequestPolicy({ ...base, commits: [] });
    expect(withCleanCommits.errors).toEqual(withoutCommits.errors);
  });
});
