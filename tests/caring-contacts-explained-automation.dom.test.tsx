import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AutomatedState } from "@/components/caring-contacts/workspace/automated-state";
import { ServiceStateBanner } from "@/components/caring-contacts/workspace/service-state-banner";
import { CaringContactsShell } from "@/components/caring-contacts/workspace/shell";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId, teamId } from "@/lib/caring-contacts/ids";
import {
  applyServiceRestartApproval,
  applyServiceStop,
  REQUIRED_RESTART_APPROVAL_ROLES,
  runningService,
  type ServiceState,
} from "@/lib/caring-contacts/service-state";

/**
 * A string that appears in the fixture's incident note and NOWHERE else.
 *
 * The reason for a sentinel rather than only the plausible literals below: a
 * name-and-number check (`/Rowan|Mira|\+61/`) only catches the leak it happened
 * to imagine. The note is free text a responder types mid-incident, so the next
 * one could name a ward, a message id, or a street — none of which those
 * literals would catch. The sentinel catches ANY path from `note` to the DOM,
 * whatever the note happens to say.
 */
const NOTE_SENTINEL = "NOTE-LEAK-SENTINEL-9F3C";

const INCIDENT_CLOCK = fixedClock("2026-08-19T02:00:00.000Z");

/**
 * A stopped service whose note carries both the sentinel and the kind of patient
 * detail a real responder would write: a name, a second name, a mobile number.
 */
function stoppedServiceState(): ServiceState {
  const stopped = applyServiceStop(
    runningService(teamId("TEAM-A")),
    {
      reason: "wrong-recipient",
      actorId: actorId("ACTOR-RESPONDER"),
      note: `${NOTE_SENTINEL} Week 3 message for Rowan went to Mira on +61 400 000 000.`,
    },
    INCIDENT_CLOCK,
  );
  if (!stopped.ok) throw new Error(`fixture could not stop the service: ${stopped.reason}`);
  return stopped.value;
}

