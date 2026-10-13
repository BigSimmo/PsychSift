"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { CarePlanShellFrame } from "./care-plan-shell-frame";
import { ClinicalSnapshotSurface, type ClinicalSnapshotVariant } from "./clinical-snapshot-page";
import { ManagementPlanFormSurface } from "./management-plan-form";
import { ManagementPlanPrintSurface } from "./management-plan-print";
import { ManagementPlanSurface } from "./management-plan-read";
import { ManagementPlanReviewSurface } from "./management-plan-review";
import { HistorySurface } from "./history-page";
import { GovernanceSurface, ReviewsSurface, TeamSurface } from "./operations-pages";
import { PatientPlanFormSurface } from "./patient-plan-form";
import { PatientPlanPrintSurface, PatientPlanSurface } from "./patient-plan-pages";
import { PresentationFormSurface } from "./presentation-form";
import {
  PresentationDetailSurface,
  PresentationTimelineSurface,
  presentationIdFromPathname,
} from "./presentation-pages";
import { useCarePlanPrototype } from "./prototype-provider";
import { CARE_PLAN_BASE, CARE_PLAN_ROUTES, isSyntheticPatientId, type CarePlanDestination } from "./routes";
import { SafetyPlanFormSurface } from "./safety-plan-form";
import { SafetyPlanPrintSurface, SafetyPlanSurface } from "./safety-plan-pages";
import { SystemStatesSurface } from "./system-states-page";
import type { PrototypeScenario, SyntheticId } from "./types";

/**
 * The approved heading and rail destination of every route in the family.
 *
 * Each definition also carried the route's one-line purpose until Task 10. That
 * string existed for the Task 3 specimen surface, which stated what a route
 * would eventually hold while its content was still being built. Every route now
 * holds its content, so the specimen surface is gone and the purpose line went
 * with it rather than staying behind as data nothing reads. The approved route
 * table itself lives in the specification.
 */
type CarePlanRouteDefinition = {
  key: string;
  heading: string;
  destination: CarePlanDestination;
};

const ROUTE_DEFINITIONS = {
  home: { key: "home", heading: "Home", destination: "Home" },
  patients: { key: "patients", heading: "Patients", destination: "Patients" },
  patient: { key: "patient", heading: "Patient overview", destination: "Patients" },
  managementPlan: { key: "managementPlan", heading: "Management Plan", destination: "Patients" },
  managementPlanEdit: { key: "managementPlanEdit", heading: "Draft Management Plan Version", destination: "Patients" },
  managementPlanReview: { key: "managementPlanReview", heading: "Review submitted version", destination: "Patients" },
  managementPlanPrint: { key: "managementPlanPrint", heading: "Print Management Plan", destination: "Patients" },
  patientPlan: { key: "patientPlan", heading: "Patient Plan", destination: "Patients" },
  patientPlanEdit: { key: "patientPlanEdit", heading: "Draft Patient Plan", destination: "Patients" },
  patientPlanPrint: { key: "patientPlanPrint", heading: "Print Patient Plan", destination: "Patients" },
  safetyPlan: { key: "safetyPlan", heading: "Personal Safety Plan", destination: "Patients" },
  safetyPlanEdit: {
    key: "safetyPlanEdit",
    heading: "Draft Personal Safety Plan Version",
    destination: "Patients",
  },
  safetyPlanPrint: { key: "safetyPlanPrint", heading: "Print Personal Safety Plan", destination: "Patients" },
  presentations: { key: "presentations", heading: "ED Presentations", destination: "Patients" },
  newPresentation: { key: "newPresentation", heading: "Record ED Presentation", destination: "Patients" },
  presentation: { key: "presentation", heading: "ED Presentation", destination: "Patients" },
  history: { key: "history", heading: "History", destination: "Patients" },
  reviews: { key: "reviews", heading: "Reviews", destination: "Reviews" },
  team: { key: "team", heading: "Team", destination: "Team" },
  governance: { key: "governance", heading: "Governance", destination: "Governance" },
  systemStates: { key: "systemStates", heading: "System states", destination: "System states" },
} as const satisfies Record<string, CarePlanRouteDefinition>;

