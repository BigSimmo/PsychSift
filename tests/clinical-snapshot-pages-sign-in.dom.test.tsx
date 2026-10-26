import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #3738: the medicine and differential pages render record content on the server, so a
// signed-out request must get the sign-in card and no record. Synthetic auth only.
const state = vi.hoisted(() => ({
  demo: false,
  noAuth: false,
  configured: true,
  user: null as { id: string } | null,
  getUser: vi.fn(),
}));

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isDemoMode: () => state.demo,
  isLocalNoAuthMode: () => state.noAuth,
}));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createSupabaseServerClient: async () =>
    state.configured
      ? { auth: { getUser: state.getUser.mockImplementation(async () => ({ data: { user: state.user } })) } }
      : null,
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

vi.mock("@/lib/site-content/differential-page-records", async (importOriginal) => {
  const { differentialRecords } = await import("@/lib/differentials");
  return {
    ...(await importOriginal<typeof import("@/lib/site-content/differential-page-records")>()),
    // The committed snapshot stands in for the database read.
    readDifferentialPageRecord: async (slug: string) => differentialRecords.find((r) => r.slug === slug) ?? null,
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  // React's `cache` only dedupes inside a server request; per call here keeps each test independent.
  return { ...actual, cache: <T,>(fn: T) => fn };
});

import { ClinicalPageSignInNotice } from "@/components/mode-kit/clinical-page-sign-in-notice";
import { clinicalPageSignInRequired } from "@/lib/clinical-page-access";
import { loadMedicationSnapshot } from "@/lib/medication-snapshot";
import { differentialStaticParams } from "@/lib/differentials";
import MedicationPage, { generateMetadata as medicationMetadata } from "@/app/(search-app)/medications/[slug]/page";
import MedicationsLayout from "@/app/(search-app)/medications/layout";
import DifferentialsLayout from "@/app/(search-app)/differentials/layout";
import DifferentialDiagnosisRoute, {
  generateMetadata as diagnosisMetadata,
} from "@/app/(search-app)/differentials/diagnoses/[slug]/page";
import DifferentialPresentationRoute from "@/app/(search-app)/differentials/presentations/[slug]/page";
import DifferentialCompareRoute from "@/app/(search-app)/differentials/compare/page";
import DifferentialDiagnosesRoute from "@/app/(search-app)/differentials/diagnoses/page";
import DifferentialPresentationsRoute from "@/app/(search-app)/differentials/presentations/page";
import DifferentialsSearchRoute from "@/app/(search-app)/differentials/search/page";
import { presentationStaticParams } from "@/lib/differentials";

const medication = loadMedicationSnapshot()[0]!;
const diagnosisSlug = differentialStaticParams()[0]!.slug;
const presentationSlug = presentationStaticParams()[0]!.slug;
const params = <T,>(value: T) => Promise.resolve(value);

function isNotice(element: unknown, testId: string) {
  const el = element as { type?: unknown; props?: Record<string, unknown> };
  return el?.type === ClinicalPageSignInNotice && el.props?.testId === testId;
}

beforeEach(() => {
  state.demo = false;
  state.noAuth = false;
  state.configured = true;
  state.user = null;
  state.getUser.mockClear();
});

describe("server-rendered clinical pages need sign-in (#3738)", () => {
  it("decides sign-in from the server session, demo, no-auth and config", async () => {
    expect(await clinicalPageSignInRequired()).toBe(true);
    state.user = { id: "synthetic-user" };
    expect(await clinicalPageSignInRequired()).toBe(false);
    state.user = null;
    state.demo = true;
    expect(await clinicalPageSignInRequired()).toBe(false);
    state.demo = false;
    state.noAuth = true;
    expect(await clinicalPageSignInRequired()).toBe(false);
    state.noAuth = false;
    state.configured = false;
    // N-06: no server client outside demo or no-auth mode means sign-in cannot be checked.
    expect(await clinicalPageSignInRequired()).toBe(true);
  });

  it("sends a signed-out medicine page the sign-in card and no record", async () => {
    const element = await MedicationPage({ params: params({ slug: medication.slug }) });
    expect(isNotice(element, "medications-sign-in")).toBe(true);
    expect(JSON.stringify((element as { props: unknown }).props)).not.toContain(medication.name);
    const html = renderToString(element);
    expect(html).toContain("Sign in to read medicines");
    expect(html).not.toContain(medication.name);
    expect((await medicationMetadata({ params: params({ slug: medication.slug }) })).title).not.toContain(
      medication.name,
    );
  });

  it("sends a signed-in reader the medicine record", async () => {
    state.user = { id: "synthetic-user" };
    const element = (await MedicationPage({ params: params({ slug: medication.slug }) })) as {
      props: { fallbackRecord?: { name: string } };
    };
    expect(element.props.fallbackRecord?.name).toBe(medication.name);
    expect((await medicationMetadata({ params: params({ slug: medication.slug }) })).title).toContain(medication.name);
  });

  it.each([
    ["diagnosis", () => DifferentialDiagnosisRoute({ params: params({ slug: diagnosisSlug }) })],
    ["presentation", () => DifferentialPresentationRoute({ params: params({ slug: presentationSlug }) })],
    ["compare", () => DifferentialCompareRoute({})],
    ["diagnoses list", () => DifferentialDiagnosesRoute({})],
    ["presentations list", () => DifferentialPresentationsRoute({})],
    ["search", () => DifferentialsSearchRoute({ searchParams: params({ q: "low mood" }) })],
  ])("sends a signed-out %s page only the sign-in card", async (_name, render) => {
    const element = await render();
    expect(isNotice(element, "differentials-sign-in")).toBe(true);
    expect(renderToString(element)).toContain("Sign in to use differentials");
  });

  it("sends a signed-in reader the diagnosis record", async () => {
    state.user = { id: "synthetic-user" };
    const element = (await DifferentialDiagnosisRoute({ params: params({ slug: diagnosisSlug }) })) as {
      props: { fallbackRecord?: { slug: string } };
    };
    expect(element.props.fallbackRecord?.slug).toBe(diagnosisSlug);
    expect(String((await diagnosisMetadata({ params: params({ slug: diagnosisSlug }) })).title)).not.toBe(
      "Differential diagnosis - PsychSift",
    );
  });

  it("names no diagnosis in signed-out metadata", async () => {
    expect((await diagnosisMetadata({ params: params({ slug: diagnosisSlug }) })).title).toBe(
      "Differential diagnosis - PsychSift",
    );
  });

  it("keeps the record pages open in demo mode and no-auth dev", async () => {
    for (const mode of ["demo", "noAuth"] as const) {
      state[mode] = true;
      const element = (await MedicationPage({ params: params({ slug: medication.slug }) })) as {
        props: { fallbackRecord?: unknown };
      };
      expect(element.props.fallbackRecord).toBeDefined();
      expect(state.getUser).not.toHaveBeenCalled();
      state[mode] = false;
    }
  });

  it("layouts render the card, not the children, for a signed-out request", async () => {
    const child = <p>synthetic record body</p>;
    const meds = await MedicationsLayout({ children: child });
    const diffs = await DifferentialsLayout({ children: child });
    expect(isNotice(meds, "medications-sign-in")).toBe(true);
    expect(isNotice(diffs, "differentials-sign-in")).toBe(true);
    expect(renderToString(meds)).not.toContain("synthetic record body");
  });

  it("signed-in layouts render their children on the server while the browser session loads", async () => {
    state.user = { id: "synthetic-user" };
    const meds = await MedicationsLayout({ children: <p>synthetic record body</p> });
    expect(renderToString(meds)).toContain("synthetic record body");
  });
});
