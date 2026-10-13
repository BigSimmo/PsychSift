# PsychSift — build conventions

> The system of record is `docs/design-system/` (SPEC · TOKENS · COMPONENTS · DECISIONS ·
> GATES). This file is the designer-facing build idiom; where it disagrees with that set,
> treat the disagreement as a defect here and follow the set. New code uses the `--e0`…
> `--e4` tiers directly; the remaining `--shadow-*` roles are legacy-compat aliases
> documented in `docs/design-system/TOKENS.md` §6.

## Setup

No provider is required — every component renders standalone. Styling comes
entirely from `styles.css` (compiled Tailwind v4 + design tokens): make sure it
is loaded. Fonts are Geist (UI) and Geist Mono (codes/numbers), shipped in the
bundle; body text inherits `var(--font-sans)` from the stylesheet.

## Styling idiom

Tailwind utility classes, with **all colour/shadow through CSS variables** in
arbitrary-value form — never hardcoded colours:

- Text: `text-[color:var(--text)]`, `--text-heading`, `--text-muted`, `--text-soft`
- Surfaces: `bg-[color:var(--surface)]`, `--surface-raised`, `--surface-inset`, `--surface-subtle`, `--surface-lux`, `--surface-wash`
- Borders: `border-[color:var(--border)]`, `--border-strong`, `--border-lux`
- Accent (primary action colour): `--clinical-accent`, `--clinical-accent-hover`, `--clinical-accent-active`, `--clinical-accent-soft`, `--clinical-accent-border`, `--clinical-accent-contrast`
- Command (primary buttons): `--command`, `--command-hover`, `--command-contrast`
- Status: `success`, `warning`, `info` and `danger` each define
  `-text`, `-bg`, `-border`, `-soft` (e.g. `--success-text`, `--warning-soft`).
  The solid pair `--danger-solid` / `--danger-solid-contrast` exists for
  `danger` only — there is no `--success-solid`, `--warning-solid` or
  `--info-solid`. For a filled non-danger status use `-bg` + `-text`.
- Elevation: the `--e0` … `--e4` ladder — `shadow-[var(--e2)]`, `hover:shadow-[var(--e3)]`.
  `--e0` flush · `--e1` resting hairline · `--e2` cards/popovers · `--e3` hover/lifted chrome ·
  `--e4` modals/sheets/drawers. The remaining role names are aliases onto tiers:
  `--shadow-card`/`--shadow-soft`→`--e2`, `--shadow-hover`→`--e3`,
  `--shadow-elevated`/`--shadow-lux`→`--e4`. `--shadow-inset` stays bespoke.
  Never hand-roll a `shadow-[0_…]` literal.
- Focus ring: `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]`.
  Outline only — never add a companion `focus:ring-*` / `box-shadow`. The shared base rule is one
  focus owner by design; a second ring both stacks a halo and wipes the control's resting elevation.

Radius rules: `rounded-sm` chips/pills, `rounded-md` controls/inputs/buttons,
`rounded-lg` cards/table cards/popovers, `rounded-xl` panels/answer card, `rounded-2xl`
sheets/dialogs. Tap targets: `min-h-tap` / `h-tap w-tap` (48px) —
interactive controls only. A static chip is 28px text, not a touch target;
putting `min-h-tap` on one is why dense tables scrolled so much.
Dark mode is automatic via the `.dark` class — the variables flip; never write
`dark:` colour overrides yourself.

## Colour boundaries

Three layers, and they do not borrow from each other:

1. **Clinical state** — `success` / `warning` / `danger`. Reserved for currency,
   validation and safety. Never decorative. Amber and red appear only in
   `SourceStatusBadge`, `InlineNotice`, `ConfirmDialog`, the extraction-quality
   row, and a `DoseLine` row whose cited source is overdue.
2. **Information** — `info` plus the accent. Neutral emphasis, not a verdict.
3. **Identity** — the muted `--type-*` hues that tell record kinds apart.

`--command` is the one filled action colour, and a surface carries at most one
filled `--command` button. `--danger-solid` has exactly one home: the `danger`
variant of `Button`, i.e. a destructive confirmation. Importance is `primary`.

