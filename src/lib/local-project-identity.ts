export type LocalProjectIdentityPayload = {
  appName: string;
  projectId: string;
  identityPath: "/api/local-project-id";
  localServer: {
    currentUrl: string | null;
    currentPort: number | null;
    projectPortStart: number;
    projectPortEnd: number;
    safeLocalOrigin: boolean;
    requestOrigin: string | null;
    requestReferer: string | null;
    unsafeLocalCaller: string | null;
  };
};

/**
 * The deployed site answers /api/local-project-id with 404 (it is local tooling only), so a
 * production build treats that 404 as "not a local checkout": the hosted origin is the right one.
 */
function deployedSiteIdentity(): LocalProjectIdentityPayload {
  return {
    appName: "PsychSift",
    projectId: "deployed",
    identityPath: "/api/local-project-id",
    localServer: {
      currentUrl: null,
      currentPort: null,
      projectPortStart: 0,
      projectPortEnd: 0,
      safeLocalOrigin: true,
      requestOrigin: null,
      requestReferer: null,
      unsafeLocalCaller: null,
    },
  };
}

export async function readLocalProjectIdentity() {
  const response = await fetch("/api/local-project-id", { cache: "no-store" });
  if (response.status === 404 && process.env.NODE_ENV === "production") return deployedSiteIdentity();
  if (!response.ok) return null;
  return (await response.json()) as LocalProjectIdentityPayload;
}

export function unsafeLocalProjectMessage(identity: LocalProjectIdentityPayload | null) {
  const range =
    typeof identity?.localServer?.projectPortStart === "number" &&
    typeof identity.localServer.projectPortEnd === "number"
      ? ` Use the URL printed by npm run ensure; managed ports are ${identity.localServer.projectPortStart}-${identity.localServer.projectPortEnd}.`
      : " Use the URL printed by npm run ensure.";
  return `This tab is not using the guarded PsychSift local URL.${range}`;
}
