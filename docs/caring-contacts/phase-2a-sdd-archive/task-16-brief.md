### Task 16: The service-state banner and the explained-automation contract

Spec §4.4 is a contract, not a preference: wherever the system has acted on its own — paused, skipped, suppressed, blocked, escalated — the surface stating that state must also state, **in plain words and in place**, why and what would change it. No bare status chip without a reachable reason. Spec §4.2 additionally requires the service-state banner to be visible **everywhere** while a stop is active.

**Files:**

- Create: `src/components/caring-contacts/workspace/service-state-banner.tsx`
- Create: `src/components/caring-contacts/workspace/automated-state.tsx`
- Modify: `src/components/caring-contacts/workspace/shell.tsx`
- Test: `tests/caring-contacts-explained-automation.dom.test.tsx` (new)

**Interfaces:**

```tsx
export function ServiceStateBanner(props: { state: ServiceState }): JSX.Element | null;

export type AutomatedStateProps = {
  state: string; // a closed transport or plan term, e.g. "Suppressed"
  because: string; // plain-words reason
  changedBy: string; // plain-words statement of what would change it
};
export function AutomatedState(props: AutomatedStateProps): JSX.Element;
```

**Rules:** `AutomatedState` renders the state, the reason and the remedy in the same accessible region, wired so a screen reader reaching the state also reaches both — the reason is never in a tooltip alone. `ServiceStateBanner` returns `null` while running, and while stopped renders `role="status"`, the categorised reason in plain words, the count of restart approvals recorded out of three, and a link to the service-stop screen. It **never** contains patient information — it is rendered on every screen including ones showing no patient.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AutomatedState } from "@/components/caring-contacts/workspace/automated-state";
import { ServiceStateBanner } from "@/components/caring-contacts/workspace/service-state-banner";

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

  it("shows nothing while the service is running", () => {
    const { container } = render(<ServiceStateBanner state={{ stopped: false, teamId: teamId("TEAM-A") }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("states the reason and the approval count while stopped, with no patient information", () => {
    render(<ServiceStateBanner state={stoppedServiceState()} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/0 of 3/);
    expect(banner).toHaveTextContent(/wrong recipient/i);
    expect(banner.textContent ?? "").not.toMatch(/Rowan|Mira|\+61/);
  });

  it("keeps the banner on every screen the shell renders", () => {
    render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement both components and mount the banner in the shell.** Use design tokens only; status is communicated through text, icon and structure, never colour alone.
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Render `AutomatedState` without the remedy → the first test goes red. Revert.
- [ ] **Step 6: Commit**

```bash
git add src/components/caring-contacts/workspace/service-state-banner.tsx src/components/caring-contacts/workspace/automated-state.tsx src/components/caring-contacts/workspace/shell.tsx tests/caring-contacts-explained-automation.dom.test.tsx
git commit -m "feat(caring-contacts): service-state banner and the explained-automation contract"
```

---

## Group 5 — The 24 overlays

**Build these two tasks at high reasoning effort.** The 24-row modality matrix is frozen, deep-linked, geometry-asserted at two widths, and carries the fresh-authentication checkpoint for the two most consequential actions in the product.

---
