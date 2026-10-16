#!/usr/bin/env bash
#
# setup-claude-cloud — provision a Claude Code on the web container to near-parity with the local
# Windows workstation.
#
# The SessionStart hook already handles the two things nothing else can run without: a Node meeting
# the engine floor, and `npm ci`. Everything past that point — Playwright browsers, the Python OCR
# stack, Tesseract, Deno, the GitHub CLI, the four user plugins, and the checked-in user profile —
# was previously absent, which is why browser proof, the ingestion worker, edge functions and the
# operator's personal skills all failed or silently behaved differently in a cloud session.
#
# DESIGN NOTES
#   - Tiered. Each tier is independent, marker-guarded, and idempotent, so a warm container re-runs
#     in about a second and a cold one can be resumed after an interrupted run without redoing work.
#   - Non-fatal per tier. A failing tier is recorded and the run continues, because a container
#     without WebKit is still a useful container. The exit code is non-zero if any tier failed, so a
#     human or a gate can still see it; the hook wrapper is what decides to swallow that.
#   - Never prints an environment variable value. Presence only, by name.
#   - Safe to run by hand from anywhere in the repository.
#
# Usage:
#   bash scripts/setup-claude-cloud.sh                  # every tier
#   bash scripts/setup-claude-cloud.sh --tier profile --tier browsers
#   bash scripts/setup-claude-cloud.sh --list
#   bash scripts/setup-claude-cloud.sh --force          # ignore markers and redo the selected tiers
#   bash scripts/setup-claude-cloud.sh --allow-local    # provision a non-cloud machine (see guard below)
#
# Environment:
#   CLAUDE_CLOUD_SKIP_TIERS   comma-separated tier names to skip (e.g. "browsers,python")
#   CLAUDE_CLOUD_BROWSERS     Playwright browsers to install (default "chromium firefox webkit")

set -uo pipefail

ALL_TIERS=(profile plugins gh deno browsers python)

log() { printf '[claude-cloud] %s\n' "$*"; }
warn() { printf '[claude-cloud] WARNING: %s\n' "$*" >&2; }

# Install the session exit contract before resolving the checkout or creating markers: either can
# fail before provisioning begins. Detect --session independently of argument order.
selected=()
force=0
allow_local=0
session_mode=0
lock_dir=""
for arg in "$@"; do
  [ "$arg" != "--session" ] || session_mode=1
done
cleanup() {
  local code=$?
  [ -n "$lock_dir" ] && rm -rf "$lock_dir" 2>/dev/null
  if [ "$session_mode" -eq 1 ]; then
    exit 0
  fi
  exit "$code"
}
trap cleanup EXIT

argument_error() {
  warn "$1"
  if [ "$session_mode" -eq 1 ]; then
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"claude-cloud provisioning incomplete: invalid tier arguments; no tiers were run"}}'
  fi
  exit 2
}

# A missing --tier value or a misspelled option must never select every installer by falling
# through to the no-arguments default. Validate the complete command before entering any tier.
list_tiers=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --list) list_tiers=1 ;;
    --force) force=1 ;;
    --allow-local) allow_local=1 ;;
    --session) ;;
    --tier=*)
      [ -n "${1#--tier=}" ] || argument_error "--tier requires a tier name"
      selected+=("${1#--tier=}")
      ;;
    --tier)
      [ "$#" -gt 1 ] && [[ "$2" != --* ]] || argument_error "--tier requires a tier name"
      shift
      selected+=("$1")
      ;;
    --*) argument_error "unknown option $1" ;;
    *) selected+=("$1") ;;
  esac
  shift
done

if [ "$list_tiers" -eq 1 ]; then
  printf '%s\n' "${ALL_TIERS[@]}"
  exit 0
fi

# Every provisioning tier writes outside the checkout. Local no-op and metadata paths must return
# before checking the checkout or creating any cache state.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ] && [ "$allow_local" -eq 0 ]; then
  log "not a Claude Code cloud container (CLAUDE_CODE_REMOTE is not true); nothing to do"
  log "to provision this machine anyway, re-run with --allow-local"
  exit 0
fi

