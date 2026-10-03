"use client";

import { useState } from "react";

import { ModeRow } from "@/components/mode-kit/grouped-list";
import { Button } from "@/components/ui/button";
import type { RosterChangeNotice } from "@/lib/roster/what-changed";

/** Rows shown before "See all", the Today standard's "three rows then See all (n)". */
const PREVIEW_ROWS = 3;

/**
 * Roster "what changed" lines for a "Needs you" group: one row per change to
 * the user's own shifts, three at first, then "See all (n)", and one "Got it"
 * that clears them. Rendered inside a `ModeGroupedList`, so it returns rows.
 *
 * The lines stay until the user taps "Got it": opening the page alone no
 * longer counts as having read them. `onDismiss` uses the existing seen marker
 * for the source (the import's `seenAt`, or the publication's `seen.mark`).
 */
export function RosterChangeRows({
  notices,
  onDismiss,
  testId,
}: {
  readonly notices: readonly RosterChangeNotice[];
  readonly onDismiss: () => void;
  readonly testId: string;
}) {
  const [showAll, setShowAll] = useState(false);
  if (notices.length === 0) return null;
  const shown = showAll ? notices : notices.slice(0, PREVIEW_ROWS);
  const hidden = notices.length - shown.length;
  return (
    <>
      {shown.map((notice) => (
        <ModeRow
          key={notice.id}
          title={`Your roster changed · ${notice.title}`}
          subtitle={notice.detail}
          href={notice.href}
          testId={`${testId}-${notice.id}`}
        />
      ))}
      <ModeRow
        title={notices.length === 1 ? "1 change to your shifts" : `${notices.length} changes to your shifts`}
        testId={`${testId}-actions`}
        trailing={
          <>
            {hidden > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setShowAll(true)} testId={`${testId}-see-all`}>
                {`See all (${notices.length})`}
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={onDismiss} testId={`${testId}-dismiss`}>
              Got it
            </Button>
          </>
        }
      />
    </>
  );
}
