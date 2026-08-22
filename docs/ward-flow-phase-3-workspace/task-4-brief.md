### Task 4: The provider, the clock and the layout

**Files:**

- Create: `src/components/ward-management/ward-flow-provider.tsx`
- Create: `src/app/ward-management/layout.tsx`
- Create: `tests/ward-flow-provider.dom.test.tsx`

**Interfaces:**

- Consumes: `seedWardFlowState`, `wardFlowReducer`, `WardFlowEvent`, `wallClockNow`, `NOW_ANCHOR`.
- Produces: `WardFlowProvider({ children, initialNow? })`; `useWardFlow(): { movements, units, rejections, now, dispatch }`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/ward-flow-provider.dom.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WardFlowProvider, useWardFlow } from "../src/components/ward-management/ward-flow-provider";
import { NOW_ANCHOR } from "../src/components/ward-management/ward-sites";

function Probe() {
  const { movements, units, now, rejections } = useWardFlow();
  return (
    <ul>
      <li data-testid="movements">{movements.length}</li>
      <li data-testid="units">{units.length}</li>
      <li data-testid="now">{now}</li>
      <li data-testid="rejections">{rejections.length}</li>
    </ul>
  );
}

describe("WardFlowProvider", () => {
  it("seeds the fixture and holds the clock at the injected instant", () => {
    render(
      <WardFlowProvider initialNow={NOW_ANCHOR}>
        <Probe />
      </WardFlowProvider>,
    );
    expect(screen.getByTestId("movements")).toHaveTextContent("48");
    expect(screen.getByTestId("units")).toHaveTextContent("22");
    expect(screen.getByTestId("now")).toHaveTextContent(String(NOW_ANCHOR));
    expect(screen.getByTestId("rejections")).toHaveTextContent("0");
  });

  it("refuses to be used outside the provider rather than returning an empty world", () => {
    // Conservative failure: a component rendered outside the provider must fail loudly, not
    // silently render zero patients, which would read as a quiet night.
    expect(() => render(<Probe />)).toThrow(/WardFlowProvider/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ward-flow-provider.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the provider**

`"use client"`. `useReducer(wardFlowReducer, undefined, seedWardFlowState)`.

The clock:

```ts
// `initialNow` is how tests pin time. Only the live app ticks.
const mountedAt = useRef<Instant | undefined>(undefined);
if (mountedAt.current === undefined) mountedAt.current = initialNow ?? wallClockNow();
const [ticks, setTicks] = useState(0);
useEffect(() => {
  if (initialNow !== undefined) return; // pinned: never tick in a test
  const id = setInterval(() => setTicks((value) => value + 1), 30_000);
  return () => clearInterval(id);
}, [initialNow]);
const elapsed = initialNow !== undefined ? 0 : Math.max(0, wallClockNow() - mountedAt.current);
const now = NOW_ANCHOR + elapsed + state.clockOffsetMinutes;
```

`useWardFlow()` throws a named error when the context is absent — never a default empty state.

`src/app/ward-management/layout.tsx` is a server component that renders `<WardFlowProvider>{children}</WardFlowProvider>`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/ward-flow-provider.dom.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Prove the app still boots**

```bash
npm run ensure
npx tsc --noEmit -p tsconfig.json
PLAYWRIGHT_BASE_URL=<url ensure printed> npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line
```

Expected: 21 passed, 0 skipped. Adding a layout above the routes must change nothing yet.

- [ ] **Step 6: Commit**

```bash
npm run format
git add src/components/ward-management/ward-flow-provider.tsx src/app/ward-management/layout.tsx tests/ward-flow-provider.dom.test.tsx
git commit -m "feat(ward-flow): add the state provider and the ticking clock"
```

---
