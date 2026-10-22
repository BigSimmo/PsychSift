import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DeveloperHubPage from "@/app/(admin)/admin/developer-hub/page";
import { developerHubNavSections } from "@/components/developer-area/developer-hub-nav-header";
import { loadLedgerSnapshot } from "@/lib/developer-area/ledger-snapshot";

/**
 * The hub page's own contracts, kept out of
 * `tests/in-page-nav-route-sections.dom.test.tsx` on purpose: that file exists to
 * prove every *declared navigation section* resolves to a rendered anchor, for
 * fourteen routes at once. The three things guarded here — a clinical-safety
 * warning, a band that must not be able to go stale, and an empty group — are
 * page content rather than navigation, and two of them need this page's data
 * source mocked. Loading that into the shared file would make a cross-route
 * contract carry one route's fixtures.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/developer-hub",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({
    isSaved: () => false,
    isAuthenticated: true,
    setFavourite: vi.fn(async () => true),
  }),
}));

/**
 * The page reads all four strip facts through one server-only helper, so the
 * helper is the seam. Mocking it rather than Supabase keeps this file a *page*
 * contract: what the page renders for a given set of facts, not how those facts
 * are fetched. `tests/developer-hub-environment-facts.test.ts` owns the other
 * half — owner scoping, and that a failed read reports null rather than zero.
 *
 * The default is the shape an unauthenticated local render produces, which is
 * what every test that does not care about the strip should see.
 */
const environment = vi.hoisted(() => ({
  value: { demoMode: true, documentCount: null as number | null, email: null as string | null },
}));

vi.mock("@/lib/developer-area/environment-facts", () => ({
  resolveHubEnvironmentFacts: async () => environment.value,
}));

/**
 * The band is the whole reason the panel was built: the same facts already sit
 * in the ledger this page renders, buried among eighty-odd open items. Mocked
 * here so both the present and absent branches are reachable regardless of what
 * the committed ledger happens to hold today.
 */
const clinicalAnswerFailures = vi.hoisted(() => ({ value: [] as { item: { id: string } }[] }));

vi.mock("@/lib/developer-area/clinical-answer-failures", () => ({
  resolveClinicalAnswerFailures: () => clinicalAnswerFailures.value,
}));

/**
 * Only `counts.p1` is overridden, and only on top of the *real* committed
 * snapshot — so the band is exercised against the shape the route actually
 * loads rather than a hand-built fixture that could drift from it. `null` means
 * "do not override", which is also how the assertions below read the true
 * count. The committed snapshot can have `p1 === 0` (no open P1s), so the
 * override is what reaches the singular and non-zero branches.
 */
const p1 = vi.hoisted(() => ({ value: null as number | null }));

vi.mock("@/lib/developer-area/ledger-snapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/developer-area/ledger-snapshot")>();
  return {
    ...actual,
    loadLedgerSnapshot: () => {
      const snapshot = actual.loadLedgerSnapshot();
      if (p1.value === null) return snapshot;
      return { ...snapshot, counts: { ...snapshot.counts, p1: p1.value } };
    },
  };
});

/** Empties one real group, so the empty-group branch can be reached by name. */
const emptyGroups = vi.hoisted(() => ({ value: new Set<string>() }));

vi.mock("@/lib/developer-area/hub-panels", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/developer-area/hub-panels")>();
  return {
    ...actual,
    panelsInGroup: (group: Parameters<typeof actual.panelsInGroup>[0]) =>
      emptyGroups.value.has(group) ? [] : actual.panelsInGroup(group),
  };
});

afterEach(() => {
  cleanup();
  p1.value = null;
  emptyGroups.value = new Set();
});

