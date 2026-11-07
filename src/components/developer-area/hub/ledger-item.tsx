import type { LedgerOpenItem } from "@/lib/developer-area/ledger-snapshot";

/**
 * Priority is "how much this matters", and it is rendered as a *filled* pill.
 * Acuity — "how soon to start" — is a different scale on a different table, and
 * the queue renders it as an outlined chip carrying a plain-English descriptor.
 * The two treatments are deliberately unalike: a shared badge would read the
 * two P1 rows and the one A1 queue entry as a single urgent set of three, when
 * they are three different items on two unrelated scales.
 */
const PRIORITY_CLASS: Record<string, string> = {
  P1: "bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
  P2: "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
  P3: "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
};

/** A priority the ledger has not used before still gets a legible badge. */
const UNKNOWN_PRIORITY_CLASS = "bg-[color:var(--surface-subtle)] text-[color:var(--text-heading)]";

/**
 * Shared with the queue disclosure on the ledger page, so the two cannot drift.
 * The token that matters is `min-h-12`: no lint rule enforces tap targets on a
 * `<summary>`, so a duplicated literal is the only thing that could quietly
 * lose it on one of the two surfaces.
 */
export const LEDGER_DISCLOSURE_CLASS =
  "flex min-h-12 cursor-pointer items-center text-xs font-bold text-[color:var(--text-muted)]";

/** Detail cells carry unbroken tokens — file paths, CLI flags, registry keys. */
export const LEDGER_DETAIL_CLASS = "text-xs leading-6 [overflow-wrap:anywhere] text-[color:var(--text-muted)]";

/**
 * Progressive detail. Native `<details>` keeps this a Server Component with no
 * client JavaScript, gives correct keyboard and screen-reader behaviour for
 * free, and is not a `<button>` — so `require-button-wiring` does not apply.
 *
 * It is a readability device, not a data-hiding one: the longest detail cell in
 * the committed snapshot is roughly 7,800 characters, so rendering 67 of them
 * inline would make the page unscannable — but every character stays in the
 * HTML whether the disclosure is open or shut, and find-in-page and assistive
 * technology can still reach it.
 */
export function LedgerItem({ item }: { item: LedgerOpenItem }) {
  return (
    <li
      data-testid={`developer-ledger-item-${item.id.replace("#", "")}`}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-xl border border-[color:var(--border)] p-4"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-xs text-[color:var(--text-muted)]">{item.id}</span>
        {/*
         * Filled rectangle, against the queue's outlined pill for acuity. The
         * contrast is the point, not decoration — see the note above — so it is
         * pinned by `developer ledger page > gives acuity and priority
         * genuinely different badge treatments`.
         */}
        <span
          data-testid={`developer-ledger-priority-${item.id.replace("#", "")}`}
          className={`rounded-lg px-2 py-0.5 text-xs font-bold ${PRIORITY_CLASS[item.priority] ?? UNKNOWN_PRIORITY_CLASS}`}
        >
          {item.priority}
        </span>
        <span className="rounded-lg border border-[color:var(--border)] px-2 py-0.5 text-xs text-[color:var(--text-muted)]">
          {item.type}
        </span>
      </div>
      <p className="text-sm leading-6 [overflow-wrap:anywhere] text-[color:var(--text-heading)]">{item.summary}</p>
      <details>
        <summary className={LEDGER_DISCLOSURE_CLASS}>Detail and source</summary>
        <p className={`mt-2 ${LEDGER_DETAIL_CLASS}`}>{item.detail}</p>
        <p className="mt-1 text-xs [overflow-wrap:anywhere] text-[color:var(--text-muted)]">
          Source: {item.source} · added {item.added}
        </p>
      </details>
    </li>
  );
}
