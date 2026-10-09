"use client";

import { useEffect, useMemo, useState, type ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { postRosterAction, fetchRosterRead } from "@/components/roster/use-roster-team";
import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";

import type { RequestSent } from "./request-ui";

type DayKind = "cant" | "prefer_off";
const words: Record<DayKind, string> = { cant: "Can't work", prefer_off: "Prefer off" };

export function RosterDatesSheet(props: ComponentProps<typeof DatesSession>) {
  return props.open ? (
    <DatesSession
      key={JSON.stringify([props.serviceId, props.actorId, props.initialDate, props.toDate, props.initialKind])}
      {...props}
    />
  ) : null;
}

function DatesSession({
  open,
  onClose,
  serviceId,
  actorId,
  initialDate,
  toDate,
  initialKind = "cant",
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  serviceId: string;
  actorId: string;
  initialDate?: string | null;
  toDate?: string | null;
  initialKind?: DayKind;
  onSent: RequestSent;
}) {
  const today = perthDateOf(new Date());
  const dates = useMemo(() => Array.from({ length: 56 }, (_, index) => addDaysToDate(today, index + 1)), [today]);
  const [before, setBefore] = useState<Record<string, DayKind>>({});
  const [selected, setSelected] = useState<Record<string, DayKind>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void fetchRosterRead(serviceId, "unavailability", { from: dates[0]!, to: dates.at(-1)! }).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setError("Your dates couldn't be checked. Close and try again.");
        return;
      }
      const saved = Object.fromEntries(
        result.data.unavailability.filter((row) => row.userId === actorId).map((row) => [row.date, row.kind]),
      ) as Record<string, DayKind>;
      const next = { ...saved };
      if (initialDate && initialDate > today && initialDate <= dates.at(-1)!) {
        for (
          let day = initialDate;
          day <= (toDate && toDate >= day ? toDate : initialDate) && day <= dates.at(-1)!;
          day = addDaysToDate(day, 1)
        )
          next[day] = initialKind;
      }
      setBefore(saved);
      setSelected(next);
      setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [open, serviceId, actorId, initialDate, toDate, initialKind, today, dates]);

  function cycle(day: string) {
    setSelected((current) => {
      const next = { ...current };
      if (!next[day]) next[day] = "cant";
      else if (next[day] === "cant") next[day] = "prefer_off";
      else delete next[day];
      return next;
    });
  }

  async function save() {
    const set = dates
      .filter((date) => selected[date] && selected[date] !== before[date])
      .map((date) => ({ date, kind: selected[date]! }));
    const clear = dates.filter((date) => before[date] && !selected[date]);
    if (!set.length && !clear.length) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await postRosterAction(serviceId, { action: "unavailability.set", set, clear });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSent("Dates saved", async () => {
      const reverse = await postRosterAction(serviceId, {
        action: "unavailability.set",
        set: dates
          .filter((date) => before[date] !== selected[date] && before[date])
          .map((date) => ({ date, kind: before[date]! })),
        clear: dates.filter((date) => selected[date] && !before[date]),
      });
      if (!reverse.ok) throw new Error(reverse.message);
    });
    onClose();
  }

  const months = dates.reduce<Record<string, string[]>>((groups, date) => {
    (groups[date.slice(0, 7)] ??= []).push(date);
    return groups;
  }, {});

  return (
    <Sheet open={open} onClose={onClose} title="Dates I can't work">
      <div className="grid gap-4">
        <p className="text-sm">
          Tap a future date once for Can&apos;t work, again for Prefer off, and a third time to clear it. These are for
          the next roster.
        </p>
        {!loaded && !error ? <p role="status">Checking your dates…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {loaded ? (
          <div className="grid gap-4">
            {Object.entries(months).map(([month, days]) => (
              <section key={month}>
                <h3 className="mb-2 font-medium">
                  {new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", month: "long", year: "numeric" }).format(
                    new Date(`${month}-01T00:00:00Z`),
                  )}
                </h3>
                <div className="grid grid-cols-7 gap-1">
                  {days.map((date) => (
                    <button
                      type="button"
                      key={date}
                      aria-label={`${date}: ${selected[date] ? words[selected[date]] : "available"}`}
                      aria-pressed={!!selected[date]}
                      onClick={() => cycle(date)}
                      className="min-h-12 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] text-xs hover:bg-[color:var(--surface-subtle)]"
                    >
                      <span className="block">{Number(date.slice(8))}</span>
                      <span className="block text-3xs">
                        {selected[date] === "cant" ? "Can't" : selected[date] === "prefer_off" ? "Prefer" : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
        {loaded ? (
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Save dates
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}
