import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Info } from "lucide-react";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { AnswerFooter, DoseLine } from "@/components/ui/answer-card";
import { Button } from "@/components/ui/button";
import { Citation, CitationList } from "@/components/ui/citation";
import { Chip, ChoiceChip } from "@/components/ui/chip";
import { Checkbox, RadioGroup } from "@/components/ui/choice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Disclosure, DisclosureGroup, disclosureBodyText } from "@/components/ui/disclosure";
import { DownloadLink, ExternalTextLink, LinkAction, TextLink, type LinkActionProps } from "@/components/ui/link";
import { OverlayPortal, OverlayRoot } from "@/components/ui/overlay-root";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Progress, StageList } from "@/components/ui/progress";
import { StatusMark, type DocumentStatus } from "@/components/ui/status-mark";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { SearchField, TextField } from "@/components/ui/text-field";
import type { ClinicalSourceMetadata } from "@/lib/types";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";

describe("Button", () => {
  it("folds the busy contract in: disabled, announced, and relabelled", () => {
    render(
      <Button variant="primary" busy busyLabel="Reindexing…">
        Reindex
      </Button>,
    );

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Reindexing…");
  });

  it("defaults to type=button so it cannot submit a surrounding form by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("uses semantic danger hover and active tokens without brightness filters", () => {
    render(<Button variant="danger">Delete source</Button>);
    const classes = screen.getByRole("button").className;
    expect(classes).toContain("--danger-solid-hover");
    expect(classes).toContain("--danger-solid-active");
    expect(classes).not.toContain("brightness-");
  });
});

