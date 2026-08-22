### Task 14: Route handlers that audit every view

This is where Phase 1 open item 1 actually closes. A read is only observable at a boundary; the boundary is here.

**Files:**

- Create: `src/lib/caring-contacts-server/handler.ts`
- Create: `src/app/api/caring-contacts/plans/route.ts`, `plans/[planId]/route.ts`, `referrals/route.ts`, `service-state/route.ts`, `access-trail/route.ts`, `assignments/[planId]/route.ts`, `dispatches/route.ts`, `notification-preferences/route.ts`, `training/route.ts`, `pathway-versions/route.ts`
- Test: `tests/caring-contacts-api-handler.test.ts` (new)

**Interfaces:**

```ts
export type ReadHandlerConfig<T> = {
  access: { kind: AccessKind; objectType: AccessedObjectType; objectId: (request: NextRequest) => string };
  read: (store: CaringContactRepository, actor: Actor, request: NextRequest) => Promise<T>;
};
export function readHandler<T>(config: ReadHandlerConfig<T>): (request: NextRequest) => Promise<Response>;

export type WriteHandlerConfig<TBody, TResult> = {
  schema: ZodType<TBody>;
  action: CaringContactAction;
  write: (store: CaringContactRepository, actor: Actor, body: TBody) => Promise<TransitionResult<TResult>>;
};
export function writeHandler<TBody, TResult>(
  config: WriteHandlerConfig<TBody, TResult>,
): (request: NextRequest) => Promise<Response>;
```

**Rules:**

1. **`readHandler` records an access audit event on every call, before returning — including when the read is denied.** A denied read records `outcome: "denied"`. This is the whole point of the task; a read path with no `recordAccess` call is a defect.
2. `writeHandler` parses with Zod, resolves the actor, checks `canPerformCaringContactAction` and returns `403` with the **named reason** in the body when denied — the elevation brief requires denials to say why.
3. Refusals map to status codes: `not-found` → 404; `permission-denied` / any capability denial → 403; `stale-version` → 409; `duplicate-active-plan` / `plan-already-exists` / `idempotency-key-reused-for-a-different-write` → 409; `service-stopped` → 423; everything else → 422. The body is always `{ refusal: string }` and never contains patient data.
4. Every response is `no-store`. No patient data ever appears in a URL, so reads take identifiers in the path and filters in the body of a `POST` where a filter could carry a name.
5. Next 16: `params` is a `Promise` — `const { planId } = await props.params`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

import { readHandler, writeHandler } from "@/lib/caring-contacts-server/handler";

describe("caring-contacts API boundary", () => {
  it("records an access event for a successful read", async () => {
    const { store, recorded } = await inMemoryStoreWithSpy();
    const handler = readHandler({
      access: { kind: "view", objectType: "plan", objectId: () => "SYN-PLAN-001" },
      read: async (repository, actor) => repository.getPlan(planId("SYN-PLAN-001"), { actor }),
    });
    const response = await handler(new NextRequest("http://localhost/api/caring-contacts/plans/SYN-PLAN-001"));
    expect(response.status).toBe(200);
    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "view", objectType: "plan", outcome: "allowed" }),
    );
  });

  it("records an access event even when the read is denied", async () => {
    const { store, recorded } = await inMemoryStoreWithSpy({ actorRole: "auditor" });
    const handler = readHandler({
      access: { kind: "view", objectType: "episode", objectId: () => "SYN-PLAN-001" },
      read: async (repository, actor) => repository.getEpisode(planId("SYN-PLAN-001"), { actor }),
    });
    await handler(new NextRequest("http://localhost/api/caring-contacts/episodes/SYN-PLAN-001"));
    expect(recorded()).toContainEqual(expect.objectContaining({ outcome: "denied" }));
  });

  it("returns the named denial reason so the interface can explain itself", async () => {
    const handler = writeHandler({
      schema: z.object({ planId: z.string() }),
      action: "publishPathwayVersion",
      write: async () => ({ ok: true, value: null }),
    });
    const response = await handler(
      new NextRequest("http://localhost/api/caring-contacts/pathway-versions", {
        method: "POST",
        body: JSON.stringify({ planId: "SYN-PLAN-001" }),
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ refusal: "action-not-granted" });
  });

  it("returns 423 and refuses a write while the service is stopped", async () => {
    // stop the service, then attempt a pause through the handler
    expect((await pauseThroughHandler()).status).toBe(423);
  });

  it("never returns patient data in a refusal body", async () => {
    const response = await pauseThroughHandler();
    const body = await response.text();
    expect(body).not.toMatch(/Rowan|Mira|\+61/);
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement `handler.ts` and the ten route handlers.** Put `recordAccess` inside `readHandler`, never in an individual route — a route that could forget it is the failure mode.
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail — two mutations.** Remove the `recordAccess` call from the denied branch → the second test goes red. Return a bare `403` with no body → the third test goes red. Revert both.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts-server/handler.ts src/app/api/caring-contacts/ tests/caring-contacts-api-handler.test.ts
git commit -m "feat(caring-contacts): API boundary that audits every view and names every denial"
```

---

### Checkpoint 3 — end of Group 3

```bash
npm run test
```

```bash
npm run typecheck
```

Paste both decisive lines. Phase 1 open item 1 — "reads are not audited" — is now closed, and open item 2 — "referrals and pathway_versions are declared but never written" — closed at Task 11.

---

## Group 4 — The production shell

---
