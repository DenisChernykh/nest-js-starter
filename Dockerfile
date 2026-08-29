# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89
# check=error=true

ARG NODE_IMAGE=node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573

FROM ${NODE_IMAGE} AS security-patched-base
RUN apt-get update && \
    apt-get install --only-upgrade --yes --no-install-recommends \
      bsdutils \
      libblkid1 \
      liblastlog2-2 \
      libmount1 \
      libsmartcols1 \
      libssl3t64 \
      libuuid1 \
      login \
      mount \
      openssl-provider-legacy \
      util-linux && \
    rm -rf /var/lib/apt/lists/*

FROM security-patched-base AS dependencies
ENV HUSKY=0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY .husky/install.mjs ./.husky/install.mjs
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    corepack pnpm@11.15.1 install --frozen-lockfile --store-dir=/pnpm/store

FROM dependencies AS development
ENV NODE_ENV=development \
    API_HOST=0.0.0.0 \
    pnpm_config_verify_deps_before_run=false
COPY --chown=node:node . .
RUN mkdir -p /app/dist && chown -R node:node /app/dist
USER node
EXPOSE 3000
CMD ["corepack", "pnpm@11.15.1", "run", "dev:api"]

FROM dependencies AS build
COPY . .
RUN corepack pnpm@11.15.1 run build && \
    CI=true corepack pnpm@11.15.1 prune --prod

FROM security-patched-base AS runtime
ARG BUILD_REVISION
ARG BUILD_SOURCE
ARG BUILD_CREATED
RUN rm -rf /root/.cache/node/corepack && \
    rm -rf /usr/local/lib/node_modules/npm && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx
RUN node -e 'const [revision, source] = process.argv.slice(1); if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("BUILD_REVISION must be 40 lowercase hex"); let url; try { url = new URL(source) } catch { throw new Error("BUILD_SOURCE must be a credential-free HTTPS URL") } if (url.protocol !== "https:" || url.username !== "" || url.password !== "") throw new Error("BUILD_SOURCE must be a credential-free HTTPS URL")' "$BUILD_REVISION" "$BUILD_SOURCE"
LABEL org.opencontainers.image.title="nest-js-starter" \
      org.opencontainers.image.source="${BUILD_SOURCE}" \
      org.opencontainers.image.revision="${BUILD_REVISION}" \
      org.opencontainers.image.created="${BUILD_CREATED}"
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    pnpm_config_verify_deps_before_run=false
WORKDIR /app
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/prisma.config.ts ./prisma.config.ts
USER node
EXPOSE 3000
CMD ["node", "dist/bootstrap/api/main.js"]