const PATIENT_PLAN_SEGMENTS = {
  "management-plan": {
    base: ROUTE_DEFINITIONS.managementPlan,
    edit: ROUTE_DEFINITIONS.managementPlanEdit,
    review: ROUTE_DEFINITIONS.managementPlanReview,
    print: ROUTE_DEFINITIONS.managementPlanPrint,
  },
  "patient-plan": {
    base: ROUTE_DEFINITIONS.patientPlan,
    edit: ROUTE_DEFINITIONS.patientPlanEdit,
    print: ROUTE_DEFINITIONS.patientPlanPrint,
  },
  "safety-plan": {
    base: ROUTE_DEFINITIONS.safetyPlan,
    edit: ROUTE_DEFINITIONS.safetyPlanEdit,
    print: ROUTE_DEFINITIONS.safetyPlanPrint,
  },
} as const;

function carePlanBasePath(pathname: string): string | null {
  if (pathname.startsWith("/admin/care-plan")) return "/admin/care-plan";
  if (pathname.startsWith(CARE_PLAN_BASE)) return CARE_PLAN_BASE;
  return null;
}

/**
 * Resolves a URL to its route definition from the path shape alone, so a route
 * reached by typing its address behaves exactly like one reached by a link.
 */
export function resolveCarePlanRoute(pathname: string): CarePlanRouteDefinition {
  const trimmed = pathname.split("?")[0] ?? pathname;
  const base = carePlanBasePath(trimmed);
  if (!base) return ROUTE_DEFINITIONS.home;
  const segments = trimmed.slice(base.length).split("/").filter(Boolean);

  if (segments.length === 0) return ROUTE_DEFINITIONS.home;

  const [first, , third, fourth] = segments;

  if (first === "reviews") return ROUTE_DEFINITIONS.reviews;
  if (first === "team") return ROUTE_DEFINITIONS.team;
  if (first === "governance") return ROUTE_DEFINITIONS.governance;
  if (first === "system-states") return ROUTE_DEFINITIONS.systemStates;
  if (first !== "patients") return ROUTE_DEFINITIONS.home;

  if (segments.length === 1) return ROUTE_DEFINITIONS.patients;
  if (segments.length === 2) return ROUTE_DEFINITIONS.patient;

  if (third === "history") return ROUTE_DEFINITIONS.history;

  if (third === "presentations") {
    if (!fourth) return ROUTE_DEFINITIONS.presentations;
    return fourth === "new" ? ROUTE_DEFINITIONS.newPresentation : ROUTE_DEFINITIONS.presentation;
  }

  const planSegment = PATIENT_PLAN_SEGMENTS[third as keyof typeof PATIENT_PLAN_SEGMENTS];
  if (!planSegment) return ROUTE_DEFINITIONS.patient;
  if (!fourth) return planSegment.base;
  if (fourth === "edit" && "edit" in planSegment) return planSegment.edit;
  if (fourth === "review" && "review" in planSegment) return planSegment.review;
  if (fourth === "print") return planSegment.print;
  return planSegment.base;
}

const SCENARIO_VALUES: readonly PrototypeScenario[] = [
  "normal",
  "empty",
  "no-current-plan",
  "overdue-plan",
  "withdrawn-plan",
  "unverified-contact",
  "identity-uncertain",
  "version-conflict",
  "offline",
  "permission-unavailable",
  "launch-failure",
  "print-failure",
];

/**
 * A URL may name a deterministic specimen state and nothing else — never a name,
 * a contact detail, or any other record content.
 */
export function scenarioFromQuery(query: string): PrototypeScenario {
  const candidate = new URLSearchParams(query).get("scenario");
  return SCENARIO_VALUES.find((scenario) => scenario === candidate) ?? "normal";
}

/**
 * The synthetic patient a patient-scoped address names, or `null` when the
 * address names none or names one the fixtures do not contain. The page files
 * already refuse an unknown parameter with `notFound()`; this is the same check
 * again on the reading side, so a hand-typed address can never make a surface
 * ask the state for a record that does not exist.
 */
