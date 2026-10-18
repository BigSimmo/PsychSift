"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuthSession } from "@/lib/supabase/client";
import { parseApiErrorResponse } from "@/lib/api-client-error";
import {
  type AccountFavourite,
  type AccountFavouriteSet,
  type FavouriteContentType,
  type FavouriteSetName,
  favouriteSetNames,
  favouritesContractVersion,
  isFavouriteMembershipResponse,
  isFavouriteUpdateResponse,
  isFavouritesClearResponse,
  parseFavouriteSetResponse,
  parseFavouritesSnapshot,
} from "@/lib/favourites-client-contract";
import {
  readSavedRegistrySlugs,
  savedDifferentialsStorageKey,
  savedFormsStorageKey,
  savedServicesStorageKey,
  savedTherapiesStorageKey,
  subscribeSavedRegistrySlugs,
  writeSavedRegistrySlugs,
} from "@/lib/saved-registry-storage";

export { favouriteSetNames };
export type { AccountFavourite, AccountFavouriteSet, FavouriteContentType, FavouriteSetName };

type FavouritesByType = Record<FavouriteContentType, string[]>;
type FavouriteMutationState = {
  confirmed: boolean;
  confirmedRecord: AccountFavourite | null;
  desired: boolean;
  pending: number;
  tail: Promise<void>;
};

const emptyFavourites: FavouritesByType = { service: [], form: [], differential: [], therapy: [] };
const storageKeyByType = {
  service: savedServicesStorageKey,
  form: savedFormsStorageKey,
  differential: savedDifferentialsStorageKey,
  therapy: savedTherapiesStorageKey,
} satisfies Record<FavouriteContentType, string>;
const demoAccountData = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

function readDemoFavourites(): FavouritesByType {
  return {
    service: readSavedRegistrySlugs(savedServicesStorageKey),
    form: readSavedRegistrySlugs(savedFormsStorageKey),
    differential: readSavedRegistrySlugs(savedDifferentialsStorageKey),
    therapy: readSavedRegistrySlugs(savedTherapiesStorageKey),
  };
}

type AccountDataContextValue = {
  favourites: FavouritesByType;
  favouriteItems: AccountFavourite[];
  favouriteSets: AccountFavouriteSet[];
  ready: boolean;
  /** Failure of GET /api/account/favourites (initial load or reload). */
  loadError: string | null;
  /** Failure of a save/clear mutation after the library was already loaded. */
  error: string | null;
  isAuthenticated: boolean;
  isSaved: (contentType: FavouriteContentType, contentKey: string) => boolean;
  /** Re-issue the account favourites request for the current identity. A failed
      load clears every saved slug, so without this a Retry offered by a
      favourites surface has nothing left to re-request and cannot recover. */
  reload: () => void;
  setFavourite: (contentType: FavouriteContentType, contentKey: string, saved: boolean) => Promise<boolean>;
  createFavouriteSet: (name: FavouriteSetName) => Promise<AccountFavouriteSet | null>;
  /** Names stay on the fixed list, so a set label can never become a patient-note field. */
  renameFavouriteSet: (setId: string, name: FavouriteSetName) => Promise<AccountFavouriteSet | null>;
  /** Deletes a set. Its favourites stay saved and move to Unsorted. */
  deleteFavouriteSet: (setId: string) => Promise<boolean>;
  moveFavourite: (contentType: FavouriteContentType, contentKey: string, setId: string | null) => Promise<boolean>;
  /** Saves an exact order for every favourite in one set (or Unsorted when setId is null). */
  setFavouriteOrder: (
    setId: string | null,
    items: Array<{ contentType: FavouriteContentType; contentKey: string }>,
  ) => Promise<boolean>;
  reorderFavourite: (
    contentType: FavouriteContentType,
    contentKey: string,
    direction: "up" | "down",
  ) => Promise<boolean>;
  recordFavouriteOpen: (contentType: FavouriteContentType, contentKey: string) => Promise<boolean>;
  /** Adds the favourite to (or removes it from) Quick launch. */
  setFavouritePinned: (contentType: FavouriteContentType, contentKey: string, pinned: boolean) => Promise<boolean>;
  clearFavourites: () => Promise<boolean>;
};

