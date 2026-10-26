"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  searchTextPatientDetailRefusal,
  usePreloadSearchPatientCheck,
} from "@/components/clinical-dashboard/search-patient-detail-guard";
import { useOptionalToast } from "@/components/ui/toast";

import {
  THERAPY_KNOWN_SCREENS,
  THERAPY_MAX_COMPARE,
  readTherapyWorkspaceState,
  resolveTherapyRoute,
  therapyHrefWithSearchParams,
  therapyRecordHref,
  therapyScreenHref,
  therapyWorkspaceSearchParams,
  type TherapySheetSection,
  type TherapyWorkspaceState,
} from "@/lib/therapy-compass-navigation";
import { readTherapyCompareMemory, writeTherapyCompareMemory } from "@/lib/therapy-compare-memory";

import { useTherapyData } from "./data/use-therapy-data";
import { THERAPY_CATALOGUE_SUMMARY } from "./data/generated-assets";
import { relatedTherapies, type RelatedTherapy } from "./data/related";
import {
  EMPTY_SEARCH,
  RECOMMEND_CONSTRAINTS,
  inferRecommendConstraints,
  resolveRecommendConstraints,
  rankRecommendations,
  searchTherapies,
  type Ranked,
  type SearchOptions,
} from "./data/select";
import type { Pathway, ReferenceData, Therapy } from "./data/types";

type SheetSectionKey = TherapySheetSection;

export type TcBindings = {
  // ---- data -----------------------------------------------------------
  loading: boolean;
  error: string | null;
  retryData: () => void | Promise<void>;
  therapies: Therapy[];
  therapyCount: number;
  unreviewedTherapies: Therapy[];
  reviewCount: number;
  pathways: Pathway[];
  reference: ReferenceData | null;

  // ---- screen navigation ---------------------------------------------
  screen: string;
  go: (screen: string) => void;
  goHome: () => void;
  goSearch: () => void;
  goRecommend: () => void;
  goCompare: () => void;
  goPathways: () => void;
  goDetail: () => void;
  goReview: () => void;
  workspaceHref: (href: string, patch?: Partial<TherapyWorkspaceState>) => string;
  isHome: boolean;
  isOther: boolean;
  otherLabel: string;
  // ---- active therapy (detail / brief / sheet) ------------------------
  selectedSlug: string | null;
  selectedTherapy: Therapy | null;
  relatedForSelected: RelatedTherapy[];
  open: (slug: string) => void; // → detail
  openBrief: (slug: string) => void;
  openSheet: (slug: string) => void;
  select: (slug: string) => void; // set without navigating

  // ---- search ---------------------------------------------------------
  search: SearchOptions;
  searchResults: Therapy[];
  /**
   * Query-only matches — same query, tags/reviewedOnly/briefOnly reset to
   * `EMPTY_SEARCH`. The base for a facet option's count ("how many would I
   * have if I ticked this as well" — docs/filter-contract.md section 3),
   * which must never be narrowed by the very selection it is counting.
   */
  queryMatches: Therapy[];
  setQuery: (q: string) => void;
  submitQuery: (q: string) => void; // set query + go search
  toggleTag: (tag: string) => void;
  toggleBriefOnly: () => void;
  toggleSheetOnly: () => void;
  toggleReviewedOnly: () => void;
  clearSearch: () => void;
  clearSearchFilters: () => void;

  // ---- compare --------------------------------------------------------
  compareSlugs: string[];
  compareTherapies: Therapy[];
  addCompare: (slug: string) => void;
  replaceCompareSlugs: (slugs: readonly string[]) => void;
  removeCompare: (slug: string) => void;
  clearCompare: () => void;
  isInCompare: (slug: string) => boolean;

  // ---- recommend ------------------------------------------------------
  recQuery: string;
  setRecQuery: (q: string) => void;
  recConstraints: string[];
  inferredConstraintKeys: string[];
  isConstraintActive: (key: string) => boolean;
  isConstraintInferred: (key: string) => boolean;
  toggleConstraint: (key: string) => void;
  recommendations: Ranked[];

  // ---- pathways -------------------------------------------------------
  selectedPathwaySlug: string | null;
  selectedPathway: Pathway | null;
  selectPathway: (slug: string) => void;

  // ---- comparison tabs + density -------------------------------------
  cmpTab: string;
  setTabPriorities: () => void;
  setTabDifferences: () => void;
  setTabAll: () => void;
  density: string;
  setComfortable: () => void;
  setDense: () => void;

  // ---- brief-intervention tabs ---------------------------------------
  briefTab: string;
  set5: () => void;
  set15: () => void;
  setGround: () => void;

  // ---- patient-sheet tone --------------------------------------------
  sheetTone: string;
  setTonePlain: () => void;
  setToneWarm: () => void;
  setToneClinical: () => void;

  // ---- patient-sheet sections + clinician ----------------------------
  secAbout: boolean;
  secSteps: boolean;
  secPractice: boolean;
  secCoping: boolean;
  secContacts: boolean;
  chipAbout: string;
  chipSteps: string;
  chipPractice: string;
  chipCoping: string;
  chipContacts: string;
  toggleAbout: () => void;
  toggleSteps: () => void;
  togglePractice: () => void;
  toggleCoping: () => void;
  toggleContacts: () => void;
  sheetClinician: boolean;
  toggleClinician: () => void;
};

