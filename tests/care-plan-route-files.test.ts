import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { BANNED_ADMISSION_CONSTRUCTIONS } from "@/components/care-plan/mockups/domain";
import { syntheticEdPresentations, syntheticPatients } from "@/components/care-plan/mockups/fixtures";
import {
  CARE_PLAN_BASE,
  CARE_PLAN_ROUTES,
  SYNTHETIC_PATIENT_PARAMS,
  SYNTHETIC_PRESENTATION_PARAMS,
  carePlanRoute,
  isSyntheticPatientId,
  isSyntheticPresentationForPatient,
  isSyntheticPresentationId,
} from "@/components/care-plan/mockups/routes";
import { DEVELOPER_GATED_PATH_PREFIXES } from "@/lib/developer-area/headers";
import { HUB_PANELS } from "@/lib/developer-area/hub-panels";

const APP_ROOT = "src/app/mockups/care-plan";
const COMPONENT_ROOT = "src/components/care-plan/mockups";

const pageFiles = [
  `${APP_ROOT}/page.tsx`,
  `${APP_ROOT}/patients/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/management-plan/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/management-plan/edit/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/management-plan/review/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/management-plan/print/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/patient-plan/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/patient-plan/edit/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/patient-plan/print/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/safety-plan/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/safety-plan/edit/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/safety-plan/print/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/presentations/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/presentations/new/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/presentations/[presentationId]/page.tsx`,
  `${APP_ROOT}/patients/[patientId]/history/page.tsx`,
  `${APP_ROOT}/reviews/page.tsx`,
  `${APP_ROOT}/team/page.tsx`,
  `${APP_ROOT}/governance/page.tsx`,
  `${APP_ROOT}/system-states/page.tsx`,
] as const;

function readNamespaceSources(): { path: string; source: string }[] {
  return [APP_ROOT, COMPONENT_ROOT].flatMap((root) => {
    const absoluteRoot = resolve(process.cwd(), root);
    return readdirSync(absoluteRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:ts|tsx|css)$/.test(entry.name))
      .map((entry) => {
        const path = resolve(entry.parentPath, entry.name);
        return { path, source: readFileSync(path, "utf8") };
      });
  });
}

