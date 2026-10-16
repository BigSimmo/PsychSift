import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import snapshotJson from "../../../data/outstanding-issues-snapshot.json";

import { resolveFreshnessFrom, type Freshness } from "./freshness";

export const LEDGER_SNAPSHOT_VERSION = "outstanding-issues-snapshot-v2";

export type LedgerPriority = "P1" | "P2" | "P3";

export type LedgerOpenItem = {
  id: string;
  priority: string;
  type: string;
  summary: string;
  detail: string;
  source: string;
  added: string;
};

export type LedgerQueueEntry = {
  order: number;
  ids: string[];
  /** Urgency. Deliberately NOT derived from, or merged with, `LedgerOpenItem.priority`. */
  acuity: string;
  capability: string;
  timing: string;
  estimate: string;
  detail: string;
};

export type LedgerPendingRequest = {
  request_id: string;
  action: string;
  summary: string;
  created_at: string | null;
};

export type LedgerSnapshot = {
  version: string;
  // Match main: date-only revision, no sha (see generate-outstanding-issues-snapshot.mjs).
  ledger_revision: { committed_at: string } | null;
  counts: { open: number; p1: number; p2: number; p3: number; queued: number; pending: number; resolved: number };
  queue: LedgerQueueEntry[];
  open: LedgerOpenItem[];
  pending: LedgerPendingRequest[];
};

type InboxRecordPayload = {
  id?: string;
  summary?: string;
  detail?: string;
  pri?: string;
  source?: string;
  requestId?: string;
  reason?: string;
  outcome?: string;
};

export const inboxRecordSchema = z
  .object({
    id: z.string().min(1),
    action: z.string().min(1),
    createdOn: z.string().nullable().optional(),
    targetId: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

type InboxRecord = {
  id: string;
  action: string;
  createdOn?: string | null;
  targetId?: string;
  payload?: InboxRecordPayload;
};

/**
 * Formats a raw inbox record into a `LedgerPendingRequest` matching the exact logic
 * in `scripts/generate-outstanding-issues-snapshot.mjs`.
 */
export function formatInboxRecord(record: InboxRecord): LedgerPendingRequest {
  const payload = record.payload ?? {};
  const target = payload.id ? `${payload.id}: ` : "";
  let summary: string;

  if (record.action === "update") {
    const changes = [
      payload.summary !== undefined ? `summary → ${payload.summary || "(clear)"}` : null,
      payload.detail !== undefined ? `detail → ${payload.detail || "(clear)"}` : null,
      payload.pri !== undefined ? `priority → ${payload.pri}` : null,
      payload.source !== undefined ? `source → ${payload.source || "(clear)"}` : null,
    ].filter(Boolean);
    summary = changes.length > 0 ? `${target}${changes.join("; ")}` : `${target}(no change in the update request)`;
  } else if (record.action === "cancel") {
    const request = payload.requestId ? `Cancel request ${payload.requestId}` : "Cancel request";
    summary = `${request}: ${payload.reason || "(no reason in the cancel request)"}`;
  } else {
    const body = payload.summary || payload.detail || payload.outcome || "";
    summary = body ? `${target}${body}` : `${target}(no summary in the ${record.action} request)`;
  }

  return {
    request_id: record.id,
    action: record.action,
    summary,
    created_at: record.createdOn ?? null,
  };
}

/**
 * Reads and formats unapplied inbox records from `docs/outstanding-issues-inbox/`.
 * Deterministically sorts files by filename to ensure stable ordering.
 * Malformed or schema-invalid files are skipped individually so a single corrupt
 * file cannot blank the entire pending-requests list (#315621).
 */
export function readDevPendingRequests(dir: string): LedgerPendingRequest[] {
  if (typeof window !== "undefined") return [];
  try {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => (typeof entry.isFile === "function" ? entry.isFile() : true) && entry.name.endsWith(".json"))
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        try {
          const raw = fs.readFileSync(path.join(dir, entry.name), "utf8");
          const parsed = inboxRecordSchema.safeParse(JSON.parse(raw));
          if (!parsed.success) return [];
          return [formatInboxRecord(parsed.data as InboxRecord)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/**
 * Loads the committed ledger snapshot.
 *
 * Why dev-only reading from docs/ is used (#707F09):
 * The committed snapshot deliberately carries an empty `pending` array to prevent
 * git merge conflicts across concurrent branches (`#Y090R5`). During production builds
 * or Docker container generation, `prebuild` runs `scripts/generate-outstanding-issues-snapshot.mjs`
 * with `--with-pending`. However, during local development (`next dev`), no lifecycle
 * script regenerates the snapshot file on disk.
 *
 * To prevent the developer hub's pending-requests panel from reading empty during
 * local development, non-production environments dynamically read unapplied inbox
 * records directly from `docs/outstanding-issues-inbox/*.json` if available.
 * If `docs/` is absent (e.g. in a production container) or unreadable, it safely
 * falls back to the snapshot's existing pending list.
 */
export function loadLedgerSnapshot(options?: { inboxDir?: string }): LedgerSnapshot {
  const snapshot: LedgerSnapshot = {
    ...snapshotJson,
    counts: { ...snapshotJson.counts },
    queue: [...snapshotJson.queue],
    open: [...snapshotJson.open],
    pending: [...snapshotJson.pending],
  };
  if (snapshot.version !== LEDGER_SNAPSHOT_VERSION) {
    // Loud, not a render fallback: an unrecognised shape means the page would
    // silently under-report outstanding work, which is the `#338` failure.
    throw new Error(
      `Unrecognised ledger snapshot version ${snapshot.version}; expected ${LEDGER_SNAPSHOT_VERSION}. Run: npm run snapshot:issues`,
    );
  }

  if (process.env.NODE_ENV !== "production" && snapshot.pending.length === 0) {
    try {
      const inboxDir = options?.inboxDir ?? path.join(process.cwd(), "docs", "outstanding-issues-inbox");
      if (fs.existsSync(inboxDir)) {
        const loadedPending = readDevPendingRequests(inboxDir);
        snapshot.pending = loadedPending;
        snapshot.counts.pending = loadedPending.length;
      }
    } catch {
      // Gracefully fall back to snapshot.pending if reading docs fails or is absent.
    }
  }

  return snapshot;
}

export type { Freshness };

export function resolveFreshness(snapshot: LedgerSnapshot, now: Date): Freshness {
  return resolveFreshnessFrom(snapshot.ledger_revision?.committed_at ?? null, now);
}

export function openItemsByPriority(snapshot: LedgerSnapshot): Record<LedgerPriority, LedgerOpenItem[]> {
  const grouped: Record<LedgerPriority, LedgerOpenItem[]> = { P1: [], P2: [], P3: [] };
  for (const item of snapshot.open) {
    if (item.priority === "P1" || item.priority === "P2" || item.priority === "P3") grouped[item.priority].push(item);
  }
  return grouped;
}
