### Task 1: Patient-visible copy moves into the sealed domain

The three patient-visible strings and a second, duplicated `calculateGsm7` currently live in a **mockup component**, `src/components/caring-contacts/mockups/personalisation-screen.tsx`. Production code may never import from a mockup path (`eslint.config.mjs` `no-restricted-imports`), so production cannot reach them where they are. They move into the sealed domain; the mockup re-exports them so every existing pinned test keeps passing against the byte-identical strings.

**Files:**

- Create: `src/lib/caring-contacts/synthetic-contacts.ts`
- Create: `src/lib/caring-contacts/message-copy.ts`
- Modify: `src/components/caring-contacts/mockups/types.ts:27-41` (re-export instead of declare)
- Modify: `src/components/caring-contacts/mockups/personalisation-screen.tsx:15-62` (re-export instead of declare; delete the duplicated `calculateGsm7` and `Gsm7Evidence`)
- Test: `tests/caring-contacts-message-copy.test.ts` (new)

**Interfaces:**

- Consumes: `calculateGsm7(value: string): Gsm7Evidence` and `type Gsm7Evidence = { valid: boolean; septets: number; segments: number; invalidCharacters: string[] }` from `src/lib/caring-contacts/message-policy.ts`.
- Produces:
  - `FICTIONAL_CONTACTS_BY_ROLE: Readonly<{ miraPatientMobile: string; rowanPatientMobile: string; programmeStaffedLine: string; crisisSupportContact: string }>`
  - `DESIGNATED_FICTIONAL_MOBILE_NUMBERS: readonly string[]`
  - `PATIENT_VISIBLE_NO_REPLY_NOTICE: string`
  - `EXACT_PATIENT_VISIBLE_MESSAGE: string`
  - `AUTOMATED_REPLY_RESPONSE: string`
  - `EXACT_MESSAGE_GSM7: Gsm7Evidence`
  - `AUTOMATED_REPLY_GSM7: Gsm7Evidence`

**Critical:** the strings must be **byte-identical** to today's. `tests/caring-contact-mockups.dom.test.tsx:130-153` pins `EXACT_MESSAGE_GSM7` at exactly `{ invalidCharacters: [], segments: 2, septets: 252, valid: true }` and `AUTOMATED_REPLY_RESPONSE` at 218 septets / 2 segments. Do not reword, re-punctuate, or "improve" them — they are provisional clinical copy owned by an approval gate outside this build.

- [ ] **Step 1: Write the failing test**

Create `tests/caring-contacts-message-copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { calculateGsm7 } from "@/lib/caring-contacts/message-policy";
import {
  AUTOMATED_REPLY_GSM7,
  AUTOMATED_REPLY_RESPONSE,
  EXACT_MESSAGE_GSM7,
  EXACT_PATIENT_VISIBLE_MESSAGE,
  PATIENT_VISIBLE_NO_REPLY_NOTICE,
} from "@/lib/caring-contacts/message-copy";
import {
  DESIGNATED_FICTIONAL_MOBILE_NUMBERS,
  FICTIONAL_CONTACTS_BY_ROLE,
} from "@/lib/caring-contacts/synthetic-contacts";

describe("caring-contacts patient-visible copy", () => {
  it("keeps the pinned GSM-7 evidence for both patient-visible strings", () => {
    expect(EXACT_MESSAGE_GSM7).toEqual({ invalidCharacters: [], segments: 2, septets: 252, valid: true });
    expect(AUTOMATED_REPLY_GSM7).toEqual({ invalidCharacters: [], segments: 2, septets: 218, valid: true });
  });

  it("derives its evidence from the single domain GSM-7 calculator", () => {
    expect(EXACT_MESSAGE_GSM7).toEqual(calculateGsm7(EXACT_PATIENT_VISIBLE_MESSAGE));
    expect(AUTOMATED_REPLY_GSM7).toEqual(calculateGsm7(AUTOMATED_REPLY_RESPONSE));
  });

  it("names the staffed line and crisis support in both strings and neither patient mobile", () => {
    for (const text of [EXACT_PATIENT_VISIBLE_MESSAGE, AUTOMATED_REPLY_RESPONSE]) {
      expect(text).toContain(FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine);
      expect(text).toContain(FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact);
      expect(text).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile);
      expect(text).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.miraPatientMobile);
    }
  });

  it("states only that nobody reads replies, never that replies are not received", () => {
    expect(EXACT_PATIENT_VISIBLE_MESSAGE).toContain(PATIENT_VISIBLE_NO_REPLY_NOTICE);
    expect(PATIENT_VISIBLE_NO_REPLY_NOTICE).toBe("No one reads replies to this number");
    for (const text of [EXACT_PATIENT_VISIBLE_MESSAGE, AUTOMATED_REPLY_RESPONSE]) {
      expect(text).not.toMatch(/replies are not received|we monitor|monitored/i);
    }
  });

  it("uses four distinct reserved fictional numbers", () => {
    expect(new Set(DESIGNATED_FICTIONAL_MOBILE_NUMBERS).size).toBe(4);
    expect(DESIGNATED_FICTIONAL_MOBILE_NUMBERS).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:focused -- --files tests/caring-contacts-message-copy.test.ts`
