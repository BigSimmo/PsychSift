# Permanent colour direction

> **Historical colour-direction record.** Start at the [current design-system front door](../design-system/README.md).
> Current authority is `AGENTS.md` → `src/app/ckb-v2-tokens.css` → committed tests →
> `.design-sync/conventions.md` → the v2 document set; `globals.css` is the compatibility layer.
> This record preserves the original direction and palette rationale. It does not override
> current token values or prescribe editing this file before changing the governing source.

_Updated 2026-10-21 — corrected authority routing only; Documentation owns._

## Decision

Adopt **Clinical White / Sky Graphite** as the permanent colour direction.

This is a crisp white, graphite-led interface with a cool clinical blue accent. It replaces the warm cream/porcelain base and demotes green to success-only states.

> **Revised 2026-07-28 — accent moved from Aegean teal `#0B6F86` to Clinical Sky `#1D6FB8`.** The full `--primary-*` ramp was re-derived in both themes rather than swapping the 500 step, so tints, borders and hover states stay coherent; dark now holds the same hue instead of drifting to cyan-green. The direction is otherwise unchanged: white for clarity, graphite for command, one accent for clinical identity. Earlier documents that say "Aegean" describe the same _role_, not the current colour.

## Why this direction wins

The app is a source-backed clinical workspace. It should feel precise, calm, premium, and operational. The interface should not feel like a generic medical brand, a mint healthcare template, or a soft editorial product.

The strongest long-term direction is:

- White for clarity.
- Graphite for command and product weight.
- Clinical Sky blue for clinical evidence and source confidence.
- Green only for completion/success.
- Amber and red only for safety states.

This keeps the app clean and crisp while preserving a clinical identity.

## Final palette

### Light mode

| Role                   | Token                      | Hex       | Purpose                                                              |
| ---------------------- | -------------------------- | --------- | -------------------------------------------------------------------- |
| Canvas                 | `--background`             | `#F1F4F8` | Main app canvas; no cream tint                                       |
| Wash surface           | `--surface-wash`           | `#F1F4F8` | Page floor behind the content planes                                 |
| Rail                   | `--surface-subtle`         | `#F7F9FC` | Sidebar rail, header band, quiet nested areas                        |
| Surface                | `--surface`                | `#FCFDFE` | Cards, menus, answer panels                                          |
| Raised surface         | `--surface-raised`         | `#FFFFFF` | Composer, floating controls — the lightest plane                     |
| Inset surface          | `--surface-inset`          | `#EAEEF4` | Inputs, recessed chips, skeletons                                    |
| Border                 | `--border`                 | `#E3E8EF` | Default hairline                                                     |
| Strong border          | `--border-strong`          | `#C8D2DE` | Active/focused boundaries                                            |
| Text                   | `--text`                   | `#101418` | Body text                                                            |
| Heading                | `--text-heading`           | `#080B0F` | High-emphasis headings                                               |
| Muted text             | `--text-muted`             | `#475467` | Secondary text                                                       |
| Soft text              | `--text-soft`              | `#667085` | Metadata and placeholders                                            |
| Command                | `--command`                | `#111827` | Primary actions and high-emphasis command controls                   |
| Command hover          | `--command-hover`          | `#0B1220` | Hover/pressed command state                                          |
| Clinical accent        | `--clinical-accent`        | `#1D6FB8` | Evidence, selected mode, source confidence, send action              |
| Clinical accent hover  | `--clinical-accent-hover`  | `#185C99` | Hover/pressed clinical action                                        |
| Clinical accent active | `--clinical-accent-active` | `#14507F` | Settled `:active` state — never below the resting baseline           |
| Clinical accent strong | `--clinical-accent-strong` | `#185C99` | High-contrast accent text on neutral surfaces                        |
| Clinical accent soft   | `--clinical-accent-soft`   | `#EFF5FC` | Small evidence chips and icon tiles only                             |
| Clinical accent border | `--clinical-accent-border` | `#C6DCF2` | Selected/evidence borders                                            |
| Info                   | `--info`                   | `#1C4FBF` | Document/search information where clinical confidence is not implied |
| Success                | `--success`                | `#0C6B41` | Ready, complete, connected, passed                                   |
| Warning                | `--warning`                | `#8A4D05` | Setup, caution, review required                                      |
| Danger                 | `--danger`                 | `#A3190F` | Critical/safety states                                               |

Every status `-text` step clears 5.5:1 on its own background, and danger is clearly the highest of the four. They previously sat bunched in one 4.6–5.2:1 band, so nothing read as more urgent than anything else. Nothing else in the system is allowed to out-shout them — the categorical `--type-*` and `--tone-*` anchors are chroma-capped below the calmest status colour.

### Dark mode

Keep the black-polish direction and pair it with a brighter version of the same blue — not a different hue.

| Role                   | Token                      | Hex       |
| ---------------------- | -------------------------- | --------- |
| Canvas                 | `--background`             | `#060708` |
| Wash surface           | `--surface-wash`           | `#0A0C0E` |
| Subtle surface         | `--surface-subtle`         | `#0D0F11` |
| Surface                | `--surface`                | `#101315` |
| Raised surface         | `--surface-raised`         | `#171B1E` |
| Inset surface          | `--surface-inset`          | `#08090B` |
| Border                 | `--border`                 | `#2B3136` |
| Strong border          | `--border-strong`          | `#3B444B` |
| Text                   | `--text`                   | `#F4F6F8` |
| Muted text             | `--text-muted`             | `#A4ADB7` |
| Clinical accent        | `--clinical-accent`        | `#74BDF0` |
| Clinical accent strong | `--clinical-accent-strong` | `#A9D8F8` |
| Clinical accent soft   | `--clinical-accent-soft`   | `#123556` |
| Success                | `--success`                | `#7DE0A3` |
| Warning                | `--warning`                | `#F2C45A` |
| Danger                 | `--danger`                 | `#FF9CA4` |

