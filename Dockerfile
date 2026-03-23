FROM oven/bun:1-alpine AS base
WORKDIR /app

# Dependency install
FROM base AS install
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/am-addon/package.json ./packages/am-addon/
COPY packages/spotify-addon/package.json ./packages/spotify-addon/
COPY packages/torbox-addon/package.json ./packages/torbox-addon/
COPY packages/ytm-addon/package.json ./packages/ytm-addon/
RUN bun install --frozen-lockfile --production

# Release
FROM base AS release
COPY package.json ./
COPY packages/ ./packages/
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/packages/am-addon/node_modules ./packages/am-addon/node_modules
COPY --from=install /app/packages/spotify-addon/node_modules ./packages/spotify-addon/node_modules
COPY --from=install /app/packages/torbox-addon/node_modules ./packages/torbox-addon/node_modules
COPY --from=install /app/packages/ytm-addon/node_modules ./packages/ytm-addon/node_modules
USER bun
ENTRYPOINT ["bun", "run"]
