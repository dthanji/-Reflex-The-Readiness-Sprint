# Deploying Reflex

## What's handled in the code

- **JWT secret**: required in production, app refuses to start without it (`backend/src/auth.js`). No hardcoded fallback.
- **CORS**: restricted to an explicit allowlist via `ALLOWED_ORIGINS`. Cross-origin browser requests from anywhere else are rejected with a clean 403.
- **Rate limiting**: 20 requests/15min on `/api/auth/*`, 120 requests/min on the rest of `/api/*`.
- **Errors**: never leak a raw stack trace — both CORS rejections and unhandled errors return clean JSON.
- **Non-root container user**: the Docker image runs as an unprivileged user, not root.

## What's NOT handled in the code — this is the host/infra's job

**HTTPS/WSS.** This app speaks plain HTTP and ws:// — it does not terminate TLS itself. In production, put it behind a reverse proxy or platform that terminates HTTPS (nginx, Caddy, or your hosting platform's built-in TLS — Render, Railway, Fly.io, and similar all do this automatically). The frontend's `app.js` already handles this correctly: it switches to `wss://` automatically when the page is loaded over `https://`, so no frontend changes are needed once TLS is terminated in front of it.

**Database backups.** Not automated here. If you use managed Postgres (RDS, Render Postgres, Supabase, etc.), enable their automated backup feature. If self-hosting Postgres, set up `pg_dump` on a cron schedule.

**Secrets management.** `.env.example` documents what's needed. In production, use your platform's secret manager (not a committed `.env` file) for `JWT_SECRET` and `PGPASSWORD`.

**Horizontal scaling.** Documented as a known trade-off in `TRADEOFFS.md` — the WebSocket broadcast hub is single-process. Don't run more than one backend instance without adding Redis pub/sub first, or riders/dispatchers connected to different instances won't see each other's updates.

## Running with Docker (local or any Docker host)

```bash
cp backend/.env.example .env
# edit .env: set JWT_SECRET (generate with the command in .env.example) and PGPASSWORD

docker compose up --build
```

This starts Postgres (with the schema applied automatically on first boot) and the backend together. The app is available at `http://localhost:3000/` — put a TLS-terminating proxy in front of it for anything beyond local testing.

## Running without Docker

See the main `README.md` Quick Start section — `createdb`, apply `schema.sql`, `npm install`, `npm start` — but set `JWT_SECRET` and `ALLOWED_ORIGINS` in your environment first; the app will refuse to start in production without `JWT_SECRET`.

## Pre-deploy checklist

- [ ] `JWT_SECRET` set to a real random value in the deploy environment (not `.env.example`'s blank)
- [ ] `ALLOWED_ORIGINS` set to your actual frontend domain(s)
- [ ] `NODE_ENV=production` set
- [ ] TLS terminated in front of the app (reverse proxy or platform-provided)
- [ ] Postgres backups enabled
- [ ] `npm test` passing against a fresh test database
- [ ] Still only one backend instance running (see horizontal scaling note above) unless Redis pub/sub has been added
