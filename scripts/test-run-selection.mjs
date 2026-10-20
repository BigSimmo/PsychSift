const explicitUnitTestPattern = /^(?:\.?[\\/])?tests[\\/].+\.test\.[cm]?[jt]sx?$/i;
const boundedRelatedFilePattern = /^(?:\.?[\\/])?(?:src|worker|scripts|tests)[\\/].+\.[cm]?[jt]sx?$/i;
const valueFlags = new Set([
  "--reporter",
  "--reporters",
  "-r",
  "--testNamePattern",
  "-t",
  "--bail",
  "--testTimeout",
  "--hookTimeout",
]);
const booleanFlags = new Set([
  "--run",
  "--no-coverage",
  "--no-file-parallelism",
  "--fileParallelism=false",
  "--silent",
  "--silent=true",
  "--silent=false",
]);
const unsafeSharedFlags = [
  /^--coverage(?:=|\.|$)/,
  /^--config(?:=|$)/,
  /^-c$/,
  /^--workspace(?:=|$)/,
  /^--max(?:-?workers)(?:=|$)/i,
  /^--min(?:-?workers)(?:=|$)/i,
  /^--pool(?:-?options)(?:=|\.|$)/i,
];

export function vitestLeaseMode(args) {
  if (args.some((argument) => unsafeSharedFlags.some((pattern) => pattern.test(argument)))) return "exclusive";
  const related = args[0] === "related" && args.includes("--run");
  if (args[0] !== "run" && !related) return "exclusive";

  const selectors = [];
  let positionalOnly = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (!positionalOnly && argument === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && argument.startsWith("-")) {
      if (booleanFlags.has(argument)) continue;
      const equals = argument.indexOf("=");
      if (equals !== -1 && valueFlags.has(argument.slice(0, equals)) && argument.slice(equals + 1)) continue;
      if (valueFlags.has(argument) && args[index + 1] && !args[index + 1].startsWith("-")) {
        index += 1;
        continue;
      }
      // Unknown option arity could hide a directory selector or broaden the run.
      return "exclusive";
    }
    selectors.push(argument);
  }

  const boundedPattern = related ? boundedRelatedFilePattern : explicitUnitTestPattern;
  return selectors.length > 0 &&
    selectors.every(
      (selector) =>
        boundedPattern.test(selector) && !/[*?[{]/.test(selector) && !selector.split(/[\\/]/).includes(".."),
    )
    ? "shared"
    : "exclusive";
}
