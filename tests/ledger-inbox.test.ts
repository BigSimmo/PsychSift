import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  acquireReconcileLock,
  applyRequest,
  applyRequestBatch,
  planRequestBatch,
  validateRequest,
} from "../scripts/ledger-inbox.mjs";
import {
  mergeArchiveOutcome,
  pruneResolvedIdFromQueue,
  resolveIssue,
  updateArchivedIssue,
} from "../scripts/outstanding-issues.mjs";
import {
  archiveRowFingerprint,
  checkIssues,
  parseIssues,
  issueRowFingerprint,
} from "../scripts/check-outstanding-issues.mjs";

const BASE_LEDGER = [
  "<!-- issues:next-id=10 -->",
  "",
  "## Recommended execution queue",
  "",
  "<!-- prettier-ignore -->",
  "",
  "| Order | ID(s) | Acuity | Capability | When | Estimate | Outcome |",
  "| ----: | -------------- | -------- | --- | --- | --- | --- |",
  "| 1 | `#001` | A2 | High | now | 1h | solo |",
  "| 2 | `#DREDWA` | A2 | Med | later | 2h | crockford |",
  "",
  "## Open items",
  "",
  "<!-- prettier-ignore -->",
  "",
  "| ID | Pri | Type | Summary | Detail / next action | Source | Added |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  "| #001 | P2 | issue | First open issue | detail one | src | 2026-01-01 |",
  "| #002 | P3 | task | Second open task | detail two | src | 2026-01-02 |",
  "| #DREDWA <!-- issue-ulid:01M09A9WXBDREDWA7KN2EB1JRA --> | P2 | task | Crockford issue | detail crockford | src | 2026-01-03 |",
  "",
  "## Resolved / archive",
  "",
  "<!-- prettier-ignore -->",
  "",
  "| ID | Type | Summary | Outcome | Resolved |",
  "| ---- | ---- | ---- | ---- | ---- |",
  "| #000 | task | Initial task | Closed in bootstrap | 2025-12-01 |",
  "| #005 | issue | Prior resolved issue | Original outcome text from PR #10 | 2026-01-01 |",
  "",
].join("\n");

