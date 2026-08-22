### Task 13: The demo role switcher

The decision lock requires WA Health enterprise sign-on and states that no Caring-Contacts-local credentials exist, so this is **not** a login and must never look like one. It is a role switcher, labelled as one, that exists because the permission and auditor surfaces cannot be demonstrated without it.

**Files:**

- Create: `src/lib/caring-contacts-server/session.ts`
- Create: `src/app/api/caring-contacts/session/route.ts`
- Test: `tests/caring-contacts-session.test.ts` (new)

**Interfaces:**

```ts
export const CARING_CONTACTS_ROLE_COOKIE = "caring-contacts-demo-role";
export const DEMO_ROLES: readonly CaringContactRole[]; // all five, in switcher order
export const DEMO_TEAM_ID: TeamId;
export async function resolveDemoActor(): Promise<Actor>; // reads cookies(), defaults to coordinator
export function demoActorForRole(role: CaringContactRole): Actor;
```

**Rules:** the cookie holds only a role name from `DEMO_ROLES`; anything else falls back to `coordinator` rather than throwing, because an unreadable cookie must never lock someone out of a demonstration. There is no password field anywhere. The actor id is derived from the role (`demo-<role>`) so the audit trail shows who acted. `cookies()` is async in Next 16 — `await cookies()`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

import {
  CARING_CONTACTS_ROLE_COOKIE,
  DEMO_ROLES,
  demoActorForRole,
  resolveDemoActor,
} from "@/lib/caring-contacts-server/session";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name] })),
}));

let mockCookies: Record<string, { value: string } | undefined> = {};

describe("demo role switcher", () => {
  it("offers all five roles and no credential field", () => {
    expect(DEMO_ROLES).toEqual([
      "coordinator",
      "teamLead",
      "auditor",
      "clinicalProgrammeLead",
      "livedExperienceRepresentative",
    ]);
  });

  it("defaults to the coordinator when no cookie is set", async () => {
    mockCookies = {};
    await expect(resolveDemoActor()).resolves.toMatchObject({ roles: ["coordinator"] });
  });

  it("falls back to the coordinator on an unreadable cookie rather than failing", async () => {
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "administrator" } };
    await expect(resolveDemoActor()).resolves.toMatchObject({ roles: ["coordinator"] });
  });

  it("names the acting role in the actor id so the audit trail can show it", () => {
    expect(demoActorForRole("auditor").id).toBe("demo-auditor");
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement `session.ts` and the `POST`/`GET` route handler** that sets and reads the cookie. The route validates the body with Zod against `DEMO_ROLES` and returns `400` on anything else.
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Make the unknown-cookie path throw → the third test goes red. Revert.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts-server/session.ts src/app/api/caring-contacts/session/route.ts tests/caring-contacts-session.test.ts
git commit -m "feat(caring-contacts): demo role switcher with no credentials"
```

---
