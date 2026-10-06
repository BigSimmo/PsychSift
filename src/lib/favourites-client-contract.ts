/**
 * Client-safe slice of the favourites API contract.
 *
 * The server route owns the full Zod contract in `favourites-contract.ts`.
 * Keeping its runtime validator out of this shared-shell provider prevents the
 * search home from downloading Zod solely to validate a small account response.
 * These parsers still fail closed on malformed successful responses.
 */

import { isValidFavouriteSetName } from "@/lib/favourite-set-name";

export const favouritesContractVersion = 1 as const;
export const maxFavouritesPerAccount = 2000 as const;
export const favouriteContentTypes = ["service", "form", "differential", "therapy"] as const;
export type FavouriteContentType = (typeof favouriteContentTypes)[number];

export const favouriteSetNames = [
  "Clinical review",
  "Ward round",
  "On call",
  "Follow up",
  "Teaching",
  "Reference",
] as const;
/** The six original names, now offered as suggestions. Any name passing the set-name rules is allowed. */
export type FavouriteSetName = string;

export type AccountFavourite = {
  contentType: FavouriteContentType;
  contentKey: string;
  createdAt: string;
  setId: string | null;
  sortOrder: number;
  pinnedAt: string | null;
  lastOpenedAt: string | null;
};

export type AccountFavouriteSet = {
  id: string;
  name: FavouriteSetName;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type FavouritesSnapshot = {
  version: typeof favouritesContractVersion;
  favourites: AccountFavourite[];
  sets: AccountFavouriteSet[];
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canonicalKeyPattern = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/;
// Fractional seconds are 1-9 digits, not exactly 3: the route passes Supabase
// timestamptz values through untouched, and Postgres serialises `now()` at
// microsecond precision with trailing zeros trimmed (`.550361+00:00`, `.5+00:00`).
// The server's Zod check is precision-agnostic; the client must be too, or one
// live row nulls the whole snapshot and the Favourites hub shows a load error.
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && isoTimestampPattern.test(value) && Number.isFinite(Date.parse(value));
}

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || timestamp(value);
}

function contentType(value: unknown): value is FavouriteContentType {
  return typeof value === "string" && (favouriteContentTypes as readonly string[]).includes(value);
}

function setName(value: unknown): value is FavouriteSetName {
  return isValidFavouriteSetName(value);
}

function accountFavourite(value: unknown): value is AccountFavourite {
  const candidate = record(value);
  return Boolean(
    candidate &&
    exactKeys(candidate, [
      "contentType",
      "contentKey",
      "createdAt",
      "setId",
      "sortOrder",
      "pinnedAt",
      "lastOpenedAt",
    ]) &&
    contentType(candidate.contentType) &&
    typeof candidate.contentKey === "string" &&
    candidate.contentKey.length > 0 &&
    candidate.contentKey.length <= 180 &&
    canonicalKeyPattern.test(candidate.contentKey) &&
    timestamp(candidate.createdAt) &&
    (candidate.setId === null || (typeof candidate.setId === "string" && uuidPattern.test(candidate.setId))) &&
    typeof candidate.sortOrder === "number" &&
    Number.isInteger(candidate.sortOrder) &&
    candidate.sortOrder >= 0 &&
    candidate.sortOrder <= 1_000_000 &&
    nullableTimestamp(candidate.pinnedAt) &&
    nullableTimestamp(candidate.lastOpenedAt),
  );
}

function accountFavouriteSet(value: unknown): value is AccountFavouriteSet {
  const candidate = record(value);
  return Boolean(
    candidate &&
    exactKeys(candidate, ["id", "name", "sortOrder", "createdAt", "updatedAt"]) &&
    typeof candidate.id === "string" &&
    uuidPattern.test(candidate.id) &&
    setName(candidate.name) &&
    typeof candidate.sortOrder === "number" &&
    Number.isInteger(candidate.sortOrder) &&
    candidate.sortOrder >= 0 &&
    candidate.sortOrder <= 10_000 &&
    timestamp(candidate.createdAt) &&
    timestamp(candidate.updatedAt),
  );
}

export function parseFavouritesSnapshot(value: unknown): FavouritesSnapshot | null {
  const candidate = record(value);
  if (
    !candidate ||
    !exactKeys(candidate, ["version", "favourites", "sets"]) ||
    candidate.version !== favouritesContractVersion ||
    !Array.isArray(candidate.favourites) ||
    !Array.isArray(candidate.sets) ||
    candidate.favourites.length > maxFavouritesPerAccount ||
    candidate.sets.length > 50 ||
    !candidate.favourites.every(accountFavourite) ||
    !candidate.sets.every(accountFavouriteSet)
  ) {
    return null;
  }
  return candidate as FavouritesSnapshot;
}

export function isFavouriteMembershipResponse(value: unknown): boolean {
  const candidate = record(value);
  return Boolean(
    candidate &&
    exactKeys(candidate, ["version", "saved"]) &&
    candidate.version === favouritesContractVersion &&
    typeof candidate.saved === "boolean",
  );
}

export function parseFavouriteSetResponse(value: unknown): AccountFavouriteSet | null {
  const candidate = record(value);
  return candidate &&
    exactKeys(candidate, ["version", "set"]) &&
    candidate.version === favouritesContractVersion &&
    accountFavouriteSet(candidate.set)
    ? candidate.set
    : null;
}

export function isFavouriteUpdateResponse(value: unknown): boolean {
  const candidate = record(value);
  return Boolean(
    candidate &&
    exactKeys(candidate, ["version", "updated"]) &&
    candidate.version === favouritesContractVersion &&
    candidate.updated === true,
  );
}

export function isFavouritesClearResponse(value: unknown): boolean {
  const candidate = record(value);
  return Boolean(
    candidate &&
    exactKeys(candidate, ["version", "cleared"]) &&
    candidate.version === favouritesContractVersion &&
    candidate.cleared === true,
  );
}
