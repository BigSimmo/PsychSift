"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";

import { keepAboveKeyboard, sheetFootnote } from "@/components/favourites/number-sheets";
import type { FavouriteItem } from "@/components/favourites/favourites-view-model";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Sheet } from "@/components/ui/sheet";
import { TextField } from "@/components/ui/text-field";
import { cn, fieldControl, textMuted } from "@/components/ui-primitives";
import { OVERRIDE_NAME_MAX, OVERRIDE_NOTE_MAX, setFavouriteOverride } from "@/lib/favourites/favourites-local";

/**
 * A person's own name and note for one favourite, kept on this phone. The
 * item's own title stays in search. Nothing that fails the patient-detail check
 * is stored: the store refuses it and the field says why.
 */
export function EditFavouriteSheet({
  item,
  overrideName,
  overrideNote,
  onClose,
}: {
  item: FavouriteItem | null;
  overrideName?: string;
  overrideNote?: string;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={item !== null}
      onClose={onClose}
      title="Edit favourite"
      description={item?.type}
      closeLabel="Close edit favourite"
      testId="edit-favourite-sheet"
      bodyClassName="p-3 pb-6"
    >
      {item ? (
        <div data-work-frame="sheet">
          <EditFavouriteForm
            key={item.id}
            item={item}
            overrideName={overrideName ?? ""}
            overrideNote={overrideNote ?? ""}
            onClose={onClose}
          />
        </div>
      ) : null}
    </Sheet>
  );
}

function EditFavouriteForm({
  item,
  overrideName,
  overrideNote,
  onClose,
}: {
  item: FavouriteItem;
  overrideName: string;
  overrideNote: string;
  onClose: () => void;
}) {
  const original = item.originalTitle ?? item.title;
  const [name, setName] = useState(overrideName);
  const [note, setNote] = useState(overrideNote);
  const [errors, setErrors] = useState<{ name?: string; note?: string; form?: string }>({});
  const hasOverride = Boolean(overrideName || overrideNote);

  function save() {
    const result = setFavouriteOverride(item.id, { name, note });
    if (result.ok) {
      onClose();
      return;
    }
    setErrors(result.field === "storage" ? { form: result.problem } : { [result.field]: result.problem });
  }

  function reset() {
    const result = setFavouriteOverride(item.id, null);
    if (result.ok) {
      onClose();
      return;
    }
    setErrors({ form: result.problem });
  }

  return (
    <form
      className="grid gap-4 px-1 pt-1"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <p className={cn("m-0 text-sm", textMuted)} data-testid="edit-favourite-original">
        Original name: <span className="font-semibold">{original}</span>
      </p>
      <TextField
        label="Name you see"
        value={name}
        placeholder={original}
        maxLength={OVERRIDE_NAME_MAX}
        autoComplete="off"
        enterKeyHint="next"
        hint="Leave it empty to use the original name."
        error={errors.name}
        onChange={(event) => {
          setName(event.target.value);
          if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
        }}
        onFocus={keepAboveKeyboard}
      />
      <FormField label="Note" hint="Optional. Never write patient details." error={errors.note}>
        {(field) => (
          <>
            <textarea
              id={field.id}
              value={note}
              rows={3}
              maxLength={OVERRIDE_NOTE_MAX}
              aria-invalid={field.invalid || undefined}
              aria-describedby={field.describedBy}
              className={cn(fieldControl, "h-auto min-h-24 resize-none px-3 py-2.5")}
              onChange={(event) => {
                setNote(event.target.value);
                if (errors.note) setErrors((current) => ({ ...current, note: undefined }));
              }}
              onFocus={keepAboveKeyboard}
            />
            <p className={cn("m-0 mt-1 text-right text-xs tabular-nums", textMuted)}>
              {note.length} of {OVERRIDE_NOTE_MAX}
            </p>
          </>
        )}
      </FormField>
      {errors.form ? (
        <p role="alert" className="m-0 flex items-start gap-1.5 text-sm font-semibold text-[color:var(--danger)]">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-icon-xs shrink-0" />
          <span>{errors.form}</span>
        </p>
      ) : null}
      <Button type="submit" variant="primary" block>
        Save
      </Button>
      {hasOverride ? (
        <Button type="button" variant="secondary" block onClick={reset}>
          Reset to original
        </Button>
      ) : null}
      <p className={sheetFootnote}>Your name and note stay on this phone.</p>
    </form>
  );
}
