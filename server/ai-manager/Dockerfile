# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --ignore-scripts

# ── Runtime stage ─────────────────────────────────────────────
FROM node:20-alpine AS runtime
LABEL maintainer="superparty-ai-manager"
LABEL description="Superparty AI Manager — employee operations & AI orchestration"

WORKDIR /app

# Non-root user
RUN addgroup -S aiops && adduser -S aiops -G aiops

COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Remove dev/test artifacts
RUN rm -f .env .env.*

RUN chown -R aiops:aiops /app

USER aiops

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -q -O - http://localhost:3002/health || exit 1

CMD ["node", "index.mjs"]