if [ "${#selected[@]}" -eq 0 ]; then
  if [ "$session_mode" -eq 1 ]; then
    read -r -a selected <<< "${CLAUDE_CLOUD_SESSION_TIERS-profile plugins gh deno}"
  else
    selected=("${ALL_TIERS[@]}")
  fi
fi
background_tiers=()
if [ "$session_mode" -eq 1 ]; then
  read -r -a background_tiers <<< "${CLAUDE_CLOUD_BACKGROUND_TIERS-browsers python}"
fi
# Check the entire selection, including detached work, before any valid earlier tier can mutate
# the profile. Do not report invalid override values inside JSON context.
known_tier() {
  local candidate
  for candidate in "${ALL_TIERS[@]}"; do
    [ "$1" != "$candidate" ] || return 0
  done
  return 1
}
for tier in "${selected[@]}" "${background_tiers[@]}"; do
  if ! known_tier "$tier"; then
    warn "unknown tier '$tier' (known: ${ALL_TIERS[*]})"
    if [ "$session_mode" -eq 1 ]; then
      printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"claude-cloud provisioning incomplete: invalid tier selection; no tiers were run"}}'
    fi
    exit 1
  fi
done

# Resolve the checkout from this script's OWN location, never from the caller's cwd and never from
# `git rev-parse --show-toplevel`. This repository keeps its Claude worktrees at
# .claude/worktrees/<name>, i.e. inside the main working tree, so `--show-toplevel` run from inside
# one returns the MAIN repository instead of the worktree — verified 2026-08-21. A provisioner that
# believed it would npm/pip against a different checkout than the session is actually using.
# CLAUDE_PROJECT_DIR wins when set, because that is the session's own answer to the same question.
repo_root="${CLAUDE_PROJECT_DIR:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"}"
if ! cd "$repo_root"; then
  if [ "$session_mode" -eq 1 ]; then
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"claude-cloud provisioning incomplete: project directory is unavailable; no tiers were run"}}'
  fi
  exit 1
fi

marker_dir="$HOME/.cache/clinical-kb-claude-cloud"
if ! mkdir -p "$marker_dir"; then
  if [ "$session_mode" -eq 1 ]; then
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"claude-cloud provisioning incomplete: marker directory is unavailable; no tiers were run"}}'
  fi
  exit 1
fi

# Hard guard. Every tier here writes outside the repository — into ~/.claude, into apt, into a global
# npm prefix. That is correct for a disposable Linux container and wrong for the operator's Windows
# workstation, whose real ~/.claude is the ORIGIN of the checked-in profile. Getting this backwards
# would overwrite the source of truth with a snapshot of itself.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  warn "--allow-local on a non-cloud machine: the profile tier will OVERWRITE ~/.claude/CLAUDE.md and"
  warn "~/.claude/skills/* with the checked-in snapshot in .claude/cloud-profile/. On the workstation"
  warn "that snapshot's own source, this replaces the original with a copy of an older version of itself."
fi

skip_list=",${CLAUDE_CLOUD_SKIP_TIERS:-},"
failed=()
pending_locked=()

# A tier is "done" when its marker exists AND still carries the same signature, so a tier whose
# inputs changed (a new lockfile, a different browser list) reprovisions instead of being skipped on
# a stale marker — the cached-container staleness trap that produced fake regressions before.
tier_is_done() {
  local tier="$1" signature="$2" marker="$marker_dir/$1.marker"
  [ "$force" -eq 0 ] || return 1
  [ -f "$marker" ] || return 1
  [ "$(cat "$marker" 2>/dev/null)" = "$signature" ] || return 1
  # A cache marker outlives a binary removed from PATH or replaced by an unsupported version.
  # Validate the cheap CLI prerequisites before reusing their installation receipt.
  case "$tier" in
    gh) have gh && gh --version >/dev/null 2>&1 ;;
    deno) have deno && [ "$(deno --version 2>/dev/null | sed -n '1s/^deno \([0-9]*\).*/\1/p')" = "2" ] ;;
    *) return 0 ;;
  esac
}

mark_tier_done() {
  printf '%s\n' "$2" > "$marker_dir/$1.marker"
}

have() { command -v "$1" >/dev/null 2>&1; }

