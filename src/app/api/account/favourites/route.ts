import { z } from "zod";

import {
  accountFavouriteSchema,
  accountFavouriteSetSchema,
  favouriteMembershipResponseSchema,
  favouriteItemReferenceShape,
  favouriteSetIdSchema,
  favouriteSetNameInputSchema,
  favouriteSetResponseSchema,
  favouriteUpdateResponseSchema,
  favouritesClearResponseSchema,
  favouritesContractVersion,
  maxFavouritesPerAccount,
  favouritesSnapshotSchema,
} from "@/lib/favourites-contract";
import { maxFavouriteSetsPerAccount } from "@/lib/favourite-set-name";
import { PublicApiError, jsonError } from "@/lib/http";
import { planFavouriteItemOrder } from "@/lib/favourites-order";
import { requireCanonicalFavouriteReference } from "@/lib/favourites-reference";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

const contractVersion = favouritesContractVersion;
const setNameSchema = favouriteSetNameInputSchema;
const setIdSchema = favouriteSetIdSchema;
const itemReferenceShape = favouriteItemReferenceShape;

const legacyMembershipSchema = z.object({ ...itemReferenceShape, saved: z.boolean() }).strict();
const versionedMembershipSchema = z
  .object({
    version: z.literal(contractVersion),
    action: z.literal("setMembership"),
    ...itemReferenceShape,
    saved: z.boolean(),
  })
  .strict();
const membershipSchema = z.union([legacyMembershipSchema, versionedMembershipSchema]);

const postSchema = z.discriminatedUnion("action", [
  z.object({ version: z.literal(contractVersion), action: z.literal("createSet"), name: setNameSchema }).strict(),
  z
    .object({
      version: z.literal(contractVersion),
      action: z.literal("renameSet"),
      setId: setIdSchema,
      name: setNameSchema,
    })
    .strict(),
  // Deleting a set never deletes its favourites: they move to Unsorted first.
  z.object({ version: z.literal(contractVersion), action: z.literal("deleteSet"), setId: setIdSchema }).strict(),
]);

const patchSchema = z.discriminatedUnion("action", [
  z
    .object({
      version: z.literal(contractVersion),
      action: z.literal("moveItem"),
      ...itemReferenceShape,
      setId: setIdSchema.nullable(),
    })
    .strict(),
  z
    .object({
      version: z.literal(contractVersion),
      action: z.literal("reorderItem"),
      ...itemReferenceShape,
      direction: z.enum(["up", "down"]),
    })
    .strict(),
  z.object({ version: z.literal(contractVersion), action: z.literal("recordOpen"), ...itemReferenceShape }).strict(),
  z
    .object({
      version: z.literal(contractVersion),
      action: z.literal("setPinned"),
      ...itemReferenceShape,
      pinned: z.boolean(),
    })
    .strict(),
  z
    .object({
      version: z.literal(contractVersion),
      action: z.literal("setItemOrder"),
      setId: setIdSchema.nullable(),
      items: z.array(z.object(itemReferenceShape).strict()).max(maxFavouritesPerAccount),
    })
    .strict(),
  z
    .object({
      version: z.literal(contractVersion),
      action: z.literal("reorderSet"),
      setId: setIdSchema,
      sortOrder: z.number().int().min(0).max(10_000),
    })
    .strict(),
]);

const deleteSchema = z.union([
  z.null(),
  z.object({ version: z.literal(contractVersion), action: z.literal("clearAll") }).strict(),
]);

const favouriteSetSchema = accountFavouriteSetSchema;
const snapshotSchema = favouritesSnapshotSchema;

type AdminClient = ReturnType<typeof createAdminClient>;

