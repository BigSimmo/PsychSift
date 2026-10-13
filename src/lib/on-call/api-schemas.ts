import { onCallEntrySchema } from "@/lib/on-call/entry-model";

/** Create bodies carry no `id` — the server generates it. `view` is virtual, never accepted from writes. */
export const createOnCallEntrySchema = onCallEntrySchema.omit({ id: true, isOwn: true, view: true });

/**
 * Update bodies must be COMPLETE.
 *
 * `.required()` strips every `.default(...)` the base schema declares (subtitle, body,
 * linkedDocumentIds, tags, isPersonal, includeOnCard, sortOrder, lastVerifiedAt) and makes each
 * mandatory. Defaults are correct on create — a new entry that omits `subtitle` genuinely has
 * none — but dangerous on update: without this, a PATCH body that forgot to round-trip
 * `lastVerifiedAt` would validate and silently reset it, discarding the record that an entry is
 * still correct, which is what the twelve-month staleness design rests on. A partial body is
 * rejected with a 400 instead.
 *
 * These live here rather than in the route file because a Next.js Route Handler module may only
 * export the framework's own names; an extra export fails the production build's generated route
 * types, and `tsc --noEmit` alone does not catch it.
 */
export const updateOnCallEntrySchema = createOnCallEntrySchema.required();
