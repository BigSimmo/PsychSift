# Reusable project guidance

Use current repository instructions and verify the current host and task. Dated examples below
do not establish present machine paths, failures, services or task status. Historical coordination
boards and workstation state are archived in the repository and are not startup memory seeds.

- [Never print env values](never-print-env-values.md) — names/presence only; preserve the lesson from a 2026-08-18 disclosure incident
- [Checks that cannot fail](checks-that-cannot-fail.md) — mutation-test guards; stderr hooks, grep on binary, `| tail` masking exit codes, tautological re-checks
- [Hook exec-bit trap](claude-hook-exec-bit-trap.md) — verify hook index modes and the current host's Git configuration
- [Plain, brief communication style](communication-style-plain-and-brief.md) — answer first, numbered steps, no internal detail unless asked
- [Token usage hygiene](token-usage-hygiene.md) — search before reading large files; delegate only under current policy; preserve applicable instructions
- [Claude plugin native deps trap](claude-plugin-native-deps-trap.md) — verify actual dependency readiness; dated workstation symptoms do not establish current host state