describe("Care Plan route registry", () => {
  it("pins the exact approved URL for every route in the family", () => {
    expect(CARE_PLAN_ROUTES).toEqual({
      home: "/mockups/care-plan",
      patients: "/mockups/care-plan/patients",
      patient: "/mockups/care-plan/patients/SYN-PATIENT-001",
      managementPlan: "/mockups/care-plan/patients/SYN-PATIENT-001/management-plan",
      managementPlanEdit: "/mockups/care-plan/patients/SYN-PATIENT-001/management-plan/edit",
      managementPlanReview: "/mockups/care-plan/patients/SYN-PATIENT-001/management-plan/review",
      managementPlanPrint: "/mockups/care-plan/patients/SYN-PATIENT-001/management-plan/print",
      patientPlan: "/mockups/care-plan/patients/SYN-PATIENT-001/patient-plan",
      patientPlanEdit: "/mockups/care-plan/patients/SYN-PATIENT-001/patient-plan/edit",
      patientPlanPrint: "/mockups/care-plan/patients/SYN-PATIENT-001/patient-plan/print",
      safetyPlan: "/mockups/care-plan/patients/SYN-PATIENT-001/safety-plan",
      safetyPlanEdit: "/mockups/care-plan/patients/SYN-PATIENT-001/safety-plan/edit",
      safetyPlanPrint: "/mockups/care-plan/patients/SYN-PATIENT-001/safety-plan/print",
      presentations: "/mockups/care-plan/patients/SYN-PATIENT-001/presentations",
      newPresentation: "/mockups/care-plan/patients/SYN-PATIENT-001/presentations/new",
      presentation: "/mockups/care-plan/patients/SYN-PATIENT-001/presentations/SYN-PRESENTATION-001",
      history: "/mockups/care-plan/patients/SYN-PATIENT-001/history",
      reviews: "/mockups/care-plan/reviews",
      team: "/mockups/care-plan/team",
      governance: "/mockups/care-plan/governance",
      systemStates: "/mockups/care-plan/system-states",
    });
    expect(CARE_PLAN_BASE).toBe("/mockups/care-plan");
  });

  it("rebuilds every deep route from a patient identifier without a second literal", () => {
    expect(carePlanRoute.patient("SYN-PATIENT-003")).toBe("/mockups/care-plan/patients/SYN-PATIENT-003");
    expect(carePlanRoute.managementPlan("SYN-PATIENT-003")).toBe(
      "/mockups/care-plan/patients/SYN-PATIENT-003/management-plan",
    );
    // Both authoring addresses existed in `CARE_PLAN_ROUTES` from Task 3 but had
    // no builder, so an authoring link could only be reached by hand-writing the
    // suffix — the one thing this registry exists to prevent.
    expect(carePlanRoute.managementPlanEdit("SYN-PATIENT-003")).toBe(
      "/mockups/care-plan/patients/SYN-PATIENT-003/management-plan/edit",
    );
    expect(carePlanRoute.managementPlanReview("SYN-PATIENT-003")).toBe(
      "/mockups/care-plan/patients/SYN-PATIENT-003/management-plan/review",
    );
    expect(carePlanRoute.managementPlanEdit("SYN-PATIENT-001")).toBe(CARE_PLAN_ROUTES.managementPlanEdit);
    expect(carePlanRoute.managementPlanReview("SYN-PATIENT-001")).toBe(CARE_PLAN_ROUTES.managementPlanReview);
    expect(carePlanRoute.safetyPlan("SYN-PATIENT-003")).toBe("/mockups/care-plan/patients/SYN-PATIENT-003/safety-plan");
    // The Personal Safety Plan's own two addresses were in `CARE_PLAN_ROUTES`
    // from Task 3 with no builder beside them, exactly as the Management Plan's
    // authoring addresses were until Task 6 and the recording address until
    // Task 7. A print link hand-written from a string is how a patient-facing
    // sheet ends up addressed to a different person.
    expect(carePlanRoute.safetyPlanEdit("SYN-PATIENT-003")).toBe(
      "/mockups/care-plan/patients/SYN-PATIENT-003/safety-plan/edit",
    );
    expect(carePlanRoute.safetyPlanPrint("SYN-PATIENT-003")).toBe(
      "/mockups/care-plan/patients/SYN-PATIENT-003/safety-plan/print",
    );
    expect(carePlanRoute.safetyPlanEdit("SYN-PATIENT-001")).toBe(CARE_PLAN_ROUTES.safetyPlanEdit);
    expect(carePlanRoute.safetyPlanPrint("SYN-PATIENT-001")).toBe(CARE_PLAN_ROUTES.safetyPlanPrint);
    // The Patient Plan's own two addresses were in `CARE_PLAN_ROUTES` from
    // Task 3 with no builder beside them, exactly as the Management Plan's and
    // the Safety Plan's were. This is the copy handed to a person, so a
    // hand-written print link is how one ends up addressed to somebody else.
    expect(carePlanRoute.patientPlan("SYN-PATIENT-003")).toBe(
      "/mockups/care-plan/patients/SYN-PATIENT-003/patient-plan",
    );
    expect(carePlanRoute.patientPlanEdit("SYN-PATIENT-003")).toBe(
      "/mockups/care-plan/patients/SYN-PATIENT-003/patient-plan/edit",
    );
    expect(carePlanRoute.patientPlanPrint("SYN-PATIENT-003")).toBe(
      "/mockups/care-plan/patients/SYN-PATIENT-003/patient-plan/print",
    );
    expect(carePlanRoute.patientPlanEdit("SYN-PATIENT-001")).toBe(CARE_PLAN_ROUTES.patientPlanEdit);
    expect(carePlanRoute.patientPlanPrint("SYN-PATIENT-001")).toBe(CARE_PLAN_ROUTES.patientPlanPrint);
    expect(carePlanRoute.presentations("SYN-PATIENT-003")).toBe(
      "/mockups/care-plan/patients/SYN-PATIENT-003/presentations",
    );
    // The recording address existed in `CARE_PLAN_ROUTES` from Task 3 with no
    // builder beside it, so the only way to link to it was to hand-write the
    // suffix — the same gap the two authoring addresses had until Task 6.
    expect(carePlanRoute.newPresentation("SYN-PATIENT-003")).toBe(
      "/mockups/care-plan/patients/SYN-PATIENT-003/presentations/new",
    );
    expect(carePlanRoute.newPresentation("SYN-PATIENT-001")).toBe(CARE_PLAN_ROUTES.newPresentation);
    expect(carePlanRoute.presentation("SYN-PATIENT-003", "SYN-PRESENTATION-012")).toBe(
      "/mockups/care-plan/patients/SYN-PATIENT-003/presentations/SYN-PRESENTATION-012",
    );
  });

  it("carries only a named specimen scenario in a query string, never record content", () => {
    expect(carePlanRoute.scenario("overdue-plan")).toBe("/mockups/care-plan/system-states?scenario=overdue-plan");
    expect(carePlanRoute.scenario("offline", CARE_PLAN_ROUTES.reviews)).toBe(
      "/mockups/care-plan/reviews?scenario=offline",
    );
    expect(carePlanRoute.withQuery(CARE_PLAN_ROUTES.reviews, "scenario", "empty")).toBe(
      "/mockups/care-plan/reviews?scenario=empty",
    );
    expect(carePlanRoute.withQuery("/mockups/care-plan/reviews?scenario=empty", "view", "awaiting")).toBe(
      "/mockups/care-plan/reviews?scenario=empty&view=awaiting",
    );
  });
});