export function carePlanPatientIdFromPathname(pathname: string): string | null {
  const trimmed = pathname.split("?")[0] ?? pathname;
  const base = carePlanBasePath(trimmed);
  if (!base) return null;
  const segments = trimmed.slice(base.length).split("/").filter(Boolean);
  if (segments[0] !== "patients") return null;
  const candidate = segments[1];
  return candidate !== undefined && isSyntheticPatientId(candidate) ? candidate : null;
}

/**
 * The three routes that share the Clinical Snapshot surface, each as a variant
 * of it. Home and Patients own their own directory search rather than borrowing
 * the shell composer, so no page in the family carries two search fields.
 *
 * Every other route owns a surface of its own, resolved in the chain below.
 * That chain is exhaustive over `ROUTE_DEFINITIONS` as of Task 10: no route
 * falls through to a specimen any more, and the Task 3 purpose surface that
 * stood in for unbuilt content no longer exists.
 */
const SNAPSHOT_VARIANT_BY_ROUTE_KEY: Partial<Record<string, ClinicalSnapshotVariant>> = {
  home: "home",
  patients: "patients",
  patient: "patient",
};

export type CarePlanRouteSurfaceProps = {
  pathname: string;
  query?: string;
  navigate: (href: string) => void;
};

/**
 * The whole route family rendered from plain strings and one navigation
 * callback, so every route can be exercised without a router.
 */