describe("ledger inbox intake and lock admission", () => {
  const add = {
    version: 1,
    id: "11111111-1111-4111-8111-111111111111",
    createdOn: "2026-10-13",
    action: "add",
    payload: { pri: "P2", type: "task", summary: "Synthetic fixture" },
  };

  it.each(["P9", "p2", "high"])("rejects an unsupported add priority before enqueue: %s", (pri) => {
    expect(validateRequest({ ...add, payload: { ...add.payload, pri } })).toContain("add pri must be P1, P2, or P3");
  });

  it.each(["bug", "TASK", "other"])("rejects an unsupported add type before enqueue: %s", (type) => {
    expect(validateRequest({ ...add, payload: { ...add.payload, type } })).toContain(
      "add type must be task, issue, or rec",
    );
  });

  it.each(["P1", "P2", "P3"])("accepts every writer-supported type at %s", (pri) => {
    for (const type of ["task", "issue", "rec"]) {
      const request = { ...add, payload: { ...add.payload, pri, type } };
      expect(validateRequest(request)).toEqual([]);
      expect(() => applyRequest(BASE_LEDGER, request)).not.toThrow();
    }
  });

  it("serializes two stale recoverers before either can remove a replacement live lock", () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "ledger-lock-admission-"));
    const lockPath = path.join(fixture, "reconcile.lock");
    mkdirSync(lockPath);
    writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 2147483647 }));
    let release: (() => void) | undefined;
    try {
      release = acquireReconcileLock({
        lockPath,
        recoverTransaction: () => {
          // Deterministically enter the competing acquirer at the old race
          // window, after stale-owner inspection but before lock removal.
          expect(() => acquireReconcileLock({ lockPath })).toThrow(/admission is already claimed/);
          expect(JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8")).pid).toBe(2147483647);
        },
      });
      const owner = readFileSync(path.join(lockPath, "owner.json"), "utf8");
      expect(JSON.parse(owner).pid).toBe(process.pid);
      expect(() => acquireReconcileLock({ lockPath })).toThrow(/another reconciliation is active/);
      expect(readFileSync(path.join(lockPath, "owner.json"), "utf8")).toBe(owner);
    } finally {
      release?.();
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("fails closed on an abandoned admission claim without deleting the stale lock", () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "ledger-lock-admission-"));
    const lockPath = path.join(fixture, "reconcile.lock");
    mkdirSync(lockPath);
    mkdirSync(`${lockPath}.admission`);
    const owner = JSON.stringify({ pid: 2147483647 });
    writeFileSync(path.join(lockPath, "owner.json"), owner);
    try {
      expect(() => acquireReconcileLock({ lockPath })).toThrow(/obtain reviewed recovery/);
      expect(readFileSync(path.join(lockPath, "owner.json"), "utf8")).toBe(owner);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

describe("ledger-inbox idempotent close and duplicate done handling", () => {
  describe("idempotent close of already-archived issues", () => {
    it("preserves existing outcome and merges new outcome note when applying done request to archived issue", () => {
      const doneRequest = {
        version: 1,
        id: "11111111-1111-4111-8111-111111111111",
        createdOn: "2026-08-15",
        action: "done",
        payload: {
          id: "#005",
          outcome: "Verified fix in PR #20",
        },
      };

      const result = applyRequest(BASE_LEDGER, doneRequest, { allowArchived: true });

      // Verify valid ledger structure
      const problems = checkIssues(result, { prettierIgnored: true });
      expect(problems).toEqual([]);

      const parsed = parseIssues(result);
      const row = parsed.rows.find((r) => r.id === "#005");
      expect(row).toBeDefined();
      expect(row?.table).toBe("archive");
      expect(row?.raw).toContain("Original outcome text from PR #10 \\| Note: Verified fix in PR #20");
    });

    it("handles done request with baseRowFingerprint when issue was already archived", () => {
      // Even if a client queued a done request with a baseRowFingerprint before the issue got archived
      const doneRequest = {
        version: 1,
        id: "22222222-2222-4222-8222-222222222222",
        createdOn: "2026-08-15",
        action: "done",
        payload: {
          id: "#005",
          outcome: "Follow-up notes from PR #30",
          baseRowFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      };

      const result = applyRequest(BASE_LEDGER, doneRequest);
      expect(checkIssues(result, { prettierIgnored: true })).toEqual([]);

      const parsed = parseIssues(result);
      const row = parsed.rows.find((r) => r.id === "#005");
      expect(row?.raw).toContain("Original outcome text from PR #10 \\| Note: Follow-up notes from PR #30");
    });

    it("is idempotent and does not repeatedly append duplicate outcome notes", () => {
      const doneRequest = {
        version: 1,
        id: "33333333-3333-4333-8333-333333333333",
        createdOn: "2026-08-15",
        action: "done",
        payload: {
          id: "#005",
          outcome: "Verified fix in PR #20",
        },
      };

      const once = applyRequest(BASE_LEDGER, doneRequest, { allowArchived: true });
      const twice = applyRequest(once, doneRequest, { allowArchived: true });

      const parsedOnce = parseIssues(once);
      const parsedTwice = parseIssues(twice);
      const rowOnce = parsedOnce.rows.find((r) => r.id === "#005");
      const rowTwice = parsedTwice.rows.find((r) => r.id === "#005");

      expect(rowOnce?.raw).toBe(rowTwice?.raw);
      expect(rowTwice?.raw).toContain("Original outcome text from PR #10 \\| Note: Verified fix in PR #20");
    });

    it("resolveIssue allows idempotent close when allowArchived option is set", () => {
      const updated = resolveIssue(BASE_LEDGER, "#005", "Direct resolve note", { allowArchived: true });
      const parsed = parseIssues(updated);
      const row = parsed.rows.find((r) => r.id === "#005");
      expect(row?.raw).toContain("Original outcome text from PR #10 \\| Note: Direct resolve note");

      const updatedWithIdempotent = resolveIssue(BASE_LEDGER, "#005", "Direct idempotent note", {
        idempotent: true,
      });
      expect(updatedWithIdempotent).toBe(BASE_LEDGER);
    });

    it("resolveIssue throws already archived error when allowArchived option is not set", () => {
      expect(() => resolveIssue(BASE_LEDGER, "#005", "Should fail")).toThrow(/already archived/);
    });

    it("mergeArchiveOutcome helper formats and merges notes correctly", () => {
      expect(mergeArchiveOutcome("PR #1", "PR #2")).toBe("PR #1 \\| Note: PR #2");
      expect(mergeArchiveOutcome("PR #1", "Note: PR #2")).toBe("PR #1 \\| Note: PR #2");
      expect(mergeArchiveOutcome("PR #1 \\| Note: PR #2", "PR #2")).toBe("PR #1 \\| Note: PR #2");
      expect(mergeArchiveOutcome("PR #1 \\| Note: PR #2", "PR #3")).toBe("PR #1 \\| Note: PR #2 \\| Note: PR #3");
      expect(mergeArchiveOutcome("", "PR #1")).toBe("PR #1");
    });
  });

  describe("archived done with createRequest allowArchived reaches merge path", () => {
    it("applyRequestBatch merges outcome when payload.allowArchived is set (createRequest path)", () => {
      const doneRequest = {
        version: 1,
        id: "eeee1111-1111-4111-8111-111111111111",
        createdOn: "2026-08-15",
        action: "done",
        payload: {
          id: "#005",
          outcome: "Landed after prior reconciliation archived the row",
          // Mirrors createRequest marking archive-aware closes so reconcile
          // does not silently no-op via the idempotent archived fast-path.
          allowArchived: true,
        },
      };

      const result = applyRequestBatch(BASE_LEDGER, [doneRequest]);
      expect(checkIssues(result.markdown, { prettierIgnored: true })).toEqual([]);

      const parsed = parseIssues(result.markdown);
      const row = parsed.rows.find((r) => r.id === "#005");
      expect(row?.table).toBe("archive");
      expect(row?.raw).toContain(
        "Original outcome text from PR #10 \\| Note: Landed after prior reconciliation archived the row",
      );
    });

    it("applyRequestBatch no-ops archived done without allowArchived (integrity)", () => {
      const staleDone = {
        version: 1,
        id: "eeee3333-3333-4333-8333-333333333333",
        createdOn: "2026-08-15",
        action: "done",
        payload: {
          id: "#005",
          outcome: "Should not merge without allowArchived",
        },
      };
      expect(applyRequestBatch(BASE_LEDGER, [staleDone]).markdown).toBe(BASE_LEDGER);
    });

    it("applyRequest with idempotent merges archived done when payload.allowArchived is set", () => {
      const doneRequest = {
        version: 1,
        id: "eeee2222-2222-4222-8222-222222222222",
        createdOn: "2026-08-15",
        action: "done",
        payload: {
          id: "#005",
          outcome: "Archive-aware queued close",
          allowArchived: true,
        },
      };
      const result = applyRequest(BASE_LEDGER, doneRequest, { idempotent: true });
      expect(result).toContain("Original outcome text from PR #10 \\| Note: Archive-aware queued close");
    });
  });

  describe("lowercase Crockford locator queue pruning", () => {
    it("resolveIssue with lowercase display id archives and prunes uppercase queue citation", () => {
      const updated = resolveIssue(BASE_LEDGER, "#dredwa", "Closed via lowercase locator");
      expect(checkIssues(updated, { prettierIgnored: true })).toEqual([]);
      expect(updated).not.toContain("`#DREDWA`");
      expect(updated).not.toContain("`#dredwa`");
      const parsed = parseIssues(updated);
      const row = parsed.rows.find((r) => r.id === "#DREDWA");
      expect(row?.table).toBe("archive");
      expect(row?.raw).toContain("Closed via lowercase locator");
    });

    it("pruneResolvedIdFromQueue normalizes lowercase target against uppercase citations", () => {
      const pruned = pruneResolvedIdFromQueue(BASE_LEDGER, "#dredwa");
      expect(pruned).not.toContain("`#DREDWA`");
      expect(pruned).toContain("`#001`");
    });
  });

  describe("concurrent duplicate done requests in a batch", () => {
    it("planRequestBatch does not flag duplicate done requests as mutation conflicts", () => {
      const req1 = {
        version: 1,
        id: "aaaa1111-1111-4111-8111-111111111111",
        createdOn: "2026-08-15",
        action: "done",
        payload: { id: "#001", outcome: "Resolved in PR #101" },
      };
      const req2 = {
        version: 1,
        id: "aaaa2222-2222-4222-8222-222222222222",
        createdOn: "2026-08-15",
        action: "done",
        payload: { id: "#001", outcome: "Resolved in PR #102" },
      };

      const plan = planRequestBatch([req1, req2]);
      expect(plan.active).toHaveLength(2);
      expect(plan.cancellations).toHaveLength(0);
    });

    it("applyRequestBatch merges outcome notes cleanly for duplicate done requests", () => {
      const req1 = {
        version: 1,
        id: "bbbb1111-1111-4111-8111-111111111111",
        createdOn: "2026-08-15",
        action: "done",
        payload: {
          id: "#001",
          outcome: "Closed in branch A",
          baseRowFingerprint: issueRowFingerprint(BASE_LEDGER, "#001"),
        },
      };
      const req2 = {
        version: 1,
        id: "bbbb2222-2222-4222-8222-222222222222",
        createdOn: "2026-08-15",
        action: "done",
        payload: {
          id: "#001",
          outcome: "Closed in branch B",
          baseRowFingerprint: issueRowFingerprint(BASE_LEDGER, "#001"),
        },
      };

      const result = applyRequestBatch(BASE_LEDGER, [req1, req2]);
      expect(checkIssues(result.markdown, { prettierIgnored: true })).toEqual([]);

      const parsed = parseIssues(result.markdown);
      const row = parsed.rows.find((r) => r.id === "#001");
      expect(row).toBeDefined();
      expect(row?.table).toBe("archive");
      expect(row?.raw).toContain("Closed in branch A \\| Note: Closed in branch B");

      // Verify #001 was dropped from recommended execution queue
      expect(result.markdown).not.toContain("`#001`");
    });

    it("merges three duplicate done requests in a batch", () => {
      const req1 = {
        version: 1,
        id: "cccc1111-1111-4111-8111-111111111111",
        createdOn: "2026-08-15",
        action: "done",
        payload: { id: "#001", outcome: "Close step 1" },
      };
      const req2 = {
        version: 1,
        id: "cccc2222-2222-4222-8222-222222222222",
        createdOn: "2026-08-15",
        action: "done",
        payload: { id: "#001", outcome: "Close step 2" },
      };
      const req3 = {
        version: 1,
        id: "cccc3333-3333-4333-8333-333333333333",
        createdOn: "2026-08-15",
        action: "done",
        payload: { id: "#001", outcome: "Close step 3" },
      };

      const result = applyRequestBatch(BASE_LEDGER, [req1, req2, req3]);
      expect(checkIssues(result.markdown, { prettierIgnored: true })).toEqual([]);

      const parsed = parseIssues(result.markdown);
      const row = parsed.rows.find((r) => r.id === "#001");
      expect(row?.raw).toContain("Close step 1 \\| Note: Close step 2 \\| Note: Close step 3");
    });

    it("merges duplicate done requests for Crockford ULID display IDs", () => {
      const req1 = {
        version: 1,
        id: "dddd1111-1111-4111-8111-111111111111",
        createdOn: "2026-08-15",
        action: "done",
        payload: {
          id: "#DREDWA",
          outcome: "Crockford close 1",
          baseRowFingerprint: issueRowFingerprint(BASE_LEDGER, "#DREDWA"),
        },
      };
      const req2 = {
        version: 1,
        id: "dddd2222-2222-4222-8222-222222222222",
        createdOn: "2026-08-15",
        action: "done",
        payload: {
          id: "#DREDWA",
          outcome: "Crockford close 2",
          baseRowFingerprint: issueRowFingerprint(BASE_LEDGER, "#DREDWA"),
        },
      };

      const result = applyRequestBatch(BASE_LEDGER, [req1, req2]);
      expect(checkIssues(result.markdown, { prettierIgnored: true })).toEqual([]);

      const parsed = parseIssues(result.markdown);
      const row = parsed.rows.find((r) => r.id === "#DREDWA");
      expect(row).toBeDefined();
      expect(row?.table).toBe("archive");
      expect(row?.ulid).toBe("01M09A9WXBDREDWA7KN2EB1JRA");
      expect(row?.raw).toContain("Crockford close 1 \\| Note: Crockford close 2");
      expect(result.markdown).not.toContain("`#DREDWA`");
    });

    it("applies duplicate done requests alongside other distinct actions", () => {
      const addReq = {
        version: 1,
        id: "eeee1111-1111-4111-8111-111111111111",
        createdOn: "2026-08-15",
        action: "add",
        payload: { pri: "P2", type: "task", summary: "New feature task" },
      };
      const doneReq1 = {
        version: 1,
        id: "eeee2222-2222-4222-8222-222222222222",
        createdOn: "2026-08-15",
        action: "done",
        payload: { id: "#001", outcome: "Closed #001 first" },
      };
      const doneReq2 = {
        version: 1,
        id: "eeee3333-3333-4333-8333-333333333333",
        createdOn: "2026-08-15",
        action: "done",
        payload: { id: "#001", outcome: "Closed #001 second" },
      };
      const doneOther = {
        version: 1,
        id: "eeee4444-4444-4444-8444-444444444444",
        createdOn: "2026-08-15",
        action: "done",
        payload: { id: "#002", outcome: "Closed #002" },
      };

      const result = applyRequestBatch(BASE_LEDGER, [addReq, doneReq1, doneReq2, doneOther]);
      expect(checkIssues(result.markdown, { prettierIgnored: true })).toEqual([]);

      const parsed = parseIssues(result.markdown);
      expect(parsed.rows.some((r) => r.table === "open" && r.raw.includes("New feature task"))).toBe(true);

      const row1 = parsed.rows.find((r) => r.id === "#001");
      expect(row1?.table).toBe("archive");
      expect(row1?.raw).toContain("Closed #001 first \\| Note: Closed #001 second");

      const row2 = parsed.rows.find((r) => r.id === "#002");
      expect(row2?.table).toBe("archive");
      expect(row2?.raw).toContain("Closed #002");
    });

    it("still rejects colliding mutations between done and update for the same issue", () => {
      const doneReq = {
        version: 1,
        id: "ffff1111-1111-4111-8111-111111111111",
        createdOn: "2026-08-15",
        action: "done",
        payload: { id: "#001", outcome: "done #001" },
      };
      const updateReq = {
        version: 1,
        id: "ffff2222-2222-4222-8222-222222222222",
        createdOn: "2026-08-15",
        action: "update",
        payload: { id: "#001", summary: "new summary" },
      };

      expect(() => applyRequestBatch(BASE_LEDGER, [doneReq, updateReq])).toThrow(
        /multiple pending mutations require an explicit cancellation decision/,
      );
    });

    it("still rejects colliding mutations between done and queue for the same issue", () => {
      const doneReq = {
        version: 1,
        id: "ffff3333-3333-4333-8333-333333333333",
        createdOn: "2026-08-15",
        action: "done",
        payload: { id: "#001", outcome: "done #001" },
      };
      const queueReq = {
        version: 1,
        id: "ffff4444-4444-4444-8444-444444444444",
        createdOn: "2026-08-15",
        action: "queue",
        payload: { id: "#001", acuity: "A1" },
      };

      expect(() => applyRequestBatch(BASE_LEDGER, [doneReq, queueReq])).toThrow(
        /multiple pending mutations require an explicit cancellation decision/,
      );
    });
  });

  describe("archived ledger row outcome correction (#1BKK79)", () => {
    const ARCHIVE_LEDGER = [
      "<!-- issues:next-id=10 -->",
      "",
      "## Recommended execution queue",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| Order | ID(s) | Acuity | Capability | When | Estimate | Outcome |",
      "| ----: | -------------- | -------- | --- | --- | --- | --- |",
      "| 1 | `#001` | A2 | High | now | 1h | solo |",
      "",
      "## Open items",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| ID | Pri | Type | Summary | Detail / next action | Source | Added |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| #001 | P2 | issue | First open issue | detail one | src | 2026-01-01 |",
      "",
      "## Resolved / archive",
      "",
      "<!-- prettier-ignore -->",
      "",
      "| ID | Type | Summary | Outcome | Resolved |",
      "| ---- | ---- | ---- | ---- | ---- |",
      "| #000 | task | Initial task | Closed in bootstrap | 2025-12-01 |",
      "| #005 | issue | Prior resolved issue | Original outcome text from PR #10 | 2026-01-01 |",
      "| #041061 <!-- issue-ulid:01M00000000410610000000000 --> | task | Crockford archive row | Completed task | 2026-02-01 |",
      "",
    ].join("\n");

    it("validates amend-outcome and update requests with outcome", () => {
      const amendValid = {
        version: 1,
        id: "aaaaaaaa-1111-4111-8111-111111111111",
        createdOn: "2026-08-15",
        action: "amend-outcome",
        payload: { id: "#005", outcome: "Updated note" },
      };
      expect(validateRequest(amendValid)).toEqual([]);

      const amendInvalid = {
        ...amendValid,
        payload: { id: "#005" },
      };
      expect(validateRequest(amendInvalid)).toContain("amend-outcome requires outcome");

      const updateWithOutcome = {
        version: 1,
        id: "aaaaaaaa-2222-4222-8222-222222222222",
        createdOn: "2026-08-15",
        action: "update",
        payload: { id: "#005", outcome: "Updated note" },
      };
      expect(validateRequest(updateWithOutcome)).toEqual([]);
    });

    it("archiveRowFingerprint computes sha256 hash for archived rows and handles display locators", () => {
      const fpNumeric = archiveRowFingerprint(ARCHIVE_LEDGER, "#005");
      expect(fpNumeric).toMatch(/^[0-9a-f]{64}$/);

      const fpCrockford = archiveRowFingerprint(ARCHIVE_LEDGER, "#041061");
      expect(fpCrockford).toMatch(/^[0-9a-f]{64}$/);

      // Open item has no archive fingerprint
      expect(archiveRowFingerprint(ARCHIVE_LEDGER, "#001")).toBeNull();

      // Unknown ID returns null
      expect(archiveRowFingerprint(ARCHIVE_LEDGER, "#999")).toBeNull();
    });

    it("applies amend-outcome request to an archived row and preserves table structure", () => {
      const fp = archiveRowFingerprint(ARCHIVE_LEDGER, "#005");
      const req = {
        version: 1,
        id: "bbbb1111-1111-4111-8111-111111111111",
        createdOn: "2026-08-15",
        action: "amend-outcome",
        payload: {
          id: "#005",
          outcome: "Amended resolution rationale from review",
          baseRowFingerprint: fp,
        },
      };

      const result = applyRequest(ARCHIVE_LEDGER, req);
      expect(checkIssues(result, { prettierIgnored: true })).toEqual([]);

      const parsed = parseIssues(result);
      const row = parsed.rows.find((r) => r.id === "#005");
      expect(row?.table).toBe("archive");
      expect(row?.cellCount).toBe(5);
      expect(row?.raw).toContain(
        "Original outcome text from PR #10 \\| Note: Amended resolution rationale from review",
      );
    });

    it("applies update request with outcome targeting an archived row", () => {
      const fp = archiveRowFingerprint(ARCHIVE_LEDGER, "#041061");
      const req = {
        version: 1,
        id: "bbbb2222-2222-4222-8222-222222222222",
        createdOn: "2026-08-15",
        action: "update",
        payload: {
          id: "#041061",
          outcome: "Additional verification details",
          baseRowFingerprint: fp,
        },
      };

      const result = applyRequest(ARCHIVE_LEDGER, req);
      expect(checkIssues(result, { prettierIgnored: true })).toEqual([]);

      const parsed = parseIssues(result);
      const row = parsed.rows.find((r) => r.id === "#041061");
      expect(row?.table).toBe("archive");
      expect(row?.cellCount).toBe(5);
      expect(row?.raw).toContain("Completed task \\| Note: Additional verification details");
    });

    it("rejects amend-outcome request with stale baseRowFingerprint", () => {
      const req = {
        version: 1,
        id: "bbbb3333-3333-4333-8333-333333333333",
        createdOn: "2026-08-15",
        action: "amend-outcome",
        payload: {
          id: "#005",
          outcome: "Stale amendment",
          baseRowFingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
        },
      };

      expect(() => applyRequest(ARCHIVE_LEDGER, req)).toThrow(/stale/);
    });

    it("rejects outcome amendments targeting an open row", () => {
      const fingerprint = issueRowFingerprint(ARCHIVE_LEDGER, "#001");
      const amend = {
        version: 1,
        id: "bbbb4444-4444-4444-8444-444444444444",
        createdOn: "2026-08-15",
        action: "amend-outcome",
        payload: { id: "#001", outcome: "Not archived", baseRowFingerprint: fingerprint },
      };
      const outcomeOnlyUpdate = {
        ...amend,
        id: "bbbb5555-5555-4555-8555-555555555555",
        action: "update",
        payload: { id: "#001", outcome: "Not archived", baseRowFingerprint: fingerprint },
      };

      expect(() => applyRequest(ARCHIVE_LEDGER, amend)).toThrow(/outcome amendments require an archived issue/);
      expect(() => applyRequest(ARCHIVE_LEDGER, outcomeOnlyUpdate)).toThrow(
        /outcome amendments require an archived issue/,
      );
    });

    it("requires cancellation for concurrent archived outcome amendments", () => {
      const fingerprint = archiveRowFingerprint(ARCHIVE_LEDGER, "#005");
      const first = {
        version: 1,
        id: "bbbb6666-6666-4666-8666-666666666666",
        createdOn: "2026-08-15",
        action: "amend-outcome",
        payload: { id: "#005", outcome: "Branch A", baseRowFingerprint: fingerprint },
      };
      const second = {
        ...first,
        id: "bbbb7777-7777-4777-8777-777777777777",
        payload: { ...first.payload, outcome: "Branch B" },
      };

      expect(() => planRequestBatch([first, second])).toThrow(/explicit cancellation decision/);
    });

    it("updateArchivedIssue correctly updates outcome and is idempotent", () => {
      const once = updateArchivedIssue(ARCHIVE_LEDGER, "#005", "Direct amendment");
      expect(checkIssues(once, { prettierIgnored: true })).toEqual([]);

      const parsedOnce = parseIssues(once);
      const rowOnce = parsedOnce.rows.find((r) => r.id === "#005");
      expect(rowOnce?.raw).toContain("Original outcome text from PR #10 \\| Note: Direct amendment");

      const twice = updateArchivedIssue(once, "#005", "Direct amendment");
      expect(twice).toBe(once);
    });

    it("rejects mixed update that pairs outcome with open-row fields", () => {
      const mixed = {
        version: 1,
        id: "bbbb8888-8888-4888-8888-888888888888",
        createdOn: "2026-08-15",
        action: "update",
        payload: {
          id: "#005",
          summary: "Must not be silently dropped",
          outcome: "Archive note",
        },
      };
      expect(validateRequest(mixed)).toContain("update cannot mix outcome with pri, summary, detail, or source");
      expect(() => applyRequest(ARCHIVE_LEDGER, mixed)).toThrow(/cannot mix outcome/);
    });

    it("rejects amend-outcome when the id is not archived", () => {
      const missing = {
        version: 1,
        id: "bbbb9999-9999-4999-8999-999999999999",
        createdOn: "2026-08-15",
        action: "amend-outcome",
        payload: { id: "#999", outcome: "No such archive row" },
      };
      expect(() => applyRequest(ARCHIVE_LEDGER, missing)).toThrow(/not archived/);
    });
  });
});
