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

## Deploying on Render

Render builds directly from the `Dockerfile` at the repo root, which is already set up. Two ways to do this — pick one:

### Option A: One-click via render.yaml (faster, less manual setup)

The repo includes a `render.yaml` Blueprint that defines both the database and the web service, wired together automatically.

- Render dashboard → **New +** → **Blueprint** → connect the `dthanji/-Reflex-The-Readiness-Sprint` repo → Render reads `render.yaml` and shows you the database + web service it's about to create → **Apply**.
- `JWT_SECRET` is generated automatically by Render, `DATABASE_URL` is wired to the new database automatically — you don't set either by hand.

**Honest caveat:** this file is written to match Render's current documented Blueprint syntax and its YAML has been validated, but it hasn't been run against a real Render account from here — I don't have one to test against. Worth double-checking the values it proposes (region, plan) before clicking Apply, and falling back to Option B if anything about it looks off in the dashboard.

### Option B: Manual setup via the dashboard

### 1. Create the database
- Render dashboard → **New +** → **PostgreSQL**
- Pick a name, region, and plan. Free tier works for testing, but note: it expires after 30 days and then requires a paid plan (~$6/mo minimum) — fine for a sprint defense, not something to build a real product on without upgrading.
- Once created, open the database's **Connect** tab and copy the **Internal Database URL** (not External — Internal avoids egress fees and works as long as your web service is in the same Render account/region, which it will be).

### 2. Apply the schema once
From your own machine, using the **External** connection string this one time (Internal URLs aren't reachable from outside Render's network):
```bash
psql "<external-connection-string-from-render>" -f backend/schema.sql
```

### 3. Create the web service
- **New +** → **Web Service** → connect the `dthanji/-Reflex-The-Readiness-Sprint` repo
- Render should auto-detect the `Dockerfile`. If it offers a choice, pick **Docker** as the environment, not the Node native buildpack — the Dockerfile already handles installing dependencies and copying the frontend into the right place.
- Same region as the database from step 1.
- Free instance type works for testing; note free web services spin down after 15 minutes idle and take 30–60 seconds to wake up on the next request — don't rely on this during a live demo, since that gap will look like the app broke.

### 4. Set environment variables
In the web service's **Environment** tab:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the **Internal** Database URL from step 1 |
| `PGSSLMODE` | leave unset (Internal URLs don't need SSL) |
| `JWT_SECRET` | generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — a real random value, not left blank |
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGINS` | leave unset — the backend serves the PWA frontend itself, so normal use is same-origin and doesn't need CORS allowances. Only set this if you build a separately-hosted frontend later. |

Render injects `PORT` automatically — `server.js` already reads `process.env.PORT`, so no action needed there.

### 5. Deploy and verify (both options)
Render builds and deploys automatically once the service is created. When it's live:
```bash
curl https://your-service-name.onrender.com/api/health
```
should return `{"ok":true}`. Then register a retailer/dispatcher/rider account through the actual UI at that URL and run through the demo script to confirm the full flow works on the real deployment, not just locally.

## Running without Docker

See the main `README.md` Quick Start section — `createdb`, apply `schema.sql`, `npm install`, `npm start` — but set `JWT_SECRET` and `ALLOWED_ORIGINS` in your environment first; the app will refuse to start in production without `JWT_SECRET`.

## Pre-deploy checklist

- [ ] `JWT_SECRET` set to a real random value in the deploy environment (not `.env.example`'s blank)
- [ ] `DATABASE_URL` (or the individual `PG*` vars) pointing at a real database, schema applied
- [ ] `ALLOWED_ORIGINS` set only if the frontend is hosted separately from this backend — same-origin deployments (like Render, as above) don't need it
- [ ] `NODE_ENV=production` set
- [ ] TLS terminated in front of the app (reverse proxy or platform-provided — Render/Railway/Fly.io do this automatically)
- [ ] Postgres backups enabled
- [ ] `npm test` passing against a fresh test database
- [ ] Still only one backend instance running (see horizontal scaling note above) unless Redis pub/sub has been added
