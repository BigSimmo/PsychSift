export type ReleaseEnvironment = {
  SENTRY_RELEASE?: string;
  NEXT_PUBLIC_SENTRY_RELEASE?: string;
  RAILWAY_GIT_COMMIT_SHA?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
  GITHUB_SHA?: string;
  SOURCE_COMMIT_SHA?: string;
  COMMIT_SHA?: string;
  RELEASE_IDENTITY_MANIFEST_PATH?: string;
};

export type ReleaseIdentityManifest = {
  commitSha: string | null;
  sentryRelease: string | null;
};

export type ReleaseResolutionOptions = {
  manifestPath?: string | null;
  useManifestFallback?: boolean;
};

const SHA_RE = /^[a-f0-9]{40}$/i;
const DEFAULT_MANIFEST_PATHS = ["/app/deploy/release-identity.json", "./deploy/release-identity.json"] as const;

let cachedDefaultManifest: ReleaseIdentityManifest | undefined;

function normalizeCommitSha(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  return SHA_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeReleaseString(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function readManifestFromPath(candidatePath: string): ReleaseIdentityManifest | null {
  try {
    const getBuiltin =
      typeof process !== "undefined" && typeof process.getBuiltinModule === "function"
        ? process.getBuiltinModule.bind(process)
        : null;
    if (!getBuiltin) return null;
    const fs = getBuiltin("node:fs") as typeof import("node:fs") | undefined;
    const pathMod = getBuiltin("node:path") as typeof import("node:path") | undefined;
    if (!fs?.readFileSync) return null;
    const resolvedPath =
      pathMod && !pathMod.isAbsolute(candidatePath) && typeof process.cwd === "function"
        ? pathMod.resolve(process.cwd(), candidatePath)
        : candidatePath;
    const raw = fs.readFileSync(resolvedPath, "utf8");
    const parsed = JSON.parse(raw) as { commitSha?: unknown; sentryRelease?: unknown };
    if (!parsed || typeof parsed !== "object") return null;
    const commitSha = typeof parsed.commitSha === "string" ? normalizeCommitSha(parsed.commitSha) : null;
    const sentryRelease =
      typeof parsed.sentryRelease === "string" ? normalizeReleaseString(parsed.sentryRelease) : null;
    return { commitSha, sentryRelease };
  } catch {
    return null;
  }
}

function loadReleaseManifest(
  environment: ReleaseEnvironment,
  options?: ReleaseResolutionOptions,
): ReleaseIdentityManifest {
  if (options?.useManifestFallback === false || options?.manifestPath === null) {
    return { commitSha: null, sentryRelease: null };
  }

  const explicitPath = normalizeReleaseString(options?.manifestPath ?? environment.RELEASE_IDENTITY_MANIFEST_PATH);
  if (explicitPath) {
    return readManifestFromPath(explicitPath) ?? { commitSha: null, sentryRelease: null };
  }

  if (cachedDefaultManifest !== undefined) {
    return cachedDefaultManifest;
  }

  for (const candidatePath of DEFAULT_MANIFEST_PATHS) {
    const loaded = readManifestFromPath(candidatePath);
    if (loaded) {
      cachedDefaultManifest = loaded;
      return loaded;
    }
  }

  cachedDefaultManifest = { commitSha: null, sentryRelease: null };
  return cachedDefaultManifest;
}

export function resetReleaseManifestCacheForTests(): void {
  cachedDefaultManifest = undefined;
}

/** One release resolver for build, app runtimes, and the ingestion worker. */
export function resolveSentryRelease(
  environment: ReleaseEnvironment = process.env as ReleaseEnvironment,
  options?: ReleaseResolutionOptions,
): string {
  const release = [
    environment.SENTRY_RELEASE,
    environment.NEXT_PUBLIC_SENTRY_RELEASE,
    environment.RAILWAY_GIT_COMMIT_SHA,
    environment.VERCEL_GIT_COMMIT_SHA,
    environment.GITHUB_SHA,
    environment.SOURCE_COMMIT_SHA,
    environment.COMMIT_SHA,
  ].find((candidate) => candidate?.trim());
  if (release?.trim()) {
    return release.trim();
  }

  const manifest = loadReleaseManifest(environment, options);
  return manifest.sentryRelease || manifest.commitSha || "dev";
}

/** Public deployment identity is limited to a full Git commit SHA. */
export function resolveDeploymentCommitSha(
  environment: ReleaseEnvironment = process.env as ReleaseEnvironment,
  options?: ReleaseResolutionOptions,
): string | null {
  const candidate = [
    environment.RAILWAY_GIT_COMMIT_SHA,
    environment.VERCEL_GIT_COMMIT_SHA,
    environment.GITHUB_SHA,
    environment.SOURCE_COMMIT_SHA,
    environment.COMMIT_SHA,
  ].find((value) => SHA_RE.test(value?.trim() ?? ""));
  if (candidate) {
    return candidate.trim().toLowerCase();
  }

  const manifest = loadReleaseManifest(environment, options);
  return manifest.commitSha;
}
