# Cloud production-build resources

Use the read-only preflight before a production build or the canonical production
Playwright command on a cloud runner:

```bash
node scripts/check-cloud-build-resources.mjs
node scripts/check-cloud-build-resources.mjs --json
```

Both forms exit `0` when the recommended planning envelope is available, `1` when
heap/resource diagnostics need attention, and `2` for invalid arguments. The script
does not build, start a server, acquire the heavy-run lease, change the environment,
resize the host, or suppress any check. A pass is resource-planning evidence; the
existing build, typecheck and browser commands still supply their own acceptance
evidence. Follow [verification gates](../agents/verification-gates.md) for scope and reporting.

## Heap inherited by Next.js workers

In the prior cloud acceptance run, compilation completed with the default heap,
then Next.js typechecking exhausted roughly 4 GiB. Repeating the canonical
production Playwright run with command-scoped
`NODE_OPTIONS=--max-old-space-size=8192` completed 107 browser tests. That observed
result motivates the recommendation; it does not establish a universal minimum
or guarantee every future build fits.

The preflight measures V8's heap limit in a short Node subprocess inheriting the
current environment. A heap flag on the preflight process alone cannot make it
pass. This matters because a parent `node --max-old-space-size=8192` flag does not
establish what a separately launched Next.js worker receives. The measured V8
limit includes a little overhead beyond the old-space setting.

When `NODE_OPTIONS` is unset or empty, a Bash invocation can keep the setting scoped
to the preflight and the existing command:

```bash
NODE_OPTIONS=--max-old-space-size=8192 node scripts/check-cloud-build-resources.mjs &&
  NODE_OPTIONS=--max-old-space-size=8192 npm run build
```

Use the same command-scoped setting on the browser command selected for the task
when its runner builds the production app. Do not permanently export this setting
or replace existing `NODE_OPTIONS` wholesale. If other options are already set,
retain them; review any explicit heap option before editing it. Node accepts both
`--max-old-space-size` and `--max_old_space_size`, with values supplied using `=` or
as a separate argument. The preflight lets Node interpret these options rather
than rewriting or guessing their meaning. A small explicit heap produces a clear
diagnostic and remains unchanged. A larger heap increases the memory envelope.

## Runner capacity and headroom

Plan for an 8 GiB old-space heap **plus 4 GiB of headroom** for native allocations,
other Node workers, the browser and the OS: approximately 12 GiB total. The actual
check uses the measured V8 heap plus 4 GiB, including V8's small overhead. A 16 GiB
runner with adequate current availability is a practical starting point. An 8 GiB
runner cannot safely accommodate an 8 GiB heap. The headroom is a conservative
planning recommendation, not a measured worst-case bound for every worker mix.

The report limits capacity to the smallest visible host/cgroup limit. Linux
discovery resolves cgroup v2 `memory.max`/`memory.current` or v1
`memory.limit_in_bytes`/`memory.usage_in_bytes` using this process's membership and
mount information, then checks visible ancestors. Unlimited cgroups fall back to
finite host capacity. Host availability uses `MemAvailable` where provided,
otherwise free memory. Cgroup availability subtracts current usage and credits
bounded inactive file cache as reclaimable. A visible memory mount with unresolved
process membership, any unreadable visible ancestor limit, invalid limits, or
missing usage for a finite limit fails the preflight instead of trusting the
larger host. Mount paths must be absolute and normalized, and ancestor traversal
is bounded. Unlimited fallback requires explicit readable `max` or sentinel
bounds through the visible hierarchy, except that the global cgroup v2 root
(mount root `/`) legitimately has no `memory.max`. Only `ENOENT` at that root is
accepted; permission errors and unreadable intermediate bounds still fail. All
finite ancestors below the root remain checked. A namespace-hidden root (including
the kernel's `/..` mount-root marker) without a readable bound is reported as not
ready. See the kernel's [memory controller reference](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files).

This is a snapshot: another process can consume memory after it passes, and hidden
ancestors cannot be inspected. Keep the existing heavy-run admission mechanism,
rerun immediately before the build, and wait for other work or choose a larger
runner when availability is insufficient. Do not reduce verification or change
host memory limits to obtain a passing report.
