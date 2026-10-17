# Decision: consolidate Cloud instructions and prevent stale launch rules returning

- **Status:** decided 2026-10-16
- **Source:** `docs/agents/codex-cloud-environment.md`, find "canonical operating policy"
- **Retires:** `cloud-unavailable-route-defaults`

The owner requested a full Cloud instruction overhaul and purge of stale instructions. General
tasks follow the canonical current-host policy; obsolete task prompts are retired, model routing
uses current tools, and copied prompts and programme lifecycle instructions are covered by the
retired-rule guard. Selected specialist and production safeguards retain their own authority.
Historical machine/session state is archived rather than seeded into fresh Cloud memory; existing
host-written memories remain untouched.

The follow-up audit applies the same policy to executable entry points and installed guidance.
Legacy setup and maintenance check inherited boundaries before runtime work; malformed selectors
cannot silently select installers or runtime probes. Profile repairs preserve invalid host settings
without echoing their contents and retain existing memory links. Copied skills and SessionStart
context follow current capabilities, task ownership and observed verification rather than dated
model lists, fresh-checkout ceremonies or assumed CI results. Temporary-profile and synthetic
environment regressions verify these paths without changing a real host.

Further failure-path checks require valid complete tier selections and memory-source admission
before profile writes, current CLI readiness alongside cache markers, nonempty matching dependency
fingerprints and valid explicitly configured Git bases. GitHub lifecycle preflight retains only the
documented setup-PAT exception; other inherited provider names fail before authentication. A local
filesystem path is not evidence of a GitHub remote identity. Diagnostics follow the declared Node
engine range rather than accepting every version in the same major.

If this summary and the source ever differ, the source wins.
