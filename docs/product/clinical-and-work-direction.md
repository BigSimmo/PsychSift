# Clinical and Work product direction

**Decision date:** 2026-10-21
**Decision:** Psych Sift is one app for both clinical reference and work management. Nothing is cut; it is organised into two sides, Clinical and Work.

_Recorded from the owner's own words in the project chat and the Clinical and Work structure thread, 21 Oct 2026. This file is the home for these rules; other files link here rather than restating them._

## What the owner decided

1. **All in one.** The owner wrote "I want it to be an all in one reference and work management tool". No Work area (On Call, Roster, Teaching, CPD, Admin, My Day) is to be cut or parked to narrow the app.
2. **A reference tool, without patient data.** Psych Sift is a reference and work tool, not a patient record. The owner kept On Call's bed number and initials as they are; checking the other screens for patient details is part of the safety work.
3. **Other doctors will use it.** Colleagues are not invited until the safety work (proving that each person's data is kept apart) is finished.
4. **All pages stay live.** No page is hidden behind a beta or release label.
5. **No brand new areas for 8 weeks**, from 21 Oct 2026 (to about 16 Dec 2026). Work in that time improves the areas that exist. This sits beside the conditions in [the clinical trust direction](clinical-trust-direction.md).
6. **Two sides, Clinical and Work.** The name "Clinical" stays. Every mode says which side it is on, in `src/lib/app-modes.ts`, and the menus and Work area lists are checked against it (`tests/app-mode-sides.test.ts`).
   - **Clinical** keeps its doors: Search, Psychiatry, Mental Health Act and Medicines, with your library (Favourites and Sources) at the foot.
   - **Mental Health Act** is a door of its own. Forms leads it, with its three tabs: the forms register, the Act and Chief Psychiatrist standards, and the MHA clock. Every address is unchanged.
   - **Work** is one list in one order everywhere: My Day, On Call, Roster, Teaching, CPD, Admin. My Day is the front page of Work.
   - **Open shifts** is a tab inside Roster, not a separate entry in the menu. Its addresses keep working.
7. **Cross-links between the sides.** The On Call handbook stays in On Call and links to the library. On Call's shift tools link to the MHA clock.
8. **Deferred:** the clean-up of the Clinical sidebar's own list of modes waits for a later decision.

## Where each rule lives in the code

| Rule                                | Home                                           |
| ----------------------------------- | ---------------------------------------------- |
| Which side each mode is on          | `src/lib/app-modes.ts` (`side` on every mode)  |
| Menu doors and their order          | `src/lib/phone-mode-groups.ts`                 |
| Work side menu and rail (six areas) | `src/lib/work-frame/side-nav.ts`               |
| On Call to MHA clock link           | `src/components/on-call/now/mha-clock-row.tsx` |