async function requireOwnedSet(supabase: AdminClient, userId: string, setId: string) {
  const { data, error } = await supabase
    .from("user_favourite_sets")
    .select("id")
    .eq("user_id", userId)
    .eq("id", setId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new PublicApiError("Favourite set was not found.", 404, { code: "favourite_set_not_found" });
}

function throwFavouriteSetWriteError(error: { code?: string; message: string }) {
  if (error.code === "23505") {
    throw new PublicApiError("A favourite set with that name already exists.", 409, {
      code: "favourite_set_name_conflict",
    });
  }
  throw new Error(error.message);
}

function handleRouteError(error: unknown) {
  if (error instanceof AuthenticationError) return unauthorizedResponse();
  return jsonError(error);
}

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase);
    const [favouritesResult, setsResult] = await Promise.all([
      supabase
        .from("user_favourites")
        .select("content_type,content_key,created_at,set_id,sort_order,pinned_at,last_opened_at")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .order("content_type", { ascending: true })
        .order("content_key", { ascending: true })
        .limit(maxFavouritesPerAccount),
      supabase
        .from("user_favourite_sets")
        .select("id,name,sort_order,created_at,updated_at")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(50),
    ]);
    if (favouritesResult.error) throw new Error(favouritesResult.error.message);
    if (setsResult.error) throw new Error(setsResult.error.message);

    const favourites = (favouritesResult.data ?? []).flatMap((row) => {
      const parsed = accountFavouriteSchema.safeParse({
        contentType: row.content_type,
        contentKey: row.content_key,
        createdAt: row.created_at,
        setId: row.set_id,
        sortOrder: row.sort_order,
        pinnedAt: row.pinned_at,
        lastOpenedAt: row.last_opened_at,
      });
      return parsed.success ? [parsed.data] : [];
    });
    const sets = (setsResult.data ?? []).flatMap((row) => {
      const parsed = favouriteSetSchema.safeParse({
        id: row.id,
        name: row.name,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      return parsed.success ? [parsed.data] : [];
    });

    return Response.json(snapshotSchema.parse({ version: contractVersion, favourites, sets }));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase);
    const input = await parseJsonBody(request, membershipSchema, "Saved-item request is invalid.");
    if (input.saved) {
      await requireCanonicalFavouriteReference(supabase, user.id, input.contentType, input.contentKey);
      const { data: existingFavourite, error: existingError } = await supabase
        .from("user_favourites")
        .select("content_key")
        .eq("user_id", user.id)
        .eq("content_type", input.contentType)
        .eq("content_key", input.contentKey)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (!existingFavourite) {
        const { count, error: countError } = await supabase
          .from("user_favourites")
          .select("content_key", { count: "exact", head: true })
          .eq("user_id", user.id);
        if (countError) throw new Error(countError.message);
        if ((count ?? 0) >= maxFavouritesPerAccount) {
          throw new PublicApiError("Favourite capacity was reached.", 409, { code: "favourite_capacity" });
        }
      }
      const { data: lastFavourite, error: orderError } = await supabase
        .from("user_favourites")
        .select("sort_order")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (orderError) throw new Error(orderError.message);
      const nextSortOrder = (lastFavourite?.sort_order ?? 0) + 10;
      if (nextSortOrder > 1_000_000) {
        throw new PublicApiError("Favourite order capacity was reached.", 409, { code: "favourite_order_capacity" });
      }
      const { error } = await supabase.from("user_favourites").upsert(
        {
          user_id: user.id,
          content_type: input.contentType,
          content_key: input.contentKey,
          sort_order: nextSortOrder,
        },
        { onConflict: "user_id,content_type,content_key", ignoreDuplicates: true },
      );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("user_favourites")
        .delete()
        .eq("user_id", user.id)
        .eq("content_type", input.contentType)
        .eq("content_key", input.contentKey);
      if (error) throw new Error(error.message);
    }
    return Response.json(favouriteMembershipResponseSchema.parse({ version: contractVersion, saved: input.saved }));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase);
    const input = await parseJsonBody(request, postSchema, "Favourite-set request is invalid.");
    if (input.action === "deleteSet") {
      await requireOwnedSet(supabase, user.id, input.setId);
      const { error: unsetError } = await supabase
        .from("user_favourites")
        .update({ set_id: null })
        .eq("user_id", user.id)
        .eq("set_id", input.setId);
      if (unsetError) throw new Error(unsetError.message);
      const { data, error } = await supabase
        .from("user_favourite_sets")
        .delete()
        .eq("user_id", user.id)
        .eq("id", input.setId)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new PublicApiError("Favourite set was not found.", 404, { code: "favourite_set_not_found" });
      return Response.json(favouriteUpdateResponseSchema.parse({ version: contractVersion, updated: true }));
    }
    if (input.action === "createSet") {
      const { count, error: countError } = await supabase
        .from("user_favourite_sets")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (countError) throw new Error(countError.message);
      if ((count ?? 0) >= maxFavouriteSetsPerAccount) {
        throw new PublicApiError(`You can have up to ${maxFavouriteSetsPerAccount} favourite sets.`, 409, {
          code: "favourite_set_limit",
        });
      }
      const { data: lastSet, error: orderError } = await supabase
        .from("user_favourite_sets")
        .select("sort_order")
        .eq("user_id", user.id)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (orderError) throw new Error(orderError.message);
      const sortOrder = (lastSet?.sort_order ?? -1) + 1;
      if (sortOrder > 10_000) {
        throw new PublicApiError("Favourite set order capacity was reached.", 409, {
          code: "favourite_set_order_capacity",
        });
      }
      const { data, error } = await supabase
        .from("user_favourite_sets")
        .insert({ user_id: user.id, name: input.name, sort_order: sortOrder })
        .select("id,name,sort_order,created_at,updated_at")
        .single();
      if (error) throwFavouriteSetWriteError(error);
      if (!data) throw new Error("Favourite set creation did not return the created set.");
      return Response.json(
        favouriteSetResponseSchema.parse({
          version: contractVersion,
          set: favouriteSetSchema.parse({
            id: data.id,
            name: data.name,
            sortOrder: data.sort_order,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
          }),
        }),
      );
    }

    const { data, error } = await supabase
      .from("user_favourite_sets")
      .update({ name: input.name, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("id", input.setId)
      .select("id,name,sort_order,created_at,updated_at")
      .maybeSingle();
    if (error) throwFavouriteSetWriteError(error);
    if (!data) throw new PublicApiError("Favourite set was not found.", 404, { code: "favourite_set_not_found" });
    return Response.json(
      favouriteSetResponseSchema.parse({
        version: contractVersion,
        set: favouriteSetSchema.parse({
          id: data.id,
          name: data.name,
          sortOrder: data.sort_order,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        }),
      }),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase);
    const input = await parseJsonBody(request, patchSchema, "Favourite update is invalid.");
    if (input.action === "reorderSet") {
      await requireOwnedSet(supabase, user.id, input.setId);
      const { data, error } = await supabase
        .from("user_favourite_sets")
        .update({ sort_order: input.sortOrder, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("id", input.setId)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new PublicApiError("Favourite set was not found.", 404, { code: "favourite_set_not_found" });
      return Response.json(favouriteUpdateResponseSchema.parse({ version: contractVersion, updated: true }));
    }
    if (input.action === "setItemOrder") {
      if (input.setId) await requireOwnedSet(supabase, user.id, input.setId);
      const membersQuery = supabase
        .from("user_favourites")
        .select("content_type,content_key,sort_order")
        .eq("user_id", user.id);
      const { data: members, error: membersError } = await (input.setId
        ? membersQuery.eq("set_id", input.setId)
        : membersQuery.is("set_id", null));
      if (membersError) throw new Error(membersError.message);
      const plan = planFavouriteItemOrder(
        (members ?? []).map((row) => ({
          contentType: row.content_type,
          contentKey: row.content_key,
          sortOrder: row.sort_order,
        })),
        input.items,
      );
      if (!plan.ok) {
        throw new PublicApiError("The set changed before the new order was saved.", 409, {
          code: "favourite_order_stale",
        });
      }
      for (const row of plan.updates) {
        const { error } = await supabase
          .from("user_favourites")
          .update({ sort_order: row.sortOrder })
          .eq("user_id", user.id)
          .eq("content_type", row.contentType as (typeof input.items)[number]["contentType"])
          .eq("content_key", row.contentKey);
        if (error) throw new Error(error.message);
      }
      return Response.json(favouriteUpdateResponseSchema.parse({ version: contractVersion, updated: true }));
    }
    if (input.action === "reorderItem") {
      const { data, error } = await supabase.rpc("reorder_user_favourite", {
        p_user_id: user.id,
        p_content_type: input.contentType,
        p_content_key: input.contentKey,
        p_direction: input.direction,
      });
      if (error) throw new Error(error.message);
      if (!data) throw new PublicApiError("Favourite was not found.", 404, { code: "favourite_not_found" });
      return Response.json(favouriteUpdateResponseSchema.parse({ version: contractVersion, updated: true }));
    }
    if (input.action === "moveItem" && input.setId) await requireOwnedSet(supabase, user.id, input.setId);

    const update =
      input.action === "moveItem"
        ? { set_id: input.setId }
        : input.action === "recordOpen"
          ? { last_opened_at: new Date().toISOString() }
          : { pinned_at: input.pinned ? new Date().toISOString() : null };
    const { data, error } = await supabase
      .from("user_favourites")
      .update(update)
      .eq("user_id", user.id)
      .eq("content_type", input.contentType)
      .eq("content_key", input.contentKey)
      .select("content_type,content_key")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new PublicApiError("Favourite was not found.", 404, { code: "favourite_not_found" });
    return Response.json(favouriteUpdateResponseSchema.parse({ version: contractVersion, updated: true }));
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase);
    await parseJsonBody(request, deleteSchema, "Favourite deletion request is invalid.");
    const { error } = await supabase.from("user_favourites").delete().eq("user_id", user.id);
    if (error) throw new Error(error.message);
    return Response.json(favouritesClearResponseSchema.parse({ version: contractVersion, cleared: true }));
  } catch (error) {
    return handleRouteError(error);
  }
}
