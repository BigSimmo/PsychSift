# syntax=docker/dockerfile:1
# PsychSift app tier (Next.js). See docs/deployment-architecture.md.
#
# The repo is engine-strict (Node 24.x / npm 11.x via .npmrc + preinstall
# guard), so every stage pins the same Node 24 base image. The build stage
# runs the repo's own `npm run build` (guard-next-build + next build) so the
# image build fails exactly where a local build would.
#
# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
# The publishable key is public by design; pass the real one for a
# production image:
#   docker build \
#     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
#     --build-arg MAX_UPLOAD_MB=150 \
#     --build-arg NEXT_PUBLIC_MAX_UPLOAD_MB=150 \
#     -t clinical-kb-app .
# Server-side secrets (SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, ...) are
# NEVER baked into the image — inject them at run time from the host's
# secret store.

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node-base

FROM node-base AS deps
WORKDIR /app
# check-node-engine.cjs runs as the npm preinstall hook and
# install-git-hooks.mjs as the postinstall hook, so both must be in place
# before `npm ci`.
COPY package.json package-lock.json .npmrc ./
COPY scripts/check-node-engine.cjs scripts/check-node-engine.cjs
COPY scripts/install-git-hooks.mjs scripts/install-git-hooks.mjs
COPY scripts/check-installed-lock-parity.mjs scripts/check-installed-lock-parity.mjs
COPY scripts/lib/is-entrypoint.mjs scripts/lib/is-entrypoint.mjs
# Registry blips (ECONNRESET) have failed CI app-image builds mid-install; retry
# the whole `npm ci` rather than relying only on per-request fetch retries.
RUN for attempt in 1 2 3; do \
      npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 && break; \
      if [ "$attempt" -eq 3 ]; then exit 1; fi; \
      sleep $((attempt * 10)); \
    done

FROM node-base AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# supabase/migrations is only present in the build context, not the slim
# runtime image, so the deploy pre-deploy gate's manifest of migration
# versions this build expects is baked in now and copied into the runner
# below (see scripts/deploy/write-migration-manifest.mjs).
RUN node scripts/deploy/write-migration-manifest.mjs
ARG NEXT_PUBLIC_SUPABASE_URL=https://sjrfecxgysukkwxsowpy.supabase.co
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder-build-publishable-key
# Non-secret identity metadata lets the browser-side project guard explicitly
# accept staging instead of treating its URL as an accidental production mismatch.
ARG NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_REF=
ARG NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_NAME=
# The server value is also exposed to the build so the parity guard can compare
# the runtime configuration Railway supplies with the public value Next inlines.
ARG NEXT_PUBLIC_MAX_UPLOAD_MB=
ARG MAX_UPLOAD_MB=
# Railway exposes reference variables to Docker builds only when the Dockerfile
# declares the matching build argument. This non-secret SHA keeps build-time
# source maps and runtime Sentry events on the same release identity.
ARG RAILWAY_GIT_COMMIT_SHA=
# Same trap as above: `sitemap.ts`/`robots.ts` read these to build the
# canonical origin they advertise, and an undeclared ARG means Railway's
# service-level value never reaches this `npm run build`, silently baking an
# empty origin into any prerendered output. Both routes also re-read
# `process.env` at request time (see src/lib/crawler-policy.ts), so a
# runtime-only Railway value still works even if these build args are unset.
ARG NEXT_PUBLIC_SITE_URL=
ARG RAILWAY_PUBLIC_DOMAIN=
# Sentry source-map upload, inert until an operator supplies all three on the Railway service.
# Declaring them here is not optional bookkeeping. A build argument the Dockerfile does not
# declare is simply not in the build environment, so a value set on the Railway service cannot
# reach next.config.ts and withSentryConfig stays skipped — no error, no uploaded maps, a change
# that looks applied and does nothing. (The reference-variable note above is the same trap in the
# narrower form Railway documents; this is the plain Docker version of it.)
#
# No ENV lines: an ARG is already in the environment of this stage's RUN, so promoting it to ENV
# would only widen where it is recorded. This is a multi-stage build and the published image is
# the separate `runner` stage, so the token does not travel to Railway's registry — but it IS in
# this builder stage's environment and readable by every script `npm run build` invokes. That,
# not the shipped artefact, is why it must be a token scoped to project release/sourcemap upload
# ONLY, never a broader-scoped one.
ARG SENTRY_AUTH_TOKEN=
ARG SENTRY_ORG=
ARG SENTRY_PROJECT=
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}
ENV NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_REF=${NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_REF}
ENV NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_NAME=${NEXT_PUBLIC_SUPABASE_STAGING_PROJECT_NAME}
ENV NEXT_PUBLIC_MAX_UPLOAD_MB=${NEXT_PUBLIC_MAX_UPLOAD_MB}
ENV RAILWAY_GIT_COMMIT_SHA=${RAILWAY_GIT_COMMIT_SHA}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV RAILWAY_PUBLIC_DOMAIN=${RAILWAY_PUBLIC_DOMAIN}
# The repo build script allocates an 8 GiB heap. Prefer builders with >= 10 GiB
# locally (Docker Desktop hard-fails under the RAM guard by default). CI image
# builds pass ALLOW_LOW_RAM_BUILD=1 because GitHub buildx runners report ~7–8 GiB
# while still completing this Next build.
ARG ALLOW_LOW_RAM_BUILD=0
ENV ALLOW_LOW_RAM_BUILD=${ALLOW_LOW_RAM_BUILD}
# MAX_UPLOAD_MB remains a runtime-only server variable. Copy its build argument
# into the parity guard's checker-only name, then remove MAX_UPLOAD_MB from the
# Next build process so application env validation cannot mistake an empty
# build argument for a runtime value.
RUN UPLOAD_LIMIT_PARITY_SERVER_MB="${MAX_UPLOAD_MB}" env -u MAX_UPLOAD_MB npm run build