describe("explained automation", () => {
  it("never shows a bare automated state without a reason and a remedy", () => {
    render(
      <AutomatedState
        state="Suppressed"
        because="Week 1 falls on the first contact day."
        changedBy="Move the first contact date on the plan."
      />,
    );
    const region = screen.getByRole("group", { name: /Suppressed/ });
    expect(region).toHaveTextContent("Week 1 falls on the first contact day.");
    expect(region).toHaveTextContent("Move the first contact date on the plan.");
  });

  it("puts the reason and the remedy in the page, never in a tooltip alone", () => {
    // Spec 4.4: a reason reachable only by hovering is not reachable at all for a
    // keyboard or screen-reader user. Nothing here may hold the explanation in a
    // `title` attribute instead of in text.
    const { container } = render(
      <AutomatedState
        state="Suppressed"
        because="Week 1 falls on the first contact day."
        changedBy="Move the first contact date on the plan."
      />,
    );
    for (const node of container.querySelectorAll("[title]")) {
      expect(node.getAttribute("title")).not.toContain("Week 1 falls on the first contact day.");
      expect(node.getAttribute("title")).not.toContain("Move the first contact date on the plan.");
    }
    const region = screen.getByRole("group", { name: /Suppressed/ });
    expect(region.textContent).toContain("Week 1 falls on the first contact day.");
    expect(region.textContent).toContain("Move the first contact date on the plan.");
  });

  it("shows nothing while the service is running", () => {
    const { container } = render(<ServiceStateBanner state={runningService(teamId("TEAM-A"))} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("states the reason and the approval count while stopped, with no patient information", () => {
    render(<ServiceStateBanner state={stoppedServiceState()} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/0 of 3/);
    expect(banner).toHaveTextContent(/wrong recipient/i);
    expect(banner.textContent ?? "").not.toMatch(/Rowan|Mira|\+61/);
  });

  it("names what would restart the service, not only why it stopped", () => {
    // Spec 4.4 has two halves and the banner owes both. The reason half is
    // asserted above; without this, `describeServiceStop`'s third sentence could
    // be deleted outright and every test on this branch would stay green — the
    // one surface that renders on EVERY screen to EVERY team would then state a
    // stop with no way out of it. Proven by deleting that sentence and watching
    // this redden.
    render(<ServiceStateBanner state={stoppedServiceState()} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/still needed/i);
    // All three roles, because none is recorded yet on this fixture. The count
    // comes from the sealed list rather than a second copy of the number.
    expect(REQUIRED_RESTART_APPROVAL_ROLES).toHaveLength(3);
    expect(banner).toHaveTextContent("the incident lead");
    expect(banner).toHaveTextContent("the privacy and security owner");
    expect(banner).toHaveTextContent("the clinical programme lead");
    // The restart is a three-PERSON decision, not three tick-boxes one person can
    // supply; a banner that omits this misdescribes the remedy.
    expect(banner).toHaveTextContent(/each from a different person/i);
  });

  it("cannot put the responder's incident note on screen, whatever the note says", () => {
    // The whole rendered markup, not only its text: an attribute leak (a title, an
    // aria-label, a data-*) would be just as public as a paragraph.
    // The anti-vacuity guard has to inspect the fixture that was RENDERED. A
    // freshly constructed second copy is equivalent under the fixed clock today,
    // but the guard exists precisely for the day the fixture stops being stopped,
    // and then only the rendered object tells the truth.
    const rendered = stoppedServiceState();
    expect(rendered).toMatchObject({ stopped: true });
    const { container } = render(<ServiceStateBanner state={rendered} />);
    expect(container.innerHTML).not.toContain(NOTE_SENTINEL);
  });

  it("keeps the note out of the banner on every screen the shell renders", () => {
    const { container } = render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    expect(container.innerHTML).not.toContain(NOTE_SENTINEL);
    expect(container.innerHTML).not.toMatch(/Rowan|Mira|\+61/);
  });

  it("says the service is stopped in words, so the state does not depend on colour", () => {
    render(<ServiceStateBanner state={stoppedServiceState()} />);
    const banner = screen.getByRole("status");
    // Text content is what survives greyscale, forced colours and a screen reader.
    expect(banner.textContent ?? "").toContain("Sending stopped");
    expect(banner.textContent ?? "").toContain("stopped for the whole service");
    // The icon is decoration on top of that text, never the carrier of it.
    for (const icon of banner.querySelectorAll("svg")) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("reaches the service-stop screen through a control that states its reason", () => {
    render(<ServiceStateBanner state={stoppedServiceState()} />);
    const banner = screen.getByRole("status");
    const control = banner.querySelector("button");
    expect(control, "the banner offers no way to reach the service-stop screen").not.toBeNull();
    // Ruling 52: the service-stop screen has no page yet, so this is an
    // unavailable control that says so — never a link into a 404.
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("type", "button");
    expect(control).toHaveAttribute("title", expect.stringContaining("coming soon"));
    // Native `disabled` would remove the tab stop, so the stated reason could
    // never be reached by keyboard. The two attributes are never used together.
    expect(control).not.toHaveAttribute("disabled");
    const describedBy = control!.getAttribute("aria-describedby");
    expect(describedBy, "the control states no reason").toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent ?? "").not.toBe("");
    expect(banner.querySelector("a")).toBeNull();
  });

  it("gives the banner's service-stop control a name of its own", () => {
    // The More panel already carries a destination named exactly "Service stop".
    // Two controls sharing an accessible name are indistinguishable in a screen
    // reader's control list, so the banner's — the one with incident context —
    // takes the longer name.
    render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    expect(screen.getAllByRole("button", { name: "Service stop" })).toHaveLength(1);
    const bannerControl = screen.getByRole("status").querySelector("button");
    expect(bannerControl, "the banner offers no service-stop control").not.toBeNull();
    expect(bannerControl!.textContent).not.toBe("Service stop");
    expect(bannerControl!.textContent ?? "").toContain("Service stop");
  });

  it("cannot be rendered by a screen that never read the service state", () => {
    // Ruling 56. Spec 4.2 puts the banner on EVERY screen while a stop is active,
    // and "everywhere" cannot rest on each page author remembering an optional
    // prop: a screen whose author forgot would show no banner at all during a live
    // stop, and a clinician would keep working believing sending was fine.
    //
    // This assertion is a TYPE assertion, checked by `tsc --noEmit`, not by the
    // runtime below. `@ts-expect-error` fails compilation when the error it expects
    // stops occurring — so if anyone makes `serviceState` optional again, the
    // typecheck goes red here rather than the omission going unnoticed.
    const omitted = (
      // @ts-expect-error serviceState is required — a screen must read it, not omit it.
      <CaringContactsShell title="Today">content</CaringContactsShell>
    );
    expect(omitted).toBeTruthy();
  });

  it("keeps the banner on every screen the shell renders", () => {
    render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows no banner on a shell whose service is running", () => {
    render(
      <CaringContactsShell title="Today" serviceState={runningService(teamId("TEAM-A"))}>
        content
      </CaringContactsShell>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});

const WORKSPACE_DIR = path.join(process.cwd(), "src", "components", "caring-contacts", "workspace");

/**
 * The components in this tree allowed to be Client Components, as paths relative to
 * `WORKSPACE_DIR` with `/` separators. Read the block below before adding to this list
 * — it is not a formality, and each entry says why it is here.
 *
 * Every entry must satisfy the same three conditions (Ruling 59): it receives no
 * `serviceState`-derived prop under any name, the companion test below proves its source
 * never names that module or type, and it is added deliberately rather than to make a
 * failing test pass.
 */
const ALLOWED_CLIENT_COMPONENTS = [
  // A declared-but-unbuilt destination: `aria-disabled` plus an inert click handler, so
  // the stated reason keeps its tab stop. Takes only `id`/`label`/`reason`/`className`.
  "unavailable-destination.tsx",
  // Task 18's one renderer for all 24 overlays. Inherently interactive — it reads the
  // viewport width to choose a modality, traps focus, and runs the fresh-authentication
  // checkpoint. Its `blockReason` prop is a NAMED refusal string, never a state object.
  "overlays/overlay-host.tsx",
  // The client boundary that owns `?overlay=<id>` and the two handlers, because function
  // props cannot cross a Server → Client boundary. It takes no props at all, which is
  // what keeps the service-state record on the server side of this seam.
  "overlays/workspace-overlays.tsx",
  // Decides WHEN the condensed stop bar is shown, and never what it says. A scroll position
  // and two element rectangles are browser facts, so this one cannot be answered on the
  // server — and the header is not the height of its token (87.5px at 320/390, 65px above,
  // against 64px), so a fixed offset was not an option either. Added on the same three
  // conditions as the entries above: it takes NO PROPS AT ALL, so nothing derived from the
  // record crosses this boundary; the companion test below proves its source never names
  // that module or type; and it toggles one attribute on an element the server rendered from
  // the note-free facts type, so the bar's wording never enters the client module graph.
  "service-stop-scroll-watcher.tsx",
];

/**
 * The route segment that READS the record and hands it to the shell.
 *
 * The workspace scan above stopped at the component tree, one directory short of the
 * file that actually performs the read: `src/app/caring-contacts/page.tsx` awaits the
 * whole state and passes it down. If that file ever gained `"use client"` the note
 * would serialise into the payload and the workspace scan would stay green — the same
 * class of hole the recursive fix closed, one level up. So it is scanned too.
 */
const ROUTE_DIR = path.join(process.cwd(), "src", "app", "caring-contacts");

/**
 * Next.js REQUIRES an `error.tsx` boundary to be a Client Component, so this entry is
 * not a judgement call; it is the framework's contract. It takes only `error` and
 * `reset`, never the record, and the companion test below holds it to that.
 */
const ALLOWED_ROUTE_CLIENT_FILES = ["error.tsx"];

const USE_CLIENT_DIRECTIVE = /^\s*(?:"use client"|'use client')/m;

/**
 * Every source file under `root`, subdirectories included.
 *
 * Recursive on purpose: a flat `readdirSync` would have scanned only the top level, so a
 * client component added under `overlays/` — which is exactly where Task 18 put two —
 * would never have been seen by the check at all.
 */
/**
 * Every extension a `"use client"` module could ship under. `.ts`/`.tsx` alone left a
 * `.js`, `.jsx`, `.mjs` or `.cjs` client file invisible to both scans — the same
 * "the scan does not cover what it claims to" shape as the non-recursive read and the
 * missing route directory, in a third dimension.
 */
const CLIENT_CAPABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function sourceFilesUnder(root: string): { name: string; source: string }[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && CLIENT_CAPABLE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => {
      const absolute = path.join(entry.parentPath, entry.name);
      return {
        name: path.relative(root, absolute).split(path.sep).join("/"),
        source: readFileSync(absolute, "utf8"),
      };
    });
}

function workspaceSourceFiles() {
  return sourceFilesUnder(WORKSPACE_DIR);
}

/**
 * The half of the note guarantee the type system does NOT hold.
 *
 * `ServiceStopBannerFacts` omits `note` by construction, so the banner cannot
 * RENDER it — that half is a compile error and holds forever. But
 * `CaringContactsShellProps.serviceState` is a whole `ServiceState`, so the note
 * is in scope for every future edit of the shell, and the only reason it never
 * reaches a browser is that nothing on that path is a Client Component.
 *
 * Nothing enforced that. It was checked by hand once, which is a point-in-time
 * verification rather than a regression guard. Adding `"use client"` to
 * `shell.tsx` or `service-state-banner.tsx`, or handing `serviceState` to a new
 * client child, would serialise a responder's free-text note into the RSC
 * payload — readable in the page source, by every team, without ever appearing
 * on screen — and every DOM test above would stay green, because JSDOM has no RSC
 * payload to inspect.
 */
/**
 * Every module specifier a source file names: `from "x"`, a bare `import "x"`, and `import("x")`.
 */
const MODULE_SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/**
 * Resolves a specifier to a file this guard should follow, or `null`.
 *
 * Two kinds are followed. **Relative** specifiers, because a helper authored beside a client
 * component is the realistic way a client module acquires something it should not have. And
 * **aliased `@/…` specifiers that land inside a caring-contacts directory**, for the same reason
 * one directory further out. Everything else — `react`, `@/components/ui-primitives`, the shared
 * design-system graph — is deliberately NOT followed: that graph reaches most of `src/`, and a
 * guard that walks the whole application is a guard nobody can reason about. The residual gap is
 * stated in the test below rather than papered over.
 */
function resolveGuardedModule(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith("@/")) {
    base = path.join(process.cwd(), "src", specifier.slice(2));
    if (!base.split(path.sep).includes("caring-contacts")) return null;
  } else {
    return null;
  }

  const candidates = [
    base,
    ...CLIENT_CAPABLE_EXTENSIONS.map((extension) => base + extension),
    ...CLIENT_CAPABLE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

/**
 * `entry` plus every module reachable from it through the specifiers above, transitively.
 *
 * Fix round 1, finding 2. The scan below used to read an allowlisted component's OWN source and
 * stop there. `service-stop-scroll-watcher.tsx` passes that check and then imports
 * `service-stop-bar-anchors.ts`, which nothing constrained at all — so the guard certified
 * exactly the one file it happened to open. That is the same shape as the top-level-only
 * directory read and the `.ts`/`.tsx`-only extension list this file has already had to widen
 * twice: a check whose claim is broader than the path it walks.
 */
function guardedModuleGraph(entry: string): string[] {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, specifier] of source.matchAll(MODULE_SPECIFIER)) {
      const resolved = resolveGuardedModule(file, specifier);
      if (resolved !== null) pending.push(resolved);
    }
  }
  return [...seen];
}

describe("the service-state path stays on the server", () => {
  it("keeps every workspace component but the allowlisted client controls a Server Component", () => {
    const clientComponents = workspaceSourceFiles()
      .filter(({ source }) => USE_CLIENT_DIRECTIVE.test(source))
      .map(({ name }) => name)
      .sort();

    expect(
      clientComponents,
      "A new Client Component appeared under src/components/caring-contacts/workspace/. The shell " +
        "hands that tree a whole ServiceState, whose `note` is patient data, and a client boundary " +
        "serialises props into the RSC payload for every team to read in the page source. If this " +
        "component genuinely must run on the client, prove the note cannot reach it, then add it to " +
        "ALLOWED_CLIENT_COMPONENTS deliberately.",
    ).toEqual([...ALLOWED_CLIENT_COMPONENTS].sort());
  });

  it("keeps the service state out of every client component and everything it imports", () => {
    // The complement of the allowlist above, and deliberately the modest version.
    // Tracing which props a JSX element actually receives is not something source
    // text can answer reliably, so this does not attempt it. What it does answer
    // reliably: an allowed client component never names the service-state module
    // or its type at all, so it cannot be handed one without this going red too.
    //
    // Every entry is covered, not merely the first (Ruling 59): the allowlist is
    // the whole reason a client boundary is permitted here, so each addition must
    // carry the same proof the original one did.
    //
    // And every entry's own imports are covered too (fix round 1, finding 2). Checking a
    // client component's source alone certifies one file while the boundary is a graph:
    // a helper it imports is just as much inside the client bundle, and nothing was
    // holding those. Exposure today was nil; the hole was the guard's, not the code's.
    expect(ALLOWED_CLIENT_COMPONENTS.length).toBeGreaterThan(0);
    for (const name of ALLOWED_CLIENT_COMPONENTS) {
      const entry = path.join(WORKSPACE_DIR, name);
      const source = readFileSync(entry, "utf8");
      // A stale entry would silently widen the allowlist without covering anything.
      expect(source, `${name} is allowlisted but is not a Client Component`).toMatch(USE_CLIENT_DIRECTIVE);

      for (const file of guardedModuleGraph(entry)) {
        const label = path.relative(process.cwd(), file).split(path.sep).join("/");
        const moduleSource = readFileSync(file, "utf8");
        expect(moduleSource, `${label} (reached from ${name}) references the service-state module`).not.toMatch(
          /service-state/,
        );
        expect(moduleSource, `${label} (reached from ${name}) names ServiceState`).not.toMatch(/ServiceState/);
      }
    }
  });

  it("actually follows a client component's imports rather than stopping at its own file", () => {
    // The anti-vacuity guard for the check above. If `guardedModuleGraph` ever stopped
    // resolving — a changed extension list, a moved file, a regex that no longer matches the
    // import syntax in use — the loop above would still run, still pass, and cover exactly
    // what it covered before the fix: one file. This names the concrete edge that fix was
    // written for, so the coverage cannot quietly evaporate.
    const watcher = path.join(WORKSPACE_DIR, "service-stop-scroll-watcher.tsx");
    const reached = guardedModuleGraph(watcher).map((file) =>
      path.relative(WORKSPACE_DIR, file).split(path.sep).join("/"),
    );
    expect(reached, "the module-graph walk does not reach the watcher's own anchors module").toContain(
      "service-stop-bar-anchors.ts",
    );
  });

  it("keeps the route segment that reads the record a Server Component", () => {
    // The workspace scan cannot see this directory, and this is the file that performs
    // the read. `error.tsx` is allowed because Next.js requires an error boundary to be
    // a Client Component; nothing else here may be one, and `page.tsx` least of all.
    const routeClientFiles = sourceFilesUnder(ROUTE_DIR)
      .filter(({ source }) => USE_CLIENT_DIRECTIVE.test(source))
      .map(({ name }) => name)
      .sort();

    expect(
      routeClientFiles,
      "A Client Component appeared under src/app/caring-contacts/. `page.tsx` awaits the whole " +
        "ServiceState and hands it to the shell, so a client boundary anywhere on that path " +
        "serialises a responder's free-text note into the payload every team can read in the page " +
        "source. Only Next's mandatory error boundary belongs on this list.",
    ).toEqual([...ALLOWED_ROUTE_CLIENT_FILES].sort());

    for (const name of ALLOWED_ROUTE_CLIENT_FILES) {
      const source = readFileSync(path.join(ROUTE_DIR, name), "utf8");
      expect(source, `${name} is allowlisted but is not a Client Component`).toMatch(USE_CLIENT_DIRECTIVE);
      expect(source, `${name} references the service-state module`).not.toMatch(/service-state/);
      expect(source, `${name} names ServiceState`).not.toMatch(/ServiceState/);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * The condensed service-stop bar.
 *
 * The full banner sits in normal flow beneath a sticky header, so the browser
 * proof measured it scrolling completely out of view at 320, 390, 430 and 768px
 * (y from -285 to -602). Spec 4.2 requires the stop to be visible on every
 * screen while it is active, so a condensed one-line bar is pinned under the
 * header once the full banner has gone.
 *
 * These are the structural guarantees. Whether the bar is actually ON SCREEN
 * when scrolled is a geometry question no JSDOM test can answer, and is proved
 * in tests/ui-caring-contacts-workspace.spec.ts.
 * ------------------------------------------------------------------------- */

/** A stopped service with `recorded` restart approvals already on it. */
function stoppedServiceWithApprovals(recorded: number): ServiceState {
  let state = stoppedServiceState();
  for (const role of REQUIRED_RESTART_APPROVAL_ROLES.slice(0, recorded)) {
    const approved = applyServiceRestartApproval(state, { role, actorId: actorId(`ACTOR-${role}`) }, INCIDENT_CLOCK);
    if (!approved.ok) throw new Error(`fixture could not record ${role}: ${approved.reason}`);
    state = approved.value;
  }
  return state;
}

const CONDENSED_BAR_TEST_ID = "caring-contacts-condensed-service-stop";

describe("the condensed service-stop bar", () => {
  it("renders nothing at all while the service is running", () => {
    render(
      <CaringContactsShell title="Today" serviceState={runningService(teamId("TEAM-A"))}>
        content
      </CaringContactsShell>,
    );
    expect(screen.queryByTestId(CONDENSED_BAR_TEST_ID)).toBeNull();
  });

  it("states that sending is stopped for the whole service, in words", () => {
    render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    const bar = screen.getByTestId(CONDENSED_BAR_TEST_ID);
    // Text, not colour. This is what survives greyscale and forced colours.
    expect(bar.textContent ?? "").toContain("Sending stopped");
    // Abbreviated, but never vaguer: "sending stopped" alone could be read as one
    // patient's plan. The service-wide scope is the load-bearing half of the claim.
    expect(bar.textContent ?? "").toContain("the whole service");
    // The icon decorates the text; it never carries the state on its own.
    //
    // Fix round 1, finding 3: the count is asserted BEFORE the loop. A `for` over an empty
    // NodeList passes, so the round-1 form of this went green whether the icon was there,
    // marked correctly, or missing altogether — it could only ever fail on a *wrongly marked*
    // icon and never on a *missing* one, which is the more likely edit.
    const icons = bar.querySelectorAll("svg");
    expect(icons, "the condensed bar has no icon").toHaveLength(1);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("carries the same restart-approval count the full banner carries", () => {
    // Not a fixed "0 of 3": an abbreviated bar that froze the count would state a
    // weaker, staler claim than the banner directly above it.
    for (const recorded of [0, 1, 2]) {
      const { unmount } = render(
        <CaringContactsShell title="Today" serviceState={stoppedServiceWithApprovals(recorded)}>
          content
        </CaringContactsShell>,
      );
      const bar = screen.getByTestId(CONDENSED_BAR_TEST_ID);
      expect(bar.textContent ?? "").toContain(`${recorded} of ${REQUIRED_RESTART_APPROVAL_ROLES.length}`);
      expect(screen.getByRole("status").textContent ?? "").toContain(
        `${recorded} of ${REQUIRED_RESTART_APPROVAL_ROLES.length}`,
      );
      unmount();
    }
  });

  it("cannot put the responder's incident note in the condensed bar either", () => {
    // The same guarantee as the full banner's, and held the same way: the bar is
    // rendered from `ServiceStopBannerFacts`, which omits `note` by construction,
    // so interpolating it is a type error rather than a judgement call.
    const { container } = render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    expect(screen.getByTestId(CONDENSED_BAR_TEST_ID)).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(NOTE_SENTINEL);
    expect(container.innerHTML).not.toMatch(/Rowan|Mira|\+61/);
  });

  it("adds no second announced statement of the same stop", () => {
    // Two live regions saying the same thing is the failure mode this bar has to
    // avoid in the aural channel as well as the visual one. The full banner is
    // still in the document and still announces; the pinned duplicate is scenery.
    render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByTestId(CONDENSED_BAR_TEST_ID)).toHaveAttribute("aria-hidden", "true");
  });

  it("adds no second control competing with the banner's service-stop control", () => {
    render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    expect(screen.getByTestId(CONDENSED_BAR_TEST_ID).querySelector("button, a")).toBeNull();
  });
});
