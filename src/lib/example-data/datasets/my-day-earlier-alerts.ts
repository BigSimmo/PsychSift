import { exampleId } from "@/lib/example-data/guards";
import type { AlertCode, EarlierAlert } from "@/lib/work-screens/my-day/earlier-alerts";
import { zonedDateOf, zonedWallToIso } from "@/lib/work-time/format";

/*
 * Example alerts for My Day's Earlier alerts (`/my-day/alerts/earlier`): the mock-up's own rows,
 * built from `now` so they sit in the last few days on the work zone's wall clock. Nothing here is
 * read from a phone or kept anywhere. Every id starts "example:". Read through the registry,
 * `loadExampleDataset("myDay.earlierAlerts")`.
 */

const ROWS: readonly (readonly [AlertCode, number, string, boolean])[] = [
  ["brief", 0, "07:00", true],
  ["request", 1, "18:12", false],
  ["brief", 1, "07:00", true],
  ["reminder", 2, "14:00", true],
  ["changed", 5, "16:40", false],
];

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The example alerts up to `now`, never one in the future. */
export function exampleEarlierAlerts(now: number, zone: string): EarlierAlert[] {
  const today = zonedDateOf(now, zone);
  const out: EarlierAlert[] = [];
  for (const [code, daysBack, time, opened] of ROWS) {
    const iso = zonedWallToIso(addDays(today, -daysBack), time, zone);
    if (!iso) continue;
    const at = Date.parse(iso);
    if (at > now) continue;
    out.push({ id: exampleId(`${code}:${at}`), code, at, approx: false, openedAt: opened ? at + 60_000 : null });
  }
  return out;
}
