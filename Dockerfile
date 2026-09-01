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

# Initialize the Render database once (only when the users table is absent),
# then start the application. This keeps fresh Render databases self-initializing
# without dropping existing production data on every restart.
CMD ["sh", "-c", "node -e \"const fs=require('fs'); const {pool}=require('./src/db'); (async()=>{ const r=await pool.query(\\\"SELECT to_regclass('public.users') AS table_name\\\"); if(!r.rows[0].table_name){ console.log('[reflex] Database schema not found; initializing...'); await pool.query(fs.readFileSync('/app/schema.sql','utf8')); console.log('[reflex] Database schema initialized.'); } else { console.log('[reflex] Database schema already initialized.'); } await pool.end(); })().catch(async e=>{ console.error('[reflex] Database initialization failed:',e); await pool.end(); process.exit(1); });\" && node src/server.js"]
