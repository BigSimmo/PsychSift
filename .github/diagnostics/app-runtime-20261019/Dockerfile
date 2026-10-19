# syntax=docker/dockerfile:1
# Native-only proof; exact product donor/runtime setup and executable contracts.
FROM node:24-trixie-slim@sha256:7f486cabe892bff8fef04c0f7da8dba84a560be3e4e2740b7a86afc57ebec315 AS app-node-runtime-base
# Keep the command-string shell used by Railway pre-deploy hooks, without
# inheriting the donor's package manager or unrelated operating-system tools.
RUN test "$(id -u node)" = 1000 && test "$(id -g node)" = 1000 \
  && mkdir -p /tmp/app-runtime-home \
  && chown 1000:1000 /tmp/app-runtime-home \
  && dpkg-query --status dash > /tmp/app-runtime-dash.status
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:e792ab3d241a468a4fd7519ddbbebe66b49b5f365771716ea688ad40b6c6f1c2 AS app-runtime-base

FROM app-runtime-base AS runner
COPY --from=app-node-runtime-base /usr/local/bin/node /usr/local/bin/node
COPY --from=app-node-runtime-base /usr/bin/dash /bin/sh
COPY --from=app-node-runtime-base /tmp/app-runtime-dash.status /var/lib/dpkg/status.d/dash
COPY --from=app-node-runtime-base /usr/share/doc/dash/copyright /usr/share/doc/dash/copyright
COPY --from=app-node-runtime-base /etc/passwd /etc/passwd
COPY --from=app-node-runtime-base /etc/group /etc/group
COPY --from=app-node-runtime-base --chown=1000:1000 /tmp/app-runtime-home/ /home/node/
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOME=/home/node
USER node
STOPSIGNAL SIGTERM
# /api/health is the app's own ops health route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Bypass scripts/dev-free-port.mjs (a local-dev port picker): a container has
# exactly one app, so bind 0.0.0.0 on $PORT directly.
# Next's production CLI reads PORT itself (default 3000), preserving Railway's
# selected port while making Node PID 1 without a shell wrapper.
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0"]
