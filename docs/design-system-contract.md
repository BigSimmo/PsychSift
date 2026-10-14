# Design System Contract & Standards

This document specifies the blocking design system token rules, touch/tap target standards, and enforcement mechanisms for the PsychSift application.

---

## 1. Overview & Authority

The system of record for design tokens, components, and architectural decisions is [`docs/design-system/`](./design-system/README.md) (GATES.md, SPEC.md, TOKENS.md, COMPONENTS.md).

All UI code merged into the codebase must satisfy the automated design system gates verified via:

```bash
npm run check:design-system-contract
npm run check:type-scale
npm run check:icon-scale
```

---

## 2. Blocking Token Rules

### 2.1 Colors & Semantic Palette

- **Tokens Only**: Raw CSS hex codes (e.g. `#007a78`, `#ffffff`), RGB/RGBA, HSL, and un-tokenized Tailwind color classes (e.g. `bg-white`, `text-slate-900`, `border-red-200`) are prohibited in components.
- **Variable Syntax**: All colors must use CSS custom properties defined in `src/app/globals.css` with semantic purpose:
  - **Brand & Clinical Accent**: `var(--clinical-accent)`, `var(--clinical-accent-hover)`, `var(--clinical-accent-soft)`, `var(--clinical-accent-border)`
  - **Surfaces & Borders**: `var(--surface)`, `var(--surface-subtle)`, `var(--surface-wash)`, `var(--surface-lux)`, `var(--border)`, `var(--border-strong)`, `var(--border-lux)`
  - **Text Roles**: `var(--text)`, `var(--text-muted)`, `var(--text-heading)`. `--text-soft` is decoration (`--decoration-soft`), not a text role.
  - **Status & Safety Triads**: `--success-*`, `--warning-*`, `--danger-*`, `--info-*` (reserved exclusively for clinical/system status).
  - **Focus Ring & Outlines**: `var(--focus)` for all keyboard and visible focus rings.
- **Raw Color Exemptions**: Strict and enumerated in `RAW_COLOR_EXEMPTIONS` in `scripts/design-system-contract-utils.mjs` (e.g., globals token definitions, brand mark SVG builder, diagnostic visualizations, OpenGraph art, printable patient/factsheet paper). Medication record accent defaults (`#0f766e` in `src/lib/medications.ts` and `src/lib/medication-records.ts`) are a **scoped** exemption for the Postgres `accent` column default only — not a whole-file blank cheque, and not a mapping onto `--clinical-accent`.

### 2.2 Typography Scale

- **Named Steps Only**: Font sizes must use the registered type steps in `@theme`:
  - `text-3xs` (12px / `0.75rem` — legacy alias of `text-xs` at the clinical legibility floor), `text-2xs` (12px / `0.75rem` — legacy alias of `text-xs` at the clinical legibility floor), `text-xs` (12px — clinical legibility floor), `text-sm` / `text-sm-minus` (13px; v2 `--text-sm` equals `@theme --text-sm-minus` at `0.8125rem`), `text-base-minus` (15px), `text-base` (16px), `text-lg-minus` (17px), `text-lg` (18px), `text-xl` (20px), `text-2xl-minus` (22px), `text-2xl` (24px).
- **Arbitrary Size Prohibited**: `text-[12px]`, `text-[13px]`, etc. are blocked by `npm run check:type-scale --strict`.
- **Declared Steps Usage**: Any type step declared in `@theme` must have production consumers (no dead or unselected type tokens).

### 2.3 Icon Scale

- Glyphs must use the dedicated `--spacing-icon-*` scale: `size-icon-xs` (12px), `size-icon-sm` (14px), `size-icon-md` (16px default), `size-icon-lg` (20px), `size-icon-xl` (24px).
- Enforced strictly by `npm run check:icon-scale --strict`.

### 2.4 Elevation, Edges, & Motion

- **Elevation**: Monotonic numeric scale `var(--e0)` through `var(--e4)`. No raw `box-shadow` values.
- **Edge Ownership**: Prohibits simultaneous `border-*` and `ring-*` styling on the same surface to prevent clipped or competing boundaries.
- **Motion Durations**: Transitions and animations must use standardized duration tokens (`var(--duration-fast)`, `var(--duration-base)`) and respect `motion-reduce:`. Layout-property animation (e.g., width, height, padding) is disallowed except for explicitly audited phone-chrome transitions.

---

## 3. Touch & Tap Target Standards (#265, #321)

### 3.1 Minimum Touch Target Floor (48px)

- **Token**: `--spacing-tap` (48px), mapped to Tailwind classes `min-h-tap`, `min-w-tap`, and `size-tap`.
- **Target Applicability**: All primary and secondary interactive elements (buttons, links, form controls, summary disclosures, tabs, toolbar chips, filmstrip jump buttons) must guarantee a minimum 48px hit area along their primary touch axis.
- **Sub-Floor Prevention**: `interactiveTapFloorDeclarations` in `check:design-system-contract` mechanically scans intrinsic interactive tags (`a`, `button`, `input`, `select`, `summary`, `textarea`) and forbids un-prefixed sub-floor declarations (e.g., `min-h-8`, `min-h-10`).
- **No Downward Reductions**: Legacy `min-h-12` (48px) and `min-h-tap` (48px) must never be reduced to smaller arbitrary heights.

### 3.2 Secondary Navigation & Toolbar Chips (Case Study: #321)

- Secondary navigation items (such as the document figure filmstrip in `src/components/document-viewer/document-image-filmstrip.tsx`) must adhere to both token and touch targets:
  - Enforce `min-h-tap` on chip buttons to allow rapid, error-free mobile and desktop interaction.
  - Implement tokenized focus indicators: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]`.
  - Color styling must reference semantic tokens (`var(--surface)`, `var(--surface-subtle)`, `var(--border)`, `var(--text-muted)`, `var(--clinical-accent)`).

### 3.3 Accessible Unavailable / Disabled States

- Where controls are rendered in an inert or data-unavailable state (e.g., a figure with no recorded PDF page number):
  - Do **not** use the HTML `disabled` attribute if doing so breaks keyboard focusability and hides the reason for unavailability.
  - Use `aria-disabled="true"` with `ignoreUnavailableActivation`.
  - Provide an accessible description via `aria-describedby` linking to a screen-reader explanation (`sr-only` text), e.g., explaining why the action is unavailable.

---

## 4. Verification & Continuous Enforcement

Run the design system validation suite locally before submitting changes:

```bash
# Complete design system gate check (tokens, baselines, adoption, design-sync)
npm run check:design-system-contract

# Strict typography scale validation
npm run check:type-scale

# Strict icon scale validation
npm run check:icon-scale
```