# Serialises everything that drives apt, which the per-tier lock deliberately does not.
#
# The browsers tier shells out to `playwright install --with-deps` and the python tier calls
# apt_install for tesseract, so the two reach the same dpkg lock from different tiers. Session mode
# runs them in one detached child while telling the model to confirm with
# `bash scripts/setup-claude-cloud.sh browsers python`, and that confirmation command is exactly what
# collides. Observed 2026-09-06: the confirmation run's Playwright step died with "Installation
# process exited with code: 100" while the background child was unpacking tesseract, and the log
# carried apt's own explanation — "E: dpkg was interrupted, you must manually run 'dpkg --configure
# -a'". The browsers tier was then reported as failed even though nothing about it was broken.
#
# Waiting rather than failing is the point: apt is genuinely busy for a bounded time, so a caller that
# waits gets the install it asked for. Ten minutes is well past the slowest observed apt step and short
# enough that a truly wedged lock still surfaces instead of hanging the container.
#
# The timeout FAILS THE TIER; it never runs the command unlocked. Falling through to an unlocked run
# would recreate the exact concurrent dpkg access this function exists to prevent, and it would do so
# in the one situation where the other holder is provably still working — turning a bounded wait back
# into the interrupted-dpkg state, with the tier reported as attempted. A tier that fails saying "apt
# was busy, re-run this" is recoverable in one command; a corrupted package state is not. The two-hour
# stale sweep above is the separate, safe case: a lock that old belongs to a run that is gone, so it is
# reclaimed and then acquired properly rather than bypassed.
with_apt_lock() {
  local lock="$marker_dir/apt.lock" waited=0
  local timeout="${CLAUDE_CLOUD_APT_LOCK_TIMEOUT:-600}"
  while ! mkdir "$lock" 2>/dev/null; do
    if [ -n "$(find "$lock" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then
      warn "clearing a stale apt lock"
      rm -rf "$lock"
      continue
    fi
    if [ "$waited" -ge "$timeout" ]; then
      warn "apt is still held by another run after ${timeout}s; not running it unlocked"
      warn "re-run this tier once the other run finishes"
      return 1
    fi
    [ "$waited" -eq 0 ] && log "waiting for another run's apt step to finish"
    sleep 5
    waited=$((waited + 5))
  done
  "$@"
  local status=$?
  rm -rf "$lock" 2>/dev/null
  return "$status"
}

apt_install() {
  have apt-get || { warn "apt-get is unavailable; cannot install: $*"; return 1; }
  if [ "$(id -u)" = "0" ]; then
    with_apt_lock sh -c 'apt-get update -qq && apt-get install -y --no-install-recommends "$@"' _ "$@"
  elif have sudo; then
    with_apt_lock sh -c 'sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends "$@"' _ "$@"
  else
    warn "neither root nor sudo; cannot install: $*"
    return 1
  fi
}

# --------------------------------------------------------------------------------------------
# Tiers
# --------------------------------------------------------------------------------------------

tier_profile() {
  # Cheap and always worth redoing: the checked-in profile can change with any pull, and a stale
  # ~/.claude is invisible rather than loud.
  node scripts/apply-claude-cloud-profile.mjs --force
}

# Read the declared plugins/marketplaces out of the repository settings rather than repeating them
# here. .claude/settings.json is the list Claude Code itself acts on, so a second hand-maintained copy
# in this script could only ever drift out of agreement with the thing that matters.
declared_plugins() {
  node -e '
    const s = JSON.parse(require("fs").readFileSync(".claude/settings.json", "utf8"));
    for (const [name, on] of Object.entries(s.enabledPlugins ?? {})) if (on) console.log(name);
  ' 2>/dev/null
}

declared_marketplaces() {
  node -e '
    const s = JSON.parse(require("fs").readFileSync(".claude/settings.json", "utf8"));
    for (const m of Object.values(s.extraKnownMarketplaces ?? {})) if (m?.source?.repo) console.log(m.source.repo);
  ' 2>/dev/null
}

# `claude plugin install` — and Claude Code's own install of a declared plugin — unpacks a plugin but
# does NOT install its npm dependencies. A plugin with runtime dependencies therefore unpacks clean and
# then fails at first use, with nothing in the install output to suggest why. Repairing that is the one
# job here that nothing else does, so it runs unconditionally, including when the CLI is absent and
# Claude Code did the installing.
install_plugin_dependencies() {
  local plugin_root="$HOME/.claude/plugins/cache" status=0 dir
  [ -d "$plugin_root" ] || return 0
  while IFS= read -r manifest; do
    dir="$(dirname "$manifest")"
    [ -d "$dir/node_modules" ] && continue
    node -e 'const p=require(process.argv[1]);process.exit(p.dependencies&&Object.keys(p.dependencies).length?0:1)' \
      "$manifest" 2>/dev/null || continue
    log "installing npm dependencies for $(basename "$(dirname "$dir")")/$(basename "$dir")"
    (cd "$dir" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1) || {
      warn "dependency install failed for $dir"
      status=1
    }
  done < <(find "$plugin_root" -maxdepth 4 -name package.json -not -path '*/node_modules/*' 2>/dev/null)
  return "$status"
}

tier_plugins() {
  # BELT, NOT BRACES. The supported route is the enabledPlugins + extraKnownMarketplaces declared in
  # the repository's .claude/settings.json, which Claude Code installs from at session start on its
  # own. The CLI pass below only repairs the case where that did not happen, so a missing `claude` is
  # not a failure — but the dependency repair still has to run either way.
  local status=0
  if have claude; then
    while IFS= read -r repo; do
      [ -n "$repo" ] && claude plugin marketplace add "$repo" >/dev/null 2>&1
    done < <(declared_marketplaces)
    while IFS= read -r plugin; do
      [ -n "$plugin" ] || continue
      if claude plugin install "$plugin" >/dev/null 2>&1; then
        log "plugin present: $plugin"
      else
        warn "plugin install failed: $plugin"
        status=1
      fi
    done < <(declared_plugins)
  else
    log "the claude CLI is not on PATH; relying on the repo's declared enabledPlugins"
  fi
  install_plugin_dependencies || status=1
  return "$status"
}

tier_gh() {
  have gh && { log "gh $(gh --version | head -n 1 | awk '{print $3}') already present"; return 0; }
  apt_install gh && return 0
  # The Debian/Ubuntu base images do not carry gh in the default archives, so fall back to the
  # published tarball rather than adding an apt key at setup time.
  local version="2.67.0" tmp
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/cli/cli/releases/download/v${version}/gh_${version}_linux_amd64.tar.gz" \
    | tar -xz -C "$tmp" || { rm -rf "$tmp"; return 1; }
  mkdir -p "$HOME/.local/bin"
  cp "$tmp/gh_${version}_linux_amd64/bin/gh" "$HOME/.local/bin/gh" || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  export PATH="$HOME/.local/bin:$PATH"
  # `export` here only reaches this script's own process tree. Persist it the same way tier_python does
  # for its venv, or a later Claude command in the session — not just this provisioning run — cannot
  # find gh, and the completed marker would then stop any later session from repairing it.
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    printf 'export PATH="%s/.local/bin:$PATH"\n' "$HOME" >> "$CLAUDE_ENV_FILE"
  fi
  log "gh ${version} installed to ~/.local/bin"
}

tier_deno() {
  if have deno && [ "$(deno --version 2>/dev/null | sed -n '1s/^deno \([0-9]*\).*/\1/p')" = "2" ]; then
    log "deno 2 already present"
    return 0
  fi
  npm install --global 'deno@2' >/dev/null 2>&1 || return 1
  log "deno 2 installed"
}

tier_browsers() {
  [ -x ./node_modules/.bin/playwright ] || { warn "playwright is not installed; run npm ci first"; return 1; }
  # `--with-deps` runs apt, so it takes the shared apt lock like apt_install does; see with_apt_lock.
  # shellcheck disable=SC2086
  with_apt_lock ./node_modules/.bin/playwright install --with-deps ${CLAUDE_CLOUD_BROWSERS:-chromium firefox webkit}
}

tier_python() {
  local wanted="3.12" venv status=0
  have tesseract || apt_install tesseract-ocr || status=1

  # Resolve the WANTED interpreter specifically before ever falling back to a generic python3. Folding
  # the fallback into this first lookup let an older interpreter that already had a working venv module
  # (e.g. system 3.11) mask the need to install python${wanted} at all — the version check below then
  # rejected that older interpreter and the OCR tier failed even though installing 3.12 would have
  # fixed it. Only fall back to whatever python3 exists after actually trying to get the pinned version.
  local python_bin
  python_bin="$(command -v "python${wanted}" || true)"
  if [ -z "$python_bin" ] || ! "$python_bin" -c 'import venv' >/dev/null 2>&1; then
    apt_install "python${wanted}" "python${wanted}-venv" || apt_install python3 python3-venv || status=1
    python_bin="$(command -v "python${wanted}" || true)"
  fi
  [ -n "$python_bin" ] || python_bin="$(command -v python3 || true)"
  [ -n "$python_bin" ] || { warn "no Python 3 available"; return 1; }

  local actual
  actual="$("$python_bin" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  if [ "$actual" != "$wanted" ]; then
    # The cloud lockfile is hash-pinned against 3.12; a different minor cannot satisfy it. Say so
    # plainly rather than installing a set of wheels that will not match the lock.
    warn "Python ${wanted} is required by worker/python/requirements-cloud.txt; found ${actual}. Skipping the OCR venv."
    return 1
  fi

  venv="$HOME/.cache/clinical-kb-claude-cloud/ocr-venv-${wanted}"
  [ -x "$venv/bin/python" ] || "$python_bin" -m venv "$venv" || return 1
  "$venv/bin/python" -m pip install --quiet --disable-pip-version-check --require-hashes \
    -r worker/python/requirements-cloud.txt || return 1
  "$venv/bin/python" -m pip check || status=1
  log "OCR venv ready at ${venv}"

  # Expose it the same way the Codex Cloud path does, so worker code finds an interpreter without
  # each caller hard-coding the venv path.
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    {
      printf 'export PATH="%s/bin:$PATH"\n' "$venv"
      printf 'export PYTHON_BIN="%s/bin/python"\n' "$venv"
    } >> "$CLAUDE_ENV_FILE"
  fi
  return "$status"
}

# --------------------------------------------------------------------------------------------
# Signatures — what makes a tier stale
# --------------------------------------------------------------------------------------------

tier_signature() {
  case "$1" in
    profile) printf 'always' ;;
    plugins)
      # settings.json alone misses a plugin Claude installed or updated in the cache without touching
      # the repo's declared list — the signature stayed valid and the whole tier, including the
      # dependency repair, was skipped on the stale marker. Fold in each cached manifest's path and
      # mtime so any cache mutation invalidates the marker too.
      {
        sha256sum .claude/settings.json 2>/dev/null
        find "$HOME/.claude/plugins/cache" -maxdepth 4 -name package.json -not -path '*/node_modules/*' \
          -printf '%p %T@\n' 2>/dev/null | sort
      } | sha256sum | cut -d' ' -f1
      ;;
    gh) printf 'v1' ;;
    deno) printf 'v2' ;;
    browsers) printf '%s|%s' "${CLAUDE_CLOUD_BROWSERS:-chromium firefox webkit}" \
      "$(sha256sum package-lock.json 2>/dev/null | cut -d' ' -f1)" ;;
    python) sha256sum worker/python/requirements-cloud.txt 2>/dev/null | cut -d' ' -f1 ;;
    *) printf 'v1' ;;
  esac
}

