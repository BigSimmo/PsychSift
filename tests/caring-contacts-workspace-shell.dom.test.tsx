import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CaringContactsShell } from "@/components/caring-contacts/workspace/shell";
import { FICTIONAL_DATA_MARKER } from "@/components/caring-contacts/workspace/synthetic-marker";
import { CARING_CONTACTS_ROUTES } from "@/lib/caring-contacts-routes";
import { teamId } from "@/lib/caring-contacts/ids";
import { runningService } from "@/lib/caring-contacts/service-state";

/**
 * Ruling 52: the workspace navigation renders its whole destination set now, and
 * every destination that has no page yet is an *unavailable control with a stated
 * reason* — never a link to a route that would 404.
 *
 * The kind of each destination is derived from the DOM itself rather than read
 * off a marker attribute the shell controls, so the shell cannot satisfy this
 * test by relabelling a dead link.
 */
type DestinationKind = "link" | "in-page" | "unavailable" | "live-action" | "unknown";

function destinationKind(element: Element): DestinationKind {
  if (element.tagName === "A") {
    const href = element.getAttribute("href") ?? "";
    if (href.startsWith("#")) return "in-page";
    return href ? "link" : "unknown";
  }
  if (element.tagName === "BUTTON") {
    return element.getAttribute("aria-disabled") === "true" ? "unavailable" : "live-action";
  }
  return "unknown";
}

/** Every destination in one navigation, in DOM order, as { label, kind }. */
function destinationsOf(navigation: HTMLElement) {
  return [...navigation.querySelectorAll("a, button")].map((element) => ({
    label: element.textContent,
    kind: destinationKind(element),
  }));
}

/** The full unavailable-control convention from docs/wiring-conventions.md. */
function expectStatesItsReason(control: Element) {
  expect(control.tagName, `${control.textContent} should be a button, not an anchor`).toBe("BUTTON");
  expect(control).toHaveAttribute("aria-disabled", "true");
  expect(control).toHaveAttribute("type", "button");
  expect(control).toHaveAttribute("title", expect.stringContaining("coming soon"));
  // Native `disabled` would remove the tab stop, so the stated reason could never
  // be reached by keyboard. The two attributes are never used together.
  expect(control).not.toHaveAttribute("disabled");
  const describedBy = control.getAttribute("aria-describedby");
  expect(describedBy, `${control.textContent} states no reason`).toBeTruthy();
  expect(document.getElementById(describedBy!)?.textContent ?? "").not.toBe("");
}

function renderShell() {
  // `serviceState` became required in Task 16 (Ruling 56), so this call site gains
  // an argument. A running service renders no banner, so every expectation below --
  // including the exact count of unavailable controls -- is unchanged.
  return render(
    <CaringContactsShell title="Today" serviceState={runningService(teamId("shell-test-team"))}>
      content
    </CaringContactsShell>,
  );
}

describe("caring-contacts workspace shell", () => {
  it("renders exactly one h1 and marks the workspace synthetic", () => {
    renderShell();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId("caring-contacts-synthetic-marker")).toBeInTheDocument();
  });

  it("says in so many words that the data is invented", () => {
    renderShell();
    // Presence by test id is not enough. Without this, the wording could be
    // changed to anything at all — including something that no longer says the
    // data is invented — and every gate on this branch would still pass. This is
    // the safeguard that makes listing a workspace of invented patients in the
    // live tools catalogue defensible, so its text is pinned, exactly as the
    // prototype's copy is pinned by caring-contact-product-redesign.dom.test.tsx.
    expect(FICTIONAL_DATA_MARKER).toBe("Synthetic prototype — fictional data only");
    expect(screen.getByTestId("caring-contacts-synthetic-marker")).toHaveTextContent(
      "Synthetic prototype — fictional data only",
    );
  });

  it("keeps the frozen rail destination set, in order, with only Today navigable", () => {
    renderShell();
    expect(destinationsOf(screen.getByRole("navigation", { name: "Workspace" }))).toEqual([
      { label: "Today", kind: "link" },
      { label: "Patients", kind: "unavailable" },
      { label: "Schedule", kind: "unavailable" },
      { label: "Templates", kind: "unavailable" },
    ]);
  });

  it("keeps the frozen phone destination set, in order, with More reaching the in-page panel", () => {
    renderShell();
    expect(destinationsOf(screen.getByRole("navigation", { name: "Phone workspace" }))).toEqual([
      { label: "Today", kind: "link" },
      { label: "Patients", kind: "unavailable" },
      { label: "Schedule", kind: "unavailable" },
      { label: "More", kind: "in-page" },
    ]);
  });

  it("navigates internally with Link, never a raw anchor to an internal route", () => {
    const { container } = renderShell();
    for (const anchor of container.querySelectorAll("a[href^='/']")) {
      expect(anchor.getAttribute("data-internal-link")).toBe("true");
    }
  });

  it("links only to routes that exist, so no destination can reach a 404", () => {
    const { container } = renderShell();
    const internalHrefs = [...container.querySelectorAll("a[href^='/']")].map((anchor) => anchor.getAttribute("href"));
    expect(internalHrefs.length).toBeGreaterThan(0);
    // `today` is the only Caring Contacts route with a page. Every other declared
    // destination is an unavailable control until Plan 2B builds its page.
    expect(new Set(internalHrefs)).toEqual(new Set([CARING_CONTACTS_ROUTES.today]));
  });

  it("keeps the More panel's destination set, in order, all of them unavailable", () => {
    renderShell();
    expect(destinationsOf(screen.getByRole("region", { name: "More destinations" }))).toEqual(
      [
        "Team",
        "Guidance",
        "Reports",
        "Service stop",
        "Access trail",
        "Workload",
        "Reconciliation",
        "Notifications",
        "Training",
        "Coverage",
      ].map((label) => ({ label, kind: "unavailable" })),
    );
  });

  it("makes the workspace's primary control an unavailable one, not a dead button", () => {
    const { container } = renderShell();
    const primary = screen.getByTestId("caring-contacts-primary-control").closest("button");
    expect(primary, "the primary control is not a button").not.toBeNull();
    expect(primary!.textContent).toBe("New plan");
    expect(destinationKind(primary!)).toBe("unavailable");
    expectStatesItsReason(primary!);
    // 3 unbuilt rail destinations + 2 on the phone bar + 10 in the More panel + this one.
    expect([...container.querySelectorAll("button")].filter((c) => destinationKind(c) === "unavailable")).toHaveLength(
      16,
    );
  });

  it("states a reason on every destination that is not built yet", () => {
    const { container } = renderShell();
    const unavailable = [...container.querySelectorAll("button")].filter(
      (control) => destinationKind(control) === "unavailable",
    );
    // Three unbuilt rail destinations, two more on the phone bar, plus the More panel.
    expect(unavailable.length).toBeGreaterThanOrEqual(5);
    for (const control of unavailable) expectStatesItsReason(control);
  });

  it("exposes the frozen width state so the media-class layout is observable", () => {
    const { container } = renderShell();
    expect(
      [...container.querySelectorAll("[data-workspace-width-state]")].map((node) =>
        node.getAttribute("data-workspace-width-state"),
      ),
    ).toEqual(["compact", "rail", "split", "wide"]);
  });
});