describe("TextField / SearchField", () => {
  it("wires hint text through aria-describedby", () => {
    render(<TextField label="Publisher" hint="As printed on the source." />);

    // Only required fields carry a marker in the label text, so an optional
    // field's accessible name stays "Publisher".
    const input = screen.getByLabelText(/Publisher/);
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent("As printed on the source.");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("keeps the hint alongside the error and marks the field invalid", () => {
    // Flipped with the PR 13 fold. The old shell swapped the hint out for the
    // error, which took away the statement of the correct format at exactly the
    // moment the user got the format wrong. Folding onto `FormField` keeps both.
    render(<TextField label="Review date" hint="DD/MM/YYYY" error="That date does not exist." />);

    const input = screen.getByLabelText(/Review date/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    const ids = (input.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0] as string)).toHaveTextContent("DD/MM/YYYY");
    expect(document.getElementById(ids[1] as string)).toHaveTextContent("That date does not exist.");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("merges a caller's aria-describedby ahead of its own hint", () => {
    render(
      <>
        <p id="publisher-note">As it appears on the cover.</p>
        <TextField label="Publisher" aria-describedby="publisher-note" hint="As printed on the source." />
      </>,
    );

    const ids = (screen.getByLabelText(/Publisher/).getAttribute("aria-describedby") ?? "").split(" ");
    expect(ids[0]).toBe("publisher-note");
    expect(ids).toHaveLength(2);
  });

  it("honours an externally supplied id so an error summary can link to the field", () => {
    render(<TextField id="publisher" label="Publisher" />);
    expect(screen.getByLabelText(/Publisher/)).toHaveAttribute("id", "publisher");
  });

  it("reaches the input with a caller ref after the fold onto FormField", () => {
    // The fold moved the input inside a render-prop child, so `ref` now travels
    // through the props spread rather than sitting on the component's own
    // element. The settings email field focuses itself through exactly this ref,
    // and a dropped ref is invisible in a diff and in a typecheck.
    const ref = createRef<HTMLInputElement>();
    render(<TextField label="Publisher" ref={ref} />);

    expect(ref.current).toBe(screen.getByLabelText(/Publisher/));
    ref.current?.focus();
    expect(document.activeElement).toBe(screen.getByLabelText(/Publisher/));
  });

  it("only offers the clear control once the search field has a value", async () => {
    const onClear = vi.fn();
    const { rerender } = render(<SearchField label="Search sources" value="" onClear={onClear} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();

    rerender(<SearchField label="Search sources" value="clozapine" onClear={onClear} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});

describe("Chip", () => {
  it("gives each remove control its own label rather than a row of identical ones", async () => {
    const onRemove = vi.fn();
    render(
      <>
        <Chip onRemove={onRemove} removeLabel="Remove WA">
          WA
        </Chip>
        <Chip onRemove={onRemove} removeLabel="Remove Current only">
          Current only
        </Chip>
      </>,
    );

    expect(screen.getByRole("button", { name: "Remove WA" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove Current only" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("pins compact to 24px/11px and standard to 28px/12px while the remove target stays inside the chip", () => {
    render(
      <>
        <Chip
          size="compact"
          appearance={{ kind: "category", tone: "source" }}
          onRemove={() => {}}
          removeLabel="Remove source"
        >
          Source
        </Chip>
        <Chip size="standard">Long standard content</Chip>
      </>,
    );

    const [compact, standard] = screen.getAllByTestId("chip");
    expect(compact).toHaveAttribute("data-size", "compact");
    expect(compact).toHaveAttribute("data-appearance", "category");
    expect(compact).toHaveAttribute("data-wrap", "false");
    expect(compact).toHaveClass("h-6", "text-2xs");
    expect(compact).not.toHaveClass("min-h-6");
    expect(standard).toHaveAttribute("data-size", "standard");
    expect(standard).toHaveClass("h-7", "text-xs");
    expect(standard).not.toHaveClass("min-h-7");
    expect(within(standard).getByText("Long standard content")).toHaveClass("max-h-full", "overflow-hidden");
    const remove = screen.getByRole("button", { name: "Remove source" });
    expect(remove).toHaveClass("min-h-tap", "w-8");
    expect(remove).not.toHaveClass("h-tap", "w-tap", "max-w-full");
  });

  it("opts into wrapping for long clinical tag phrases without changing default density", () => {
    render(
      <Chip size="standard" wrap>
        Persistent depressive disorder with anxious distress
      </Chip>,
    );

    const chip = screen.getByTestId("chip");
    expect(chip).toHaveAttribute("data-wrap", "true");
    expect(chip).toHaveClass("min-h-7");
    expect(chip).not.toHaveClass("h-7");
    expect(within(chip).getByText("Persistent depressive disorder with anxious distress")).toHaveClass(
      "whitespace-normal",
      "break-words",
    );
  });

  it("keeps the remove control tappable when a wrapping tag has no fixed height", () => {
    render(
      <Chip
        size="standard"
        wrap
        onRemove={() => {}}
        removeLabel="Remove persistent depressive disorder with anxious distress"
      >
        Persistent depressive disorder with anxious distress
      </Chip>,
    );

    const chip = screen.getByTestId("chip");
    const track = chip.querySelector("span.relative");
    expect(track).toHaveClass("min-h-5", "self-stretch");
    expect(track).not.toHaveClass("h-full");
    const remove = screen.getByRole("button", {
      name: "Remove persistent depressive disorder with anxious distress",
    });
    expect(remove).toHaveClass("min-h-tap", "w-8");
    expect(remove).not.toHaveClass("max-w-full");
  });
});

describe("ChoiceChip", () => {
  it("exposes pressed state and reports the requested next state", async () => {
    const onPressedChange = vi.fn();
    const { rerender } = render(
      <ChoiceChip pressed={false} onPressedChange={onPressedChange} testId="allergy-chip">
        Penicillin
      </ChoiceChip>,
    );

    const chip = screen.getByRole("button", { name: "Penicillin" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveClass("min-h-tap", "rounded-lg");
    expect(chip).toHaveAttribute("data-choice-chip", "true");
    expect(chip).not.toHaveClass("border", "shadow-[var(--shadow-inset)]");
    const surface = chip.querySelector("[data-choice-chip-surface='true']");
    expect(surface).toHaveClass(
      "absolute",
      "inset-1",
      "z-0",
      "border",
      "shadow-[var(--shadow-inset)]",
      "group-hover:border-[color:var(--border-strong)]",
      "group-hover:bg-[color:var(--surface-subtle)]",
    );
    expect(chip.querySelector("[data-choice-chip-content='true']")).toHaveClass("relative", "z-[var(--z-raised)]");
    await userEvent.click(chip);
    expect(onPressedChange).toHaveBeenCalledWith(true);

    rerender(
      <ChoiceChip pressed onPressedChange={onPressedChange} testId="allergy-chip">
        Penicillin
      </ChoiceChip>,
    );
    expect(screen.getByRole("button", { name: "Penicillin" })).not.toHaveClass("ring-1");
  });

  it("keeps an explained dead end focusable without activating it", async () => {
    const onPressedChange = vi.fn();
    render(
      <>
        <p id="no-matches">No matches with your current filters.</p>
        <ChoiceChip pressed={false} onPressedChange={onPressedChange} ariaDisabled ariaDescribedBy="no-matches">
          Archived
        </ChoiceChip>
      </>,
    );

    const chip = screen.getByRole("button", { name: "Archived" });
    expect(chip).toHaveAttribute("aria-disabled", "true");
    expect(chip).not.toBeDisabled();
    await userEvent.click(chip);
    expect(onPressedChange).not.toHaveBeenCalled();
  });

  it("keeps an explained dead end focusable when both disabled inputs are set", async () => {
    const onPressedChange = vi.fn();
    render(
      <ChoiceChip disabled ariaDisabled pressed={false} onPressedChange={onPressedChange}>
        Unavailable
      </ChoiceChip>,
    );

    const chip = screen.getByRole("button", { name: "Unavailable" });
    expect(chip).toHaveAttribute("aria-disabled", "true");
    expect(chip).not.toBeDisabled();
    await userEvent.click(chip);
    expect(onPressedChange).not.toHaveBeenCalled();
  });

  it("stops an explained dead end from activating a clickable ancestor", async () => {
    const onPressedChange = vi.fn();
    const onAncestorClick = vi.fn();
    render(
      <div onClick={onAncestorClick}>
        <ChoiceChip ariaDisabled pressed={false} onPressedChange={onPressedChange}>
          Unavailable
        </ChoiceChip>
      </div>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Unavailable" }));
    expect(onPressedChange).not.toHaveBeenCalled();
    expect(onAncestorClick).not.toHaveBeenCalled();
  });
});

describe("Citation", () => {
  it("activates when interactive and named", async () => {
    const onActivate = vi.fn();
    render(<Citation index={1} label="RANZCP" locator="p. 12" onActivate={onActivate} />);
    await userEvent.click(screen.getByRole("button", { name: /Source 1, RANZCP/ }));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("renders a static mark when interactive is false", () => {
    render(<Citation index={2} label="NICE" interactive={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("citation")).toHaveTextContent(/NICE/);
  });

  it("gives the static citation a real accessible name instead of an ignored aria-label", () => {
    // `aria-label` on a role-less <span> is dropped by assistive technology, so
    // the static/print citation used to lose both the "Source N" framing and the
    // currency phrase — `StatusMark` is aria-hidden and contributes nothing.
    render(<Citation index={7} label="NICE CG90" locator="p. 22" status="outdated" interactive={false} />);

    const chip = screen.getByTestId("citation");
    expect(chip).not.toHaveAttribute("aria-label");
    expect(chip).toHaveTextContent("Source 7, NICE CG90, p. 22, outdated source");
  });

  it("announces the static and interactive citations identically", () => {
    const { unmount } = render(
      <Citation index={3} label="RANZCP" locator="p. 12" status="review_due" interactive onActivate={() => {}} />,
    );
    const interactiveName = screen.getByRole("button").getAttribute("aria-label");
    unmount();

    render(<Citation index={3} label="RANZCP" locator="p. 12" status="review_due" interactive={false} />);
    // The visible face is hidden from the tree, so the sr-only phrase is the
    // whole accessible text and must match the button's name exactly.
    expect(screen.getByTestId("citation")).toHaveTextContent(String(interactiveName));
  });

  it("keeps list identity stable when citations reorder", () => {
    const first = {
      id: "source-ranzcp-12",
      citation: <Citation index={1} label="RANZCP" locator="p. 12" interactive={false} />,
    };
    const second = {
      id: "source-nice-4",
      citation: <Citation index={2} label="NICE" locator="p. 4" interactive={false} />,
    };
    const { rerender } = render(<CitationList citations={[first, second]} />);

    rerender(<CitationList citations={[second, first]} />);

    expect(screen.getAllByRole("listitem").map((item) => item.dataset.citationId)).toEqual([
      "source-nice-4",
      "source-ranzcp-12",
    ]);
  });
});

describe("Disclosure / Progress", () => {
  it("uses the contextual disclosure heading level", () => {
    render(
      <Disclosure title="Monitoring" headingLevel={4}>
        Review ECG and electrolytes.
      </Disclosure>,
    );
    expect(screen.getByRole("heading", { level: 4, name: "Monitoring" })).toBeVisible();
  });

  it("keeps description as a visual preview outside the accessible name", async () => {
    const user = userEvent.setup();
    render(
      <Disclosure
        title="Does not authorise"
        description="Treatment, detention, transport, restraint, seclusion or force by itself."
        headingLevel={4}
      >
        Treatment, detention, transport, restraint, seclusion or force by itself.
      </Disclosure>,
    );

    const description = "Treatment, detention, transport, restraint, seclusion or force by itself.";

    const trigger = screen.getByRole("button", { name: "Does not authorise" });
    expect(trigger).toHaveAccessibleName("Does not authorise");
    expect(within(trigger).getByText(description)).toBeVisible();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panelId = trigger.getAttribute("aria-controls");
    expect(panelId).toEqual(expect.any(String));
    if (!panelId) return;
    const panel = document.getElementById(panelId);
    expect(panel).toBeTruthy();
    if (!panel) return;
    expect(
      within(panel).getByText("Treatment, detention, transport, restraint, seclusion or force by itself."),
    ).toBeVisible();
  });

  it("keeps a leading icon out of the accessible name and out of the title's truncate box", () => {
    render(
      <Disclosure title="Pre-use checks" icon={<svg data-testid="row-glyph" />} headingLevel={4}>
        Confirm the linked authority.
      </Disclosure>,
    );

    const trigger = screen.getByRole("button", { name: "Pre-use checks" });
    // The glyph renders inside the trigger but contributes no accessible name: the
    // row is named by its label alone, as it was when the tile lived in `title`.
    expect(within(trigger).getByTestId("row-glyph")).toBeInTheDocument();
    expect(trigger).toHaveAccessibleName("Pre-use checks");

    // The tile is a sibling of the title, not a child of it. Nested inside the
    // title's `truncate` box it was clipped along with a long label.
    const tile = trigger.querySelector('[data-testid="row-glyph"]')?.parentElement;
    expect(tile).toHaveAttribute("aria-hidden", "true");
    expect(tile?.className).toContain("size-disclosure-icon");
    expect(tile?.parentElement).toBe(trigger);
  });

  it("sets an extended preview in the panel's own type so opening a row cannot re-size it", () => {
    const { rerender } = render(
      <Disclosure title="Does not authorise" description="Psychiatric treatment." extendDescription headingLevel={4}>
        <p className={disclosureBodyText}>Psychiatric treatment.</p>
      </Disclosure>,
    );

    const preview = () => screen.getByRole("button").querySelector('span[aria-hidden="true"]');
    for (const token of disclosureBodyText.split(" ")) {
      expect(preview()?.className, `extended preview must carry ${token}`).toContain(token);
    }

    // A description that is merely a subtitle is NOT the body, so it keeps the
    // quieter treatment the on-call, medication and provenance rows rely on.
    rerender(
      <Disclosure title="Referral" description="After hours only." headingLevel={4}>
        <p>Body copy.</p>
      </Disclosure>,
    );
    expect(preview()?.className).toContain("text-xs");
    expect(preview()?.className).not.toContain("text-sm");
  });

  it("draws a list group as one bordered container with flush rows", () => {
    const items = [
      { id: "a", title: "Purpose", content: <p>Convey a person.</p> },
      { id: "b", title: "Authorises", content: <p>Transport.</p> },
    ];

    const { rerender } = render(<DisclosureGroup variant="list" items={items} />);
    const group = screen.getByTestId("disclosure-group");
    expect(group.className).toContain("divide-y");
    expect(group.className).toContain("border");
    // The container owns the edge — SPEC 4.7, one edge owner — so no row draws a
    // second border inside it.
    for (const row of screen.getAllByTestId("disclosure")) {
      expect(row).toHaveAttribute("data-surface", "flush");
      expect(row.className).not.toContain("rounded-lg");
      expect(row.className).not.toContain("border");
    }

    // The default is unchanged, so the three existing consumers do not move.
    rerender(<DisclosureGroup items={items} />);
    expect(screen.getByTestId("disclosure-group").className).toContain("gap-2");
    for (const row of screen.getAllByTestId("disclosure")) {
      expect(row).toHaveAttribute("data-surface", "card");
      expect(row.className).toContain("border");
    }
  });

  it("animates determinate progress with scaleX rather than width", () => {
    render(<Progress value={42} label="Indexing" />);
    const fill = screen.getByTestId("progress-fill");
    expect(fill).toHaveStyle({ transform: "scaleX(0.42)", transformOrigin: "left" });
    expect(fill.style.width).toBe("");
  });
});

describe("SegmentedControl", () => {
  const options = [
    { value: "brief", label: "Brief" },
    { value: "standard", label: "Standard", disabled: true },
    { value: "comprehensive", label: "Comprehensive" },
  ] as const;

  function Harness() {
    const [value, setValue] = useState("brief");
    return <SegmentedControl label="Answer style" value={value} onChange={setValue} options={options} layout="equal" />;
  }

  it("roves one radio through enabled options with wrap and disabled skipping", async () => {
    render(<Harness />);
    const radios = screen.getAllByRole("radio");
    expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
    radios[0].focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Comprehensive" })).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Brief" })).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("radio", { name: "Comprehensive" })).toHaveFocus();
  });

  // `disabled` and `deadEnd` are different states and must not converge.
  // `disabled` is "not on offer" and leaves the keyboard path; `deadEnd` is
  // "your own narrowing emptied this", and docs/filter-contract.md section 3
  // requires it to stay reachable so it can say so.
  it("keeps a dead end on the arrow path, withholding only selection", async () => {
    function DeadEndHarness() {
      const [value, setValue] = useState("all");
      return (
        <SegmentedControl
          label="Source locality"
          value={value}
          onChange={setValue}
          options={[
            { value: "all", label: "Any locality", hint: "3 loaded sources", hintLabel: "3" },
            { value: "local", label: "Local", hint: "0 loaded sources", hintLabel: "0", deadEnd: true },
            { value: "non_local", label: "Non-local", hint: "3 loaded sources", hintLabel: "3" },
          ]}
          layout="fit"
        />
      );
    }
    render(<DeadEndHarness />);

    const dead = screen.getByRole("radio", { name: /^Local/ });
    expect(dead).toHaveAttribute("aria-disabled", "true");
    // Never the native attribute: that would take it out of the tab order.
    expect(dead).not.toBeDisabled();
    expect(dead).toHaveAccessibleDescription("Not selectable from here.");

    // Arrowing onto it moves focus so the description is announced, but must
    // not commit it — nor silently commit the option before it.
    screen.getByRole("radio", { name: /^Any locality/ }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(dead).toHaveFocus();
    expect(dead).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: /^Any locality/ })).toHaveAttribute("aria-checked", "true");

    // Clicking it is guarded too.
    await userEvent.click(dead);
    expect(screen.getByRole("radio", { name: /^Any locality/ })).toHaveAttribute("aria-checked", "true");
  });

  // The count is split: the unit is announced, the short form is displayed.
  it("announces the hint with its unit while displaying only hintLabel", () => {
    render(
      <SegmentedControl
        label="Source locality"
        value="all"
        onChange={() => undefined}
        options={[{ value: "all", label: "Any locality", hint: "3 loaded sources", hintLabel: "3" }]}
        layout="fit"
      />,
    );
    const option = screen.getByRole("radio", { name: "Any locality (3 loaded sources)" });
    expect(option).toHaveTextContent(/^Any locality3$/);
  });

  // The one-of-N rails this control replaces across the modes all carry a count.
  // Baking it into `label` would fold the number into the truncating span, so it
  // gets its own slot — and it must reach the accessible name, or a screen
  // reader user loses information a sighted user has.
  it("renders an option hint and folds it into the accessible name", () => {
    render(
      <SegmentedControl
        label="Result type"
        value="all"
        onChange={() => undefined}
        options={[
          { value: "all", label: "All", hint: "62" },
          { value: "presentation", label: "Presentations", hint: "41" },
        ]}
        layout="fit"
      />,
    );

    expect(screen.getByRole("radio", { name: "All (62)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Presentations (41)" })).toBeInTheDocument();
  });

  it("keeps a live count opaque and reserves a stable three-digit column", () => {
    const renderControl = (hint: string) => (
      <SegmentedControl
        label="Result type"
        value="all"
        onChange={() => undefined}
        options={[{ value: "all", label: "All", hint }]}
        layout="fit"
      />
    );
    const { rerender } = render(renderControl("9"));

    const initialRadio = screen.getByRole("radio", { name: "All (9)" });
    const initialHint = within(initialRadio).getByText("9");
    expect(initialHint).toHaveClass("min-w-6", "text-right", "tabular-nums");
    expect(initialHint).not.toHaveClass("opacity-80");
    expect(initialHint.className).not.toContain("--text-soft");
    const initialRadioClasses = initialRadio.className;

    rerender(renderControl("100"));

    const updatedRadio = screen.getByRole("radio", { name: "All (100)" });
    expect(updatedRadio.className).toBe(initialRadioClasses);
    expect(within(updatedRadio).getByText("100")).toHaveClass("min-w-6", "text-right", "tabular-nums");
  });

  // A hintless option must not gain stray whitespace or an empty span — the
  // existing call sites pass no hint and their names must not drift.
  it("leaves an option without a hint unchanged", () => {
    render(
      <SegmentedControl
        label="Result type"
        value="all"
        onChange={() => undefined}
        options={[{ value: "all", label: "All" }]}
        layout="fit"
      />,
    );

    expect(screen.getByRole("radio", { name: "All" })).toBeInTheDocument();
  });

  it("points the group, not each radio, at the region it filters", () => {
    render(
      <SegmentedControl
        label="Filter by tool category"
        value="all"
        onChange={() => undefined}
        options={[
          { value: "all", label: "All" },
          { value: "assess", label: "Assess" },
        ]}
        ariaControls="launcher-results-panel"
      />,
    );

    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-controls", "launcher-results-panel");
    // The radios are options of the control, not separate controllers of the
    // panel — the launcher's old rail put aria-controls on all six buttons.
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toHaveAttribute("aria-controls");
    }
  });

  it("omits aria-controls entirely when the rail governs no separate region", () => {
    render(
      <SegmentedControl
        label="Result type"
        value="all"
        onChange={() => undefined}
        options={[{ value: "all", label: "All" }]}
      />,
    );

    expect(screen.getByRole("radiogroup")).not.toHaveAttribute("aria-controls");
  });

  it("keeps a controlled disabled value checked instead of remapping to the first enabled option", () => {
    render(
      <SegmentedControl
        label="Answer style"
        value="standard"
        onChange={() => {
          throw new Error("onChange must not fire while displaying a disabled controlled value");
        }}
        options={options}
        layout="equal"
      />,
    );

    expect(screen.getByRole("radio", { name: "Standard" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Brief" })).toHaveAttribute("aria-checked", "false");
    // Focus can still land on an enabled option when the checked radio is disabled.
    expect(screen.getByRole("radio", { name: "Brief" }).tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: "Standard" }).tabIndex).toBe(-1);
  });

  it("keeps equal segments on one row while fit segments remain wrappable", () => {
    const { rerender } = render(
      <SegmentedControl
        label="Answer style"
        value="brief"
        onChange={() => undefined}
        options={options}
        layout="equal"
      />,
    );

    expect(screen.getByRole("radiogroup", { name: "Answer style" })).toHaveClass("flex-nowrap");
    for (const radio of screen.getAllByRole("radio")) expect(radio).toHaveClass("flex-1");

    rerender(
      <SegmentedControl label="Answer style" value="brief" onChange={() => undefined} options={options} layout="fit" />,
    );

    expect(screen.getByRole("radiogroup", { name: "Answer style" })).toHaveClass("flex-wrap");
    for (const radio of screen.getAllByRole("radio")) expect(radio).toHaveClass("flex-none");
  });

  it("uses a compact soft inset selection instead of a full capsule", () => {
    render(<Harness />);

    const group = screen.getByRole("radiogroup", { name: "Answer style" });
    const selected = screen.getByRole("radio", { name: "Brief" });
    expect(group).toHaveClass("rounded-xl");
    expect(group).not.toHaveClass("rounded-2xl", "p-1");
    expect(selected).toHaveClass("min-h-tap", "rounded-lg");
    expect(selected).not.toHaveClass("rounded-full");
    expect(selected.querySelector("[aria-hidden='true']")).toHaveClass("absolute", "inset-1", "rounded-lg");
  });
});

describe("OverlayRoot", () => {
  it("provides named layer hosts for portalled consumers", async () => {
    render(
      <>
        <OverlayRoot />
        <OverlayPortal layer="popover">
          <span>Portalled hint</span>
        </OverlayPortal>
      </>,
    );

    const host = document.querySelector('[data-overlay-host="popover"]');
    expect(host).not.toBeNull();
    expect((await screen.findByText("Portalled hint")).closest('[data-overlay-host="popover"]')).toBe(host);
  });

  it("re-portals when the real OverlayRoot host replaces a fallback host", async () => {
    const { rerender } = render(
      <OverlayPortal layer="popover">
        <span>Portalled hint</span>
      </OverlayPortal>,
    );

    const fallbackHost = document.querySelector('[data-overlay-host="popover"]');
    expect(fallbackHost).not.toBeNull();
    expect(fallbackHost?.closest('[data-overlay-root="fallback"]')).not.toBeNull();
    expect((await screen.findByText("Portalled hint")).closest('[data-overlay-host="popover"]')).toBe(fallbackHost);

    rerender(
      <>
        <OverlayRoot />
        <OverlayPortal layer="popover">
          <span>Portalled hint</span>
        </OverlayPortal>
      </>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const rootHost = document.querySelector('[data-overlay-root="true"] [data-overlay-host="popover"]');
    expect(rootHost).not.toBeNull();
    expect((await screen.findByText("Portalled hint")).closest('[data-overlay-host="popover"]')).toBe(rootHost);
    // After consumers leave the synthetic host, the fallback root is removed so
    // it does not linger for the page lifetime.
    expect(document.querySelector('[data-overlay-root="fallback"]')).toBeNull();
  });
});

describe("Select", () => {
  // ADOPTION §3: `Select` shipped without a dedicated test. The fold is where
  // that gap closes, because the fold is what makes its shell shared.
  it("keeps the hint alongside the error, like every other folded control", () => {
    render(
      <Select
        label="Jurisdiction"
        hint="Applies to guideline filtering only."
        error="Choose a jurisdiction."
        options={[{ value: "wa", label: "Western Australia" }]}
      />,
    );

    const select = screen.getByLabelText(/Jurisdiction/);
    expect(select).toHaveAttribute("aria-invalid", "true");
    const ids = (select.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0] as string)).toHaveTextContent("Applies to guideline filtering only.");
    expect(document.getElementById(ids[1] as string)).toHaveTextContent("Choose a jurisdiction.");
  });

  it("keeps a hidden label a real label rather than dropping it", () => {
    render(<Select label="Jurisdiction" hideLabel options={[{ value: "wa", label: "Western Australia" }]} />);
    expect(screen.getByRole("combobox")).toHaveAccessibleName(/Jurisdiction/);
  });

  // A placeholder used to force `defaultValue=""` even when the caller drove the
  // control with `value`, so every controlled Select with a placeholder warned
  // that it was both controlled and uncontrolled. React resolves that by
  // ignoring the default, so the visible behaviour was right and the warning was
  // the only symptom -- which is exactly why it survived in a shared control.
  it("does not claim to be both controlled and uncontrolled when a placeholder is set", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <Select
          label="Category"
          placeholder="Choose one"
          value="parking"
          onChange={() => {}}
          options={[
            { value: "parking", label: "Parking" },
            { value: "food", label: "Food" },
          ]}
        />,
      );

      const warnings = consoleError.mock.calls.map((call) => String(call[0] ?? ""));
      expect(warnings.filter((message) => /controlled or uncontrolled/i.test(message))).toEqual([]);
      expect(screen.getByRole("combobox")).toHaveValue("parking");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("still starts an uncontrolled select on its placeholder", () => {
    render(
      <Select
        label="Category"
        placeholder="Choose one"
        options={[
          { value: "parking", label: "Parking" },
          { value: "food", label: "Food" },
        ]}
      />,
    );

    expect(screen.getByRole("combobox")).toHaveValue("");
  });
});

describe("Checkbox", () => {
  it("merges a caller's description with its own rather than overwriting it", () => {
    render(
      <>
        <p id="outdated-note">Outdated sources stay flagged.</p>
        <Checkbox label="Include outdated sources" description="Off by default." aria-describedby="outdated-note" />
      </>,
    );

    const ids = (screen.getByRole("checkbox").getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(ids[0]).toBe("outdated-note");
    expect(ids).toHaveLength(2);
  });

  it("forwards a caller ref even though the component owns the ref for indeterminate", () => {
    // The component's own ref callback sets `indeterminate`, which exists only on
    // the node. Before this was forwarded by hand, the declared `ref` prop
    // typechecked and then did nothing at all.
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox label="Include outdated sources" indeterminate ref={ref} />);

    expect(ref.current).toBe(screen.getByRole("checkbox"));
    expect(ref.current?.indeterminate).toBe(true);
  });
});

describe("RadioGroup", () => {
  it("keeps controlled value and onChange paired", async () => {
    const onChange = vi.fn();
    render(
      <RadioGroup
        label="Sort"
        name="sort"
        value="relevance"
        onChange={onChange}
        options={[
          { value: "relevance", label: "Relevance" },
          { value: "newest", label: "Newest" },
        ]}
      />,
    );
    await userEvent.click(screen.getByLabelText("Newest"));
    expect(onChange).toHaveBeenCalledWith("newest");
  });

  it("carries a group-level hint and error together on the fieldset", () => {
    render(
      <RadioGroup
        label="Sort"
        name="sort"
        hint="Applies to this result set only."
        error="Choose a sort order."
        options={[
          { value: "relevance", label: "Relevance" },
          { value: "newest", label: "Newest" },
        ]}
      />,
    );

    const group = screen.getByRole("group", { name: "Sort" });
    const ids = (group.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0] as string)).toHaveTextContent("Applies to this result set only.");
    expect(document.getElementById(ids[1] as string)).toHaveTextContent("Choose a sort order.");
  });

  it("applies the resolved group id to the fieldset when the caller omits id", () => {
    // Without this, callers that omit `id` get a fieldset with no DOM id, so an
    // error summary cannot link to the group and option/hint/error ids still
    // exist under an orphan prefix.
    render(
      <RadioGroup
        label="Sort"
        name="sort"
        options={[
          { value: "relevance", label: "Relevance" },
          { value: "newest", label: "Newest" },
        ]}
      />,
    );

    const group = screen.getByRole("group", { name: "Sort" });
    expect(group).toHaveAttribute("id");
    expect(group.getAttribute("id")?.length).toBeGreaterThan(0);
  });

  it("honours an externally supplied id on the fieldset", () => {
    render(
      <RadioGroup
        id="sort-order"
        label="Sort"
        name="sort"
        options={[
          { value: "relevance", label: "Relevance" },
          { value: "newest", label: "Newest" },
        ]}
      />,
    );

    expect(screen.getByRole("group", { name: "Sort" })).toHaveAttribute("id", "sort-order");
  });

  it("derives option ids from a sanitised key rather than the raw value", () => {
    render(
      <RadioGroup
        label="Creatinine unit"
        name="scr-unit"
        options={[
          { value: "µmol/L", label: "µmol/L" },
          { value: "mg/dL", label: "mg/dL" },
        ]}
      />,
    );

    const ids = ["µmol/L", "mg/dL"].map((name) => screen.getByLabelText(name).getAttribute("id") ?? "");
    for (const id of ids) {
      // A raw value carrying "/" or "µ" produces an id fragment a selector
      // cannot address, and two values that sanitise alike would collide.
      expect(id).not.toContain("/");
      expect(id).not.toContain("µ");
    }
    expect(new Set(ids).size).toBe(2);
  });
});

describe("Tabs", () => {
  const items = [
    { id: "answer", label: "Answer" },
    { id: "sources", label: "Sources" },
    { id: "audit", label: "Audit" },
  ];

  function Harness() {
    const [value, setValue] = useState("answer");
    return (
      <Tabs label="Answer sections" items={items} value={value} onChange={setValue}>
        <p>panel for {value}</p>
      </Tabs>
    );
  }

  it("keeps exactly one tab in the tab order and moves selection with arrow keys", async () => {
    render(<Harness />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.filter((tab) => tab.getAttribute("tabindex") === "0")).toHaveLength(1);

    tabs[0].focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Audit" })).toHaveAttribute("aria-selected", "true");
  });

  // Regression guard for the phantom vertical scrollbar on desktop. The tabs use
  // `-mb-px` so the selected underline covers the strip's bottom border, which puts
  // their painted box 1px below the tablist's content box. `overflow-x: auto` computes
  // the other axis to `auto`, so while the tablist itself was the scroller that 1px
  // became real vertical scrollable overflow and a classic-scrollbar desktop drew a
  // full vertical scrollbar beside the tabs. jsdom has no layout, so the contract that
  // is actually assertable is the structural one: the scroller is the wrapper, and the
  // element that carries the border and the overhanging tabs never scrolls.
  it("scrolls from a wrapper so the tabs' 1px underline overhang cannot draw a vertical scrollbar", () => {
    render(<Harness />);
    const tablist = screen.getByRole("tablist");

    expect(tablist.className).not.toMatch(/overflow-/);
    expect(tablist.className).toContain("border-b");
    expect(tablist.parentElement?.className).toContain("overflow-x-auto");
    // The strip stretches to its content so the border spans the full scroll width.
    expect(tablist.className).toContain("w-max");
    expect(tablist.className).toContain("min-w-full");
    // The overlap the overhang exists for is still in place.
    expect(screen.getByRole("tab", { name: "Answer" }).className).toContain("-mb-px");
  });

  it("links the panel back to its tab", () => {
    render(<Harness />);
    const panel = screen.getByRole("tabpanel");
    const tab = screen.getByRole("tab", { name: "Answer" });
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    expect(tab).toHaveAttribute("aria-controls", panel.id);
  });

  it("does not point unselected tabs at missing panel ids", () => {
    render(<Harness />);
    const selected = screen.getByRole("tab", { name: "Answer" });
    const other = screen.getByRole("tab", { name: "Sources" });
    expect(selected).toHaveAttribute("aria-controls");
    expect(other).not.toHaveAttribute("aria-controls");
  });
});

describe("Tooltip", () => {
  it("opens on keyboard focus, not hover alone, and describes the trigger", async () => {
    render(
      <Tooltip content="Provenance is read from the document.">
        <button type="button">
          <Info aria-hidden="true" /> About
        </button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    trigger.focus();
    const tooltip = await screen.findByRole("tooltip");
    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
    await waitFor(() => {
      expect(tooltip.style.visibility).toBe("visible");
    });
  });

  it("stays invisible at the placeholder origin until geometry is measured", async () => {
    const pendingFrames: Array<(time: number) => void> = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrames.push(callback as (time: number) => void);
      return 1;
    });
    const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    try {
      render(
        <Tooltip content="Measured placement only.">
          <button type="button">Measure</button>
        </Tooltip>,
      );

      screen.getByRole("button", { name: "Measure" }).focus();
      // visibility:hidden keeps the node out of the accessibility tree, so query by test id.
      const tooltip = await screen.findByTestId("tooltip");
      expect(tooltip).toHaveAttribute("role", "tooltip");
      expect(tooltip.style.visibility).toBe("hidden");
      expect(tooltip.style.left).toBe("0px");
      expect(tooltip.style.top).toBe("0px");

      expect(pendingFrames).toHaveLength(1);
      pendingFrames[0](0);
      await waitFor(() => {
        expect(tooltip.style.visibility).toBe("visible");
      });
      expect(screen.getByRole("tooltip")).toBe(tooltip);
    } finally {
      raf.mockRestore();
      caf.mockRestore();
    }
  });

  it("coalesces capture scroll events into one passive animation-frame measurement", async () => {
    const pendingFrames: Array<(time: number) => void> = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrames.push(callback as (time: number) => void);
      return pendingFrames.length;
    });
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");

    try {
      render(
        <Tooltip content="Batched placement">
          <button type="button">Batched trigger</button>
        </Tooltip>,
      );

      screen.getByRole("button", { name: "Batched trigger" }).focus();
      await screen.findByTestId("tooltip");
      expect(pendingFrames).toHaveLength(1);
      act(() => pendingFrames.shift()?.(0));
      await waitFor(() => expect(screen.getByRole("tooltip")).toBeVisible());
      const measuredCalls = rect.mock.calls.length;

      act(() => {
        window.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new Event("resize"));
      });

      expect(pendingFrames).toHaveLength(1);
      expect(rect).toHaveBeenCalledTimes(measuredCalls);
      act(() => pendingFrames.shift()?.(16));
      await waitFor(() => expect(rect.mock.calls.length).toBe(measuredCalls + 2));
    } finally {
      raf.mockRestore();
      rect.mockRestore();
    }
  });

  it("composes over existing child event handlers instead of replacing them", async () => {
    const onFocus = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <Tooltip content="Extra detail">
        <button type="button" onFocus={onFocus} onKeyDown={onKeyDown}>
          Trigger
        </button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button");
    trigger.focus();
    await screen.findByRole("tooltip");
    expect(onFocus).toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    expect(onKeyDown).toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("caps and clamps viewport-sized content inside a 320px viewport", async () => {
    const fullContent = "Opening context. Additional supplementary detail. FINAL LINE REMAINS DESCRIBED.";
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 240 });
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return (
        this.getAttribute("role") === "tooltip"
          ? { x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 500, width: 320, height: 500 }
          : { x: 300, y: 220, left: 300, top: 220, right: 316, bottom: 236, width: 16, height: 16 }
      ) as DOMRect;
    });

    try {
      render(
        <Tooltip content={fullContent} placement="bottom">
          <button type="button">Edge trigger</button>
        </Tooltip>,
      );
      const trigger = screen.getByRole("button", { name: "Edge trigger" });
      trigger.focus();
      const tooltip = await screen.findByRole("tooltip");
      await waitFor(() => {
        expect(tooltip.style.maxWidth).toBe("304px");
        expect(tooltip.style.left).toBe("8px");
        expect(tooltip.style.top).toBe("8px");
      });
      const visual = within(tooltip).getByTestId("tooltip-visual");
      expect(visual.style.maxHeight).toBe("224px");
      expect(visual).toHaveClass("overflow-hidden");
      expect(visual.style.overflowY).toBe("");
      expect(tooltip.style.overflowY).toBe("");
      expect(tooltip).not.toHaveAttribute("tabindex");
      expect(tooltip).toHaveAttribute("aria-label", fullContent);
      expect(within(tooltip).getByTestId("tooltip-description")).toHaveTextContent("FINAL LINE REMAINS DESCRIBED.");
      expect(trigger).toHaveAccessibleDescription(fullContent);
    } finally {
      rect.mockRestore();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
    }
  });
});

describe("Pagination", () => {
  it("marks the current page and truncates a long list", () => {
    render(<Pagination page={9} pageCount={42} onPageChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Page 9" })).toHaveAttribute("aria-current", "page");
    // First, last and the band around the current page — not all 42.
    expect(screen.getByRole("button", { name: "Page 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 42" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Page 20" })).not.toBeInTheDocument();
  });

  it("renders nothing for a single page", () => {
    const { container } = render(<Pagination page={1} pageCount={1} onPageChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ConfirmDialog", () => {
  it("holds the destructive action until the confirmation phrase matches exactly", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onCancel={() => {}}
        onConfirm={onConfirm}
        title="Retire approved guideline?"
        description="This removes the guideline from future answers."
        confirmLabel="Retire guideline"
        confirmPhrase="RETIRE"
      />,
    );

    const confirm = screen.getByRole("button", { name: "Retire guideline" });
    // Button sets data-testid from its own testId prop after spreading the rest,
    // so a raw data-testid was overwritten with undefined and never reached the DOM.
    expect(confirm).toHaveAttribute("data-testid", "confirm-dialog-confirm");
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByRole("textbox"), "retire");
    expect(confirm).toBeDisabled(); // case-sensitive on purpose

    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "RETIRE");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("Toast", () => {
  function Harness() {
    const { push } = useToast();
    return (
      <button type="button" onClick={() => push({ tone: "success", title: "Source indexed", duration: 0 })}>
        Announce
      </button>
    );
  }

  it("announces politely through a live region", async () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    const region = screen.getByTestId("toast-region");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("role", "status");

    await userEvent.click(screen.getByRole("button", { name: "Announce" }));
    expect(within(region).getByText("Source indexed")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss: Source indexed" }));
    expect(within(region).queryByText("Source indexed")).not.toBeInTheDocument();
  });

  it("deduplicates outcomes and caps the visible queue", async () => {
    function QueueHarness() {
      const { push } = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            push({ tone: "info", title: "Repeated", duration: 0 });
            push({ tone: "info", title: "Repeated", duration: 0 });
            for (let index = 0; index < 8; index += 1) {
              push({ tone: "success", title: `Outcome ${index}`, duration: 0 });
            }
          }}
        >
          Fill queue
        </button>
      );
    }

    render(
      <ToastProvider>
        <QueueHarness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Fill queue" }));
    expect(screen.getAllByTestId("toast")).toHaveLength(5);
    expect(screen.queryByText("Repeated")).not.toBeInTheDocument();
  });

  it("refreshes a still-visible duplicate so the polite region can re-announce", async () => {
    function RepeatHarness() {
      const { push } = useToast();
      return (
        <button type="button" onClick={() => push({ tone: "danger", title: "Upload failed", duration: 0 })}>
          Fail upload
        </button>
      );
    }

    render(
      <ToastProvider>
        <RepeatHarness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Fail upload" }));
    const first = screen.getByTestId("toast");
    expect(first).toHaveAttribute("data-announce-key", "0");
    await userEvent.click(screen.getByRole("button", { name: "Fail upload" }));
    expect(screen.getAllByTestId("toast")).toHaveLength(1);
    expect(screen.getByTestId("toast")).toHaveAttribute("data-announce-key", "1");
  });

  it("runs a labelled action once and reports why each toast closed", async () => {
    const onAction = vi.fn();
    const closes: string[] = [];
    function ActionHarness() {
      const { push } = useToast();
      return (
        <>
          <button
            type="button"
            onClick={() =>
              push({
                tone: "info",
                title: "Removed Lithium monitoring guideline",
                duration: 0,
                action: { label: "Undo", onAction },
                onClose: (reason) => closes.push(`undo:${reason}`),
              })
            }
          >
            Remove
          </button>
          <button
            type="button"
            onClick={() =>
              push({ tone: "info", title: "Moved", duration: 0, onClose: (reason) => closes.push(`move:${reason}`) })
            }
          >
            Move
          </button>
        </>
      );
    }

    render(
      <ToastProvider>
        <ActionHarness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Removed Lithium monitoring guideline")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Move" }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss: Moved" }));
    expect(closes).toEqual(["undo:action", "move:dismiss"]);
  });

  it("pauses the close timer while the toast has focus and reports a timeout afterwards", async () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      let pushToast: ((title: string) => void) | null = null;
      function TimedHarness() {
        const { push } = useToast();
        pushToast = (title) =>
          push({ tone: "info", title, duration: 1000, action: { label: "Undo", onAction: vi.fn() }, onClose });
        return null;
      }
      render(
        <ToastProvider>
          <TimedHarness />
        </ToastProvider>,
      );
      act(() => pushToast?.("Moved to Ward round"));
      act(() => screen.getByRole("button", { name: "Undo" }).focus());
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.getByText("Moved to Ward round")).toBeInTheDocument();
      act(() => screen.getByRole("button", { name: "Undo" }).blur());
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.queryByText("Moved to Ward round")).not.toBeInTheDocument();
      expect(onClose).toHaveBeenCalledWith("timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DoseLine", () => {
  it("keeps the unit in its authored case — g is not G, mg is not MG", () => {
    render(
      <DoseLine
        rows={[{ id: "clozapine", drug: "Clozapine", dose: { value: "12.5", unit: "mg" }, status: "current" }]}
        onOpenSource={vi.fn()}
      />,
    );

    const unit = screen.getByText("mg");
    expect(unit.textContent).toBe("mg");
    // An uppercasing transform on a dose unit changes its meaning.
    expect(unit.className).toContain("normal-case");
    expect(unit.className).not.toContain("uppercase");
  });

  it("flags a row whose cited source is overdue", () => {
    render(
      <DoseLine
        rows={[
          { id: "quetiapine", drug: "Quetiapine", dose: { value: "800", unit: "mg/day" }, status: "current" },
          {
            id: "olanzapine",
            drug: "Olanzapine",
            dose: { value: "20", unit: "mg/day" },
            status: "review_due",
            // An overdue row must carry the route back to its source: the type
            // refuses "warned, with nowhere to go".
            source: { sourceId: "doc-3", title: "Olanzapine Monograph" },
          },
        ]}
        onOpenSource={vi.fn()}
      />,
    );

    const rows = screen.getAllByTestId("dose-row");
    expect(rows[0]).not.toHaveAttribute("data-overdue");
    expect(rows[1]).toHaveAttribute("data-overdue", "true");
  });
});

describe("AnswerFooter", () => {
  // PR 6 reverses the old "drop unknown segments" behaviour: on a provenance
  // strip the absence IS the governance signal, so an unrecorded publisher now
  // says so instead of looking identical to a recorded one.
  it("names every provenance field, rendering absences as phrases", () => {
    render(<AnswerFooter publisher="RANZCP" generatedAt="2026-07-31T05:04:00.000Z" />);

    const footer = screen.getByTestId("answer-footer");
    expect(footer).toHaveTextContent("RANZCP");
    expect(footer).toHaveTextContent("Version");
    expect(footer).toHaveTextContent("Review");
    expect(within(footer).getAllByTestId("missing-value").length).toBeGreaterThan(0);
  });
});

describe("Links tone contract", () => {
  it("does not leak tone onto the DOM for TextLink, ExternalTextLink, or DownloadLink", () => {
    render(
      <>
        <TextLink href="/docs" tone="inherit">
          Internal
        </TextLink>
        <ExternalTextLink href="https://example.test" tone="inherit">
          External
        </ExternalTextLink>
        <DownloadLink href="/file.pdf" tone="inherit" format="PDF" size="1 MB">
          Download
        </DownloadLink>
      </>,
    );

    for (const name of ["Internal", "External", "Download"]) {
      const link = screen.getByRole("link", { name: new RegExp(name, "i") });
      expect(link).not.toHaveAttribute("tone");
    }
  });
});

/*
 * COMPONENTS §0.4 open-defect ledger — the rows closed by ledger task #263.
 * Each case names the defect it pins so a later reader can tell an assertion
 * that is load-bearing from one that is decoration.
 */

describe("Button — ref forwarding", () => {
  it("forwards a ref to the underlying button element", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Reindex</Button>);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current).toBe(screen.getByRole("button", { name: "Reindex" }));
  });

  it("passes testId through as data-testid", () => {
    render(<Button testId="reindex-button">Reindex</Button>);
    expect(screen.getByTestId("reindex-button")).toHaveAccessibleName("Reindex");
  });
});

describe("Progress / StageList", () => {
  it("drives the indeterminate sweep from the theme animation, not a hardcoded duration", () => {
    render(<Progress label="Indexing" />);
    const fill = screen.getByTestId("progress-fill");

    expect(fill.className).toContain("animate-shimmer");
    // The literal it replaced pinned both the timing and a second easing here.
    expect(fill.className).not.toMatch(/animate-\[/);
  });

  it("never announces step 0 — an unstarted job is at its first step", () => {
    render(
      <StageList
        label="Ingestion"
        stages={[
          { id: "upload", label: "Upload", state: "pending" },
          { id: "parse", label: "Parse", state: "pending" },
          { id: "index", label: "Index", state: "pending" },
        ]}
      />,
    );

    expect(screen.getByTestId("stage-list")).toHaveAttribute("aria-label", "Ingestion: step 1 of 3");
  });

  it("counts the active stage, and clamps at the last one when every stage is done", () => {
    const { rerender } = render(
      <StageList
        label="Ingestion"
        stages={[
          { id: "upload", label: "Upload", state: "done" },
          { id: "parse", label: "Parse", state: "active" },
          { id: "index", label: "Index", state: "pending" },
        ]}
      />,
    );
    expect(screen.getByTestId("stage-list")).toHaveAttribute("aria-label", "Ingestion: step 2 of 3");

    rerender(
      <StageList
        label="Ingestion"
        stages={[
          { id: "upload", label: "Upload", state: "done" },
          { id: "parse", label: "Parse", state: "done" },
          { id: "index", label: "Index", state: "done" },
        ]}
      />,
    );
    expect(screen.getByTestId("stage-list")).toHaveAttribute("aria-label", "Ingestion: step 3 of 3");
  });

  it("announces through a dedicated status node rather than making the whole list live", () => {
    render(
      <StageList
        label="Ingestion"
        stages={[
          { id: "upload", label: "Upload", state: "done" },
          { id: "parse", label: "Parse", state: "active", detail: "118 chunks" },
          { id: "index", label: "Index", state: "pending" },
        ]}
      />,
    );

    const list = screen.getByTestId("stage-list");
    // aria-live on the <ol> re-read every stage label and detail on each
    // transition; five stages meant five sentences to learn that step 3 started.
    expect(list).not.toHaveAttribute("aria-live");
    // And the status node is a sibling, not a child — an sr-only <li> would have
    // made a three-stage job announce as "list, 4 items".
    expect(list.querySelector('[data-testid="stage-list-status"]')).toBeNull();

    const status = screen.getByTestId("stage-list-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent("Ingestion: step 2 of 3, Parse");
  });

  it("reports a failed stage as the current step when nothing is active", () => {
    render(
      <StageList
        label="Ingestion"
        stages={[
          { id: "upload", label: "Upload", state: "done" },
          { id: "parse", label: "Parse", state: "failed" },
          { id: "index", label: "Index", state: "pending" },
        ]}
      />,
    );

    expect(screen.getByTestId("stage-list")).toHaveAttribute("aria-label", "Ingestion: step 2 of 3");
    expect(screen.getByTestId("stage-list-status")).toHaveTextContent("Ingestion: step 2 of 3, Parse");
    const stages = screen.getByTestId("stage-list").querySelectorAll("li");
    expect(stages[1]).toHaveAttribute("aria-current", "step");
  });
});

describe("StatusMark — design-system vocabulary", () => {
  it("draws a distinct shape for every state it declares", () => {
    const shapeContract: Record<DocumentStatus, { childSelector: string | null; styleIncludes?: string }> = {
      current: { childSelector: null, styleIncludes: "background" },
      review_due: { childSelector: ".rounded-r-full" },
      outdated: { childSelector: ".rotate-45" },
      unknown: { childSelector: null, styleIncludes: "dashed" },
    };

    for (const status of Object.keys(shapeContract) as DocumentStatus[]) {
      const { childSelector, styleIncludes } = shapeContract[status];
      const { unmount } = render(<StatusMark status={status} />);
      const mark = screen.getByTestId("status-mark");
      expect(mark).toHaveAttribute("data-status", status);
      if (childSelector) {
        expect(mark.querySelector(childSelector)).not.toBeNull();
      }
      if (styleIncludes) {
        expect(mark.getAttribute("style")).toContain(styleIncludes);
      }
      unmount();
    }
  });

  it("keeps the application row type conforming to what the mark can draw", () => {
    // Compile-time half of the decoupling: `StatusMark` no longer aliases its
    // API off `ClinicalSourceMetadata["document_status"]`, so this assignment is
    // what fails `typecheck` if the row type grows a fifth value the mark has no
    // shape for. Previously the alias let it through and it fell silently
    // through to the `unknown` styling.
    const appStatus: NonNullable<ClinicalSourceMetadata["document_status"]> = "review_due";
    const drawable: DocumentStatus = appStatus;
    expect(drawable).toBe("review_due");
  });
});

describe("PageHeader — actions must not starve the title", () => {
  it("floors the title column and lets the actions column give way", () => {
    const { container } = render(
      <PageHeader
        title="Treatment-resistant depression in the context of comorbid substance use"
        actions={
          <>
            <Button>Print</Button>
            <Button>Export</Button>
            <Button variant="primary">Reindex</Button>
          </>
        }
      />,
    );

    const grid = container.querySelector("header > div");
    // `[minmax(0,1fr)_auto]` sized the actions track to its full max-content
    // first and let the title collapse toward zero. The floor is the fix; the
    // existing flex-wrap only decided where the actions sat, not how wide.
    expect(grid?.className).toContain("sm:grid-cols-[minmax(20ch,1fr)_minmax(0,auto)]");
    expect(grid?.className).not.toContain("sm:grid-cols-[minmax(0,1fr)_auto]");
  });
});

describe("Disclosure — print", () => {
  it("expands a collapsed panel for print instead of omitting the section", () => {
    render(
      <Disclosure title="Monitoring">
        <p>Review ECG and electrolytes.</p>
      </Disclosure>,
    );

    const panel = screen.getByTestId("disclosure").querySelector('[role="region"]');
    expect(panel).not.toHaveAttribute("hidden");
    expect(panel).toHaveAttribute("data-open", "false");
    // On paper there is no control to open, so a collapsed section would print
    // as though the guideline never mentioned it — undetectably.
    expect(panel).toHaveClass("hidden", "print:block");
    expect(screen.getByRole("button", { name: "Monitoring" })).toHaveClass("print:hidden");
    const printTitle = screen.getByTestId("disclosure").querySelector("h3 > span.hidden");
    expect(printTitle).toHaveClass("print:flex");
    expect(printTitle).toHaveAttribute("aria-hidden", "true");
    expect(printTitle).toHaveTextContent("Monitoring");
  });

  it("keeps an open panel visible and still print-expanded", () => {
    render(
      <Disclosure title="Monitoring" defaultOpen>
        <p>Review ECG and electrolytes.</p>
      </Disclosure>,
    );

    const panel = screen.getByRole("region");
    expect(panel).not.toHaveAttribute("hidden");
    expect(panel).not.toHaveClass("hidden");
    expect(panel).toHaveClass("print:block");
    expect(panel).toHaveAttribute("data-open", "true");
  });
});

describe("Tabs — invalid selected value", () => {
  const items = [
    { id: "answer", label: "Answer" },
    { id: "sources", label: "Sources" },
  ];

  it("keeps the strip reachable when value matches no enabled tab", () => {
    // A stale saved filter or a deep link to a removed tab produced this. Every
    // tab took tabIndex -1, so Tab skipped the whole strip and the arrow keys
    // that would have fixed it were unreachable.
    render(
      <Tabs label="Answer sections" items={items} value="removed-tab" onChange={() => {}}>
        <p>panel</p>
      </Tabs>,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs.filter((tab) => tab.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Answer" })).toHaveAttribute("tabindex", "0");
    // Reachability only: nothing is claimed as selected, and onChange is not
    // fired behind the caller's back.
    expect(tabs.every((tab) => tab.getAttribute("aria-selected") === "false")).toBe(true);
  });

  it("does not fire onChange to repair the caller's state", () => {
    const onChange = vi.fn();
    render(<Tabs label="Answer sections" items={items} value="removed-tab" onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("skips a disabled tab when picking the reachable fallback", () => {
    render(
      <Tabs
        label="Answer sections"
        items={[{ id: "answer", label: "Answer", disabled: true }, ...items.slice(1)]}
        value="answer"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Answer" })).toHaveAttribute("aria-selected", "false");
  });

  it("keeps the panel wired to a tab that exists", () => {
    render(
      <Tabs label="Answer sections" items={items} value="removed-tab" onChange={() => {}}>
        <p>panel</p>
      </Tabs>,
    );

    const panel = screen.getByRole("tabpanel");
    const owner = screen.getByRole("tab", { name: "Answer" });
    // Keyed off `value`, both of these dangled at ids no element carried.
    expect(panel).toHaveAttribute("aria-labelledby", owner.id);
    expect(owner).toHaveAttribute("aria-controls", panel.id);
  });
});

describe("Pagination — clamping, focus and announcement", () => {
  it("clamps an out-of-range page rather than emitting page 0 or -1", async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={0} pageCount={5} onPageChange={onPageChange} />);

    // page=0 arrives from a URL query or a stale saved filter; it is an ordinary
    // state, not a caller bug.
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("clamps a page past the end onto the last page", async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={99} pageCount={5} onPageChange={onPageChange} />);

    expect(screen.getByRole("button", { name: "Page 5" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("hands focus to the current page when the pressed step button disables itself", async () => {
    function Harness() {
      const [page, setPage] = useState(2);
      return <Pagination page={page} pageCount={2} onPageChange={setPage} />;
    }
    render(<Harness />);

    const previous = screen.getByRole("button", { name: "Previous page" });
    previous.focus();
    await userEvent.click(previous);

    // Reaching page 1 disables Previous, which used to drop focus to <body> and
    // lose the reader's place in the list.
    await waitFor(() => expect(previous).toBeDisabled());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Page 1" }));
  });

  it("wraps the control row so a seven-page window fits a 320px viewport", () => {
    render(<Pagination page={4} pageCount={7} onPageChange={() => {}} />);
    const row = screen.getByRole("button", { name: "Previous page" }).parentElement;
    expect(row?.className).toContain("flex-wrap");
  });

  it("does not announce a page the parent rejected", async () => {
    const announceSpy = vi.spyOn(await import("@/components/ui/live-announcer"), "announce");
    render(<Pagination page={2} pageCount={5} onPageChange={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(announceSpy).not.toHaveBeenCalled());

    announceSpy.mockRestore();
  });
});

describe("Links — invariants a spread cannot override", () => {
  it("keeps download set even when a caller spreads over it", () => {
    // The type omits `download` and the attribute is written after the spread —
    // two independent guards, because a JS caller can defeat the first.
    render(
      <DownloadLink href="/guideline.pdf" format="PDF" size="4 MB" {...({ download: false } as object)}>
        Guideline
      </DownloadLink>,
    );

    expect(screen.getByRole("link", { name: /Guideline/ })).toHaveAttribute("download");
  });

  it("keeps the external link's target and rel ahead of a spread", () => {
    render(
      <ExternalTextLink href="https://example.test" {...({ target: "_self", rel: "" } as object)}>
        External
      </ExternalTextLink>,
    );

    const link = screen.getByRole("link", { name: /External/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("refuses LinkAction's tone through a spread, not only through a literal", () => {
    // `LinkAction` renders the accent unconditionally, so an accepted-but-ignored
    // `tone` is a silent lie. `Omit<BaseProps, "tone">` alone does not close it:
    // excess-property checking only runs on object literals, so the literal form
    // is rejected while `<LinkAction {...props} />` — an ordinary assignment,
    // where extra properties are allowed — type-checks clean and still renders
    // the accent. `tone?: never` rejects both. This assertion is the gate: it
    // stops compiling the moment the prop widens back to something assignable.
    type ToneCarryingProps = { href: string; children: string; tone: "inherit" };
    type SpreadIsRejected = ToneCarryingProps extends LinkActionProps ? false : true;
    const spreadIsRejected: SpreadIsRejected = true;

    expect(spreadIsRejected).toBe(true);

    render(<LinkAction href="/documents">Review sources</LinkAction>);
    expect(screen.getByRole("link", { name: /Review sources/ })).toHaveClass("text-[color:var(--clinical-accent)]");
  });
});

describe("Checkbox / RadioGroup — dimensions on the spacing scale", () => {
  it("sizes the checkbox box and its mixed-state dash without arbitrary literals", () => {
    const { container } = render(<Checkbox label="Include outdated sources" indeterminate />);

    const box = container.querySelector(".grid.size-5");
    expect(box).not.toBeNull();
    expect(container.innerHTML).not.toContain("size-[1.125rem]");
    expect(container.innerHTML).not.toContain("h-[2px]");
    expect(container.innerHTML).not.toContain("size-4.5");
  });

  it("keeps the radio control on the same box recipe", () => {
    const { container } = render(
      <RadioGroup
        label="Sort by"
        name="sort"
        options={[{ value: "relevance", label: "Relevance" }]}
        defaultValue="relevance"
      />,
    );

    expect(container.querySelector(".size-5")).not.toBeNull();
    expect(container.innerHTML).not.toContain("size-[1.125rem]");
  });
});