describe("Care Plan finite synthetic parameters", () => {
  it("derives the patient parameter list from the fixtures rather than a hand-written copy", () => {
    expect(SYNTHETIC_PATIENT_PARAMS).toEqual(syntheticPatients.map((patient) => ({ patientId: patient.id })));
    expect(SYNTHETIC_PATIENT_PARAMS.length).toBeGreaterThan(0);
    for (const { patientId } of SYNTHETIC_PATIENT_PARAMS) expect(patientId.startsWith("SYN-")).toBe(true);
  });

  it("derives every episode parameter pair from the fixtures", () => {
    expect(SYNTHETIC_PRESENTATION_PARAMS).toEqual(
      syntheticEdPresentations.map((presentation) => ({
        patientId: presentation.patientId,
        presentationId: presentation.id,
      })),
    );
    for (const { patientId, presentationId } of SYNTHETIC_PRESENTATION_PARAMS) {
      expect(patientId.startsWith("SYN-")).toBe(true);
      expect(presentationId.startsWith("SYN-")).toBe(true);
    }
  });

  it("recognises only known synthetic identifiers", () => {
    expect(isSyntheticPatientId("SYN-PATIENT-001")).toBe(true);
    expect(isSyntheticPatientId("SYN-PATIENT-999")).toBe(false);
    expect(isSyntheticPatientId("../../etc/passwd")).toBe(false);
    expect(isSyntheticPresentationForPatient("SYN-PATIENT-001", "SYN-PRESENTATION-001")).toBe(true);
    // Episode 009 belongs to another patient, so this pairing must not resolve.
    expect(isSyntheticPresentationForPatient("SYN-PATIENT-001", "SYN-PRESENTATION-009")).toBe(false);
    expect(isSyntheticPresentationForPatient("SYN-PATIENT-001", "SYN-PRESENTATION-999")).toBe(false);
  });

  /**
   * The episode page cannot ask the pairing question — it is a server component
   * with no view of the session's memory, and an episode recorded in this
   * session is a real address the fixtures have never heard of. It refuses what
   * is not an address at all, and the surface makes the belongs-to-this-patient
   * decision against the state it can actually see.
   */
  it("accepts an episode identifier recorded in this session while still refusing a non-address", () => {
    expect(isSyntheticPresentationId("SYN-PRESENTATION-001")).toBe(true);
    expect(isSyntheticPresentationId("SYN-PRESENTATION-021")).toBe(true);
    expect(isSyntheticPresentationId("SYN-PATIENT-001")).toBe(false);
    expect(isSyntheticPresentationId("SYN-PRESENTATION-")).toBe(false);
    expect(isSyntheticPresentationId("../../etc/passwd")).toBe(false);
    expect(isSyntheticPresentationId("SYN-PRESENTATION-001/../../secret")).toBe(false);
  });
});

describe("Care Plan route registration", () => {
  it("registers all twenty-one approved pages plus the shared layout, loading and route page", () => {
    for (const file of pageFiles) {
      expect(existsSync(resolve(process.cwd(), file)), `${file} is missing`).toBe(true);
    }
    expect(pageFiles.length).toBe(21);
    for (const file of [`${APP_ROOT}/layout.tsx`, `${APP_ROOT}/loading.tsx`, `${APP_ROOT}/route-page.tsx`]) {
      expect(existsSync(resolve(process.cwd(), file)), `${file} is missing`).toBe(true);
    }
  });

  it("registers no page beyond the twenty-one approved routes", () => {
    const found = readdirSync(resolve(process.cwd(), APP_ROOT), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name === "page.tsx")
      .map((entry) => resolve(entry.parentPath, entry.name));
    expect(found.length).toBe(pageFiles.length);
  });

  /**
   * Every dynamic segment is validated — each one, by name.
   *
   * This used to accept any file matching `isSyntheticPatientId|isSyntheticPresentationForPatient`,
   * which was one alternation for two different parameters. When Task 7 moved the
   * episode page from the fixture-pairing check to a shape check plus a
   * state-side identity refusal, the patient half alone kept satisfying the
   * alternation: deleting the presentation-identifier check outright left the
   * parameter unvalidated at the server with nothing going red. A guard that
   * cannot fail is worse than no guard, because it is counted as coverage.
   *
   * The rule is now per parameter, so a page can only satisfy it by validating
   * the exact segment its own path declares.
   */
  const PARAMETER_GUARDS: readonly { segment: string; guard: RegExp; name: string }[] = [
    { segment: "[patientId]", guard: /isSyntheticPatientId\s*\(\s*patientId\s*\)/, name: "patientId" },
    {
      segment: "[presentationId]",
      guard: /isSyntheticPresentation(?:Id|ForPatient)\s*\(/,
      name: "presentationId",
    },
  ];

  it("validates every dynamic parameter and repeats no synthetic identifier in a page file", () => {
    const dynamicPages = pageFiles.filter((file) => file.includes("["));
    expect(dynamicPages.length).toBe(15);
    // Fails closed: if the route family ever stops carrying an episode page,
    // the presentation guard below would silently stop being exercised.
    expect(dynamicPages.filter((file) => file.includes("[presentationId]")).length).toBe(1);

    for (const file of dynamicPages) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, `${file} must refuse an unknown parameter`).toContain("notFound()");
      expect(source, `${file} must prerender its finite parameter list`).toContain("generateStaticParams");
      for (const { segment, guard, name } of PARAMETER_GUARDS) {
        if (!file.includes(segment)) continue;
        expect(source, `${file} must validate its ${name} parameter, by name`).toMatch(guard);
      }
    }
    for (const file of pageFiles) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, `${file} must not repeat a synthetic identifier`).not.toMatch(/SYN-/);
    }
  });

  it("nests the developer gate outside the prototype provider in the route-family layout", () => {
    const layout = readFileSync(resolve(process.cwd(), `${APP_ROOT}/layout.tsx`), "utf8");
    const gateIndex = layout.indexOf("<DeveloperAreaGate>");
    const boundaryIndex = layout.indexOf("<CarePlanErrorBoundary>");
    const providerIndex = layout.indexOf("<CarePlanPrototypeProvider>");
    expect(gateIndex).toBeGreaterThanOrEqual(0);
    expect(boundaryIndex).toBeGreaterThan(gateIndex);
    expect(providerIndex).toBeGreaterThan(boundaryIndex);
  });

  it("exposes a busy loading fallback that shows no fabricated record content", () => {
    const loading = readFileSync(resolve(process.cwd(), `${APP_ROOT}/loading.tsx`), "utf8");
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toMatch(/SYN-PATIENT-|Rowan|Mira|Jordan|Evelyn|Alex Fiction/);
  });

  it("gates only the Care Plan prefix, leaving similarly prefixed paths outside the developer area", () => {
    expect(DEVELOPER_GATED_PATH_PREFIXES).toContain("/mockups/care-plan");
    // Never widened to the whole mockup tree: each entry names one subtree.
    // `tests/proxy.test.ts` proves the look-alike prefixes stay blocked.
    for (const prefix of DEVELOPER_GATED_PATH_PREFIXES) {
      expect(prefix.startsWith("/mockups/"), prefix).toBe(true);
      expect(prefix.slice("/mockups/".length).includes("/"), prefix).toBe(false);
    }
  });

  it("keeps the Care Plan shell independent from the shared mockup search chrome", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/mockups/mockups-layout-client.tsx"), "utf8");
    expect(source).toContain('pathname === "/mockups/care-plan"');
    expect(source).toContain('pathname.startsWith("/mockups/care-plan/")');
    expect(source.match(/!isCarePlanMockup/g)?.length).toBe(2);
  });

  it("links the Care Plan surface from the developer index", () => {
    expect(HUB_PANELS).toContainEqual(
      expect.objectContaining({
        id: "care-plan",
        name: "Care Plan",
        href: CARE_PLAN_ROUTES.home,
        phase: 1,
      }),
    );
  });
});

