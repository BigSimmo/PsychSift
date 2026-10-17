import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hasMhaTimeline } from "@/lib/mha-timeline";
import { mhaClockForms } from "@/lib/psychiatry-hub/mha-clock-forms";
import { fetchStarterSharing, writeStarterSharing } from "@/lib/work-roles/starter-sharing";
import {
  EXPECTED_CATATONIA_ROW_KEYS,
  parseCatatoniaWorksheet,
  parseWorksheetArgs,
} from "../scripts/apply-specifier-worksheet.mjs";

const REPO_ROOT = process.cwd();

describe("mhaClockForms", () => {
  it("returns only forms that carry governed MHA timeline definitions", () => {
    const forms = mhaClockForms();
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      expect(form.code.length).toBeGreaterThan(0);
      expect(form.title.length).toBeGreaterThan(0);
      expect(form.slug.length).toBeGreaterThan(0);
      expect(hasMhaTimeline(form.code)).toBe(true);
    }
  });
});

describe("starter-sharing preference reader and CAS writer", () => {
  it("rejects empty ownerId and reads default off choice when no preferences row exists", async () => {
    const fakeSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof fetchStarterSharing>[0];

    await expect(fetchStarterSharing(fakeSupabase, "")).rejects.toThrow("Missing sharing owner.");
    const choice = await fetchStarterSharing(fakeSupabase, "user-123");
    expect(choice).toEqual({ workforce: false, updatedAt: null });
  });

  it("inserts a new preferences row or updates an existing row via compare-and-swap", async () => {
    const state: {
      storedRow: { preferences: Record<string, unknown>; updated_at: string } | null;
    } = { storedRow: null };
    const fakeSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state.storedRow, error: null }),
          }),
        }),
        insert: async (payload: { preferences: Record<string, unknown>; updated_at: string }) => {
          state.storedRow = { preferences: payload.preferences, updated_at: payload.updated_at };
          return { error: null };
        },
        update: (payload: { preferences: Record<string, unknown>; updated_at: string }) => ({
          eq: (column: string, ownerId: string) => ({
            eq: (timestampColumn: string, expectedUpdatedAt: string) => ({
              select: () => ({
                maybeSingle: async () => {
                  // Enforce both predicates, as Supabase does for the CAS update.
                  if (
                    column !== "user_id" ||
                    ownerId !== "user-123" ||
                    timestampColumn !== "updated_at" ||
                    !state.storedRow ||
                    state.storedRow.updated_at !== expectedUpdatedAt
                  ) {
                    return { data: null, error: null };
                  }
                  state.storedRow = { preferences: payload.preferences, updated_at: payload.updated_at };
                  return { data: { updated_at: payload.updated_at }, error: null };
                },
              }),
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof writeStarterSharing>[0];

    const first = await writeStarterSharing(fakeSupabase, "user-123", true);
    expect(first.workforce).toBe(true);
    expect(typeof first.updatedAt).toBe("string");

    const second = await writeStarterSharing(fakeSupabase, "user-123", false);
    expect(second.workforce).toBe(false);
    expect(state.storedRow?.preferences).toHaveProperty("starterSharing");
  });
});

describe("apply-specifier-worksheet CLI & parser", () => {
  it("parses CLI flags and validates catatonia worksheet keys", () => {
    expect(EXPECTED_CATATONIA_ROW_KEYS).toHaveLength(9);
    expect(parseWorksheetArgs(["--worksheet", "docs/custom.md", "--write"])).toEqual({
      worksheet: "docs/custom.md",
      write: true,
      dryRun: false,
    });
    expect(() => parseWorksheetArgs(["--dry-run", "--write"])).toThrow("Specify at most one of --dry-run or --write.");

    expect(() => parseCatatoniaWorksheet("# Shared\n> _(blank)_\n## 2. Disorders\n")).toThrow(
      /Worksheet is incomplete; refusing to apply/,
    );

    let failure: { status?: number | null; stderr?: string } | undefined;
    try {
      execFileSync(process.execPath, ["scripts/run-preview-smoke.mjs", "--url", "http://["], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      failure = error as { status?: number | null; stderr?: string };
    }
    // Pin the URL-validation exit, not just any failure (missing script, syntax error, crash).
    expect(failure?.status).toBe(1);
    expect(failure?.stderr).toContain('Invalid preview URL: "http://["');
  });
});