# --------------------------------------------------------------------------------------------
# Run
# --------------------------------------------------------------------------------------------

# Locking is PER TIER, not per run. A global lock would deadlock the design: the session hook forks a
# detached child for the slow tiers while the parent still holds the lock, and the child would see it
# held and quietly do nothing. Tiers are independent, so a per-tier lock is both the correct
# granularity and race-free. `mkdir` is the atomic primitive; a lock older than two hours is assumed
# dead rather than blocking the container forever.
acquire_tier_lock() {
  local lock="$marker_dir/$1.lock"
  if mkdir "$lock" 2>/dev/null; then
    lock_dir="$lock"
    return 0
  fi
  if [ -n "$(find "$lock" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then
    warn "clearing a stale lock for tier $1"
    rm -rf "$lock"
    if mkdir "$lock" 2>/dev/null; then
      lock_dir="$lock"
      return 0
    fi
  fi
  return 1
}

release_tier_lock() {
  [ -n "$lock_dir" ] && rm -rf "$lock_dir" 2>/dev/null
  lock_dir=""
}

for tier in "${selected[@]}"; do
  case "$skip_list" in
    *",$tier,"*)
      log "tier ${tier}: skipped by CLAUDE_CLOUD_SKIP_TIERS"
      continue
      ;;
  esac

  signature="$(tier_signature "$tier")"
  # The profile tier is intentionally never marker-skipped: it is a sub-second file copy and a stale
  # ~/.claude is the failure this whole script exists to prevent.
  if [ "$tier" != "profile" ] && tier_is_done "$tier" "$signature"; then
    log "tier ${tier}: already provisioned"
    continue
  fi

  if ! acquire_tier_lock "$tier"; then
    log "tier ${tier}: another run is provisioning it"
    pending_locked+=("$tier")
    continue
  fi

  log "tier ${tier}: provisioning"
  if "tier_${tier}"; then
    mark_tier_done "$tier" "$signature"
    log "tier ${tier}: done"
  else
    warn "tier ${tier}: failed (continuing)"
    failed+=("$tier")
  fi
  release_tier_lock
