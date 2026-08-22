import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DeveloperLedgerPage from "@/app/mockups/development/ledger/page";
import { loadLedgerSnapshot, openItemsByPriority } from "@/lib/developer-area/ledger-snapshot";

/**
 * Overrides ride on top of the *real* committed snapshot, following
 * `tests/developer-hub-page.dom.test.tsx`: a state the live ledger does not
 * currently exercise gets pinned against the shape the route actually loads,
 * rather than against a hand-built fixture that could drift from it. `null`
 * means "do not override".
 */
const acuityOverride = vi.hoisted(() => ({ value: null as string | null }));

/**
 * Overrides `open[0].detail`. Added for the pipe-escape test below: the one
 * live row that used to carry a literal `|` (`#SZGPAH`) was resolved and
 * archived by an upstream `main` merge, so the property this test pins can no
 * longer be exercised by any open row. `null` means "do not override".
 */
const openDetailOverride = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/developer-area/ledger-snapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/developer-area/ledger-snapshot")>();
  return {
    ...actual,
    loadLedgerSnapshot: () => {
      let snapshot = actual.loadLedgerSnapshot();
      if (acuityOverride.value !== null) {
        const acuity = acuityOverride.value;
        snapshot = { ...snapshot, queue: snapshot.queue.map((entry) => ({ ...entry, acuity })) };
      }
      if (openDetailOverride.value !== null) {
        const detail = openDetailOverride.value;
        snapshot = {
          ...snapshot,
          open: snapshot.open.map((item, index) => (index === 0 ? { ...item, detail } : item)),
        };
      }
      return snapshot;
    },
  };
});

afterEach(cleanup);

afterEach(() => {
  acuityOverride.value = null;
  openDetailOverride.value = null;
});

