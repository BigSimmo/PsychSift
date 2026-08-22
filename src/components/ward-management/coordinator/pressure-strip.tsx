"use client";

import { splitDuration, type Instant } from "@/components/ward-management/ward-clock";
import type { Movement } from "@/components/ward-management/ward-model";
import { edPressure } from "@/components/ward-management/ward-pressure";

import styles from "./coordinator.module.css";

type PressureStripProps = {
  now: Instant;
  selectedEdId: string | undefined;
  onSelectEd: (edId: string | undefined) => void;
  /**
   * Injectable for tests only — mirrors `edPressure`'s own `(now, movements)` injection point.
   * Production call sites never pass this, so `edPressure` falls back to the real fixture; a
   * dedicated dom test passes `[]` to exercise a department with nobody waiting without having
   * to wait for the live fixture to grow one (Task 4 review Important 5).
   */
  movements?: Movement[];
};

/**
 * The coordinator's one-second read on "which emergency department is worst". Worst-first
 * ordering comes from `edPressure` (a passed legal deadline outranks a long wait, which
 * outranks sheer volume) — this component only renders that order, it never re-derives it.
 *
 * The visible label is `ed.siteCode`, never a name shortened by string surgery: `ed.name` is
 * carried in the card's accessible name and `title` instead, so the unabbreviated hospital
 * reaches a screen reader and a hover without ever displaying a plausible-but-wrong guess.
 */
export function PressureStrip({ now, selectedEdId, onSelectEd, movements }: PressureStripProps) {
  const pressure = movements === undefined ? edPressure(now) : edPressure(now, movements);

  return (
    <section className={styles.pressureStrip} aria-label="Emergency department pressure">
      <header className={styles.regionHeader}>
        <h2>Emergency department pressure</h2>
        <span className={styles.regionCount}>{pressure.length} departments</span>
      </header>
      <p className={styles.pressureRule}>Ordered worst first: breached deadlines, then longest wait.</p>
      <ul className={styles.pressureList}>
        {pressure.map((row) => {
          const selected = row.ed.id === selectedEdId;
          // `aria-label` REPLACES an element's accessible name computed from its content, so
          // setting it to just `ed.name` (Task 4 review Important 3) hid the waiting count,
          // longest wait and breach count from assistive technology entirely. Compose the whole
          // card into the name instead — the hospital name the ruling requires, plus every
          // figure a sighted coordinator sees. `title` stays the bare hospital name for a hover
          // tooltip, a different surface with a different length budget. The visible spans are
          // `aria-hidden` so a screen reader isn't read the same figures twice.
          const accessibleNameParts = [row.ed.name];
          if (row.waiting === 0) {
            accessibleNameParts.push("no patients waiting");
          } else {
            accessibleNameParts.push(`${row.waiting} waiting`, `longest ${splitDuration(row.longestWaitMinutes)}`);
          }
          if (row.breaching > 0) accessibleNameParts.push(`${row.breaching} breaching`);
          const accessibleName = accessibleNameParts.join(", ");

          return (
            <li key={row.ed.id}>
              <button
                type="button"
                data-testid={`ward-ed-${row.ed.id}`}
                className={selected ? styles.pressureCardSelected : styles.pressureCard}
                // Always present and numeric — never a boolean flag — so a test can read these
                // as the actual sort keys `edPressure` ranks by, not just "some truthy marker"
                // (Task 4 review Important 1).
                data-breaching={row.breaching}
                data-longest-minutes={row.longestWaitMinutes}
                data-waiting={row.waiting}
                aria-pressed={selected}
                aria-label={accessibleName}
                title={row.ed.name}
                onClick={() => onSelectEd(selected ? undefined : row.ed.id)}
              >
                <span className={styles.pressureSiteCode} aria-hidden="true">
                  {row.ed.siteCode}
                </span>
                {row.waiting === 0 ? (
                  <span className={styles.pressureStats} aria-hidden="true">
                    No patients waiting
                  </span>
                ) : (
                  <span className={styles.pressureStats} aria-hidden="true">
                    {row.waiting} waiting · longest {splitDuration(row.longestWaitMinutes)}
                  </span>
                )}
                {row.breaching > 0 ? (
                  <span className={styles.pressureBreach} aria-hidden="true">
                    {row.breaching} breaching
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
