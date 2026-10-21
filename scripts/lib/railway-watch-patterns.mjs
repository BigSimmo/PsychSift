// Railway watch-pattern matching for `railway.app.json` / `railway.worker.json`.
//
// Railway redeploys a service only when a push changes a file its `build.watchPatterns`
// select, so a deployment can legitimately run an older commit than main HEAD: every commit
// after it touched nothing the service watches. The staging tenancy harness relies on that to
// tell a staging app that is merely "behind on documentation" from one that is genuinely stale
// (scripts/resolve-staging-deployment.mjs).
//
// Gitignore-style, as Railway documents: a "!" pattern excludes files a preceding rule included,
// and the last matching pattern wins. Only the two shapes the config files use are supported, an
// exact path and a `dir/**` subtree; tests/railway-config.test.ts fails if a third shape appears.

/** @param {string} pattern @param {string} filePath */
export function watchPatternMatches(pattern, filePath) {
  const normalizedPattern = pattern.replace(/^\/+/, "");
  const normalizedPath = filePath.replace(/^\/+/, "");
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }
  return normalizedPath === normalizedPattern;
}

/** @param {readonly string[]} watchPatterns @param {string} filePath */
export function triggersDeploy(watchPatterns, filePath) {
  let included = false;
  for (const pattern of watchPatterns) {
    const negated = pattern.startsWith("!");
    if (watchPatternMatches(negated ? pattern.slice(1) : pattern, filePath)) included = !negated;
  }
  return included;
}

/** The changed files that would redeploy a service with these watch patterns. */
/** @param {readonly string[]} watchPatterns @param {readonly string[]} changedFiles */
export function deployTriggeringFiles(watchPatterns, changedFiles) {
  return changedFiles.filter((file) => file.trim() !== "" && triggersDeploy(watchPatterns, file.trim()));
}