done

# Session mode hands the expensive tiers off to a detached child and returns immediately. A cold
# Playwright matrix plus the hash-pinned spaCy/medspaCy wheel set is ten-plus minutes, far too long to
# hold a session open for. Neither writes into the repository or node_modules — browsers land in
# ~/.cache/ms-playwright and the OCR venv in ~/.cache — so they cannot race a build or test the model
# starts meanwhile.
if [ "$session_mode" -eq 1 ]; then
  pending=()
  for tier in "${background_tiers[@]}"; do
    # Signature, not bare marker existence. A marker whose signature no longer matches means the
    # inputs moved — a new package-lock for browsers, a new requirements-cloud.txt for python — and a
    # presence-only check would leave the container silently running the previous provisioning.
    tier_is_done "$tier" "$(tier_signature "$tier")" || pending+=("$tier")
  done
  if [ "${#pending[@]}" -gt 0 ]; then
    child_flags=()
    # The child re-enters this script from scratch and re-evaluates the cloud guard, so an explicit
    # local override has to travel with it or the detached run silently refuses.
    [ "$allow_local" -eq 1 ] && child_flags+=(--allow-local)
    nohup bash "$repo_root/scripts/setup-claude-cloud.sh" "${child_flags[@]}" "${pending[@]}" \
      >> "$marker_dir/setup.log" 2>&1 &
    disown 2>/dev/null || true
    log "${pending[*]} provisioning in the background; log: $marker_dir/setup.log"
    log "before trusting a browser or worker check, confirm with:"
    log "  bash scripts/setup-claude-cloud.sh ${pending[*]}"
  fi
