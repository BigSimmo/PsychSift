import { NextResponse } from "next/server";
import type { LocalProjectIdentityPayload } from "@/lib/local-project-identity";
import { appName, localProjectId, projectPortEnd, projectPortStart } from "@/lib/local-server-utils.mjs";

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function portFor(url: URL) {
  const explicit = Number.parseInt(url.port, 10);
  if (Number.isInteger(explicit)) return explicit;
  if (url.protocol === "http:") return 80;
  if (url.protocol === "https:") return 443;
  return null;
}

export function isLocalUrl(url: URL) {
  return localHosts.has(url.hostname.toLowerCase());
}

export function isManagedProjectPort(port: number | null) {
  return port !== null && port >= projectPortStart && port <= projectPortEnd;
}

export function localProjectIdentityPayload(requestUrl: string): LocalProjectIdentityPayload {
  const url = new URL(requestUrl);
  const local = isLocalUrl(url);
  const port = local ? portFor(url) : null;
  const currentUrl = local && port ? `${url.protocol}//${url.hostname}:${port}` : null;

  return {
    appName,
    projectId: localProjectId(process.cwd()),
    identityPath: "/api/local-project-id",
    localServer: {
      currentUrl,
      currentPort: port,
      projectPortStart,
      projectPortEnd,
      safeLocalOrigin: !local || isManagedProjectPort(port),
      requestOrigin: null,
      requestReferer: null,
      unsafeLocalCaller: null,
    },
  };
}

function unsafeLocalCallerFromHeader(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!isLocalUrl(url)) return null;
    return isManagedProjectPort(portFor(url)) ? null : url.origin;
  } catch {
    return null;
  }
}

export function localProjectRequestIdentityPayload(request: Request): LocalProjectIdentityPayload {
  const payload = localProjectIdentityPayload(request.url);
  const requestOrigin = request.headers.get("origin");
  const requestReferer = request.headers.get("referer");
  const unsafeLocalCaller = unsafeLocalCallerFromHeader(requestOrigin) ?? unsafeLocalCallerFromHeader(requestReferer);

  return {
    ...payload,
    localServer: {
      ...payload.localServer,
      requestOrigin,
      requestReferer,
      unsafeLocalCaller,
      safeLocalOrigin: payload.localServer.safeLocalOrigin && !unsafeLocalCaller,
    },
  };
}

const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);
const wildcardBindHosts = new Set(["0.0.0.0", "[::]"]);
const deployedRuntimeMarkers = [
  "RAILWAY_ENVIRONMENT_NAME",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
];

/**
 * Whether /api/local-project-id may answer this request. It needs no sign-in and echoes the
 * caller's Origin/Referer plus this checkout's project identity, so it only answers local tooling:
 *
 * - `next dev` and unit tests (NODE_ENV is not "production") always answer.
 * - A production build answers only when it is clearly a local `next start` (boot smoke, Playwright,
 *   Lighthouse): not on Railway, addressed to a loopback host, and with only loopback forwarding hops.
 * - Everything else (the deployed site) gets a plain 404.
 */
export function isLocalProjectIdentityEndpointEnabled(request: Request, env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") return true;
  if (deployedRuntimeMarkers.some((name) => Boolean(env[name]?.trim()))) return false;
  // Next's own server fills X-Forwarded-For with the socket address, so a local caller shows up
  // as loopback here; any non-loopback hop means a proxy (or a remote caller) is in the path.
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor && !forwardedFor.split(",").every((entry) => loopbackAddresses.has(entry.trim().toLowerCase()))) {
    return false;
  }
  try {
    const url = new URL(request.url);
    if (isLocalUrl(url)) return true;
    // `next start --hostname 0.0.0.0` (Playwright, boot smoke) builds request.url from the bind
    // address, not the Host header, so a wildcard bind says nothing about who was addressed.
    // Only then fall back to the Host header, and still require it to name a loopback host.
    if (!wildcardBindHosts.has(url.hostname.toLowerCase())) return false;
    const host = request.headers.get("host");
    return Boolean(host) && isLocalUrl(new URL(`http://${host}`));
  } catch {
    return false;
  }
}

export function isSafeLocalProjectRequest(request: Request) {
  return localProjectRequestIdentityPayload(request).localServer.safeLocalOrigin;
}

export class UnsafeLocalProjectOriginError extends Error {
  constructor(readonly payload: LocalProjectIdentityPayload) {
    super(
      `Local requests for ${payload.appName} must use a managed project port. Run npm run ensure and use the printed URL.`,
    );
    this.name = "UnsafeLocalProjectOriginError";
  }
}

export function assertSafeLocalProjectRequest(request: Request) {
  const payload = localProjectRequestIdentityPayload(request);
  if (!payload.localServer.safeLocalOrigin) {
    throw new UnsafeLocalProjectOriginError(payload);
  }
}

export function unsafeLocalProjectResponse(payload: LocalProjectIdentityPayload) {
  return NextResponse.json(
    {
      error: "Use the ensured PsychSift local URL before calling this API.",
      run: "npm run ensure",
      identity: payload,
    },
    {
      status: 409,
      headers: {
        "Cache-Control": "no-store",
        "X-Clinical-KB-Local-Guard": "unsafe-local-origin",
      },
    },
  );
}

export function localProjectOriginErrorResponse(error: UnsafeLocalProjectOriginError) {
  return unsafeLocalProjectResponse(error.payload);
}
