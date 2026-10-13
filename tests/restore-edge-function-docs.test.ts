import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const configuredFunctions = [...read("supabase/config.toml").matchAll(/^\[functions\.([\w-]+)\]/gm)].map(
  (match) => match[1],
);

describe("post-restore edge function procedures", () => {
  it("lists configured edge functions", () => {
    expect(configuredFunctions).toEqual(expect.arrayContaining(["indexing-v3-agent", "site-content-sync"]));
  });

  for (const doc of ["docs/db-maintenance.md", "docs/disaster-recovery-runbook.md"]) {
    it(`${doc} redeploys every configured edge function`, () => {
      const text = read(doc);
      for (const name of configuredFunctions) {
        expect(text).toContain(`supabase functions deploy ${name} --project-ref <PROJECT_REF>`);
      }
    });
  }
});