describe("developer ledger page", () => {
  it("renders priority and acuity as visibly distinct labels", () => {
    render(<DeveloperLedgerPage />);
    const queue = screen.getByTestId("developer-ledger-queue");
    // Acuity lives only in the queue; priority only in the open list. A shared
    // badge would report the P1 rows and the A1 queue entry as one urgent set.
    expect(within(queue).queryByText(/^P1$/)).toBeNull();
    expect(within(screen.getByTestId("developer-ledger-open")).queryByText(/^A1$/)).toBeNull();
  });

  it("gives acuity and priority genuinely different badge treatments", () => {
    // The test above constrains only *which scale appears where*. It says
    // nothing about treatment, so a regression that handed the acuity chip the
    // priority badge's exact classes — the merged badge the spec forbids —
    // would pass it. This is the assertion that fails instead.
    const snapshot = loadLedgerSnapshot();
    render(<DeveloperLedgerPage />);

    const entry = snapshot.queue[0];
    const chip = screen.getByTestId(`developer-ledger-acuity-${entry.order}`);
    const badge = screen.getByTestId(`developer-ledger-priority-${snapshot.open[0].id.replace("#", "")}`);
    const chipClass = chip.getAttribute("class") ?? "";
    const badgeClass = badge.getAttribute("class") ?? "";

    // Both halves of each contrast are named, so collapsing either one into the
    // other fails: giving the chip the badge's classes breaks the rounded-full
    // and border-2 assertions, and giving the badge the chip's classes breaks
    // the rounded-lg one.
    expect(chipClass).toContain("rounded-full");
    expect(chipClass).toContain("border-2");
    expect(chipClass).not.toContain("rounded-lg");

    expect(badgeClass).toContain("rounded-lg");
    expect(badgeClass).not.toContain("rounded-full");
    expect(badgeClass).not.toContain("border-2");

    expect(chipClass).not.toBe(badgeClass);

    // ...and the chip says in words what its code means, which the badge does
    // not need to: a bare `A1` beside a bare `P1` is the confusion itself.
    expect(chip.textContent).toMatch(new RegExp(`^${entry.acuity}·\\s+\\S`));
    expect(badge.textContent).toBe(snapshot.open[0].priority);
  });

  it("shows counts that match the snapshot", () => {
    const snapshot = loadLedgerSnapshot();
    render(<DeveloperLedgerPage />);
    expect(screen.getByTestId("developer-ledger-count-open")).toHaveTextContent(String(snapshot.counts.open));
    expect(screen.getByTestId("developer-ledger-count-pending")).toHaveTextContent(String(snapshot.counts.pending));
  });

  it("wires all four counts to the snapshot rather than hardcoding any of them", () => {
    // The two the brief pins are not enough on their own: `-p1` and `-queued`
    // could each carry a literal and still pass above. Every tile must read
    // from the same snapshot the list below it renders.
    const { counts } = loadLedgerSnapshot();
    render(<DeveloperLedgerPage />);

    // Read the number element itself, not the whole tile: the p1 tile's label
    // is "blocking, priority P1", so a `toContain` over the tile would match
    // the label's own `1` and pass against any value the day `counts.p1` is 1.
    expect(screen.getByTestId("developer-ledger-count-p1-value").textContent).toBe(String(counts.p1));
    expect(screen.getByTestId("developer-ledger-count-queued-value").textContent).toBe(String(counts.queued));
    expect(screen.getByTestId("developer-ledger-count-open-value").textContent).toBe(String(counts.open));
    expect(screen.getByTestId("developer-ledger-count-pending-value").textContent).toBe(String(counts.pending));
    // The queued tile must agree with the list it describes, not merely with
    // the counts block — that is what makes it unfakeable.
    expect(within(screen.getByTestId("developer-ledger-queue")).getAllByRole("listitem")).toHaveLength(counts.queued);
  });

  it("always shows the freshness stamp", () => {
    render(<DeveloperLedgerPage />);
    expect(screen.getByTestId("developer-hub-freshness")).toBeInTheDocument();
  });

  it("keeps full detail in the DOM behind a native disclosure, not a click handler", () => {
    render(<DeveloperLedgerPage />);
    const item = screen.getAllByTestId(/^developer-ledger-item-/)[0];
    expect(item.querySelector("details")).not.toBeNull();
    expect(item.querySelector("button")).toBeNull();
  });

  it("carries no button anywhere on the page, so nothing needs a client handler", () => {
    // Task 7 shipped a `<button onClick>` inside a Server Component and the
    // route threw on every render; neither tsc nor jsdom can see that class of
    // bug, because jsdom renders this as an ordinary client tree. Asserting the
    // absence of buttons outright is what keeps the page free of handlers.
    const { container } = render(<DeveloperLedgerPage />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("keeps the collapsed detail text in the DOM rather than withholding it", () => {
    // Progressive disclosure is a readability device, not a data-hiding one.
    // The longest detail cell is ~7,800 characters, which is why it is not
    // inline — but it must still be findable and screen-reader reachable.
    const snapshot = loadLedgerSnapshot();
    const first = snapshot.open[0];
    render(<DeveloperLedgerPage />);

    const item = screen.getByTestId(`developer-ledger-item-${first.id.replace("#", "")}`);
    expect(item.querySelector("details")?.textContent).toContain(first.detail);
  });

  it("labels the running order as urgency, not priority", () => {
    render(<DeveloperLedgerPage />);
    expect(screen.getByTestId("developer-ledger-queue-caption")).toHaveTextContent(/urgency, not priority/i);
  });

  it("renders every open item, grouped P1 then P2 then P3", () => {
    const snapshot = loadLedgerSnapshot();
    const grouped = openItemsByPriority(snapshot);
    render(<DeveloperLedgerPage />);

    const open = screen.getByTestId("developer-ledger-open");
    const rendered = within(open)
      .getAllByTestId(/^developer-ledger-item-/)
      .map((node) => node.getAttribute("data-testid"));

    // `openItemsByPriority` recognises only P1-P3, so any other priority must
    // still be rendered somewhere rather than silently dropped: the list has to
    // add up to `counts.open`, which is the number the tile above it reports.
    const inGroups = [...grouped.P1, ...grouped.P2, ...grouped.P3];
    const inGroupIds = new Set(inGroups.map((item) => item.id));
    const remainder = snapshot.open.filter((item) => !inGroupIds.has(item.id));

    expect(rendered).toEqual(
      [...inGroups, ...remainder].map((item) => `developer-ledger-item-${item.id.replace("#", "")}`),
    );
    expect(rendered).toHaveLength(snapshot.counts.open);
  });

  it("renders an acuity value it does not recognise instead of dropping the entry", () => {
    // The spec lists "Optional" as a possible acuity; the live ledger only ever
    // uses A1-A3, so without this override the unknown branch is never reached.
    acuityOverride.value = "Optional";
    const snapshot = loadLedgerSnapshot();
    render(<DeveloperLedgerPage />);

    const queue = screen.getByTestId("developer-ledger-queue");
    expect(within(queue).getAllByRole("listitem")).toHaveLength(snapshot.counts.queued);
    expect(within(queue).getAllByText("Optional").length).toBe(snapshot.counts.queued);
  });

  it("lists every pending inbox request", () => {
    const snapshot = loadLedgerSnapshot();
    render(<DeveloperLedgerPage />);
    const pending = screen.getByTestId("developer-ledger-pending");
    // A fully reconciled inbox is a normal resting state, not an anomaly: reconcile
    // applies every queued request and leaves zero pending until the next branch
    // queues one. The page renders its empty-state paragraph under the same testid,
    // so branch on the count instead of assuming the queue is never empty — the
    // unguarded getAllByRole/pending[0] pair throws on a clean inbox.
    if (snapshot.counts.pending === 0) {
      expect(pending).toHaveTextContent("No requests are waiting.");
      expect(within(pending).queryAllByRole("listitem")).toHaveLength(0);
      return;
    }
    expect(within(pending).getAllByRole("listitem")).toHaveLength(snapshot.counts.pending);
    expect(pending).toHaveTextContent(snapshot.pending[0].summary);
  });

  it("links back to the developer hub", () => {
    render(<DeveloperLedgerPage />);
    expect(screen.getByTestId("developer-ledger-back")).toHaveAttribute("href", "/mockups/development");
  });

  it("shows no markdown pipe escape to the reader", () => {
    // `open.#SZGPAH.detail` used to carry a literal `\|` — a markdown-table
    // artifact that has no business in a JSON data contract, and that the page
    // would otherwise render verbatim. Fixed in the generator; pinned here
    // end to end.
    //
    // The positive half was originally derived from the live snapshot at
    // render time, deliberately not naming `#SZGPAH`, so the assertion would
    // survive that row being resolved. It didn't survive: `#SZGPAH` was
    // resolved and archived by an upstream `main` merge, and with it went the
    // only open row anywhere in the ledger that contained a pipe — so the
    // derived filter now runs over zero rows every time, not just on the day
    // `#SZGPAH` closes. A non-empty guard on that filter caught exactly this
    // and failed loud instead of passing vacuously, per its own comment. But a
    // property that has already gone vacuous once, through no change of ours,
    // will drift again the next time the ledger is regenerated — live data is
    // proven unreliable as the carrier for this specific property. So the
    // positive half now renders against a mocked snapshot with a row whose
    // `detail` holds a real pipe, following the override pattern in
    // `tests/developer-hub-page.dom.test.tsx`. With a fixture we control there
    // is no "maybe zero rows" case, so the guard is gone too — not weakened,
    // removed, because the condition it protected against no longer exists for
    // this assertion.
    const { container: liveContainer } = render(<DeveloperLedgerPage />);

    // Durable negative, unaffected by the fixture below: it runs against the
    // real, unmocked snapshot and holds whatever the ledger happens to
    // contain. `String.raw` on purpose — a plain "\|" is just "|" after JS
    // escape processing, which would assert no pipe character at all.
    expect(liveContainer.textContent).not.toContain(String.raw`\|`);
    cleanup();

    openDetailOverride.value = "Row detail with a | pipe character that must render as a literal pipe.";
    const snapshot = loadLedgerSnapshot();
    const first = snapshot.open[0];
    expect(first.detail).toContain("|");

    const { container } = render(<DeveloperLedgerPage />);
    expect(container.textContent).toContain(first.detail);
    expect(container.textContent).not.toContain(String.raw`\|`);
  });
});
