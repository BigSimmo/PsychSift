import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const CPD_DIRS = ["src/components/cme", "src/app/(search-app)/cme"];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => join(dir, file).replaceAll("\\", "/"));
}

describe("CPD checkboxes", () => {
  const files = CPD_DIRS.flatMap(tsxFiles);

  it("never draws a bare native checkbox", () => {
    expect(files.filter((file) => /type=["']checkbox["']/.test(readFileSync(file, "utf8")))).toEqual([]);
  });

  it("uses the app's one shared Checkbox wherever CPD asks a yes/no", () => {
    const users = files.filter((file) => readFileSync(file, "utf8").includes('from "@/components/ui/choice"'));
    expect(users.sort()).toEqual([
      "src/components/cme/cme-entry-form.tsx",
      "src/components/cme/cme-evidence-panel.tsx",
      "src/components/cme/cme-new-entry-route.tsx",
      "src/components/cme/cme-setup-page.tsx",
    ]);
  });
});
