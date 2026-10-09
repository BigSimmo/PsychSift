"use client";

import { useState } from "react";

import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { Button } from "@/components/ui/button";
import { formatPerthDay, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { personKey, type PublishComparison, type SwapUndo } from "@/lib/roster/publish/compare";
import { formatShiftRange } from "@/components/roster/roster-format";

export function RosterPublishPreview({
  comparison,
  swapChoices,
  onSwapChoice,
  openChoices,
  onOpenChoice,
}: {
  comparison: PublishComparison;
  swapChoices: Readonly<Record<string, "keep" | "file">>;
  onSwapChoice: (swapId: string, choice: "keep" | "file") => void;
  openChoices: Readonly<Record<string, "keep" | "file">>;
  onOpenChoice: (openShiftId: string, choice: "keep" | "file") => void;
}) {
  const [person, setPerson] = useState<string | null>(null);
  const list = comparison.byPerson;
  const selected = list.find((item) => personKey(item) === person);
  const swaps: readonly SwapUndo[] = comparison.undoesSwaps;
  return (
    <div className="grid gap-4" data-testid="roster-publish-preview">
      <p className="text-sm text-[color:var(--text-muted)]">
        {comparison.unchanged} unchanged · {comparison.added.length} added · {comparison.changed.length} changed ·{" "}
        {comparison.removed.length} removed · {comparison.openShifts.length} open{" "}
        {comparison.openShifts.length === 1 ? "shift" : "shifts"} to post
      </p>
      {swaps.length ? (
        <ModeGroupedList eyebrow={`Would undo ${swaps.length} approved ${swaps.length === 1 ? "swap" : "swaps"}`}>
          {swaps.map((swap) => (
            <ModeRow
              key={swap.swapId}
              title={`${swap.names.join(" and ")} swap · ${formatPerthDay(swap.date)}`}
              subtitle={`Approved ${formatPerthDay(perthDateOf(swap.decidedAt))}`}
              trailing={
                <span className="flex flex-wrap gap-2">
                  <Button
                    variant={swapChoices[swap.swapId] !== "file" ? "primary" : "secondary"}
                    aria-pressed={swapChoices[swap.swapId] !== "file"}
                    onClick={() => onSwapChoice(swap.swapId, "keep")}
                  >
                    Keep the swap
                  </Button>
                  <Button
                    variant={swapChoices[swap.swapId] === "file" ? "primary" : "secondary"}
                    aria-pressed={swapChoices[swap.swapId] === "file"}
                    onClick={() => onSwapChoice(swap.swapId, "file")}
                  >
                    Use file, undo swap
                  </Button>
                </span>
              }
            />
          ))}
        </ModeGroupedList>
      ) : null}
      {comparison.undoesOpenClaims.length ? (
        <ModeGroupedList
          eyebrow={`Would undo ${comparison.undoesOpenClaims.length} approved ${comparison.undoesOpenClaims.length === 1 ? "open-shift claim" : "open-shift claims"}`}
        >
          {comparison.undoesOpenClaims.map((claim) => (
            <ModeRow
              key={claim.openShiftId}
              title={`${claim.name} claim · ${formatPerthDay(claim.date)}`}
              subtitle={`Approved ${formatPerthDay(perthDateOf(claim.decidedAt))}`}
              trailing={
                <span className="flex flex-wrap gap-2">
                  <Button
                    variant={openChoices[claim.openShiftId] !== "file" ? "primary" : "secondary"}
                    aria-pressed={openChoices[claim.openShiftId] !== "file"}
                    onClick={() => onOpenChoice(claim.openShiftId, "keep")}
                  >
                    Keep the claim
                  </Button>
                  <Button
                    variant={openChoices[claim.openShiftId] === "file" ? "primary" : "secondary"}
                    aria-pressed={openChoices[claim.openShiftId] === "file"}
                    onClick={() => onOpenChoice(claim.openShiftId, "file")}
                  >
                    Use file, undo claim
                  </Button>
                </span>
              }
            />
          ))}
        </ModeGroupedList>
      ) : null}
      <ModeGroupedList eyebrow="People with changes">
        {list.length === 0 ? (
          <ModeRow title="No changes" />
        ) : (
          list.map((item) => (
            <ModeRow
              key={personKey(item)}
              title={item.name}
              subtitle={`${item.count} ${item.count === 1 ? "change" : "changes"}`}
              trailing={
                <Button variant="secondary" onClick={() => setPerson(personKey(item))}>
                  Preview
                </Button>
              }
            />
          ))
        )}
      </ModeGroupedList>
      {selected ? (
        <ModeGroupedList eyebrow={`Changes for ${selected.name}`}>
          {comparison.changed
            .filter((change) => personKey(change.after) === personKey(selected))
            .map((change, index) => (
              <ModeRow
                key={`${change.after.startsAt}-${index}`}
                title={formatPerthDay(perthDateOf(change.after.startsAt))}
                subtitle={
                  <>
                    <s>
                      {change.before.shiftCode} {formatShiftRange(change.before)}
                    </s>{" "}
                    now {change.after.shiftCode} {formatShiftRange(change.after)}
                  </>
                }
              />
            ))}
          {comparison.added
            .filter((row) => personKey(row) === personKey(selected))
            .map((row, index) => (
              <ModeRow
                key={`${row.startsAt}-${index}`}
                title={formatPerthDay(perthDateOf(row.startsAt))}
                subtitle={`New · ${row.shiftCode}`}
              />
            ))}
          {comparison.removed
            .filter((row) => personKey(row) === personKey(selected))
            .map((row, index) => (
              <ModeRow
                key={`removed-${row.id}-${index}`}
                title={formatPerthDay(perthDateOf(row.startsAt))}
                subtitle={
                  <>
                    Removed ·{" "}
                    <s>
                      {row.shiftCode} {formatShiftRange(row)}
                    </s>
                  </>
                }
              />
            ))}
        </ModeGroupedList>
      ) : null}
    </div>
  );
}
