# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89
# check=error=true

ARG NODE_IMAGE=node:24.18.0-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    corepack pnpm@11.15.1 install --frozen-lockfile --store-dir=/pnpm/store

FROM dependencies AS build
COPY . .
RUN corepack pnpm@11.15.1 run build && \
    CI=true corepack pnpm@11.15.1 prune --prod

FROM ${NODE_IMAGE} AS runtime
ARG BUILD_REVISION
ARG BUILD_SOURCE
ARG BUILD_CREATED
RUN corepack install --global pnpm@11.15.1
RUN node -e 'const [revision, source] = process.argv.slice(1); if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("BUILD_REVISION must be 40 lowercase hex"); let url; try { url = new URL(source) } catch { throw new Error("BUILD_SOURCE must be a credential-free HTTPS URL") } if (url.protocol !== "https:" || url.username !== "" || url.password !== "") throw new Error("BUILD_SOURCE must be a credential-free HTTPS URL")' "$BUILD_REVISION" "$BUILD_SOURCE"
LABEL org.opencontainers.image.title="nest-js-starter" \
      org.opencontainers.image.source="${BUILD_SOURCE}" \
      org.opencontainers.image.revision="${BUILD_REVISION}" \
      org.opencontainers.image.created="${BUILD_CREATED}"
ENV NODE_ENV=production \
    API_HOST=0.0.0.0
WORKDIR /app
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/prisma.config.ts ./prisma.config.ts
USER node
EXPOSE 3000
CMD ["node", "dist/bootstrap/api/main.js"]