`--text-soft` is around 3.2:1 on white — decoration only (dots, dividers,
glyphs). Label and caption **text** uses `--text-muted`.

## Opt-in v2 token layer

`.ckb-v2` is an opt-in class that swaps in the v2 shell: white surfaces, a dark slate
`--command` (`#111827`), a crisper `--e1`…`--e4` ladder, a 7-step type scale (size steps with
shared `--leading-prose`; hero companions `--text-hero--line-height` /
`--text-hero-tr` only — no per-step leading or tracking), semantic spacing
(`--gap-*`, `--pad-*`), density (`--tap-min`, `--chip-height`, `--row-*`), icon
sizes (`--icon-*`) and motion durations. Production puts `ckb-v2` on `<html>`
(`src/app/layout.tsx`); subtree opt-in is no longer the production model.
Components that reference v2-only tokens carry a v1 fallback
(`var(--pad-panel,1.5rem)`) so they render correctly either way.

## Class-string vocabulary (exported constants)

The bundle exports ready-made class strings — compose them instead of
re-deriving surfaces: `panel`, `panelSubtle`, `raisedCard`, `sourceCard`,
`answerSurface`, `primaryControl`, `floatingControl`, `toolbarButton`,
`navPill`, `metadataPill`, `subtleStatusPill`, `shellChip`, `fieldLabel`,
`fieldControl`, `fieldControlWithIcon`, `fieldControlPlain`, `fieldIcon`,
`eyebrowText`, `textMuted`, `proseMeasure`, `codeText`, `iconTilePremium`,
`clinicalDivider`, `tableCard`, `tableCardHeader`, `controlBase` (the shared
control shell the button recipes build on — prefer `primaryControl` /
`floatingControl` / `toolbarButton` unless composing a new control), plus the
chat/search composer and tone recipes documented in
`docs/redesign/09-ui-primitives-recipes.md`. Join with the exported `cn(...)`
helper.

Prefer a component over a recipe where one now exists. `Button` supersedes
hand-composing `primaryControl` / `floatingControl` / `toolbarButton` on a raw
`<button>`; `TextField` / `SearchField` supersede hand-wiring `fieldLabel` +
`fieldControl*` + `aria-describedby`; `Chip` supersedes `metadataPill` /
`subtleStatusPill` for filter and status chips; `AnswerCard` supersedes
`answerSurface`, which was only `rounded-lg bg-transparent`.

Module-private helpers (`insetCard`, `iconTile`, `compactMetadataRow`,
`toneWarningQuiet`, `statusDotBase`, `chatComposerShellDelta`)
power components inside `ui-primitives.tsx` and are **not** part of the import
surface — use the exported components (`LoadingPanel`, `PanelHeading`,
`SourceProvenance`, `SourceStatusBadge`, …) or the exported recipes above.

## Example

```tsx
import { PanelHeading, panelSubtle, primaryControl, cn, FileText } from "<pkg>";

<section className={cn(panelSubtle, "p-4 space-y-3")}>
  <PanelHeading icon={FileText} title="Document library" description="Indexed guidelines and protocols." />
  <button className={primaryControl}>Upload document</button>
</section>;
```

## Icons

The bundle ships a curated lucide icon set — import icons from the package
itself, never from `lucide-react` (it is not available to designs): `Search`,
`SearchX`, `FileText`, `File`, `Inbox`, `Upload`, `Download`, `ShieldCheck`,
`ShieldAlert`, `TriangleAlert`, `AlertCircle`, `Ban`, `X`, `Check`,
`CheckCircle2`, `Info`, `Loader2`, `ChevronDown`, `ChevronRight`, `ArrowLeft`,
`ArrowRight`, `Plus`, `Trash2`, `Pencil`, `Filter`, `Settings`, `Database`,
`BookOpen`, `Stethoscope`, `HeartPulse`, `Pill`, `Calendar`, `Clock`,
`ExternalLink`, `Copy`, `Maximize2`. The `icon` prop on `PanelHeading` /
`EmptyState` is optional — omit it rather than inventing an icon.

## Where the truth lives

Read `styles.css` for the full token set (`:root` and `.dark` blocks) and each
component's `.d.ts` + `.prompt.md` for its API.
