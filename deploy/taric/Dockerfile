# syntax=docker/dockerfile:1

# Build Taric with Node 22 and compile all workspace packages.
FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.json ./
RUN npm ci --include-workspace-root --workspaces=false || npm install --workspaces=false
RUN npm ci
RUN npm run build

# Runtime uses a non-root process and a Linux named volume for authority data.
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    TARIC_DB=/data/authority.sqlite \
    TARIC_CONTENT_ROOT=/data/content
WORKDIR /app
RUN groupadd --gid 10001 taric \
    && useradd --uid 10001 --gid taric --no-create-home --shell /usr/sbin/nologin taric \
    && mkdir -p /data/content \
    && chown -R taric:taric /data
COPY --from=build --chown=taric:taric /src/package.json /src/package-lock.json ./
COPY --from=build --chown=taric:taric /src/node_modules ./node_modules
COPY --from=build --chown=taric:taric /src/packages ./packages
USER taric
VOLUME ["/data"]
ENTRYPOINT ["node", "packages/cli/dist/bin.js"]
CMD ["--help"]
