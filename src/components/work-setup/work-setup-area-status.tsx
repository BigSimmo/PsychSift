"use client";

import { Check } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { WorkTag } from "@/components/mode-kit/work";
import { useWorkProfileData } from "@/components/work-profile/use-work-profile-data";
import {
  adminArea,
  cpdArea,
  onCallArea,
  rosterArea,
  teachingArea,
  type AreaId,
  type AreaRow,
} from "@/lib/work-profile/model";

/**
 * Whether each area is set up, read exactly as Work profile reads it
 * (`@/lib/work-profile/model`), so the walkthrough and Work profile can never
 * disagree. A read that failed or is still running says "Not checked", never
 * "Ready", and a signed-out reader is asked to sign in rather than told an
 * area is empty.
 */

export type SetupAreaRows = Readonly<Record<AreaId, AreaRow>>;

function signedOutRow(id: AreaId, title: string): AreaRow {
  return { id, title, subtitle: "Sign in to check", state: "not-checked", label: "Not checked" };
}

const SIGNED_OUT_ROWS: SetupAreaRows = {
  roster: signedOutRow("roster", "Roster"),
  teaching: signedOutRow("teaching", "Teaching"),
  cpd: signedOutRow("cpd", "CPD"),
  admin: signedOutRow("admin", "Admin"),
  "on-call": signedOutRow("on-call", "On Call"),
};

function useMinuteNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function SignedInAreaStatus({ children }: { readonly children: (rows: SetupAreaRows) => ReactNode }) {
  const data = useWorkProfileData(useMinuteNow());
  const rows: SetupAreaRows = {
    roster: rosterArea(data.roster),
    teaching: teachingArea(data.teaching),
    cpd: cpdArea(data.cpd),
    admin: adminArea(data.admin),
    "on-call": onCallArea(data.hospitalPhone),
  };
  return <>{children(rows)}</>;
}

/** Renders `children` with each area's row. Reads only for a signed-in reader. */
export function SetupAreaStatus({
  signedIn,
  children,
}: {
  readonly signedIn: boolean;
  readonly children: (rows: SetupAreaRows) => ReactNode;
}) {
  if (!signedIn) return <>{children(SIGNED_OUT_ROWS)}</>;
  return <SignedInAreaStatus>{children}</SignedInAreaStatus>;
}

/** The row's end: a quiet tick for Ready, a tag for Start, plain words otherwise. */
export function SetupAreaTrailing({ row }: { readonly row: AreaRow }) {
  if (row.state === "ready") {
    return (
      <span className="work-setup__ready">
        <Check aria-hidden="true" className="size-icon-sm" strokeWidth={2.4} />
        {row.label}
      </span>
    );
  }
  if (row.state === "start") return <WorkTag tone="amber">{row.label}</WorkTag>;
  return <span className="work-setup__muted">{row.label}</span>;
}