const AccountDataContext = createContext<AccountDataContextValue | null>(null);

function favouritesByType(rows: AccountFavourite[]): FavouritesByType {
  const result: FavouritesByType = { service: [], form: [], differential: [], therapy: [] };
  for (const row of rows) {
    result[row.contentType].push(row.contentKey);
  }
  return result;
}

export function AccountDataProvider({ children }: { children: ReactNode }) {
  const auth = useAuthSession();
  const scope = `${auth.authEpoch}:${auth.status}:${auth.session?.user.id ?? ""}`;
  const epoch = auth.authEpoch;
  const isAuthEpochCurrent = auth.isAuthEpochCurrent;
  const currentScope = useRef<string | null>(scope);
  const [owner, setOwner] = useState(scope);
  const isCurrent = useCallback(
    () => currentScope.current === scope && (isAuthEpochCurrent?.(epoch) ?? true),
    [epoch, isAuthEpochCurrent, scope],
  );
  const [favourites, setFavourites] = useState<FavouritesByType>(emptyFavourites);
  const [favouriteItems, setFavouriteItems] = useState<AccountFavourite[]>([]);
  const [favouriteSets, setFavouriteSets] = useState<AccountFavouriteSet[]>([]);
  const favouritesRef = useRef(favourites);
  const favouriteItemsRef = useRef(favouriteItems);
  const favouriteSetsRef = useRef(favouriteSets);
  const favouriteMutationsRef = useRef(new Map<string, FavouriteMutationState>());
  const favouriteClearTailRef = useRef<Promise<void>>(Promise.resolve());
  const structuredMutationTailRef = useRef<Promise<void>>(Promise.resolve());
  const structuredMutationVersionRef = useRef(0);
  const [ready, setReady] = useState(auth.status !== "authenticated");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the load effect unchanged, so an explicit Retry gets
  // exactly the same clearing and abort semantics as an auth transition.
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const reload = useCallback(() => {
    if (isCurrent()) setReloadAttempt((attempt) => attempt + 1);
  }, [isCurrent]);
  if (owner !== scope) {
    setOwner(scope);
    setFavourites(emptyFavourites);
    setFavouriteItems([]);
    setFavouriteSets([]);
    setReady(auth.status !== "authenticated");
    setLoadError(null);
    setError(null);
  }
  // Invalidate retained callbacks and detach old queues before any passive read
  // or user interaction can run for the newly committed identity.
  useLayoutEffect(() => {
    currentScope.current = scope;
    favouritesRef.current = emptyFavourites;
    favouriteItemsRef.current = [];
    favouriteSetsRef.current = [];
    favouriteMutationsRef.current = new Map();
    favouriteClearTailRef.current = Promise.resolve();
    structuredMutationTailRef.current = Promise.resolve();
    structuredMutationVersionRef.current = 0;
    return () => {
      currentScope.current = null;
    };
  }, [scope]);
  const replaceFavourites = useCallback((next: FavouritesByType) => {
    favouritesRef.current = next;
    setFavourites(next);
  }, []);
  const replaceFavouriteItems = useCallback((next: AccountFavourite[]) => {
    favouriteItemsRef.current = next;
    setFavouriteItems(next);
  }, []);
  const replaceFavouriteSets = useCallback((next: AccountFavouriteSet[]) => {
    favouriteSetsRef.current = next;
    setFavouriteSets(next);
  }, []);
  const applyFavourite = useCallback(
    (contentType: FavouriteContentType, contentKey: string, saved: boolean) => {
      const current = favouritesRef.current;
      replaceFavourites({
        ...current,
        [contentType]: saved
          ? [contentKey, ...current[contentType].filter((item) => item !== contentKey)]
          : current[contentType].filter((item) => item !== contentKey),
      });
      const existing = favouriteItemsRef.current.find(
        (item) => item.contentType === contentType && item.contentKey === contentKey,
      );
      replaceFavouriteItems(
        saved
          ? existing
            ? favouriteItemsRef.current
            : [
                {
                  contentType,
                  contentKey,
                  createdAt: new Date().toISOString(),
                  setId: null,
                  sortOrder: 0,
                  pinnedAt: null,
                  lastOpenedAt: null,
                },
                ...favouriteItemsRef.current,
              ]
          : favouriteItemsRef.current.filter(
              (item) => item.contentType !== contentType || item.contentKey !== contentKey,
            ),
      );
    },
    [replaceFavouriteItems, replaceFavourites],
  );
  // Depended on by identity rather than through `auth`, which would re-run the
  // load effect and recreate action callbacks on every auth-object render.
  const authStatus = auth.status;
  const authorizationHeader = auth.authorizationHeader;
  const markSessionExpired = auth.markSessionExpired;

  useEffect(() => {
    if (authStatus !== "authenticated") {
      const refreshDemoFavourites = () => replaceFavourites(demoAccountData ? readDemoFavourites() : emptyFavourites);
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled || !isCurrent()) return;
        refreshDemoFavourites();
        replaceFavouriteItems([]);
        replaceFavouriteSets([]);
        setReady(true);
        setLoadError(null);
        setError(null);
      });
      const unsubscribe = demoAccountData ? subscribeSavedRegistrySlugs(refreshDemoFavourites) : undefined;
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    }

    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted && isCurrent()) setReady(false);
    });
    fetch("/api/account/favourites", {
      cache: "no-store",
      headers: authorizationHeader,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (controller.signal.aborted || !isCurrent()) return;
        // A rejected token cannot be recovered by re-sending it, so an expired
        // session has to change the auth state rather than only the error text.
        // Retry now exists on this path; without this it would reissue the same
        // 401 forever instead of routing the reader to sign in. The mutation
        // paths below already do this.
        if (response.status === 401) markSessionExpired();
        if (!response.ok) throw await parseApiErrorResponse(response);
        const payload: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted || !isCurrent()) return;
        const snapshot = parseFavouritesSnapshot(payload);
        if (!snapshot) throw new Error("Saved items returned an invalid response.");
        replaceFavourites(favouritesByType(snapshot.favourites));
        replaceFavouriteItems(snapshot.favourites);
        replaceFavouriteSets(snapshot.sets);
        setLoadError(null);
        setError(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted || !isCurrent()) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        replaceFavourites(emptyFavourites);
        replaceFavouriteItems([]);
        replaceFavouriteSets([]);
        setLoadError(cause instanceof Error ? cause.message : "Saved items could not be loaded.");
        setError(null);
      })
      .finally(() => {
        if (!controller.signal.aborted && isCurrent()) setReady(true);
      });

    return () => controller.abort();
  }, [
    isCurrent,
    auth.authEpoch,
    authorizationHeader,
    authStatus,
    markSessionExpired,
    reloadAttempt,
    replaceFavouriteItems,
    replaceFavouriteSets,
    replaceFavourites,
  ]);

  const setFavourite = useCallback(
    async (contentType: FavouriteContentType, contentKey: string, saved: boolean) => {
      if (!isCurrent()) return false;
      if (authStatus !== "authenticated") {
        if (demoAccountData) {
          const current = favouritesRef.current[contentType];
          return writeSavedRegistrySlugs(
            storageKeyByType[contentType],
            saved
              ? [contentKey, ...current.filter((item) => item !== contentKey)]
              : current.filter((item) => item !== contentKey),
          );
        }
        setError("Sign in or create an account to save favourites.");
        return false;
      }

      const key = contentKey.trim();
      if (!key) return false;
      const mutationKey = `${contentType}:${key}`;
      let mutation = favouriteMutationsRef.current.get(mutationKey);
      if (!mutation) {
        mutation = {
          confirmed: favouritesRef.current[contentType].includes(key),
          confirmedRecord:
            favouriteItemsRef.current.find((item) => item.contentType === contentType && item.contentKey === key) ??
            null,
          desired: saved,
          pending: 0,
          tail: Promise.resolve(),
        };
        favouriteMutationsRef.current.set(mutationKey, mutation);
      }

      mutation.desired = saved;
      mutation.pending += 1;
      applyFavourite(contentType, key, saved);

      // Per-item writes remain independent, but every write observes the latest
      // clear-all barrier. A write that begins after Clear therefore cannot race
      // ahead of its DELETE and recreate a favourite out of order.
      const request = Promise.all([mutation.tail, favouriteClearTailRef.current]).then(async () => {
        if (!isCurrent()) return false;
        const response = await fetch("/api/account/favourites", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authorizationHeader },
          body: JSON.stringify({
            version: favouritesContractVersion,
            action: "setMembership",
            contentType,
            contentKey: key,
            saved,
          }),
        }).catch(() => null);
        if (!isCurrent()) return false;
        if (!response?.ok) {
          // Mutation failures must not poison loadError: the library already loaded,
          // and Retry-on-GET would mis-describe a failed write as an unread library.
          const message = response
            ? (await parseApiErrorResponse(response)).message
            : "Saved items could not be updated.";
          if (!isCurrent()) return false;
          setError(message);
          if (response?.status === 401) markSessionExpired();
          return false;
        }
        const payload = await response.json().catch(() => null);
        if (!isCurrent()) return false;
        if (!isFavouriteMembershipResponse(payload)) {
          setError("Saved-item response was invalid.");
          return false;
        }
        mutation.confirmed = saved;
        mutation.confirmedRecord =
          favouriteItemsRef.current.find((item) => item.contentType === contentType && item.contentKey === key) ?? null;
        setError(null);
        return true;
      });
      mutation.tail = request.then(
        () => undefined,
        () => undefined,
      );

      const succeeded = await request;
      if (!isCurrent()) return false;
      mutation.pending -= 1;
      if (mutation.pending === 0) {
        applyFavourite(contentType, key, mutation.confirmed);
        if (mutation.confirmed && mutation.confirmedRecord) {
          replaceFavouriteItems([
            mutation.confirmedRecord,
            ...favouriteItemsRef.current.filter((item) => item.contentType !== contentType || item.contentKey !== key),
          ]);
        }
        favouriteMutationsRef.current.delete(mutationKey);
      } else {
        applyFavourite(contentType, key, mutation.desired);
      }
      return succeeded;
    },
    [applyFavourite, authStatus, authorizationHeader, isCurrent, markSessionExpired, replaceFavouriteItems],
  );

  const runStructuredMutation = useCallback(
    async (method: "POST" | "PATCH", body: Record<string, unknown>, failureMessage: string) => {
      if (!isCurrent()) return null;
      if (authStatus !== "authenticated") {
        setError("Sign in or create an account to organise favourites.");
        return null;
      }
      const request = Promise.all([structuredMutationTailRef.current, favouriteClearTailRef.current]).then(async () => {
        if (!isCurrent()) return null;
        const response = await fetch("/api/account/favourites", {
          method,
          headers: { "Content-Type": "application/json", ...authorizationHeader },
          body: JSON.stringify({ version: favouritesContractVersion, ...body }),
        }).catch(() => null);
        if (!isCurrent()) return null;
        if (!response?.ok) {
          const message = response ? (await parseApiErrorResponse(response)).message : failureMessage;
          if (!isCurrent()) return null;
          setError(message);
          if (response?.status === 401) markSessionExpired();
          return null;
        }
        const payload = await response.json().catch(() => null);
        if (!isCurrent()) return null;
        setError(null);
        return payload as unknown;
      });
      structuredMutationTailRef.current = request.then(
        () => undefined,
        () => undefined,
      );
      return request;
    },
    [authStatus, authorizationHeader, isCurrent, markSessionExpired],
  );

  const createFavouriteSet = useCallback(
    async (name: FavouriteSetName) => {
      if (!isCurrent()) return null;
      const version = ++structuredMutationVersionRef.current;
      const previous = favouriteSetsRef.current;
      const now = new Date().toISOString();
      const temporary: AccountFavouriteSet = {
        id: crypto.randomUUID(),
        name,
        sortOrder: Math.min(previous.length, 10000),
        createdAt: now,
        updatedAt: now,
      };
      replaceFavouriteSets([...previous, temporary]);
      const payload = await runStructuredMutation(
        "POST",
        { action: "createSet", name },
        "Favourite set could not be created.",
      );
      if (!isCurrent()) return null;
      if (!payload) {
        if (structuredMutationVersionRef.current === version) replaceFavouriteSets(previous);
        else void structuredMutationTailRef.current.then(reload);
        return null;
      }
      const created = parseFavouriteSetResponse(payload);
      if (!created) {
        replaceFavouriteSets(previous);
        setError("Favourite set response was invalid.");
        return null;
      }
      replaceFavouriteSets(favouriteSetsRef.current.map((set) => (set.id === temporary.id ? created : set)));
      return created;
    },
    [isCurrent, reload, replaceFavouriteSets, runStructuredMutation],
  );

  const renameFavouriteSet = useCallback(
    async (setId: string, name: FavouriteSetName) => {
      if (!isCurrent()) return null;
      const version = ++structuredMutationVersionRef.current;
      const previous = favouriteSetsRef.current;
      replaceFavouriteSets(previous.map((set) => (set.id === setId ? { ...set, name } : set)));
      const payload = await runStructuredMutation(
        "POST",
        { action: "renameSet", setId, name },
        "Favourite set could not be renamed.",
      );
      if (!isCurrent()) return null;
      const renamed = payload ? parseFavouriteSetResponse(payload) : null;
      if (renamed) {
        replaceFavouriteSets(favouriteSetsRef.current.map((set) => (set.id === setId ? renamed : set)));
        return renamed;
      }
      if (payload) setError("Favourite set response was invalid.");
      if (structuredMutationVersionRef.current === version) replaceFavouriteSets(previous);
      else void structuredMutationTailRef.current.then(reload);
      return null;
    },
    [isCurrent, reload, replaceFavouriteSets, runStructuredMutation],
  );

  const deleteFavouriteSet = useCallback(
    async (setId: string) => {
      if (!isCurrent()) return false;
      const version = ++structuredMutationVersionRef.current;
      const previousSets = favouriteSetsRef.current;
      const previousItems = favouriteItemsRef.current;
      replaceFavouriteSets(previousSets.filter((set) => set.id !== setId));
      replaceFavouriteItems(previousItems.map((item) => (item.setId === setId ? { ...item, setId: null } : item)));
      const payload = await runStructuredMutation(
        "POST",
        { action: "deleteSet", setId },
        "Favourite set could not be deleted.",
      );
      if (!isCurrent()) return false;
      if (isFavouriteUpdateResponse(payload)) return true;
      if (payload) setError("Favourite set response was invalid.");
      if (structuredMutationVersionRef.current === version) {
        replaceFavouriteSets(previousSets);
        replaceFavouriteItems(previousItems);
      } else void structuredMutationTailRef.current.then(reload);
      return false;
    },
    [isCurrent, reload, replaceFavouriteItems, replaceFavouriteSets, runStructuredMutation],
  );

  const setFavouriteOrder = useCallback(
    async (setId: string | null, items: Array<{ contentType: FavouriteContentType; contentKey: string }>) => {
      if (!isCurrent()) return false;
      const version = ++structuredMutationVersionRef.current;
      const previous = favouriteItemsRef.current;
      const position = new Map(items.map((item, index) => [`${item.contentType}:${item.contentKey}`, index]));
      replaceFavouriteItems(
        previous.map((item) => {
          const index = position.get(`${item.contentType}:${item.contentKey}`);
          return index === undefined || item.setId !== setId ? item : { ...item, sortOrder: (index + 1) * 10 };
        }),
      );
      const payload = await runStructuredMutation(
        "PATCH",
        { action: "setItemOrder", setId, items },
        "Favourite order could not be updated.",
      );
      if (!isCurrent()) return false;
      if (isFavouriteUpdateResponse(payload)) return true;
      if (payload) setError("Favourite order response was invalid.");
      if (structuredMutationVersionRef.current === version) replaceFavouriteItems(previous);
      // A stale order (someone changed the set elsewhere) reloads the true order.
      void structuredMutationTailRef.current.then(reload);
      return false;
    },
    [isCurrent, reload, replaceFavouriteItems, runStructuredMutation],
  );

  const moveFavourite = useCallback(
    async (contentType: FavouriteContentType, contentKey: string, setId: string | null) => {
      if (!isCurrent()) return false;
      const version = ++structuredMutationVersionRef.current;
      const previous = favouriteItemsRef.current;
      replaceFavouriteItems(
        previous.map((item) =>
          item.contentType === contentType && item.contentKey === contentKey ? { ...item, setId } : item,
        ),
      );
      const payload = await runStructuredMutation(
        "PATCH",
        { action: "moveItem", contentType, contentKey, setId },
        "Favourite could not be moved.",
      );
      if (!isCurrent()) return false;
      if (isFavouriteUpdateResponse(payload)) return true;
      if (payload) setError("Favourite move response was invalid.");
      if (structuredMutationVersionRef.current === version) replaceFavouriteItems(previous);
      else void structuredMutationTailRef.current.then(reload);
      return false;
    },
    [isCurrent, reload, replaceFavouriteItems, runStructuredMutation],
  );

  const reorderFavourite = useCallback(
    async (contentType: FavouriteContentType, contentKey: string, direction: "up" | "down") => {
      if (!isCurrent()) return false;
      const payload = await runStructuredMutation(
        "PATCH",
        { action: "reorderItem", contentType, contentKey, direction },
        "Favourite order could not be updated.",
      );
      if (!isCurrent()) return false;
      if (isFavouriteUpdateResponse(payload)) {
        reload();
        return true;
      }
      if (payload) setError("Favourite order response was invalid.");
      return false;
    },
    [isCurrent, reload, runStructuredMutation],
  );

  const setFavouritePinned = useCallback(
    async (contentType: FavouriteContentType, contentKey: string, pinned: boolean) => {
      if (!isCurrent()) return false;
      const version = ++structuredMutationVersionRef.current;
      const previous = favouriteItemsRef.current;
      const pinnedAt = pinned ? new Date().toISOString() : null;
      replaceFavouriteItems(
        previous.map((item) =>
          item.contentType === contentType && item.contentKey === contentKey ? { ...item, pinnedAt } : item,
        ),
      );
      const payload = await runStructuredMutation(
        "PATCH",
        { action: "setPinned", contentType, contentKey, pinned },
        pinned ? "Favourite could not be added to quick launch." : "Favourite could not be removed from quick launch.",
      );
      if (!isCurrent()) return false;
      if (isFavouriteUpdateResponse(payload)) return true;
      if (payload) setError("Favourite pin response was invalid.");
      if (structuredMutationVersionRef.current === version) replaceFavouriteItems(previous);
      else void structuredMutationTailRef.current.then(reload);
      return false;
    },
    [isCurrent, reload, replaceFavouriteItems, runStructuredMutation],
  );

  const recordFavouriteOpen = useCallback(
    async (contentType: FavouriteContentType, contentKey: string) => {
      if (!isCurrent()) return false;
      const version = ++structuredMutationVersionRef.current;
      const previous = favouriteItemsRef.current;
      const existing = previous.find((item) => item.contentType === contentType && item.contentKey === contentKey);
      const nowMs = Date.now();
      const openedAt = new Date(nowMs).toISOString();
      const lastOpenedMs = existing?.lastOpenedAt ? Date.parse(existing.lastOpenedAt) : Number.NaN;
      const shouldUpdateState = Boolean(
        existing && (!Number.isFinite(lastOpenedMs) || Math.abs(nowMs - lastOpenedMs) >= 1_000),
      );
      if (shouldUpdateState) {
        replaceFavouriteItems(
          previous.map((item) =>
            item.contentType === contentType && item.contentKey === contentKey
              ? { ...item, lastOpenedAt: openedAt }
              : item,
          ),
        );
      }
      const payload = await runStructuredMutation(
        "PATCH",
        { action: "recordOpen", contentType, contentKey },
        "Favourite activity could not be recorded.",
      );
      if (!isCurrent()) return false;
      if (isFavouriteUpdateResponse(payload)) return true;
      if (payload) setError("Favourite activity response was invalid.");
      if (shouldUpdateState) {
        if (structuredMutationVersionRef.current === version) replaceFavouriteItems(previous);
        else void structuredMutationTailRef.current.then(reload);
      }
      return false;
    },
    [isCurrent, reload, replaceFavouriteItems, runStructuredMutation],
  );

  const clearFavourites = useCallback(async () => {
    if (!isCurrent()) return false;
    if (authStatus !== "authenticated") {
      if (!demoAccountData) return false;
      return (Object.values(storageKeyByType) as string[]).every((key) => writeSavedRegistrySlugs(key, []));
    }

    // Clear is a global mutation boundary. Wait for every already-enqueued PUT,
    // and make later PUTs wait for this DELETE through favouriteClearTailRef.
    const pendingMutationTails = [...favouriteMutationsRef.current.values()].map((mutation) => mutation.tail);
    const request = Promise.all([
      favouriteClearTailRef.current,
      structuredMutationTailRef.current,
      ...pendingMutationTails,
    ]).then(async () => {
      if (!isCurrent()) return false;
      const response = await fetch("/api/account/favourites", {
        method: "DELETE",
        headers: authorizationHeader,
      }).catch(() => null);
      if (!isCurrent()) return false;
      if (!response?.ok) {
        setError("Saved items could not be cleared.");
        if (response?.status === 401) markSessionExpired();
        return false;
      }
      const payload = await response.json().catch(() => null);
      if (!isCurrent()) return false;
      if (!isFavouritesClearResponse(payload)) {
        setError("Saved-item clear response was invalid.");
        return false;
      }

      // Mutations queued behind the clear must roll back against the now-empty
      // server state if their later PUT fails.
      for (const mutation of favouriteMutationsRef.current.values()) {
        mutation.confirmed = false;
        mutation.confirmedRecord = null;
      }
      replaceFavourites(emptyFavourites);
      replaceFavouriteItems([]);
      setError(null);
      return true;
    });
    favouriteClearTailRef.current = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  }, [authStatus, authorizationHeader, isCurrent, markSessionExpired, replaceFavouriteItems, replaceFavourites]);

  const isSaved = useCallback(
    (contentType: FavouriteContentType, contentKey: string) => favourites[contentType].includes(contentKey),
    [favourites],
  );

  const value = useMemo<AccountDataContextValue>(
    () => ({
      favourites,
      favouriteItems,
      favouriteSets,
      ready,
      loadError,
      error,
      isAuthenticated: authStatus === "authenticated",
      isSaved,
      setFavourite,
      createFavouriteSet,
      renameFavouriteSet,
      deleteFavouriteSet,
      setFavouriteOrder,
      moveFavourite,
      reorderFavourite,
      recordFavouriteOpen,
      setFavouritePinned,
      clearFavourites,
      reload,
    }),
    [
      authStatus,
      clearFavourites,
      createFavouriteSet,
      deleteFavouriteSet,
      error,
      favouriteItems,
      favouriteSets,
      favourites,
      isSaved,
      loadError,
      moveFavourite,
      ready,
      recordFavouriteOpen,
      reload,
      renameFavouriteSet,
      reorderFavourite,
      setFavourite,
      setFavouriteOrder,
      setFavouritePinned,
    ],
  );

  return <AccountDataContext.Provider value={value}>{children}</AccountDataContext.Provider>;
}

export function useAccountData() {
  const context = useContext(AccountDataContext);
  if (!context) throw new Error("useAccountData must be used within AccountDataProvider.");
  return context;
}

export function useOptionalAccountData() {
  return useContext(AccountDataContext);
}