Expected: FAIL — `Cannot find module '@/lib/caring-contacts/message-copy'`.

- [ ] **Step 3: Create the two domain modules**

Create `src/lib/caring-contacts/synthetic-contacts.ts`:

```ts
// Reserved fictional numbers only. These are ACMA/Ofcom-style numbers that can never
// connect to a real person, so a screenshot, a test failure or a demonstration can show a
// complete message without any possibility of contacting anyone.
export const FICTIONAL_CONTACTS_BY_ROLE = Object.freeze({
  miraPatientMobile: "+61 491 570 006",
  rowanPatientMobile: "+61 491 570 156",
  programmeStaffedLine: "+61 491 570 157",
  crisisSupportContact: "+61 491 570 158",
} as const);

export type FictionalContactRole = keyof typeof FICTIONAL_CONTACTS_BY_ROLE;

export const DESIGNATED_FICTIONAL_MOBILE_NUMBERS = Object.freeze([
  FICTIONAL_CONTACTS_BY_ROLE.miraPatientMobile,
  FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile,
  FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine,
  FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact,
] as const);

export type DesignatedFictionalMobileNumber = (typeof DESIGNATED_FICTIONAL_MOBILE_NUMBERS)[number];
export type SyntheticPatientMobile =
  (typeof FICTIONAL_CONTACTS_BY_ROLE)["miraPatientMobile"] | (typeof FICTIONAL_CONTACTS_BY_ROLE)["rowanPatientMobile"];
```

Create `src/lib/caring-contacts/message-copy.ts` — copy the three string literals **verbatim** from `src/components/caring-contacts/mockups/personalisation-screen.tsx:15-33`, including their PROVISIONAL comments:

```ts
import { calculateGsm7, type Gsm7Evidence } from "./message-policy";
import { FICTIONAL_CONTACTS_BY_ROLE } from "./synthetic-contacts";

// PROVISIONAL — not clinically approved. Corrected 2026-08-19 under production-build spec §2.1, which
// replaced the non-receiving sender with a receiving-capable number that auto-responds and discards.
// The previous wording ("Replies are not received, stored, analysed or monitored") became untrue the
// moment the number could receive: replies ARE received, then discarded unread. Stating something false
// about a safety boundary is the failure this programme can least afford, so the claim now describes only
// what remains true — that nobody reads them. Final wording is a clinical decision owned by the
// lived-experience and clinical-programme approval gate (docs/caring-contacts/message-review-pack.md §1).
export const PATIENT_VISIBLE_NO_REPLY_NOTICE = "No one reads replies to this number";

export const EXACT_PATIENT_VISIBLE_MESSAGE = `Hi Rowan, Alex from Example Aftercare Team is thinking of you. This is a one-way message. ${PATIENT_VISIBLE_NO_REPLY_NOTICE}. For timing changes call ${FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine}, 9 am-6 pm. In an emergency call 000. Fictional Support Line: ${FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact}. - Alex`;

// PROVISIONAL — not clinically approved. Required by production-build spec §2.1: the automated response
// sent to anyone who replies. It must name where a person IS available, immediately after saying that
// nobody reads this channel, so that reaching out is answered rather than met with silence. Content is
// discarded after this response is sent; nothing is stored, counted per patient, or shown to staff.
export const AUTOMATED_REPLY_RESPONSE = `This number is not read. Your message has not been seen by anyone and has not been kept. To talk to someone, call ${FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine}, 9 am-6 pm every day. In an emergency call 000. Fictional Support Line: ${FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact}.`;

export const EXACT_MESSAGE_GSM7: Gsm7Evidence = calculateGsm7(EXACT_PATIENT_VISIBLE_MESSAGE);
export const AUTOMATED_REPLY_GSM7: Gsm7Evidence = calculateGsm7(AUTOMATED_REPLY_RESPONSE);
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test:focused -- --files tests/caring-contacts-message-copy.test.ts`
Expected: PASS, 5 tests.

