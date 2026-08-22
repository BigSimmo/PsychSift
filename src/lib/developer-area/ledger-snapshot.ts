import snapshotJson from "../../../data/outstanding-issues-snapshot.json";

import { resolveFreshnessFrom, type Freshness } from "./freshness";

export const LEDGER_SNAPSHOT_VERSION = "outstanding-issues-snapshot-v1";

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
  ledger_revision: { sha: string; committed_at: string } | null;
  counts: { open: number; p1: number; p2: number; p3: number; queued: number; pending: number; resolved: number };
  queue: LedgerQueueEntry[];
  open: LedgerOpenItem[];
  pending: LedgerPendingRequest[];
};

export function loadLedgerSnapshot(): LedgerSnapshot {
  const snapshot = snapshotJson as LedgerSnapshot;
  if (snapshot.version !== LEDGER_SNAPSHOT_VERSION) {
    // Loud, not a render fallback: an unrecognised shape means the page would
    // silently under-report outstanding work, which is the `#338` failure.
    throw new Error(
      `Unrecognised ledger snapshot version ${snapshot.version}; expected ${LEDGER_SNAPSHOT_VERSION}. Run: npm run snapshot:issues`,
    );
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
