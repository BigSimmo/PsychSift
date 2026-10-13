"use client";

import React, { useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { cn, fieldControlPlain, panelSubtle, subtleStatusPill, toneWarning } from "@/components/ui-primitives";

export interface RegistrarMember {
  userId: string;
  name: string;
  role?: string;
  checkInsCount?: number;
  joinedAt?: string;
}

export interface AttendanceRosterProps {
  members: readonly RegistrarMember[];
  checkInCountsByUserId?: Record<string, number>;
  initialFilterGapsOnly?: boolean;
  onSelectRegistrar?: (member: RegistrarMember) => void;
  className?: string;
}

const filterPill =
  "inline-flex min-h-tap items-center rounded-full border px-3 text-xs transition motion-reduce:transition-none";
const filterPillOff =
  "border-[color:var(--border)] bg-[color:var(--surface)] font-semibold text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]";
const filterPillOn =
  "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] font-bold text-[color:var(--clinical-accent)]";

/**
 * Registrar Attendance Roster with Attendance-Gap Filter View (#WVS32F).
 *
 * Provides a registrar roster with filterable views for attendance gaps.
 * Uses honest wording ('No check-in recorded this term', never 'missed')
 * as mandated by clinical governance and owner rulings.
 */
export function AttendanceRoster({
  members,
  checkInCountsByUserId = {},
  initialFilterGapsOnly = false,
  onSelectRegistrar,
  className = "",
}: AttendanceRosterProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const [gapsOnly, setGapsOnly] = useState(initialFilterGapsOnly);

  // Doctors / registrars roster with calculated check-in counts
  const registrarList = useMemo(() => {
    return members
      .filter((m) => !m.role || m.role === "doctor" || m.role === "registrar")
      .map((m) => {
        const count = m.checkInsCount ?? checkInCountsByUserId[m.userId] ?? 0;
        const hasGap = count === 0;
        return {
          ...m,
          count,
          hasGap,
        };
      });
  }, [members, checkInCountsByUserId]);

  const gapCount = useMemo(() => {
    return registrarList.filter((m) => m.hasGap).length;
  }, [registrarList]);

  // Filtered view according to gap toggle and text filter
  const displayedRegistrars = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return registrarList.filter((m) => {
      if (gapsOnly && !m.hasGap) return false;
      if (q && !m.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [registrarList, gapsOnly, filterQuery]);

  return (
    <div
      className={cn("teaching-attendance-roster flex flex-col gap-3 p-4", panelSubtle, className)}
      data-testid="teaching-attendance-roster"
    >
      <div className="flex flex-col justify-between gap-2 border-b border-[color:var(--border)] pb-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--text-heading)]">Registrar Attendance Roster</h2>
          <p className="text-xs text-[color:var(--text-muted)]">
            {gapCount === 0
              ? "All registered doctors have recorded check-ins."
              : `${gapCount} doctor${gapCount === 1 ? "" : "s"} with no check-in recorded this term.`}
          </p>
        </div>

        {/* Filter controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setGapsOnly(false)}
            aria-pressed={!gapsOnly}
            className={cn(filterPill, !gapsOnly ? filterPillOn : filterPillOff, focusRing)}
            data-testid="roster-view-all-btn"
          >
            All Registrars ({registrarList.length})
          </button>
          <button
            type="button"
            onClick={() => setGapsOnly(true)}
            aria-pressed={gapsOnly}
            className={cn(filterPill, gapsOnly ? cn(toneWarning, "font-bold") : filterPillOff, focusRing)}
            data-testid="attendance-gap-filter-toggle"
          >
            Attendance Gaps ({gapCount})
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="Filter registrars by name..."
          aria-label="Filter registrars"
          className={fieldControlPlain}
          data-testid="attendance-roster-search"
          spellCheck={false}
        />
        {filterQuery && (
          <button
            type="button"
            onClick={() => setFilterQuery("")}
            className={cn(
              "inline-flex min-h-tap items-center rounded-lg px-2 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text)]",
              focusRing,
            )}
          >
            Clear
          </button>
        )}
      </div>

      {/* Roster List */}
      <div className="mt-1 flex flex-col divide-y divide-[color:var(--border)]">
        {displayedRegistrars.length > 0 ? (
          displayedRegistrars.map((registrar) => (
            <div
              key={registrar.userId}
              onClick={() => onSelectRegistrar?.(registrar)}
              className={cn(
                "flex items-center justify-between rounded px-3 py-2.5 transition-colors motion-reduce:transition-none",
                registrar.hasGap
                  ? "border-l-4 border-[color:var(--warning)] bg-[color:var(--warning-soft)] pl-2"
                  : "hover:bg-[color:var(--surface-subtle)]",
              )}
              data-testid={`attendance-roster-row-${registrar.userId}`}
              data-has-gap={registrar.hasGap ? "true" : "false"}
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-[color:var(--text-heading)]">{registrar.name}</span>
                <span className="text-xs text-[color:var(--text-muted)]">
                  {registrar.hasGap
                    ? "No check-in recorded this term"
                    : `${registrar.count} check-in${registrar.count === 1 ? "" : "s"} recorded`}
                </span>
              </div>

              <div>
                {registrar.hasGap ? (
                  <span
                    className={cn(
                      "inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold",
                      toneWarning,
                    )}
                    data-testid="attendance-gap-badge"
                  >
                    Attendance gap
                  </span>
                ) : (
                  <span className={subtleStatusPill}>{registrar.count} attended</span>
                )}
              </div>
            </div>
          ))
        ) : (
          <div
            className="py-6 text-center text-sm text-[color:var(--text-muted)]"
            data-testid="attendance-roster-empty"
          >
            {filterQuery
              ? "No registrar matches that filter."
              : gapsOnly
                ? "No attendance gaps recorded."
                : "No registrars registered."}
          </div>
        )}
      </div>
    </div>
  );
}
