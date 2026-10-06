import { z } from "zod";

import { checkFavouriteSetName, isValidFavouriteSetName } from "@/lib/favourite-set-name";

export const favouritesContractVersion = 1 as const;
export const maxFavouritesPerAccount = 2000 as const;
export const favouriteContentTypeSchema = z.enum(["service", "form", "differential", "therapy"]);
export const favouriteContentKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/, "Content key must be a canonical reference.");
export const favouriteSetNames = [
  "Clinical review",
  "Ward round",
  "On call",
  "Follow up",
  "Teaching",
  "Reference",
] as const;
/** Stored names: any name that passes the set-name rules, including the six suggestions. */
export const favouriteSetNameSchema = z.string().refine(isValidFavouriteSetName, "Invalid favourite set name.");
/** Typed names: normalised first, then held to the same rules with a readable refusal. */
export const favouriteSetNameInputSchema = z
  .string()
  .max(200)
  .transform((value, context) => {
    const check = checkFavouriteSetName(value);
    if (check.ok) return check.name;
    context.addIssue({ code: "custom", message: check.message });
    return z.NEVER;
  });
export const favouriteSetIdSchema = z.uuid();
export const favouriteSortOrderSchema = z.number().int().min(0).max(1_000_000);
export const favouriteSetSortOrderSchema = z.number().int().min(0).max(10_000);
export const favouriteItemReferenceShape = {
  contentType: favouriteContentTypeSchema,
  contentKey: favouriteContentKeySchema,
};

const timestampSchema = z.iso.datetime({ offset: true });
export const accountFavouriteSchema = z
  .object({
    ...favouriteItemReferenceShape,
    createdAt: timestampSchema,
    setId: favouriteSetIdSchema.nullable(),
    sortOrder: favouriteSortOrderSchema,
    pinnedAt: timestampSchema.nullable(),
    lastOpenedAt: timestampSchema.nullable(),
  })
  .strict();
export const accountFavouriteSetSchema = z
  .object({
    id: favouriteSetIdSchema,
    name: favouriteSetNameSchema,
    sortOrder: favouriteSetSortOrderSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();
export const favouritesSnapshotSchema = z
  .object({
    version: z.literal(favouritesContractVersion),
    favourites: z.array(accountFavouriteSchema).max(maxFavouritesPerAccount),
    sets: z.array(accountFavouriteSetSchema).max(50),
  })
  .strict();
export const favouriteMembershipResponseSchema = z
  .object({ version: z.literal(favouritesContractVersion), saved: z.boolean() })
  .strict();
export const favouriteSetResponseSchema = z
  .object({ version: z.literal(favouritesContractVersion), set: accountFavouriteSetSchema })
  .strict();
export const favouriteUpdateResponseSchema = z
  .object({ version: z.literal(favouritesContractVersion), updated: z.literal(true) })
  .strict();
export const favouritesClearResponseSchema = z
  .object({ version: z.literal(favouritesContractVersion), cleared: z.literal(true) })
  .strict();

export type FavouriteContentType = z.infer<typeof favouriteContentTypeSchema>;
export type FavouriteSetName = string;
export type AccountFavourite = z.infer<typeof accountFavouriteSchema>;
export type AccountFavouriteSet = z.infer<typeof accountFavouriteSetSchema>;
