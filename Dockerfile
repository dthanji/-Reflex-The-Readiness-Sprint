# --- Build stage: install dependencies ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# --- Runtime stage ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src
COPY backend/schema.sql ./schema.sql
COPY frontend/public /frontend/public

# Run as a non-root user
RUN addgroup -S reflex && adduser -S reflex -G reflex
USER reflex

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