Dark status colours stay hot on purpose: they must clearly outrank the muted `--type-*` identity set.

### Surfaces are an ordered scale

In both themes the planes sort in one direction and must keep sorting that way:

`--surface-inset` < `--surface-wash` < `--surface-subtle` < `--surface` < `--surface-raised`

`--surface-raised` is the lightest plane in light mode. If it is ever darker than `--surface`, raised cards read as recesses.

### Elevation is a numbered ladder

Shadows are `--e0` … `--e4` — one monotonic sequence that sorts by name, hue-tinted rather than flat grey, with negative spread so a shadow pulls inward instead of bleeding.

| Tier   | Use                     |
| ------ | ----------------------- |
| `--e0` | Flush                   |
| `--e1` | Resting hairline        |
| `--e2` | Cards, popovers         |
| `--e3` | Hover, lifted chrome    |
| `--e4` | Modals, sheets, drawers |

The remaining role names are aliases onto tiers, not independent values: `--shadow-card` / `--shadow-soft` → `--e2`; `--shadow-hover` → `--e3`; `--shadow-elevated` / `--shadow-lux` → `--e4`. Dark lifts with a top highlight rather than more black. Reach for a tier; never hand-roll a `shadow-[0_…]`.

## Role contract

Do not map every important UI element to the same accent colour.

```css
--command: #111827;
--command-hover: #0b1220;

--clinical-accent: #1d6fb8;
--clinical-accent-hover: #185c99;
--clinical-accent-active: #14507f;
--clinical-accent-soft: #eff5fc;
--clinical-accent-border: #c6dcf2;

--success: #0c6b41;
```

Mapping:

- Primary command buttons: `--command`
- Sidebar `New chat`: `--command`
- Selected mode icon: `--clinical-accent`
- Send button: `--clinical-accent`
- Evidence/source state: `--clinical-accent`
- Small evidence chip/icon backgrounds: `--clinical-accent-soft`
- Ready/complete/connected/passed: `--success`
- Document/search metadata: `--info`
- Warnings: `--warning`
- Critical states: `--danger`

## Element decisions

### Sidebar

- Background: rail `#F7F8FA`.
- Brand tile: small clinical accent icon on soft accent.
- `New chat`: graphite command button.
- Active item: white card with a 2px clinical accent rail.
- Tool icons: neutral by default, clinical accent only when active or clinically meaningful.

### Header

- Header material: white or near-white glass, low shadow, nickel border.
- Mode button: neutral white surface with a small clinical accent icon.
- Header action buttons: neutral/graphite, not green.
- Do not use broad accent backgrounds in the header.

### Composer

- White floating capsule.
- Nickel border.
- Graphite text.
- Soft graphite shadow.
- Send button uses clinical accent.
- Remove green glow and broad teal gradients.

### Empty state

- White canvas.
- Graphite heading.
- Neutral starter cards.
- Accent appears only in icons or a 2px focus rail.
- No washed green/mint cards.

### Evidence and sources

- Evidence-backed answer panels use a 2px clinical accent rail.
- Evidence chips can use clinical accent soft.
- Source readiness that means "success" uses success green, not clinical accent.

### Status colours

- Green is only success.
- Amber is only caution/setup/review.
- Red is only critical/safety.
- Blue is information/document/search.

## Contrast check

Spot checks against the final palette:

| Pair                           | Ratio   |
| ------------------------------ | ------- |
| Ink on white                   | 18.50:1 |
| Muted on white                 | 7.69:1  |
| Soft on white                  | 4.97:1  |
| White on graphite              | 17.74:1 |
| Clinical accent on white       | 5.78:1  |
| Clinical accent on soft accent | 5.21:1  |
| Success on white               | 5.38:1  |
| Warning on white               | 5.19:1  |
| Danger on white                | 6.57:1  |
| Dark text on dark canvas       | 18.75:1 |
| Dark accent on dark surface    | 9.96:1  |

## Rejected directions

### Warm porcelain

Rejected because it still reads cream/ivory and softens the app too much.

### Green clinical

Rejected because it feels generic healthcare and gives the same colour too many meanings.

### Blue corporate SaaS

Rejected because it loses the clinical/source-backed identity and feels less distinctive.

### Pure monochrome

Rejected because the app still needs a visible evidence/source signal.

## Original implementation order (historical)

This sequence describes the original compatibility-layer rollout. Use the current
design-system hierarchy linked above for any new token or component change.

1. Add command and clinical accent tokens to `src/app/globals.css`.
2. Replace the light root palette with the final crisp white values.
3. Keep existing `--primary` temporarily mapped to command for backwards compatibility.
4. Move evidence/source styles from `--primary` to `--clinical-accent`.
5. Update sidebar/header/composer/empty-state hooks.
6. Verify light desktop, light mobile, dark desktop, and generated-answer states.

## Original palette summary

The app should read as **white, graphite, and precise blue-teal**. Green should only appear when the system is saying something has succeeded.