fi

# A tier still held by another run's lock is neither done nor failed — it is genuinely in progress.
# The documented confirmation command (`bash scripts/setup-claude-cloud.sh browsers python`) used to hit
# the "another run is provisioning it" branch, fall through to "all selected tiers complete", and report
# success while the background run was still writing its venv. Track it separately and never let it
# share that closing message.
if [ "${#pending_locked[@]}" -gt 0 ]; then
  log "tiers still being provisioned by another run: ${pending_locked[*]}"
  log "re-run this command once they finish to confirm completion"
fi

if [ "${#failed[@]}" -gt 0 ] || [ "${#pending_locked[@]}" -gt 0 ]; then
  if [ "${#failed[@]}" -gt 0 ]; then
    warn "tiers that did not complete: ${failed[*]}"
    warn "re-run with: bash scripts/setup-claude-cloud.sh ${failed[*]}"
  fi
  if [ "$session_mode" -eq 1 ]; then
    # A SessionStart hook's stderr is invisible to Claude — only stdout, and only this JSON envelope,
    # carries additionalContext into the session. cleanup() still forces exit 0 for session mode right
    # after this, so the hook still cannot fail the session; this only makes the failure seen instead of
    # silently swallowed.
    incomplete="$(printf '%s ' "${failed[@]}" "${pending_locked[@]}")"
    incomplete="${incomplete% }"
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"claude-cloud provisioning incomplete: %s — see ~/.cache/clinical-kb-claude-cloud/setup.log"}}\n' \
      "$incomplete"
  fi
  exit 1
fi

log "all selected tiers complete"
