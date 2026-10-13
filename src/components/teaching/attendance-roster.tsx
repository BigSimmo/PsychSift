"use client";

import React, { useMemo, useState } from "react";

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
      className={`teaching-attendance-roster flex flex-col gap-3 p-4 border rounded-lg bg-white shadow-sm ${className}`}
      data-testid="teaching-attendance-roster"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Registrar Attendance Roster</h2>
          <p className="text-xs text-gray-500">
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
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              !gapsOnly
                ? "bg-blue-50 text-blue-700 border-blue-200 font-medium"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
            data-testid="roster-view-all-btn"
          >
            All Registrars ({registrarList.length})
          </button>
          <button
            type="button"
            onClick={() => setGapsOnly(true)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              gapsOnly
                ? "bg-amber-50 text-amber-800 border-amber-300 font-medium"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
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
          className="w-full text-xs px-3 py-2 border rounded-md border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900"
          data-testid="attendance-roster-search"
          spellCheck={false}
        />
        {filterQuery && (
          <button
            type="button"
            onClick={() => setFilterQuery("")}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
          >
            Clear
          </button>
        )}
      </div>

      {/* Roster List */}
      <div className="flex flex-col divide-y divide-gray-100 mt-1">
        {displayedRegistrars.length > 0 ? (
          displayedRegistrars.map((registrar) => (
            <div
              key={registrar.userId}
              onClick={() => onSelectRegistrar?.(registrar)}
              className={`py-2.5 px-3 flex items-center justify-between transition-colors rounded ${
                registrar.hasGap
                  ? "bg-amber-50/50 hover:bg-amber-50 border-l-4 border-amber-400 pl-2"
                  : "hover:bg-gray-50"
              }`}
              data-testid={`attendance-roster-row-${registrar.userId}`}
              data-has-gap={registrar.hasGap ? "true" : "false"}
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-gray-900">{registrar.name}</span>
                <span className="text-xs text-gray-500">
                  {registrar.hasGap
                    ? "No check-in recorded this term"
                    : `${registrar.count} check-in${registrar.count === 1 ? "" : "s"} recorded`}
                </span>
              </div>

              <div>
                {registrar.hasGap ? (
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800"
                    data-testid="attendance-gap-badge"
                  >
                    Attendance gap
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs text-gray-600 bg-gray-100">
                    {registrar.count} attended
                  </span>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="py-6 text-center text-sm text-gray-500" data-testid="attendance-roster-empty">
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