describe("Care Plan synthetic, memory-only boundary", () => {
  const banned: readonly { label: string; pattern: RegExp }[] = [
    { label: "network fetch", pattern: /\bfetch\s*\(/ },
    { label: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
    { label: "WebSocket or EventSource", pattern: /\b(?:WebSocket|EventSource)\b/ },
    { label: "browser storage", pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/ },
    { label: "cookies", pattern: /document\.cookie|\bcookies\s*\(/ },
    { label: "Server Action", pattern: /["']use server["']/ },
    {
      label: "provider or analytics import",
      pattern: /from\s+["'][^"']*(?:openai|supabase|analytics|sentry)[^"']*["']/i,
    },
    { label: "timers", pattern: /\b(?:setTimeout|setInterval|requestIdleCallback)\s*\(/ },
    { label: "randomness", pattern: /Math\.random\s*\(|crypto\.randomUUID\s*\(/ },
    { label: "wall-clock read", pattern: /Date\.now\s*\(|new Date\s*\(\s*\)/ },
    { label: "presentation-count sorting", pattern: /sort[^\n]{0,40}presentation count/i },
    // Blanket-banned: these describe a person, and no concept in
    // `docs/care-plan-context.md` makes any of them acceptable. Concept-scoped
    // `_Avoid_` terms (Edit, Copy, …) are deliberately NOT here — those ban a
    // word for one concept, not everywhere, and the glossary's own Draft entry
    // says a draft "can be edited".
    {
      label: "stigmatising label for a person",
      pattern: /frequent flyer|high utili[sz]er|problem patient|frequent[- ]presenter|frequent[- ]attender/i,
    },
    { label: "quantified risk or severity verdict", pattern: /risk score|severity score|acuity score/i },
    { label: "numeric identification threshold", pattern: /identification threshold|threshold\s*[:=]\s*\d/i },
    ...BANNED_ADMISSION_CONSTRUCTIONS.map((phrase) => ({
      label: `prohibitive admission construction ("${phrase}")`,
      pattern: new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    })),
  ];

  /**
   * `BANNED_ADMISSION_CONSTRUCTIONS` is declared inside the scanned namespace,
   * so its own array literal would match every one of its own patterns. Remove
   * exactly that declaration — and nothing else — so prose anywhere else in
   * `domain.ts` is still scanned. Fails closed if the declaration changes shape.
   */
  function withoutTheBannedPhraseDeclaration(path: string, source: string) {
    if (!path.endsWith("domain.ts")) return source;
    const start = source.indexOf("export const BANNED_ADMISSION_CONSTRUCTIONS");
    expect(start, "domain.ts no longer declares BANNED_ADMISSION_CONSTRUCTIONS").toBeGreaterThanOrEqual(0);
    const end = source.indexOf("];", start);
    expect(end, "the BANNED_ADMISSION_CONSTRUCTIONS declaration no longer ends with `];`").toBeGreaterThan(start);
    return `${source.slice(0, start)}${source.slice(end)}`;
  }

  it("keeps every new Care Plan source file free of persistence, providers and non-determinism", () => {
    const files = readNamespaceSources();
    expect(files.length).toBeGreaterThan(20);
    expect(BANNED_ADMISSION_CONSTRUCTIONS.length).toBeGreaterThan(10);
    for (const { path, source: raw } of files) {
      const source = withoutTheBannedPhraseDeclaration(path, raw);
      for (const { label, pattern } of banned) {
        expect(pattern.test(source), `${path} contains ${label}`).toBe(false);
      }
    }
  });

  /**
   * The Patient Plan transformation, named explicitly.
   *
   * The scan above covers the whole namespace, which is why it would keep
   * passing if this module were deleted, renamed, or quietly moved outside the
   * directory — and this is the one module in the prototype where "no model, no
   * provider, no network" is a product boundary rather than a house style. A
   * later implementation may replace the function; it may not replace it with
   * something that calls out.
   */
  const PATIENT_PLAN_MODULES = [
    `${COMPONENT_ROOT}/patient-plan-transform.ts`,
    `${COMPONENT_ROOT}/patient-plan-fixtures.ts`,
    `${COMPONENT_ROOT}/patient-plan-pages.tsx`,
    `${COMPONENT_ROOT}/patient-plan-form.tsx`,
    `${COMPONENT_ROOT}/fixtures.ts`,
  ] as const;

  it("keeps the Patient Plan transformation offline, deterministic, and free of any model", () => {
    for (const file of PATIENT_PLAN_MODULES) {
      expect(existsSync(resolve(process.cwd(), file)), `${file} is missing`).toBe(true);
    }

    const transform = readFileSync(resolve(process.cwd(), `${COMPONENT_ROOT}/patient-plan-transform.ts`), "utf8");

    // It imports nothing from outside its own namespace. A relative import can
    // only reach a sibling; anything else would be an alias or a package.
    for (const match of transform.matchAll(/from\s+["']([^"']+)["']/g)) {
      const specifier = match[1] ?? "";
      expect(
        specifier.startsWith("./"),
        `patient-plan-transform.ts imports ${specifier} from outside the namespace`,
      ).toBe(true);
      expect(specifier.includes(".."), `patient-plan-transform.ts reaches up out of the namespace: ${specifier}`).toBe(
        false,
      );
    }

    // No language model, AI service, or provider call is reachable from any part
    // of the Patient Plan, including the transformation.
    const forbidden: readonly { label: string; pattern: RegExp }[] = [
      { label: "a language-model provider", pattern: /\b(?:openai|anthropic|claude|gemini|bedrock|azure_?openai)\b/i },
      {
        label: "a model call",
        pattern: /\b(?:createCompletion|chat\.completions|generateText|streamText|invokeModel)\b/,
      },
      { label: "an inference or embedding call", pattern: /\b(?:inference|embedding|embeddings|tokeni[sz]er)\b/i },
      { label: "a prompt", pattern: /\b(?:systemPrompt|userPrompt|promptTemplate)\b/ },
      {
        label: "a network call",
        pattern: /\bfetch\s*\(|\baxios\b|\bhttps?:\/\/(?!example\.org|www\.triplezero|emhs\.health)/i,
      },
      { label: "a wall-clock read", pattern: /Date\.now\s*\(|new Date\s*\(\s*\)/ },
      { label: "randomness", pattern: /Math\.random\s*\(|crypto\./ },
      { label: "a timer", pattern: /\bsetTimeout\s*\(|\bsetInterval\s*\(/ },
      { label: "storage", pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/ },
    ];
    for (const file of PATIENT_PLAN_MODULES) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const { label, pattern } of forbidden) {
        expect(pattern.test(source), `${file} contains ${label}`).toBe(false);
      }
    }
  });

  it("registers no route handler and no production route outside the mockup namespace", () => {
    const handlers = readdirSync(resolve(process.cwd(), APP_ROOT), { recursive: true, withFileTypes: true }).filter(
      (entry) => entry.isFile() && /^route\.(?:ts|tsx|js)$/.test(entry.name),
    );
    expect(handlers).toEqual([]);
    for (const path of ["src/app/care-plan", "src/app/patients", "src/app/reviews", "src/app/governance"]) {
      expect(existsSync(resolve(process.cwd(), path)), `${path} must not exist`).toBe(false);
    }
  });

  it("scopes every Care Plan stylesheet selector below the app root", () => {
    const css = readFileSync(resolve(process.cwd(), `${COMPONENT_ROOT}/care-plan.module.css`), "utf8");
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // Drop at-rule headers (`@media …{`) but keep the rules inside them, so a
      // selector that escapes `.appRoot` cannot hide in a media or print block.
      .replace(/@[^{]*\{/g, "")
      .split("}")
      .flatMap((block) => {
        const head = block.split("{")[0]?.trim();
        return head ? [head] : [];
      })
      .filter((head) => head.length > 0 && !head.startsWith("@"))
      .flatMap((head) => head.split(",").map((part) => part.trim()))
      .filter((part) => part.length > 0);
    expect(selectors.length).toBeGreaterThan(5);
    for (const selector of selectors) {
      expect(selector.startsWith(".appRoot"), `${selector} is not scoped below .appRoot`).toBe(true);
    }
  });

  /**
   * The DOM tests can only see class *tokens*: Vitest runs with its default
   * `css: false`, so a CSS Module import resolves to a proxy that echoes the
   * accessed key and no stylesheet is ever applied. A rule added here that
   * clipped the pinned safety boundary or the fifth first-minute section would
   * leave every DOM assertion in `care-plan-linked-routes.dom.test.tsx` passing
   * while the one section the specification says is never collapsed became
   * unreadable. This is the guard for that regression, and it is static because
   * static is the only place it is visible.
   */
  it("never lets a stylesheet rule collapse, clip or hide the pinned boundary or a first-minute section", () => {
    const css = readFileSync(resolve(process.cwd(), `${COMPONENT_ROOT}/care-plan.module.css`), "utf8");
    const blocks = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // Drop at-rule headers so a suppression cannot hide inside a media,
      // forced-colors, or print block.
      .replace(/@[^{]*\{/g, "")
      .split("}")
      .flatMap((chunk) => {
        // Assumes one `{` per chunk, which holds once at-rule headers are
        // stripped. Anything after a second `{` in one chunk is dropped.
        const [head, body] = chunk.split("{");
        return head !== undefined && body !== undefined ? [{ selector: head.trim(), body }] : [];
      });

    // Extended in Task 5 to the full-plan tier and the printed clinician copy.
    // Vitest runs with `css: false`, so a DOM test can only see that a class
    // token was applied — a print rule that clipped the paper, or a `@media
    // print` rule that hid the full-plan tier, would leave every DOM assertion
    // in `care-plan-linked-routes.dom.test.tsx` green while the content nobody
    // may lose became unreadable on paper.
    // `currentPlanCard` is on this list because it is the card that *contains*
    // the five first-minute sections: a print rule hiding the card would take
    // all five with it while every per-section selector below stayed clean.
    // Extended in Task 8 to the patient's own printed document. It leaves the
    // building, it carries a person's own words about what keeps them safe, and
    // it lists real crisis telephone numbers — a rule that clipped any of it
    // would leave every DOM assertion green.
    // Extended in Task 9 to the Patient Plan. It is the second document that
    // leaves the building, it is written to be read by the person it is about,
    // and a rule that clipped one of its eight sections would leave every DOM
    // assertion green — Vitest runs with `css: false`.
    const protectedSelector =
      /\.(?:firstMinuteSection\w*|pinnedBoundary\w*|fullPlanSection\w*|currentPlanCard|printPaper|printRecordWarning|printIdentity|printCmht|safetyPaper\w*|safetySection\w*|safetySupport\w*|crisis\w*|patientPlanPaper\w*|patientPlanSection\w*|patientPlanLeadIn|patientPlanResource\w*)\b/;

    /**
     * Declarations are parsed rather than pattern-matched over the block text.
     * A value-aware regex here needs a negative lookahead to allow the print
     * reset's `max-height: none`, and a greedy `\s*` in front of that lookahead
     * backtracks until the lookahead sits on the space rather than the value —
     * so the guard reported the reset as a suppression on its first run. Reading
     * the property and value out is not cleverer, it is simply correct.
     */
    function declarationsOf(body: string) {
      // Assumes no declaration value contains a bare `;` — true of this
      // stylesheet, which uses no data URIs or quoted strings.
      return body.split(";").flatMap((declaration) => {
        const separator = declaration.indexOf(":");
        if (separator === -1) return [];
        return [
          {
            property: declaration.slice(0, separator).trim().toLowerCase(),
            value: declaration
              .slice(separator + 1)
              .trim()
              .toLowerCase(),
          },
        ];
      });
    }

    // `max-height: none` and `overflow: visible` are the print reset and stay
    // allowed; the check is on the declared value, not on where the rule sits.
    const suppressions: readonly { label: string; matches: (d: { property: string; value: string }) => boolean }[] = [
      {
        label: "a max-height other than none",
        matches: ({ property, value }) => ["max-height", "max-block-size"].includes(property) && value !== "none",
      },
      {
        label: "clipped overflow",
        matches: ({ property, value }) =>
          /^overflow(?:-(?:x|y|block|inline))?$/.test(property) && /\b(?:hidden|clip)\b/.test(value),
      },
      { label: "display: none", matches: ({ property, value }) => property === "display" && value === "none" },
      {
        label: "visibility: hidden",
        matches: ({ property, value }) => property === "visibility" && ["hidden", "collapse"].includes(value),
      },
      { label: "a line clamp", matches: ({ property }) => property.endsWith("line-clamp") },
      {
        label: "an ellipsis truncation",
        matches: ({ property, value }) => property === "text-overflow" && value === "ellipsis",
      },
      {
        label: "a collapsed height",
        matches: ({ property, value }) =>
          ["height", "block-size"].includes(property) && /^0(?:px|rem|em|%)?$/.test(value),
      },
    ];

    const guarded = blocks.filter(({ selector }) => protectedSelector.test(selector));
    // Fails closed: if the class names are ever renamed, this guard must stop
    // silently matching nothing rather than quietly passing.
    expect(guarded.length, "no protected selector matched — has the class naming changed?").toBeGreaterThanOrEqual(24);

    for (const { selector, body } of guarded) {
      for (const declaration of declarationsOf(body)) {
        for (const { label, matches } of suppressions) {
          expect(
            matches(declaration),
            `${selector} declares ${label} (${declaration.property}: ${declaration.value}), which would hide safety-critical plan content`,
          ).toBe(false);
        }
      }
    }
  });

  /**
   * Print assertions in a DOM test are the weakest kind of guard this project
   * has. Vitest runs with `css: false`, so `expect(node).toHaveClass(...)` proves
   * only that a class *token* reached an attribute — it says nothing about
   * whether a single rule applies, let alone whether the rule survives to paper.
   * The Personal Safety Plan is the document that leaves the building, so its
   * print behaviour is asserted where it is actually visible: in the stylesheet,
   * scoped to the `@media print` block specifically.
   *
   * Each assertion below fails in a way a reader would notice on paper:
   * deleting or shrinking the printed type below 11pt, letting a safety section
   * or a crisis contact be split across a page break, or pinning any part of the
   * patient copy to a viewport that does not exist on a sheet of paper.
   */
  it("keeps the printed patient copy readable, unsplit and unpinned on paper", () => {
    const css = readFileSync(resolve(process.cwd(), `${COMPONENT_ROOT}/care-plan.module.css`), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );

    /** Rules, with the at-rule chain each one sits inside. Brace-matched rather
     *  than split on `}`, because the whole question here is which at-rule a
     *  rule is nested in — the one thing the existing parsers deliberately
     *  discard. */
    function parseRules(source: string): { selectors: string[]; body: string; atRules: string[] }[] {
      const rules: { selectors: string[]; body: string; atRules: string[] }[] = [];
      const atRules: string[] = [];
      let head = "";
      for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (character === "{") {
          const trimmed = head.trim();
          if (trimmed.startsWith("@")) {
            atRules.push(trimmed);
            head = "";
            continue;
          }
          // A plain rule: consume to its own closing brace.
          const end = source.indexOf("}", index);
          expect(end, `unterminated rule for ${trimmed}`).toBeGreaterThan(index);
          rules.push({
            selectors: trimmed
              .split(",")
              .map((part) => part.trim())
              .filter((part) => part.length > 0),
            body: source.slice(index + 1, end),
            atRules: [...atRules],
          });
          index = end;
          head = "";
          continue;
        }
        if (character === "}") {
          atRules.pop();
          head = "";
          continue;
        }
        head += character;
      }
      return rules;
    }

    const rules = parseRules(css);
    const printRules = rules.filter((rule) => rule.atRules.some((atRule) => /^@media\s+print\b/.test(atRule)));
    // Fails closed: if the print block is removed or renamed, this stops
    // silently matching nothing.
    expect(printRules.length, "no @media print rule was found in the Care Plan stylesheet").toBeGreaterThan(4);

    function declarationsFor(className: string, source: typeof rules): Map<string, string> {
      const declared = new Map<string, string>();
      for (const rule of source) {
        if (!rule.selectors.includes(`.appRoot .${className}`)) continue;
        for (const declaration of rule.body.split(";")) {
          const separator = declaration.indexOf(":");
          if (separator === -1) continue;
          declared.set(
            declaration.slice(0, separator).trim().toLowerCase(),
            declaration
              .slice(separator + 1)
              .trim()
              .toLowerCase(),
          );
        }
      }
      return declared;
    }

    /** Points, from the two units this stylesheet uses. 1px is 0.75pt. */
    function pointsOf(value: string): number {
      const match = /^([\d.]+)(pt|rem|px)$/.exec(value);
      if (match === null) return Number.NaN;
      const size = Number(match[1]);
      if (match[2] === "pt") return size;
      return (match[2] === "rem" ? size * 16 : size) * 0.75;
    }

    // Both documents that leave the building: the person's own safety plan, and
    // their own copy of the Management Plan.
    for (const paperClass of ["safetyPaper", "patientPlanPaper"]) {
      const printedSize = declarationsFor(paperClass, printRules).get("font-size");
      expect(
        printedSize,
        `.${paperClass} declares no printed font size, so the patient copy is not sized for paper`,
      ).toBeDefined();
      expect(
        pointsOf(printedSize ?? ""),
        `.${paperClass} prints at ${printedSize ?? "nothing"}, which is too small for the document a person reads in a crisis`,
      ).toBeGreaterThanOrEqual(11);
    }

    for (const className of ["safetySection", "crisisEntry", "patientPlanSection", "patientPlanResource"]) {
      expect(
        declarationsFor(className, printRules).get("break-inside"),
        `.${className} may be split across a page break, so half of it can be lost on the previous sheet`,
      ).toBe("avoid");
    }

    // Nothing on either patient copy is pinned to a viewport that does not exist
    // on a sheet of paper — a fixed dock prints once, over the content, or not at all.
    for (const rule of rules) {
      if (!rule.selectors.some((selector) => /\.(?:safety|crisis|patientPlan)[A-Za-z]*\b/.test(selector))) continue;
      const position = declarationsFor(rule.selectors[0]?.replace(".appRoot .", "") ?? "", [rule]).get("position");
      expect(["fixed", "sticky"], `${rule.selectors.join(", ")} pins printed content to the viewport`).not.toContain(
        position,
      );
    }
  });

  /**
   * The same outcome object rendered at two severities tells a reader the two
   * are different events. The reducer returns one `PrototypeOutcome`, so the
   * mapping from its `kind` to a tone belongs in one place — and the way that
   * regresses is a route quietly declaring its own copy again, which no DOM
   * assertion would see because nothing asserts a tone.
   */
  it("maps an outcome to a tone in exactly one place", () => {
    const consumers = [
      `${COMPONENT_ROOT}/patient-workspace.tsx`,
      `${COMPONENT_ROOT}/management-plan-read.tsx`,
      `${COMPONENT_ROOT}/management-plan-print.tsx`,
      `${COMPONENT_ROOT}/management-plan-form.tsx`,
      `${COMPONENT_ROOT}/management-plan-review.tsx`,
      `${COMPONENT_ROOT}/safety-plan-pages.tsx`,
      `${COMPONENT_ROOT}/safety-plan-form.tsx`,
      `${COMPONENT_ROOT}/patient-plan-pages.tsx`,
      `${COMPONENT_ROOT}/patient-plan-form.tsx`,
    ];
    for (const file of consumers) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, `${file} must use the shared outcome tone map`).toContain("PROTOTYPE_OUTCOME_TONE[");
      expect(/(?:const|let)\s+\w*OUTCOME_TONE\w*\s*=/.test(source), `${file} declares its own outcome tone map`).toBe(
        false,
      );
      expect(
        /tone=\{[^}]*lastOutcome\.kind\s*===/.test(source) || /tone=\{[^}]*outcome\.kind\s*===/.test(source),
        `${file} maps an outcome tone inline`,
      ).toBe(false);
    }

    const shared = readFileSync(resolve(process.cwd(), `${COMPONENT_ROOT}/prototype-ui.tsx`), "utf8");
    expect(shared).toMatch(
      /export const PROTOTYPE_OUTCOME_TONE[\s\S]{0,400}satisfies Record<PrototypeOutcome\["kind"\]/,
    );
  });

  /**
   * The existing guard above proves nothing *hides* the pinned safety boundary.
   * Nothing proved its link was still a link — and on 2026-08-22 it stopped being
   * one. A new rule block was inserted between `.appRoot .pinnedBoundaryLink,`
   * and the `.appRoot .inlineLink { … }` continuation it belonged to, so the
   * boundary's jump link silently rebound to a textarea rule: no accent colour,
   * no weight, no underline, and a 5.5rem min-height.
   *
   * Every gate was blind to it. Vitest runs with `css: false`, so the DOM tests
   * only ever see that a class token was applied. The suppression guard above
   * matches `pinnedBoundary\w*` but inspects declarations for hiding, and a
   * silent rebinding hides nothing. The `.appRoot` scoping guard splits the
   * selector list on `,` and both halves still started with `.appRoot`.
   *
   * So this asserts the affordance itself: the two link classes must each resolve
   * to a rule that still declares a colour, a weight, and an underline. It fails
   * closed when a class is renamed or stops matching any rule at all.
   */
  it("keeps the pinned boundary's jump link, and every inline link, looking like a link", () => {
    const css = readFileSync(resolve(process.cwd(), `${COMPONENT_ROOT}/care-plan.module.css`), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );

    const rules = css
      .replace(/@[^{]*\{/g, "")
      .split("}")
      .flatMap((chunk) => {
        const [head, body] = chunk.split("{");
        if (head === undefined || body === undefined) return [];
        return [
          {
            selectors: head
              .split(",")
              .map((part) => part.trim())
              .filter((part) => part.length > 0),
            body,
          },
        ];
      });

    function declaredPropertiesFor(className: string): Map<string, string> {
      const declared = new Map<string, string>();
      for (const rule of rules) {
        if (!rule.selectors.includes(`.appRoot .${className}`)) continue;
        for (const declaration of rule.body.split(";")) {
          const separator = declaration.indexOf(":");
          if (separator === -1) continue;
          declared.set(
            declaration.slice(0, separator).trim().toLowerCase(),
            declaration
              .slice(separator + 1)
              .trim()
              .toLowerCase(),
          );
        }
      }
      return declared;
    }

    // Task 7 added the two episode links. `timelineLink` shares the rule above,
    // which is exactly the arrangement that broke once — so it is on the list.
    for (const className of ["pinnedBoundaryLink", "inlineLink", "timelineLink", "timelineRecordLink"]) {
      const declared = declaredPropertiesFor(className);
      expect(declared.size, `.${className} matched no rule at all — has it been renamed or rebound?`).toBeGreaterThan(
        0,
      );
      expect(declared.has("color"), `.${className} declares no colour, so it does not read as a link`).toBe(true);
      expect(declared.has("font-weight"), `.${className} declares no font weight, so it does not read as a link`).toBe(
        true,
      );
      const underline = declared.get("text-decoration") ?? declared.get("text-decoration-line") ?? "";
      expect(underline, `.${className} is not underlined, so it carries no affordance beyond colour`).toContain(
        "underline",
      );
    }
  });

  /**
   * `styles.someName` on a class the stylesheet never defines is invisible at
   * runtime and invisible to the DOM tests, because the CSS Module proxy returns
   * the key name whether or not a rule exists. It is dead intent: an element
   * meant to carry a distinguishing treatment silently carries none. Caught once
   * already on `currentPlanCard`.
   */
  it("defines every CSS Module class the Care Plan components reference", () => {
    const css = readFileSync(resolve(process.cwd(), `${COMPONENT_ROOT}/care-plan.module.css`), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]));

    const referenced = new Map<string, string[]>();
    for (const { path, source } of readNamespaceSources()) {
      if (!/\.tsx?$/.test(path)) continue;
      for (const match of source.matchAll(/\bstyles\.([a-zA-Z][\w$]*)/g)) {
        const name = match[1];
        referenced.set(name, [...(referenced.get(name) ?? []), path]);
      }
    }

    expect(referenced.size, "no styles.* reference found — has the import name changed?").toBeGreaterThan(10);
    for (const [name, paths] of referenced) {
      expect(defined.has(name), `styles.${name} is referenced by ${paths.join(", ")} but no rule defines it`).toBe(
        true,
      );
    }
  });
});
