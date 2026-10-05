import { dayParts, perthDateKey, perthTime } from "@/components/teaching/teaching-dates";
import { durationText, withUnit } from "@/components/teaching/teaching-number";
import {
  feedbackPaceLabels,
  feedbackPaces,
  readinessItems,
  type FeedbackTotals,
  type Readiness,
  type ReadinessItem,
  type SupervisionEntry,
  type SupervisionPairingView,
  type TeachSession,
} from "@/lib/teaching/depth-model";

/* Pure shaping for Presenting (mock-up v5 screen 02). Perth wall-clock, 24-hour, NBSP before units. */

const MINUTE = 60_000;

/**
 * "Your next talk · today 14:00 · in 85 min", "Your next talk · Mon 12 Oct 08:00". A later talk opened
 * from the list reads "Your talk · …", since it is not the next one.
 */
export function talkKicker(talk: TeachSession, now: Date, today: string, isNext = true): string {
  const name = isNext ? "Your next talk" : "Your talk";
  const day = perthDateKey(talk.startsAt);
  const time = perthTime(talk.startsAt);
  if (day !== today) {
    const p = dayParts(day);
    return `${name} · ${p.weekday} ${p.day} ${p.month} ${time}`;
  }
  const until = Math.ceil((Date.parse(talk.startsAt) - now.getTime()) / MINUTE);
  if (until <= 0) return `Your talk · today ${time} · on now`;
  return `${name} · today ${time} · in ${durationText(until)}`;
}

/** "Library meeting room · 45 min", or "Room not set · 45 min". */
export function talkMeta(talk: TeachSession): string {
  const minutes = Math.round((Date.parse(talk.endsAt) - Date.parse(talk.startsAt)) / MINUTE);
  return [talk.venue ?? "Room not set", durationText(minutes)].join(" · ");
}

/**
 * "2 of 4", or "4 of 4 · patient check open" while the de-identification check is not done, so
 * ticking the four prep items never reads as ready on its own (clinical governance review).
 */
export function readinessCount(readiness: Readiness): string {
  const ready = readinessItems.filter((item) => readiness.items.includes(item)).length;
  return `${withUnit(ready, "of")} ${readinessItems.length}${readiness.deidConfirmedAt ? "" : " · patient check open"}`;
}

/** "Tue 16:00 · 1 of 4 ready", "Tue 17:00 · not started", "… · 4 of 4 ready · patient check open". */
export function upcomingTalkMeta(talk: TeachSession): string {
  const p = dayParts(perthDateKey(talk.startsAt));
  const ready = readinessItems.filter((item) => talk.items.includes(item)).length;
  const check = talk.deidConfirmedAt || ready === 0 ? "" : " · patient check open";
  return `${p.weekday} ${perthTime(talk.startsAt)} · ${ready === 0 ? "not started" : `${withUnit(ready, "of")} ${readinessItems.length} ready`}${check}`;
}

const ITEM_ACTIONS: Record<ReadinessItem, string> = {
  reading_list: "Mark reading list shared",
  aims: "Mark aims written",
  slides_link: "Mark slides link added",
  room: "Confirm the room",
};

/**
 * The one filled button: the patient-details check first (it is the safety step), then the first item
 * still open. Null once everything is done.
 */
export function readinessAction(
  readiness: Readiness,
): { kind: "deid"; label: string } | { kind: "item"; item: ReadinessItem; label: string } | null {
  if (!readiness.deidConfirmedAt) return { kind: "deid", label: "I have checked: no patient details" };
  const open = readinessItems.find((item) => !readiness.items.includes(item));
  return open ? { kind: "item", item: open, label: ITEM_ACTIONS[open] } : null;
}

export type FeedbackSummary = {
  answers: string;
  pace: { key: (typeof feedbackPaces)[number]; count: number }[];
  paceLine: string;
  paceSentence: string;
  usefulness: string | null;
};

/** Released totals as words: "9 answers", "Pace: too slow 1 · about right 7 · too fast 1", "4.4". */
export function feedbackSummary(totals: FeedbackTotals): FeedbackSummary | null {
  if (!totals.released) return null;
  const pace = feedbackPaces.map((key) => ({ key, count: totals.pace[key] }));
  const rated = ([1, 2, 3, 4, 5] as const).reduce((sum, rating) => sum + totals.useful[rating], 0);
  const score = ([1, 2, 3, 4, 5] as const).reduce((sum, rating) => sum + rating * totals.useful[rating], 0);
  const paceLine = `Pace: ${pace.map((p) => `${feedbackPaceLabels[p.key].toLowerCase()} ${p.count}`).join(" · ")}`;
  return {
    answers: totals.replies === 1 ? "1 answer" : `${totals.replies} answers`,
    pace,
    paceLine,
    paceSentence: paceLine.replace(" · ", ", ").replace(" · ", ", "),
    usefulness: rated > 0 ? (score / rated).toFixed(1) : null,
  };
}

export type SupervisionSummary = {
  mine: { confirmed: string; targetLine: string | null; toGo: string | null; percent: number | null } | null;
  entries: (SupervisionEntry & { meta: string })[];
  toConfirm: number;
};

/**
 * Your own supervision as registrar, summed over your pairings (each pairing has its own optional
 * target), the two latest entries, and how many entries wait for you as a supervisor.
 */
export function supervisionSummary(pairings: readonly SupervisionPairingView[]): SupervisionSummary {
  const mine = pairings.filter((p) => p.access === "registrar");
  const confirmedMinutes = mine.reduce((sum, p) => sum + p.confirmedMinutes, 0);
  const targets = mine.filter((p) => p.targetHours !== null);
  const targetHours = targets.reduce((sum, p) => sum + (p.targetHours ?? 0), 0);
  // Progress counts only the pairings that carry a target; hours with an untargeted supervisor never fill it.
  const targetedMinutes = targets.reduce((sum, p) => sum + p.confirmedMinutes, 0);
  const mixed = targets.length > 0 && targets.length < mine.length;
  const hours = (minutes: number) => withUnit(Number((minutes / 60).toFixed(1)).toString(), "h");
  const entries = mine
    .flatMap((p) => p.entries ?? [])
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 2)
    .map((entry) => {
      const p = dayParts(entry.date);
      return {
        ...entry,
        meta: [
          `${p.day} ${p.month}`,
          withUnit(entry.minutes, "min"),
          entry.status === "confirmed" ? "confirmed" : "waiting for your supervisor to confirm",
        ].join(" · "),
      };
    });
  const toConfirm = pairings.filter((p) => p.access === "supervisor").reduce((sum, p) => sum + p.pendingCount, 0);
  return {
    mine:
      mine.length === 0
        ? null
        : {
            confirmed: hours(confirmedMinutes),
            targetLine:
              targetHours > 0
                ? mixed
                  ? `${withUnit(hours(targetedMinutes), "of")} your ${withUnit(targetHours, "h")} target`
                  : `of your ${withUnit(targetHours, "h")} target`
                : null,
            toGo:
              targetHours > 0 && targetedMinutes < targetHours * 60
                ? `${hours(targetHours * 60 - targetedMinutes)} to go`
                : targetHours > 0
                  ? "Target met"
                  : null,
            percent: targetHours > 0 ? Math.min(100, Math.round((targetedMinutes / (targetHours * 60)) * 100)) : null,
          },
    entries,
    toConfirm,
  };
}