describe("developer hub page — synthetic-data warning", () => {
  /**
   * The warning is a clinical-safety statement on a page that links to synthetic
   * patient prototypes. It survived the hub rewrite only because a reviewer
   * caught its omission from the plan; before this test the sole thing holding
   * it in place was a source comment, so the next layout rewrite could drop it
   * with every gate still green. That is what these pin.
   */
  it("states that the data is synthetic and that nothing here is validated decision support", async () => {
    const { container } = render(await DeveloperHubPage());
    const warning = container.querySelector("svg.lucide-shield-alert")?.closest("p");

    expect(warning, "no paragraph carries the ShieldAlert warning icon").not.toBeNull();
    expect(warning).toHaveTextContent("Synthetic data only.");
    // The whole claim, not just its heading: "synthetic data" alone would not
    // tell a reader that the surfaces are also unvalidated.
    expect(warning).toHaveTextContent(/No patient, message, schedule or team record on these surfaces is real/);
    expect(warning).toHaveTextContent(/nothing here is validated clinical decision support/);
  });

  it("keeps the warning above the blocking-work band, not buried below the panels", async () => {
    p1.value = 3;
    const { container } = render(await DeveloperHubPage());
    const warning = container.querySelector("svg.lucide-shield-alert")?.closest("p");
    const band = screen.getByTestId("developer-hub-needs-you-now");

    expect(warning).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING: the band comes after the warning in the DOM.
    expect(warning!.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("marks the warning icon decorative so its sentence is not announced twice", async () => {
    const { container } = render(await DeveloperHubPage());
    expect(container.querySelector("svg.lucide-shield-alert")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("developer hub page — needs-you-now band", () => {
  it("reports the snapshot's own P1 count", async () => {
    // No override, so this is the real committed snapshot: the band must agree
    // with the data the route actually loads, not merely with itself. When the
    // snapshot has no P1s the page must omit the band rather than render a
    // settled-looking "0 blocking items" line — that is the same contract as
    // the explicit zero-override case below.
    const { counts } = loadLedgerSnapshot();
    render(await DeveloperHubPage());
    if (counts.p1 > 0) {
      expect(screen.getByTestId("developer-hub-needs-you-now")).toHaveTextContent(String(counts.p1));
    } else {
      expect(screen.queryByTestId("developer-hub-needs-you-now")).toBeNull();
    }
  });

  it("carries no text beyond the computed count", async () => {
    // Spec 8.1, and the whole reason the band exists: a literal such as "red for
    // 26 days" cannot age, so static prose here is the same defect class as a
    // stale snapshot. Asserting the exact string is what makes that unfakeable
    // — any added claim changes it.
    p1.value = 7;
    render(await DeveloperHubPage());
    const band = screen.getByTestId("developer-hub-needs-you-now");

    expect(band.textContent).toBe("7 blocking items in the task ledger.");
    // Belt and braces: 7 is the only number on the band, so no second figure was
    // hardcoded beside the computed one.
    expect(band.textContent?.match(/\d+/g)).toEqual(["7"]);
  });

  it("says 'item' for one and 'items' for more than one", async () => {
    p1.value = 1;
    render(await DeveloperHubPage());
    expect(screen.getByTestId("developer-hub-needs-you-now").textContent).toBe("1 blocking item in the task ledger.");
    cleanup();

    p1.value = 2;
    render(await DeveloperHubPage());
    expect(screen.getByTestId("developer-hub-needs-you-now").textContent).toBe("2 blocking items in the task ledger.");
  });

  it("renders nothing rather than a reassuring all-clear when there are no blockers", async () => {
    // A band reading "0 blocking items" would be a settled-looking statement
    // about work the page cannot see. The override keeps this branch explicit
    // even on days the committed snapshot already has no P1s.
    p1.value = 0;
    render(await DeveloperHubPage());

    expect(screen.queryByTestId("developer-hub-needs-you-now")).toBeNull();
    // The page still rendered: this is a dropped band, not a dead page.
    expect(screen.getByTestId("development-index")).toBeInTheDocument();
  });
});

describe("developer hub page — group sections", () => {
  it("renders an anchor and a heading for a group that has panels", async () => {
    const { container } = render(await DeveloperHubPage());
    expect(container.querySelector("#developer-hub-clinical")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Clinical trust" })).toBeInTheDocument();
  });

  it("omits the anchor entirely for an empty group", async () => {
    // `useResolvedPageSections` drops a declared section whose anchor is not
    // rendered — that is what lets phases 2-4 add panels without touching the
    // navigation. Rendering the section unconditionally would make that
    // mechanism inert here and leave a jump to a bare heading above an empty
    // grid.
    emptyGroups.value = new Set(["clinical"]);
    const { container } = render(await DeveloperHubPage());

    expect(container.querySelector("#developer-hub-clinical")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Clinical trust" })).toBeNull();
    // The other groups are unaffected, so this is one omitted section rather
    // than a page that failed to render.
    expect(container.querySelector("#developer-hub-work")).not.toBeNull();
    expect(container.querySelector("#developer-hub-reference")).not.toBeNull();
  });
});

describe("developer hub page — section headings", () => {
  /**
   * The section sheet in `DeveloperHubNavHeader` and the `<h2>` on the page are
   * two renderings of one label. The ids were already bound (anchor resolution
   * above), but the *text* was not — so the sheet could offer "Clinical trust"
   * while the heading said something else, with every gate green. That is the
   * defect class the whole feature exists to close.
   *
   * Deriving the headings from `developerHubNavSections` would close it
   * structurally, and cannot be done: that constant lives in a `"use client"`
   * module, so the Server Component page receives a client-reference proxy
   * rather than the array and `next build` fails (see the comment on `GROUPS`
   * in the page). **This assertion is therefore the only thing binding the
   * page's literal to the nav sheet.** It works here because jsdom has no RSC
   * boundary — both modules are ordinary JavaScript under vitest. Do not
   * weaken it, and do not "improve" the page into deriving them.
   */
  it("gives every nav section the exact heading its nav entry declares", async () => {
    const { container } = render(await DeveloperHubPage());

    const rendered = developerHubNavSections
      .map((section) => ({ section, element: container.querySelector(`#${section.id}`) }))
      .filter((entry) => entry.element !== null);

    // Every declared section has an anchor in phase 1 — all four panel groups
    // carry panels, and the environment strip always renders. Without this the
    // loop below could pass by checking nothing at all.
    expect(rendered.map((entry) => entry.section.id)).toEqual(developerHubNavSections.map((section) => section.id));

    for (const { section, element } of rendered) {
      const heading = element!.querySelector("h2");
      expect(heading, `#${section.id} renders no heading`).not.toBeNull();
      expect(heading!.textContent).toBe(section.label);
    }
  });

  it("renders no panel grid for the environment section, which is not a panel group", async () => {
    // `developerHubNavSections` declares `developer-hub-environment`, but it is
    // a navigable section rather than a panel group: it renders its own anchor
    // and `sr-only` heading around the strip, and must never gain a panel grid.
    const { container } = render(await DeveloperHubPage());
    const environment = container.querySelector("#developer-hub-environment");

    expect(environment).not.toBeNull();
    expect(environment!.querySelector("[data-testid='developer-hub-environment-strip']")).not.toBeNull();
    // The one control the strip may carry is the build line's link to its
    // commit, which renders only when a build sha is known (CI sets
    // `GITHUB_SHA`, so it appears there and not on a developer machine).
    const controls = [...environment!.querySelectorAll("a, button")];
    expect(controls.filter((control) => control.getAttribute("data-testid") !== "developer-hub-build-link")).toEqual(
      [],
    );
  });
});

describe("developer hub page — environment strip", () => {
  /**
   * All three, not just the Railway one. `resolveDeploymentCommitSha()` is
   * called with no argument, so it reads `process.env` and falls through
   * Railway -> Vercel -> GitHub. **GitHub Actions sets `GITHUB_SHA` to a 40-hex
   * sha in every step**, and nothing in `.github/workflows/ci.yml` scrubs it —
   * so a test that deleted only `RAILWAY_GIT_COMMIT_SHA` rendered "build
   * unknown" on a developer machine and `build <sha7>` on CI. Clearing the
   * whole fallback chain is what makes the unknown case environment-independent
   * rather than merely locally true.
   */
  const BUILD_SHA_VARIABLES = ["RAILWAY_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_SHA", "GITHUB_SHA"] as const;
  const original = new Map(BUILD_SHA_VARIABLES.map((name) => [name, process.env[name]]));

  function clearBuildShaVariables() {
    for (const name of BUILD_SHA_VARIABLES) delete process.env[name];
  }

  afterEach(() => {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("reports the deployed build sha when the platform provides one", async () => {
    clearBuildShaVariables();
    process.env.RAILWAY_GIT_COMMIT_SHA = "ce4b1cb72".padEnd(40, "0");
    render(await DeveloperHubPage());
    expect(screen.getByTestId("developer-hub-environment-strip")).toHaveTextContent("build ce4b1cb");
  });

  it("says build unknown rather than inventing one when the platform provides none", async () => {
    clearBuildShaVariables();
    render(await DeveloperHubPage());
    const strip = screen.getByTestId("developer-hub-environment-strip");
    expect(strip).toHaveTextContent("build unknown");
    // With the default facts (nothing read), the other two still name their own
    // gaps rather than claiming a value. Both directions are covered below.
    expect(strip).toHaveTextContent("document count unavailable");
    expect(strip).toHaveTextContent("account unknown");
  });

  afterEach(() => {
    environment.value = { demoMode: true, documentCount: null, email: null };
  });

  it("says Demo corpus when the app is serving the synthetic corpus", async () => {
    environment.value = { ...environment.value, demoMode: true };
    render(await DeveloperHubPage());
    const strip = screen.getByTestId("developer-hub-environment-strip");
    expect(strip).toHaveTextContent("Demo corpus");
    expect(strip).not.toHaveTextContent("environment unknown");
  });

  /**
   * The branch that matters. Before this was wired the strip said "environment
   * unknown" in both directions, which was honest; the failure to avoid now is
   * the opposite one, where a page reads demo mode and still reports live data.
   */
  it("says Live data only when it has actually read that the app is not in demo mode", async () => {
    environment.value = { ...environment.value, demoMode: false };
    render(await DeveloperHubPage());
    const strip = screen.getByTestId("developer-hub-environment-strip");
    expect(strip).toHaveTextContent("Live data");
    expect(strip).not.toHaveTextContent("environment unknown");
    expect(strip).not.toHaveTextContent("Demo corpus");
  });

  it("reports the document count it read, grouped for reading", async () => {
    environment.value = { ...environment.value, documentCount: 2851 };
    render(await DeveloperHubPage());
    expect(screen.getByTestId("developer-hub-environment-strip")).toHaveTextContent("2,851 documents");
  });

  /**
   * Zero is a true answer — an account that has uploaded nothing — and it must
   * survive to the screen as "0 documents". If the page ever coerced a falsy
   * count into the unavailable branch, an empty corpus would be indistinguishable
   * from a failed read, which is the one confusion this strip exists to prevent.
   */
  it("distinguishes an empty corpus from a count it could not read", async () => {
    environment.value = { ...environment.value, documentCount: 0 };
    render(await DeveloperHubPage());
    expect(screen.getByTestId("developer-hub-environment-strip")).toHaveTextContent("0 documents");

    cleanup();
    environment.value = { ...environment.value, documentCount: null };
    render(await DeveloperHubPage());
    expect(screen.getByTestId("developer-hub-environment-strip")).toHaveTextContent("document count unavailable");
  });

  it("names the signed-in account, and says so plainly when there is none", async () => {
    environment.value = { ...environment.value, email: "clinician@example.com" };
    render(await DeveloperHubPage());
    expect(screen.getByTestId("developer-hub-environment-strip")).toHaveTextContent("clinician@example.com");

    cleanup();
    environment.value = { ...environment.value, email: null };
    render(await DeveloperHubPage());
    expect(screen.getByTestId("developer-hub-environment-strip")).toHaveTextContent("account unknown");
  });
});

describe("developer hub page — clinical answer failure band", () => {
  afterEach(() => {
    clinicalAnswerFailures.value = [];
  });

  it("links recorded clinical answer problems straight to their panel", async () => {
    clinicalAnswerFailures.value = [{ item: { id: "#J8SJQ9" } }, { item: { id: "#S4R2W3" } }];
    render(await DeveloperHubPage());

    const band = screen.getByTestId("developer-hub-clinical-answer-failures-band");
    expect(band).toHaveTextContent("2 recorded problems against a named clinical question.");
    expect(band).toHaveAttribute("href", "/admin/developer-hub/clinical-answer-failures");
  });

  it("says problem, not problems, for a single one", async () => {
    clinicalAnswerFailures.value = [{ item: { id: "#J8SJQ9" } }];
    render(await DeveloperHubPage());

    expect(screen.getByTestId("developer-hub-clinical-answer-failures-band")).toHaveTextContent(
      "1 recorded problem against a named clinical question.",
    );
  });

  it("renders nothing rather than a reassuring all-clear when none are recorded", async () => {
    // Same rule the blocking band follows. An explicit "none recorded" here
    // would read as "answers are fine", which this data cannot support.
    render(await DeveloperHubPage());

    expect(screen.queryByTestId("developer-hub-clinical-answer-failures-band")).toBeNull();
  });
});

describe("owner panel page — today section", () => {
  it("leads with what is waiting on the owner and links to the tools", async () => {
    render(await DeveloperHubPage());
    expect(screen.getByRole("heading", { level: 1, name: "Owner panel" })).toBeInTheDocument();
    expect(screen.getByTestId("owner-panel-today-summary")).toHaveTextContent(/waiting on you/);
    expect(screen.getByTestId("owner-panel-settings-link")).toHaveAttribute("href", "/admin/developer-hub/settings");
    expect(screen.getByTestId("owner-panel-uploads-link")).toHaveAttribute("href", "/admin/developer-hub/ingestion");
  });
});
