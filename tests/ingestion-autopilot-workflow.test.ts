import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "ingestion-autopilot.yml"), "utf8").replace(
  /\r\n/g,
  "\n",
);

describe("ingestion autopilot workflow secret handling", () => {
  it("does not expose the Supabase service-role key to checkout or install steps", () => {
    // Workflow-level and job-level env both use fewer than 10 spaces; only
    // step-scoped env under Preflight / Run autopilot should inject the secret.
    expect(workflow).not.toMatch(/^(?: {0,6})env:\n(?: {2,8}[^\n]+\n)* {2,8}SUPABASE_SERVICE_ROLE_KEY:/m);

    expect(workflow).not.toMatch(/^  workflow_dispatch:/m);
    expect(workflow).toContain("repository_dispatch:");
    expect(workflow).toContain("types: [ingestion-autopilot]");
    expect(workflow).toContain("APPLY_REQUESTED: ${{ github.event.client_payload.apply || 'false' }}");
    // Audit F-21: the key comes from the main-only production-secrets environment, which has no
    // required reviewers so the schedule runs unattended; it is not an approval gate for --apply.
    expect(workflow.match(/^\s+environment:.*$/gm)?.map((line) => line.trim())).toEqual([
      "environment: production-secrets",
    ]);

    const secretLines = workflow.split("\n").filter((line) => line.includes("SUPABASE_SERVICE_ROLE_KEY:"));
    expect(secretLines).toEqual([
      "          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}",
      "          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}",
    ]);

    const installIndex = workflow.indexOf("      - name: Install dependencies");
    const checkoutIndex = workflow.indexOf("      - name: Checkout");
    const preflightIndex = workflow.indexOf("      - name: Preflight required secrets");
    const setupIndex = workflow.indexOf("      - name: Setup Node.js");
    const autopilotIndex = workflow.indexOf("      - name: Run autopilot");
    expect(checkoutIndex).toBeGreaterThan(-1);
    expect(preflightIndex).toBeGreaterThan(checkoutIndex);
    expect(setupIndex).toBeGreaterThan(preflightIndex);
    expect(installIndex).toBeGreaterThan(-1);
    expect(autopilotIndex).toBeGreaterThan(installIndex);

    const checkoutBlock = workflow.slice(checkoutIndex, preflightIndex);
    const preflightBlock = workflow.slice(preflightIndex, setupIndex);
    expect(checkoutBlock).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(preflightBlock).toContain("SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}");

    const installBlock = workflow.slice(installIndex, autopilotIndex);
    expect(installBlock).not.toContain("SUPABASE_SERVICE_ROLE_KEY");

    const autopilotBlock = workflow.slice(autopilotIndex);
    expect(autopilotBlock).toContain("SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}");
  });
});
