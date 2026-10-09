"use client";

import { Search, X, type LucideIcon } from "lucide-react";
import type { InputHTMLAttributes, Ref } from "react";

import { FormField } from "@/components/ui/form-field";
import { cn, fieldControlPlain, fieldControlWithIcon, fieldIcon } from "@/components/ui-primitives";

/*
 * PR 13 fold. These controls used to hand-roll their own field shell, and that
 * private copy carried the COMPONENTS §0.4 defect: `hint && !error` dropped the
 * format hint at exactly the moment the user got the format wrong, so the field
 * said "that is not a date" with nothing left saying what a date looks like.
 * `FormField` keeps both nodes in the DOM and both ids in `aria-describedby`, so
 * folding onto it is the fix rather than a refactor with a fix bolted on.
 *
 * The fold also picks up the other three shell defects for free: a caller's
 * `aria-describedby` is merged ahead of the hint instead of being overwritten,
 * an external `id` can be supplied so an `ErrorSummary` entry can link to the
 * field, and required/optional is stated in the label text.
 */

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  /** External id supported; `FormField` generates one otherwise. */
  id?: string;
  /**
   * String, not `ReactNode`: the hint is read out as part of the field's
   * description, so block content in it is content a screen reader flattens.
   */
  hint?: string;
  error?: string;
  /** Visually hide the label but keep it for assistive technology. */
  hideLabel?: boolean;
  /** Leading glyph. Adds the inset padding the icon needs. */
  icon?: LucideIcon;
  /** Wrapper class; `className` still lands on the input itself. */
  fieldClassName?: string;
  ref?: Ref<HTMLInputElement>;
};

export function TextField({
  label,
  id,
  hint,
  error,
  hideLabel,
  icon: Icon,
  className,
  fieldClassName,
  required,
  autoComplete,
  "aria-describedby": callerDescribedBy,
  ...props
}: TextFieldProps) {
  return (
    <FormField
      label={label}
      id={id}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      required={required}
      autoComplete={autoComplete}
      describedBy={callerDescribedBy}
      className={fieldClassName}
    >
      {(field) => (
        <div className="relative">
          {Icon ? <Icon aria-hidden="true" className={fieldIcon} /> : null}
          <input
            {...props}
            id={field.id}
            required={field.required}
            autoComplete={field.autoComplete}
            // `fieldControl` already styles `aria-[invalid=true]`; passing the flag
            // here is what makes that existing state reachable from a prop.
            aria-invalid={field.invalid || undefined}
            aria-describedby={field.describedBy}
            className={cn(Icon ? fieldControlWithIcon : fieldControlPlain, className)}
          />
        </div>
      )}
    </FormField>
  );
}

export type SearchFieldProps = Omit<TextFieldProps, "icon" | "type"> & {
  /** Render a clear control once the field has a value. */
  onClear?: () => void;
  clearLabel?: string;
};

export function SearchField({
  label,
  id,
  hint,
  error,
  hideLabel = true,
  onClear,
  clearLabel = "Clear search",
  className,
  fieldClassName,
  value,
  required,
  autoComplete,
  "aria-describedby": callerDescribedBy,
  ...props
}: SearchFieldProps) {
  const showClear = Boolean(onClear && typeof value === "string" && value.length > 0);

  return (
    <FormField
      label={label}
      id={id}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      required={required}
      autoComplete={autoComplete}
      describedBy={callerDescribedBy}
      className={fieldClassName}
    >
      {(field) => (
        <div className="relative">
          <Search aria-hidden="true" className={fieldIcon} />
          <input
            {...props}
            id={field.id}
            type="search"
            value={value}
            required={field.required}
            autoComplete={field.autoComplete}
            aria-invalid={field.invalid || undefined}
            aria-describedby={field.describedBy}
            className={cn(fieldControlWithIcon, showClear && "text-field-own-clear pr-11", className)}
          />
          {showClear ? (
            <button
              type="button"
              onClick={onClear}
              aria-label={clearLabel}
              className="absolute right-1 top-1/2 grid size-tap -translate-y-1/2 place-items-center rounded-lg text-[color:var(--text-muted)] transition hover:text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              <X aria-hidden="true" className="size-icon-md" />
            </button>
          ) : null}
        </div>
      )}
    </FormField>
  );
}