FROM node-base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY scripts/check-node-engine.cjs scripts/check-node-engine.cjs
COPY scripts/install-git-hooks.mjs scripts/install-git-hooks.mjs
COPY scripts/check-installed-lock-parity.mjs scripts/check-installed-lock-parity.mjs
RUN for attempt in 1 2 3; do \
      npm ci --omit=dev --ignore-scripts --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 && break; \
      if [ "$attempt" -eq 3 ]; then exit 1; fi; \
      sleep $((attempt * 10)); \
    done

FROM node-base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
# From the build stage, not the build context: `stamp-service-worker.mjs` rewrites
# public/sw.js during the build so the file's bytes differ per release, and a plain
# `COPY public` would take the unstamped original straight from the context and silently
# undo it. The runtime image must carry the artifact the build actually produced.
COPY --from=build /app/public ./public
COPY --from=build /app/src/lib/security-headers.ts ./src/lib/security-headers.ts
COPY --from=build /app/src/lib/observability/sentry-release.ts ./src/lib/observability/sentry-release.ts
COPY --from=build /app/src/lib/supabase/project.ts ./src/lib/supabase/project.ts
COPY --from=build /app/src/components/therapy-compass/data/generated-assets.ts ./src/components/therapy-compass/data/generated-assets.ts
COPY --from=build /app/src/data/therapy-catalogue-assets.ts ./src/data/therapy-catalogue-assets.ts
# Railway deploy pre-deploy gate (docs/worker-deploy-runbook.md §0): blocks/
# observes this service's deploy until migrations this build expects are live.
COPY --from=build /app/deploy/expected-migrations.json ./deploy/expected-migrations.json
COPY --from=build /app/scripts/deploy/await-migrations.mjs ./scripts/deploy/await-migrations.mjs
COPY --from=build /app/scripts/deploy/migration-versions.mjs ./scripts/deploy/migration-versions.mjs
COPY package.json next.config.ts ./
USER node
EXPOSE 3000
LABEL org.opencontainers.image.source="https://github.com/BigSimmo/PsychSift"
LABEL org.opencontainers.image.title="PsychSift app tier"
LABEL org.opencontainers.image.description="Next.js 16 app tier for the PsychSift medical guideline RAG knowledge base"
LABEL org.opencontainers.image.licenses="UNLICENSED"
STOPSIGNAL SIGTERM
# /api/health is the app's own ops health route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Bypass scripts/dev-free-port.mjs (a local-dev port picker): a container has
# exactly one app, so bind 0.0.0.0 on $PORT directly.
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
