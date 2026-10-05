"use client";

// TEMPORARY screenshot harness — never committed. Renders the real Work profile
// views from fixtures so every state can be photographed without a live account.

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import type { WorkProfileData } from "@/components/work-profile/use-work-profile-data";
import { WorkProfileFrame, WorkProfileSignedInView } from "@/components/work-profile/work-profile-page";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { readWorkProfileTab, summariseAdmin, type WorkProfileTab } from "@/lib/work-profile/model";

function compliance(title: string, details: Record<string, unknown>, n: number): OnCallEntry {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    section: "logistics",
    slug: `e${n}`,
    title,
    subtitle: null,
    body: null,
    details: { kind: "compliance", ...details },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
    isOwn: true,
  } as OnCallEntry;
}
const reg = compliance("Medical registration renewal", { category: "registration", requirementId: "medical-registration-renewal" }, 1);
const ind = compliance("Indemnity insurance declaration", { category: "registration", requirementId: "professional-indemnity-insurance" }, 2);
const vax = compliance("Influenza vaccination", { category: "Vaccination" }, 3);
const wwc = compliance("Working with children check", { category: "Checks" }, 4);

const team = (name: string, grade: string | null, n: number) => ({
  serviceId: `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`,
  name,
  enabled: true,
  role: "member" as const,
  grade: grade as never,
});

function fixture(state: string): { data: WorkProfileData; online: boolean; sync: string; stage: [string | null, number | null] } {
  const base: WorkProfileData = {
    roster: { status: "ready", value: { workplaces: 2, rowName: "EXAMPLE A" } },
    workplaces: { status: "ready", value: ["Example Hospital", "Example Private Clinic"] },
    teams: { status: "ready", value: [team("Gen Psych 2", "consultant", 1)] },
    teaching: { status: "ready", value: { teams: 2 } },
    cpd: { status: "ready", value: { configured: true, routines: 3 } },
    admin: { status: "ready", value: summariseAdmin([reg, vax, wwc], false) },
    hospitalPhone: false,
    payFortnightAnchor: { status: "ready", value: "2026-10-01" },
  };
  switch (state) {
    case "registrar":
      return {
        data: {
          ...base,
          roster: { status: "ready", value: { workplaces: 1, rowName: "EXAMPLE A" } },
          workplaces: { status: "ready", value: ["Example Hospital"] },
          teams: { status: "ready", value: [team("C-L", "registrar", 2)] },
          admin: { status: "ready", value: summariseAdmin([reg, ind, vax, wwc], false) },
        },
        online: true,
        sync: "synced",
        stage: ["registrar", 2],
      };
    case "first":
      return {
        data: {
          ...base,
          roster: { status: "ready", value: { workplaces: 0, rowName: null } },
          workplaces: { status: "ready", value: [] },
          teams: { status: "ready", value: [] },
          teaching: { status: "ready", value: { teams: 0 } },
          cpd: { status: "ready", value: { configured: false, routines: 0 } },
          admin: { status: "ready", value: summariseAdmin([], false) },
          payFortnightAnchor: { status: "ready", value: null },
        },
        online: true,
        sync: "synced",
        stage: [null, null],
      };
    case "offline":
      return {
        data: {
          ...base,
          teaching: { status: "failed" },
          cpd: { status: "failed" },
          admin: { status: "ready", value: summariseAdmin([reg, vax], true) },
        },
        online: false,
        sync: "synced",
        stage: ["consultant", null],
      };
    case "long":
      return {
        data: {
          ...base,
          roster: { status: "ready", value: { workplaces: 3, rowName: "EXAMPLE LONG LINE NAME B" } },
          workplaces: {
            status: "ready",
            value: [
              "Example Metropolitan Teaching Hospital Mental Health Service",
              "Example Private Clinic",
              "Example Regional Hospital",
            ],
          },
          teams: {
            status: "ready",
            value: [team("Consultation-Liaison Psychiatry", "consultant", 3), team("Older Adult Mental Health", "registrar", 4)],
          },
          admin: { status: "ready", value: summariseAdmin([vax], false) },
        },
        online: true,
        sync: "synced",
        stage: ["consultant", null],
      };
    case "failed":
      return { data: base, online: true, sync: "error", stage: ["consultant", null] };
    default:
      return { data: base, online: true, sync: "synced", stage: ["consultant", null] };
  }
}

function Harness() {
  const params = useSearchParams();
  const state = params.get("state") ?? "filled";
  const [tab, setTab] = useState<WorkProfileTab>(readWorkProfileTab(params.get("tab")));
  const { setPreference } = useAppPreferences();
  const f = fixture(state);
  useEffect(() => {
    setPreference("workStage", f.stage[0] as never);
    setPreference("ranzcpStage", f.stage[1] as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <WorkProfileFrame>
      <WorkProfileSignedInView
        tab={tab}
        onTab={setTab}
        email="alex.example@health.wa.gov.au"
        data={f.data}
        online={f.online}
        syncState={f.sync}
        savedAt={f.sync === "synced" && state !== "first" ? new Date("2026-10-05T06:10:00Z") : null}
        onRetry={() => undefined}
        workStageSet={f.stage[0] !== null}
      />
    </WorkProfileFrame>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Harness />
    </Suspense>
  );
}