const TcContext = createContext<TcBindings | null>(null);

function chipStyle(active: boolean): string {
  return [
    "inline-flex min-h-tap items-center justify-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3.5 py-2 text-sm-minus font-semibold text-[color:var(--text-muted)]",
    "hover:enabled:border-[color:var(--border-strong)] hover:enabled:bg-[color:var(--surface-subtle)] hover:enabled:text-[color:var(--text)]",
    active
      ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] font-semibold text-[color:var(--clinical-accent-hover)]"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function uniqueConstraintKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

export function TcProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { screen, slug: routeSlug } = resolveTherapyRoute(pathname);
  const isHome = screen === "home";
  // Search needs the complete prose corpus to preserve its existing weighted
  // matches (#1471). Home paints from generated summary metadata without a
  // catalogue request; pathways use the thin browse index.
  const catalogue = screen === "pathways" ? "index" : "full";
  const { data, loading, error, retry } = useTherapyData({
    catalogue,
    includePathways: screen === "pathways",
    includeReference: false,
    enabled: !isHome,
  });
  const therapies = useMemo(() => data?.therapies ?? [], [data]);
  // Home reads the build-time summary rather than the catalogue so first paint
  // never waits on catalogue I/O (`enabled: !isHome` above). The count is
  // therefore only as true as the last generator run, which
  // is why `npm run check:therapy-data-index` (build-therapies-index --check)
  // is load-bearing in verify:cheap - do not bypass it. If home ever lists real
  // therapy records rather than a count, it must re-enable `useTherapyData`;
  // extending the generated summary instead would drift silently.
  const therapyCount = isHome ? THERAPY_CATALOGUE_SUMMARY.totalCount : therapies.length;
  const pathways = useMemo(() => data?.pathways ?? [], [data]);

  // The active screen and therapy are derived from the URL: each workspace route
  // renders the matching screen, and this keeps nav highlighting + the selected
  // therapy in sync with the address bar (back/forward, deep links, new tabs).
  // Non-navigational interaction state lives in the provider, which the layout
  // keeps mounted across the tool's routes so selections persist between screens.
  const qParam = (searchParams.get("q") ?? "").trim();
  const workspaceFromUrl = readTherapyWorkspaceState(searchParams);
  const [compareSlugs, setCompareSlugs] = useState<string[]>(workspaceFromUrl.compareSlugs);
  const [search, setSearch] = useState<SearchOptions>(() => ({
    ...EMPTY_SEARCH,
    query: qParam,
    tags: workspaceFromUrl.topics,
    briefOnly: workspaceFromUrl.briefOnly,
    sheetOnly: workspaceFromUrl.sheetOnly,
    reviewedOnly: workspaceFromUrl.reviewedOnly,
  }));
  usePreloadSearchPatientCheck(search.query);
  // `push` is stable, unlike the object `useOptionalToast` returns, so it can sit in the bindings deps.
  const pushToast = useOptionalToast()?.push;
  const [recQuery, setRecQuery] = useState("What therapy for anxiety in outpatient care?");
  const [recConstraints, setRecConstraints] = useState<string[]>(workspaceFromUrl.constraints);
  const [dismissedConstraintKeys, setDismissedConstraintKeys] = useState<string[]>([]);
  const [selectedPathwaySlug, setSelectedPathwaySlug] = useState<string | null>(workspaceFromUrl.pathwaySlug);

  // Seed the search query from a `?q=` deep link (universal-search "view all" or a
  // recent-search pick) and re-sync whenever the deep link changes, using the
  // render-phase "adjust state when a value changes" pattern so live typing between
  // deep links is preserved without a setState-in-effect cascade. The sync is
  // unconditional (including an empty `q`) so navigating from `?q=act` back to a
  // query-less URL clears the stale query and the rendered state matches the URL.
  const [cmpTab, setCmpTab] = useState(workspaceFromUrl.comparison);
  const [density, setDensity] = useState(workspaceFromUrl.density);
  const [briefTab, setBriefTab] = useState(workspaceFromUrl.duration);
  const [sheetTone, setSheetTone] = useState(workspaceFromUrl.tone);
  const [sheetSections, setSheetSections] = useState<Record<SheetSectionKey, boolean>>({
    about: workspaceFromUrl.sections.includes("about"),
    steps: workspaceFromUrl.sections.includes("steps"),
    practice: workspaceFromUrl.sections.includes("practice"),
    coping: workspaceFromUrl.sections.includes("coping"),
    contacts: workspaceFromUrl.sections.includes("contacts"),
  });
  const [sheetClinician, setSheetClinician] = useState(workspaceFromUrl.clinician);

  // Back/forward and shared links are authoritative for every non-sensitive
  // workspace choice. Recommendation free text is intentionally absent: it may
  // contain patient information and remains session-only in `recQuery`.
  const urlStateKey = searchParams.toString();
  useEffect(() => {
    const canonical = therapyWorkspaceSearchParams(searchParams, readTherapyWorkspaceState(searchParams));
    if (canonical.toString() === urlStateKey) return;
    router.replace(therapyHrefWithSearchParams(pathname, canonical), { scroll: false });
  }, [pathname, router, searchParams, urlStateKey]);
  const [seededQParam, setSeededQParam] = useState(qParam);
  if (qParam !== seededQParam) {
    setSeededQParam(qParam);
    setSearch((prev) => ({ ...prev, query: qParam }));
  }
  const [seededUrlStateKey, setSeededUrlStateKey] = useState(urlStateKey);
  if (urlStateKey !== seededUrlStateKey) {
    setSeededUrlStateKey(urlStateKey);
    setCompareSlugs(workspaceFromUrl.compareSlugs);
    setSearch((prev) => ({
      ...prev,
      tags: workspaceFromUrl.topics,
      briefOnly: workspaceFromUrl.briefOnly,
      sheetOnly: workspaceFromUrl.sheetOnly,
      reviewedOnly: workspaceFromUrl.reviewedOnly,
    }));
    setRecConstraints(workspaceFromUrl.constraints);
    setSelectedPathwaySlug(workspaceFromUrl.pathwaySlug);
    setCmpTab(workspaceFromUrl.comparison);
    setDensity(workspaceFromUrl.density);
    setBriefTab(workspaceFromUrl.duration);
    setSheetTone(workspaceFromUrl.tone);
    setSheetSections({
      about: workspaceFromUrl.sections.includes("about"),
      steps: workspaceFromUrl.sections.includes("steps"),
      practice: workspaceFromUrl.sections.includes("practice"),
      coping: workspaceFromUrl.sections.includes("coping"),
      contacts: workspaceFromUrl.sections.includes("contacts"),
    });
    setSheetClinician(workspaceFromUrl.clinician);
  }

  const bySlug = useMemo(() => new Map(therapies.map((t) => [t.slug, t])), [therapies]);
  const unreviewedTherapies = useMemo(() => therapies.filter((t) => t.reviewStatus !== "reviewed"), [therapies]);

  // Record-owned outputs require an explicit slug in the URL. No workspace
  // action is allowed to choose an unrelated default therapy on the reader's
  // behalf.
  const effectiveSelectedSlug = routeSlug;
  const selectedTherapy = effectiveSelectedSlug ? (bySlug.get(effectiveSelectedSlug) ?? null) : null;
  const effectivePathwaySlug = selectedPathwaySlug ?? pathways[0]?.slug ?? null;
  const selectedPathway = effectivePathwaySlug ? (pathways.find((p) => p.slug === effectivePathwaySlug) ?? null) : null;

  const deferredSearch = useDeferredValue(search);
  const searchResults = useMemo(() => {
    const liveQuery = search.query.trim();
    const deferredQuery = deferredSearch.query.trim();
    // Cleared live query should browse with live filters immediately (avoid stale
    // deferred tags/flags from the previous term).
    if (!liveQuery) {
      return searchTherapies(therapies, search);
    }
    // First keystrokes: deferred text may still be empty — never dump the full library.
    if (!deferredQuery) return [];
    // Defer only the text cost; apply live filter chips/flags immediately so toggles
    // match aria-pressed state without waiting for useDeferredValue.
    return searchTherapies(therapies, { ...search, query: deferredSearch.query }, true);
  }, [therapies, deferredSearch.query, search]);
  // Same query-deferral shape as `searchResults`, tags/reviewedOnly/briefOnly
  // reset — so a facet count never lags behind or races ahead of the query
  // typing the reader can see.
  const queryMatches = useMemo(() => {
    const liveQuery = search.query.trim();
    const deferredQuery = deferredSearch.query.trim();
    if (!liveQuery) return searchTherapies(therapies, EMPTY_SEARCH);
    if (!deferredQuery) return [];
    return searchTherapies(therapies, { ...EMPTY_SEARCH, query: deferredSearch.query }, true);
  }, [therapies, deferredSearch.query, search.query]);
  const compareTherapies = useMemo(
    () => compareSlugs.map((sl) => bySlug.get(sl)).filter((t): t is Therapy => Boolean(t)),
    [compareSlugs, bySlug],
  );
  const inferredConstraintKeys = useMemo(() => inferRecommendConstraints(recQuery), [recQuery]);
  const prunedDismissedKeys = useMemo(
    () => dismissedConstraintKeys.filter((key) => inferredConstraintKeys.includes(key)),
    [dismissedConstraintKeys, inferredConstraintKeys],
  );
  if (prunedDismissedKeys.length !== dismissedConstraintKeys.length) {
    setDismissedConstraintKeys(prunedDismissedKeys);
  }
  const effectiveConstraintKeys = useMemo(
    () => resolveRecommendConstraints(recQuery, recConstraints, prunedDismissedKeys),
    [recQuery, recConstraints, prunedDismissedKeys],
  );
  const recommendations = useMemo(
    () => rankRecommendations(therapies, recQuery, effectiveConstraintKeys),
    [therapies, recQuery, effectiveConstraintKeys],
  );
  const relatedForSelected = useMemo(
    () => (selectedTherapy ? relatedTherapies(therapies, selectedTherapy) : []),
    [therapies, selectedTherapy],
  );

  const value = useMemo<TcBindings>(() => {
    const enabledSections = (Object.entries(sheetSections) as Array<[SheetSectionKey, boolean]>)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key);
    const workspaceState: TherapyWorkspaceState = {
      compareSlugs,
      topics: search.tags,
      briefOnly: search.briefOnly,
      sheetOnly: search.sheetOnly,
      reviewedOnly: search.reviewedOnly,
      constraints: recConstraints,
      pathwaySlug: selectedPathwaySlug,
      comparison: cmpTab,
      density,
      duration: briefTab,
      tone: sheetTone,
      sections: enabledSections,
      clinician: sheetClinician,
    };
    const workspaceParams = (patch: Partial<TherapyWorkspaceState> = {}) =>
      therapyWorkspaceSearchParams(searchParams, { ...workspaceState, ...patch });
    const pushWorkspace = (href: string, patch: Partial<TherapyWorkspaceState> = {}) =>
      router.push(therapyHrefWithSearchParams(href, workspaceParams(patch)));
    const replaceWorkspace = (patch: Partial<TherapyWorkspaceState>) =>
      router.replace(therapyHrefWithSearchParams(pathname, workspaceParams(patch)), { scroll: false });
    const go = (next: string) => pushWorkspace(therapyScreenHref(next));
    const toggleSection = (key: SheetSectionKey) => {
      const nextSections = { ...sheetSections, [key]: !sheetSections[key] };
      setSheetSections(nextSections);
      replaceWorkspace({
        sections: (Object.entries(nextSections) as Array<[SheetSectionKey, boolean]>)
          .filter(([, enabled]) => enabled)
          .map(([section]) => section),
      });
    };
    const patchSearch = (patch: Partial<SearchOptions>) => setSearch((prev) => ({ ...prev, ...patch }));
    const openSlug = (slug: string, sub?: "brief" | "sheet") => pushWorkspace(therapyRecordHref(slug, sub));
    // Unsupported artifact actions are a no-op. Call sites expose an honest disabled
    // state instead of silently sending the user to a different detail destination.
    const hasBrief = (slug: string | null | undefined) =>
      !!slug && (bySlug.get(slug)?.briefInterventionAvailable ?? false);
    const hasSheet = (slug: string | null | undefined) => !!slug && (bySlug.get(slug)?.patientSheetAvailable ?? false);
    const openBriefOr = (slug: string) => {
      if (hasBrief(slug)) openSlug(slug, "brief");
    };
    const openSheetOr = (slug: string) => {
      if (hasSheet(slug)) openSlug(slug, "sheet");
    };
    return {
      loading,
      error,
      retryData: retry,
      therapies,
      therapyCount,
      unreviewedTherapies,
      reviewCount: unreviewedTherapies.length,
      pathways,
      reference: data?.reference ?? null,

      screen,
      go,
      goHome: () => go("home"),
      goSearch: () => go("search"),
      goRecommend: () => go("recommend"),
      goCompare: () => go("compare"),
      goPathways: () => go("pathways"),
      goDetail: () => (effectiveSelectedSlug ? openSlug(effectiveSelectedSlug) : go("home")),
      goReview: () => go("review"),
      workspaceHref: (href, patch) => therapyHrefWithSearchParams(href, workspaceParams(patch)),
      isHome: screen === "home",
      isOther: !THERAPY_KNOWN_SCREENS.includes(screen as (typeof THERAPY_KNOWN_SCREENS)[number]),
      otherLabel: screen.charAt(0).toUpperCase() + screen.slice(1),

      selectedSlug: effectiveSelectedSlug,
      selectedTherapy,
      relatedForSelected,
      open: (slug) => openSlug(slug),
      openBrief: (slug) => openBriefOr(slug),
      openSheet: (slug) => openSheetOr(slug),
      // Artifact pickers always navigate to an explicit record URL. No local
      // selection can become an invisible fallback for a later output action.
      select: (slug) =>
        screen === "brief" ? openBriefOr(slug) : screen === "sheets" ? openSheetOr(slug) : openSlug(slug),

      search,
      searchResults,
      queryMatches,
      setQuery: (q) => patchSearch({ query: q }),
      submitQuery: (q) => {
        patchSearch({ query: q });
        const trimmed = q.trim();
        // Text that looks like it holds a patient detail stays in the box, not the address (D-03).
        const refusal = searchTextPatientDetailRefusal(trimmed);
        if (refusal) {
          pushToast?.({ tone: "warning", title: refusal });
          return;
        }
        const params = workspaceParams();
        if (trimmed) {
          params.set("q", trimmed);
          params.set("run", "1");
        } else {
          params.delete("q");
          params.delete("run");
        }
        router.push(therapyHrefWithSearchParams(therapyScreenHref("search"), params));
      },
      toggleTag: (tag) => {
        const tags = search.tags.includes(tag) ? search.tags.filter((x) => x !== tag) : [...search.tags, tag];
        patchSearch({ tags });
        replaceWorkspace({ topics: tags });
      },
      toggleBriefOnly: () => {
        const briefOnly = !search.briefOnly;
        patchSearch({ briefOnly });
        replaceWorkspace({ briefOnly });
      },
      toggleSheetOnly: () => {
        const sheetOnly = !search.sheetOnly;
        patchSearch({ sheetOnly });
        replaceWorkspace({ sheetOnly });
      },
      toggleReviewedOnly: () => {
        const reviewedOnly = !search.reviewedOnly;
        patchSearch({ reviewedOnly });
        replaceWorkspace({ reviewedOnly });
      },
      clearSearch: () => {
        setSearch(EMPTY_SEARCH);
        const params = workspaceParams({ topics: [], briefOnly: false, sheetOnly: false, reviewedOnly: false });
        params.delete("q");
        params.delete("run");
        router.replace(therapyHrefWithSearchParams(pathname, params), { scroll: false });
      },
      // Filter-only clear. The results-band shelf lists filters and says so
      // ("Filtered by"), so its Clear must not delete the search term the user
      // is reading — that is a control doing more than it advertises.
      clearSearchFilters: () => {
        setSearch((prev) => ({ ...EMPTY_SEARCH, query: prev.query }));
        replaceWorkspace({ topics: [], briefOnly: false, sheetOnly: false, reviewedOnly: false });
      },

      compareSlugs,
      compareTherapies,
      addCompare: (slug) => {
        const next =
          compareSlugs.includes(slug) || compareSlugs.length >= THERAPY_MAX_COMPARE
            ? compareSlugs
            : [...compareSlugs, slug];
        setCompareSlugs(next);
        replaceWorkspace({ compareSlugs: next });
      },
      replaceCompareSlugs: (slugs) => {
        const next: string[] = [];
        for (const slug of slugs) {
          const trimmed = slug.trim();
          if (!trimmed || next.includes(trimmed)) continue;
          next.push(trimmed);
          if (next.length >= THERAPY_MAX_COMPARE) break;
        }
        setCompareSlugs(next);
        replaceWorkspace({ compareSlugs: next });
      },
      removeCompare: (slug) => {
        const next = compareSlugs.filter((value) => value !== slug);
        setCompareSlugs(next);
        replaceWorkspace({ compareSlugs: next });
      },
      clearCompare: () => {
        setCompareSlugs([]);
        replaceWorkspace({ compareSlugs: [] });
      },
      isInCompare: (slug) => compareSlugs.includes(slug),

      recQuery,
      setRecQuery,
      recConstraints,
      inferredConstraintKeys,
      isConstraintActive: (key) => effectiveConstraintKeys.includes(key),
      isConstraintInferred: (key) =>
        inferredConstraintKeys.includes(key) && !recConstraints.includes(key) && !prunedDismissedKeys.includes(key),
      toggleConstraint: (key) => {
        const inferred = inferredConstraintKeys.includes(key);
        const explicit = recConstraints.includes(key);
        const dismissed = prunedDismissedKeys.includes(key);
        if (explicit) {
          const next = recConstraints.filter((value) => value !== key);
          setRecConstraints(next);
          replaceWorkspace({ constraints: next });
          if (inferred) setDismissedConstraintKeys(uniqueConstraintKeys([...prunedDismissedKeys, key]));
          return;
        }
        if (dismissed) {
          setDismissedConstraintKeys(prunedDismissedKeys.filter((value) => value !== key));
          const next = uniqueConstraintKeys([...recConstraints, key]);
          setRecConstraints(next);
          replaceWorkspace({ constraints: next });
          return;
        }
        if (inferred) {
          setDismissedConstraintKeys(uniqueConstraintKeys([...prunedDismissedKeys, key]));
          return;
        }
        const next = uniqueConstraintKeys([...recConstraints, key]);
        setRecConstraints(next);
        replaceWorkspace({ constraints: next });
      },
      recommendations,

      selectedPathwaySlug: effectivePathwaySlug,
      selectedPathway,
      selectPathway: (slug) => {
        setSelectedPathwaySlug(slug);
        replaceWorkspace({ pathwaySlug: slug });
      },

      cmpTab,
      setTabPriorities: () => {
        setCmpTab("priorities");
        replaceWorkspace({ comparison: "priorities" });
      },
      setTabDifferences: () => {
        setCmpTab("differences");
        replaceWorkspace({ comparison: "differences" });
      },
      setTabAll: () => {
        setCmpTab("all");
        replaceWorkspace({ comparison: "all" });
      },
      density,
      setComfortable: () => {
        setDensity("comfortable");
        replaceWorkspace({ density: "comfortable" });
      },
      setDense: () => {
        setDensity("dense");
        replaceWorkspace({ density: "dense" });
      },

      briefTab,
      set5: () => {
        setBriefTab("5min");
        replaceWorkspace({ duration: "5min" });
      },
      set15: () => {
        setBriefTab("15min");
        replaceWorkspace({ duration: "15min" });
      },
      setGround: () => {
        setBriefTab("ground");
        replaceWorkspace({ duration: "ground" });
      },

      sheetTone,
      setTonePlain: () => {
        setSheetTone("plain");
        replaceWorkspace({ tone: "plain" });
      },
      setToneWarm: () => {
        setSheetTone("warm");
        replaceWorkspace({ tone: "warm" });
      },
      setToneClinical: () => {
        setSheetTone("clinical");
        replaceWorkspace({ tone: "clinical" });
      },

      secAbout: sheetSections.about,
      secSteps: sheetSections.steps,
      secPractice: sheetSections.practice,
      secCoping: sheetSections.coping,
      secContacts: sheetSections.contacts,
      chipAbout: chipStyle(sheetSections.about),
      chipSteps: chipStyle(sheetSections.steps),
      chipPractice: chipStyle(sheetSections.practice),
      chipCoping: chipStyle(sheetSections.coping),
      chipContacts: chipStyle(sheetSections.contacts),
      toggleAbout: () => toggleSection("about"),
      toggleSteps: () => toggleSection("steps"),
      togglePractice: () => toggleSection("practice"),
      toggleCoping: () => toggleSection("coping"),
      toggleContacts: () => toggleSection("contacts"),
      sheetClinician,
      toggleClinician: () => {
        const clinician = !sheetClinician;
        setSheetClinician(clinician);
        replaceWorkspace({ clinician });
      },
    };
  }, [
    router,
    pathname,
    searchParams,
    pushToast,
    loading,
    error,
    retry,
    data,
    therapies,
    therapyCount,
    bySlug,
    unreviewedTherapies,
    pathways,
    screen,
    effectiveSelectedSlug,
    selectedTherapy,
    relatedForSelected,
    search,
    searchResults,
    queryMatches,
    compareSlugs,
    compareTherapies,
    recQuery,
    recConstraints,
    inferredConstraintKeys,
    prunedDismissedKeys,
    effectiveConstraintKeys,
    recommendations,
    effectivePathwaySlug,
    selectedPathwaySlug,
    selectedPathway,
    cmpTab,
    density,
    briefTab,
    sheetTone,
    sheetSections,
    sheetClinician,
  ]);

  // ---- Device memory for the compare set -------------------------------
  //
  // The URL stays the source of truth. Memory only fills the gap when you
  // arrive with no `ids` at all, so an interrupted comparison is not lost. Both
  // effects run after mount and never during render, so server HTML, the first
  // client render and hydration stay identical whatever is in storage.
  //
  // "Decided" is a ref, not state, and that ordering is load-bearing: effects in
  // one commit run in declaration order, so the restore below always resolves
  // before the mirror reads it, without a second render to carry a flag.
  const compareRestoreDecided = useRef(false);

  useEffect(() => {
    if (compareRestoreDecided.current) return;
    // A shared link always wins, and can be decided without the catalogue.
    if (workspaceFromUrl.compareSlugs.length > 0) {
      compareRestoreDecided.current = true;
      return;
    }
    // Restoring needs the catalogue: a slug from an older data generation must
    // be dropped rather than resurrected as a therapy that no longer exists.
    if (therapies.length === 0) return;
    compareRestoreDecided.current = true;
    const remembered = readTherapyCompareMemory().filter((slug) => bySlug.has(slug));
    if (remembered.length > 0) value.replaceCompareSlugs(remembered);
  }, [workspaceFromUrl.compareSlugs.length, therapies.length, bySlug, value]);

  useEffect(() => {
    // Writing before the restore has decided would clobber the remembered set
    // with the empty one this tab started from.
    if (!compareRestoreDecided.current) return;
    writeTherapyCompareMemory(compareSlugs);
  }, [compareSlugs]);

  return <TcContext.Provider value={value}>{children}</TcContext.Provider>;
}

export function useTcBindings(): TcBindings {
  const ctx = useContext(TcContext);
  if (!ctx) throw new Error("useTcBindings must be used within <TcProvider>");
  return ctx;
}

export { RECOMMEND_CONSTRAINTS };
