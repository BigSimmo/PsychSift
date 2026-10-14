# CME Design System Adoption Contract

This document records the design system adoption contracts and dedicated automated verification proofs for the Continuing Medical Education (CME) mode surfaces in the Clinical Knowledge Base.

The authoritative schema and proof registrations are declared in [`docs/design-system/adoption-contract.json`](design-system/adoption-contract.json) under the `catalogues-forms-and-info` surface family.

---

## 1. Scope and Surface Coverage

CME encompasses 19 distinct production routes (one `page.tsx` each under `src/app/(search-app)/cme/`) providing hours logging, category distributions, annual RANZCP compliance validation, CPD home and evidence portfolios, planning, calendar views, routine schedules, and annual print/export summaries:

- `/cme` — Dashboard, category distribution bar, pace projection, and quick logging sheet
- `/cme/log` and `/cme/log/[id]` — Activity logs and detail inspectors
- `/cme/new` — Activity recording form with sticky save bar
- `/cme/check` — Annual requirements and standard checks
- `/cme/setup` — Practice domains, college selection, and baseline target configuration
- `/cme/routines` — Recurring activities and peer review groups
- `/cme/calendar` — Month-by-month activity visualizer
- `/cme/summary` — Annual print-optimised statement and CSV download
- `/cme/plan` — Professional development plan view
- `/cme/programme`, `/cme/learning`, `/cme/customise`, `/cme/training` — Specialised support and training views (alongside `/cme/cpd-home`, `/cme/evidence`, `/cme/export`, `/cme/applications`, and `/cme/applications/cv`)

All CME routes adhere to the design system v2 tokens, 48px interactive touch target floors (`min-h-tap`), and responsive phone layouts (320px–430px) without horizontal scroll overflows.

---

## 2. Dedicated Accessibility and Environmental Proofs

While general design system token resolution is verified repository-wide via `tests/ckb-v2-token-contract.test.ts` and `tests/ui-style-contract.spec.ts`, CME routes carry dedicated automated end-to-end proofs in [`tests/ui-cme-phone.spec.ts`](../tests/ui-cme-phone.spec.ts).

### 2.1 High Contrast and Forced Colours (`forcedColors: "active"`)

- **Proof Spec:** `tests/ui-cme-phone.spec.ts` — `"setup remains readable with forced colours and keyboard focus"`
- **Target Route:** `/cme/setup`
- **Contract Verification:**
  - Evaluated under Chromium with `forcedColors: "active"` and `reducedMotion: "reduce"`.
  - Ensures all form controls, buttons, and radio/checkbox groups retain system-rendered borders (`Button` borders use `forced-colors:border`).
  - Verifies that keyboard focus transitions successfully (`control.focus()`), controls are `:focus-visible`, and interactive elements remain within the viewport without being masked or clipped.

### 2.2 Dark Mode (`colorScheme: "dark"`)

- **Proof Spec:** `tests/ui-cme-phone.spec.ts` — `"${scenario.width}px ${scenario.colorScheme}: controls fit and text does not overflow"`
- **Target Routes:** All core CME routes (`/cme`, `/cme/log`, `/cme/new`, `/cme/programme`, `/cme/setup`, `/cme/routines`, `/cme/summary?year=2026`)
- **Contract Verification:**
  - Evaluated under `colorScheme: "dark"` across mobile viewports (including 390px phone viewport).
  - Ensures tokens resolve to valid dark palette variables without unstyled text (`#main-content` contains no NaN or undefined artifacts).
  - Verifies that clinical status colors (such as raw amber/red badges) are strictly forbidden outside explicit clinical indicators.
  - Confirms touch targets maintain a minimum 48px height and horizontal scroll width matches the viewport exactly (`scrollWidth <= window.innerWidth + 1`).

### 2.3 Print Stylesheet and Layout (`@media print`)

- **Proof Spec:** `tests/ui-cme-phone.spec.ts` — `"prints the whole selected year with black text and no controls or clipping ancestors"`
- **Target Route:** `/cme/summary?year=2026`
- **Contract Verification:**
  - Evaluated under `emulateMedia({ media: "print" })`.
  - Screen-only interactive elements and navigation are hidden using `.cme-print-controls` (`display: none`).
  - All ancestor layout containers (`main`, wrapper `div`s) have their `overflowY` set to `visible` and `maxHeight` removed (`none`), ensuring physical multi-page printing without clipped pages.
  - Text colors on headings and paragraphs are converted to pure black (`rgb(0, 0, 0)`) for contrast and legibility on physical paper.
  - The root summary container switches to `position: static` with full content height expansion.

---

## 3. Contract Registration

In `docs/design-system/adoption-contract.json`, the `catalogues-forms-and-info` entry explicitly cites `tests/ui-cme-phone.spec.ts` as supporting evidence across the required proof categories:

```json
{
  "id": "catalogues-forms-and-info",
  "disposition": "owned",
  "expectedShellState": "v2",
  "proof": {
    "dark": {
      "status": "passed",
      "evidence": ["tests/ui-style-contract.spec.ts", "tests/ui-cme-phone.spec.ts"]
    },
    "forcedColours": {
      "status": "passed",
      "evidence": ["tests/ckb-v2-token-contract.test.ts", "tests/ui-cme-phone.spec.ts"]
    },
    "compact320": {
      "status": "passed",
      "evidence": ["tests/ui-smoke.spec.ts", "tests/cme-visual-contract.dom.test.tsx"]
    },
    "print": {
      "status": "passed",
      "evidence": ["tests/global-v2-activation.test.ts", "tests/ui-cme-phone.spec.ts"]
    },
    "browser": {
      "status": "passed",
      "evidence": ["tests/ui-sources.spec.ts", "tests/ui-visual-baseline.spec.ts", "tests/ui-cme-phone.spec.ts"]
    }
  }
}
```