export function CarePlanRouteSurface({ pathname, query = "", navigate }: CarePlanRouteSurfaceProps) {
  const { state, dispatch } = useCarePlanPrototype();
  const [patientSearchQuery, setPatientSearchQuery] = useState("");
  const route = useMemo(() => resolveCarePlanRoute(pathname), [pathname]);
  const scenario = useMemo(() => scenarioFromQuery(query), [query]);
  const activeUser = state.users.find((user) => user.id === state.activeUserId);
  const snapshotVariant = SNAPSHOT_VARIANT_BY_ROUTE_KEY[route.key];
  const patientId = useMemo(() => carePlanPatientIdFromPathname(pathname), [pathname]);
  const queryParams = useMemo(() => new URLSearchParams(query), [query]);

  /**
   * Put the scenario the address names into the reducer, so a specimen degrades
   * the prototype rather than only its rendering.
   *
   * Without this the lens was one-way. `?scenario=offline` set a data attribute
   * and the surfaces' `scenario` prop, while `connectivity`, `permission`,
   * `identity` and `versionConflict` stayed at their defaults — so every branch
   * of `getPrototypeMutationBlockReason` was unreachable in the running
   * application, and the refusals Tasks 4, 5 and 6 built could be proved only in
   * a test that constructed the state by hand.
   *
   * The guard is the whole point. `apply-scenario` reconstructs the fixtures, so
   * dispatching it on an ordinary navigation would throw away a draft that
   * exists only in memory — which is why this project removed an online/offline
   * listener once already. It therefore dispatches only when the scenario named
   * in the URL actually differs from the one the reducer holds, and it resets to
   * `normal` on leaving only when the current scenario was the one this address
   * put there. A scenario chosen by hand on the System states screen is left
   * alone. It mirrored the same guarded sync in the retired Caring Contacts
   * prototype.
   */
  const queryScenarioRef = useRef<PrototypeScenario | null>(null);
  useEffect(() => {
    if (queryParams.has("scenario")) {
      queryScenarioRef.current = scenario;
      if (state.scenario !== scenario) dispatch({ type: "apply-scenario", scenario });
      return;
    }
    if (queryScenarioRef.current === null) return;
    const wasQueryDerived = state.scenario === queryScenarioRef.current;
    queryScenarioRef.current = null;
    if (wasQueryDerived && state.scenario !== "normal") {
      dispatch({ type: "apply-scenario", scenario: "normal" });
    }
  }, [dispatch, queryParams, scenario, state.scenario]);

  return (
    <CarePlanShellFrame
      pathname={pathname}
      activeDestination={route.destination}
      title={route.heading}
      scenario={scenario}
      activeUser={{
        id: activeUser?.id ?? "",
        displayName: activeUser?.displayName ?? "",
        title: activeUser?.title ?? "",
      }}
      prototypeUsers={state.users}
      onSelectUser={(userId) => dispatch({ type: "set-active-user", userId: userId as SyntheticId })}
      onSearchSubmit={(searchQuery) => {
        setPatientSearchQuery(searchQuery);
        navigate(CARE_PLAN_ROUTES.patients);
      }}
      // Home and Patients own an in-flow directory search, so the shell stands
      // its own composer down rather than putting two search fields on one page.
      routeOwnsSearch={snapshotVariant === "home" || snapshotVariant === "patients"}
    >
      {snapshotVariant !== undefined ? (
        <ClinicalSnapshotSurface
          variant={snapshotVariant}
          patientId={patientId ?? undefined}
          scenario={scenario}
          initialSearchQuery={snapshotVariant === "patients" ? patientSearchQuery : ""}
        />
      ) : route.key === ROUTE_DEFINITIONS.managementPlan.key ? (
        <ManagementPlanSurface patientId={patientId} scenario={scenario} />
      ) : route.key === ROUTE_DEFINITIONS.managementPlanEdit.key ? (
        <ManagementPlanFormSurface patientId={patientId} scenario={scenario} navigate={navigate} />
      ) : route.key === ROUTE_DEFINITIONS.managementPlanReview.key ? (
        <ManagementPlanReviewSurface patientId={patientId} scenario={scenario} navigate={navigate} />
      ) : route.key === ROUTE_DEFINITIONS.managementPlanPrint.key ? (
        <ManagementPlanPrintSurface patientId={patientId} scenario={scenario} />
      ) : route.key === ROUTE_DEFINITIONS.presentations.key ? (
        <PresentationTimelineSurface patientId={patientId} scenario={scenario} />
      ) : route.key === ROUTE_DEFINITIONS.newPresentation.key ? (
        <PresentationFormSurface patientId={patientId} scenario={scenario} navigate={navigate} />
      ) : route.key === ROUTE_DEFINITIONS.presentation.key ? (
        <PresentationDetailSurface
          patientId={patientId}
          presentationId={presentationIdFromPathname(pathname)}
          scenario={scenario}
        />
      ) : route.key === ROUTE_DEFINITIONS.patientPlan.key ? (
        <PatientPlanSurface patientId={patientId} scenario={scenario} />
      ) : route.key === ROUTE_DEFINITIONS.patientPlanEdit.key ? (
        <PatientPlanFormSurface patientId={patientId} scenario={scenario} navigate={navigate} />
      ) : route.key === ROUTE_DEFINITIONS.patientPlanPrint.key ? (
        <PatientPlanPrintSurface patientId={patientId} scenario={scenario} />
      ) : route.key === ROUTE_DEFINITIONS.safetyPlan.key ? (
        <SafetyPlanSurface patientId={patientId} scenario={scenario} />
      ) : route.key === ROUTE_DEFINITIONS.safetyPlanEdit.key ? (
        <SafetyPlanFormSurface patientId={patientId} scenario={scenario} navigate={navigate} />
      ) : route.key === ROUTE_DEFINITIONS.safetyPlanPrint.key ? (
        <SafetyPlanPrintSurface patientId={patientId} scenario={scenario} />
      ) : route.key === ROUTE_DEFINITIONS.history.key ? (
        <HistorySurface patientId={patientId} scenario={scenario} />
      ) : route.key === ROUTE_DEFINITIONS.reviews.key ? (
        <ReviewsSurface />
      ) : route.key === ROUTE_DEFINITIONS.team.key ? (
        <TeamSurface />
      ) : route.key === ROUTE_DEFINITIONS.governance.key ? (
        <GovernanceSurface />
      ) : (
        /* `systemStates` — the last key in `ROUTE_DEFINITIONS`, and the only one
           the chain above does not name. `resolveCarePlanRoute` returns a
           definition from that record and nothing else, so this arm is that
           route rather than a fallback for an unknown one. */
        <SystemStatesSurface scenario={scenario} />
      )}
    </CarePlanShellFrame>
  );
}

/** The router wrapper: the only place Care Plan reads Next.js navigation. */
export function CarePlanRoutableSuite() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  return (
    <CarePlanRouteSurface pathname={pathname} query={searchParams.toString()} navigate={(href) => router.push(href)} />
  );
}