If the septet counts differ from 252/218, **do not adjust the expected numbers**. It means `message-policy.ts`'s `calculateGsm7` disagrees with the mockup's copy of it — find and fix the real difference between the two implementations, because the whole point of the move is that there is now one calculator.

- [ ] **Step 5: Re-point the mockup at the domain**

In `src/components/caring-contacts/mockups/types.ts`, delete the `FICTIONAL_CONTACTS_BY_ROLE` / `DESIGNATED_FICTIONAL_MOBILE_NUMBERS` declarations at lines 27-41 and replace with a re-export:

```ts
export {
  DESIGNATED_FICTIONAL_MOBILE_NUMBERS,
  FICTIONAL_CONTACTS_BY_ROLE,
  type DesignatedFictionalMobileNumber,
  type FictionalContactRole,
  type SyntheticPatientMobile,
} from "@/lib/caring-contacts/synthetic-contacts";
```

In `src/components/caring-contacts/mockups/personalisation-screen.tsx`, delete lines 17-62 (the three constants, `GSM_7_BASIC_CHARACTERS`, `GSM_7_EXTENSION_CHARACTERS`, `Gsm7Evidence`, `calculateGsm7`, `EXACT_MESSAGE_GSM7`) and replace with:

```ts
export { calculateGsm7, type Gsm7Evidence } from "@/lib/caring-contacts/message-policy";
export {
  AUTOMATED_REPLY_RESPONSE,
  EXACT_MESSAGE_GSM7,
  EXACT_PATIENT_VISIBLE_MESSAGE,
  PATIENT_VISIBLE_NO_REPLY_NOTICE,
} from "@/lib/caring-contacts/message-copy";
```

Keep every other export in that file untouched (`ActivationGovernanceState`, `ActivationBlocker`, `getActivationBlockers`, `canActivateGovernedVersions`, `PersonalisationScreen`).

- [ ] **Step 6: Run every affected suite**

Run: `npm run test:focused -- --files tests/caring-contacts-message-copy.test.ts,tests/caring-contact-mockups.dom.test.tsx,tests/caring-contact-product-redesign.dom.test.tsx,tests/caring-contacts-domain-isolation.test.ts,tests/caring-contacts-message-policy.test.ts`
Expected: PASS. Paste the `N passed` line.

Then `npm run lint` — the mockup files are **not** in `MOCKUP_IGNORES` (that list covers `src/app/mockups/**`, `**/*-mockups/**`, `**/*-mockups.tsx`, `**/*-mockup.tsx`, none of which matches `src/components/caring-contacts/mockups/`), so they are linted like production and must stay at zero warnings.

- [ ] **Step 7: Prove the tests can fail**

Change one character inside `EXACT_PATIENT_VISIBLE_MESSAGE` (for example `9 am-6 pm` to `9 am-7 pm`) and re-run the focused suite. Expect the septet count assertion **and** `tests/caring-contact-mockups.dom.test.tsx` to go red. Revert.

- [ ] **Step 8: Commit**

```bash
git add src/lib/caring-contacts/synthetic-contacts.ts src/lib/caring-contacts/message-copy.ts src/components/caring-contacts/mockups/types.ts src/components/caring-contacts/mockups/personalisation-screen.tsx tests/caring-contacts-message-copy.test.ts
git commit -m "refactor(caring-contacts): move patient-visible copy into the sealed domain so production can use it"
```

---
