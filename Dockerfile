# ---------------------------------------------------------------------------
# Stage 1: Install production dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@10 --activate
RUN pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# Stage 2: Build TypeScript
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
COPY gates/ ./gates/
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 3: Runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

RUN apk add --no-cache curl

WORKDIR /app

RUN addgroup -S holyship && adduser -S holyship -G holyship

COPY --chown=holyship:holyship --from=deps /app/node_modules ./node_modules
COPY --chown=holyship:holyship --from=build /app/dist ./dist
COPY --chown=holyship:holyship drizzle/ ./drizzle/
COPY --chown=holyship:holyship package.json ./
RUN mkdir -p gates /tmp/fleet && chown holyship:holyship /tmp/fleet

USER holyship

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["node", "dist/index.js"]
