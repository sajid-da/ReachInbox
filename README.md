# ReachInbox Email Scheduler

Full-stack implementation for the ReachInbox hiring assignment, including the verified scheduler backend and a React/Vite frontend based on the supplied reference screens.

## Architecture

- Express + TypeScript exposes scheduling, scheduled-email, sent-email, and health APIs.
- PostgreSQL stores users, configured senders, and every email job. `idempotency_key` is unique, so repeated requests do not create duplicate sends; jobs are scoped to the authenticated Google subject.
- BullMQ stores delayed jobs in Redis. There are no cron jobs or polling schedulers.
- A configurable worker concurrency processes jobs in parallel. Job state is claimed transactionally (`scheduled` -> `processing`) so duplicate worker deliveries are ignored; stale `processing` claims are recoverable after `PROCESSING_TIMEOUT_MS`.
- Redis Lua counters enforce an hourly limit per sender across workers/instances. When exhausted, the job is re-added for the next hour; it is never dropped.
- A Redis spacing lock enforces the configured minimum delay between sends across workers.
- SMTP uses Ethereal credentials from environment variables only. Missing credentials fail safely and persist a failed status.

## Local setup

Docker Desktop is expected to be running:

```powershell
docker compose up -d
```

Copy `.env.example` to `.env` and fill in Ethereal SMTP credentials. Then:

```powershell
npm install
npm run build
npm start
```

The API listens on `PORT` (default `4000`) and starts the worker by default. `npm run dev` is available for development when the local `tsx` loader works; the compiled `npm start` command is the verified production path.

To run the worker separately after building:

```powershell
npm run worker
```

For production build:

```powershell
npm run typecheck
npm run build
npm start
```

## API

`POST /api/emails/schedule`

```json
{
  "recipients": ["lead@example.com"],
  "subject": "Hello",
  "body": "Message body",
  "startTime": "2030-01-01T10:00:00.000Z",
  "delayMs": 2000,
  "hourlyLimit": 200,
  "senderEmail": "sender@example.com",
  "idempotencyKey": "campaign-123"
}
```

`GET /api/senders` lists configured sender addresses (never SMTP credentials). `GET /api/emails/scheduled` lists the authenticated user's scheduled/processing jobs. `GET /api/emails/sent` lists that user's sent and failed jobs. `GET /health` checks PostgreSQL connectivity.

## Frontend

The React/Vite client lives in `frontend/` and follows the supplied ReachInbox reference screens: sidebar mailbox navigation, scheduled/sent lists, compose flow, recipient chips, CSV upload, Send Later popover, and message detail view.

Run it locally alongside the API:

```powershell
npm run dev:client
```

Vite proxies `/api` to `http://localhost:4000` during local development. For a separately hosted frontend, set `VITE_API_URL` to the public API origin at build time, for example `https://your-api.example.com` (do not commit a real URL or secret). The frontend build is emitted to `dist/client` by `npm run build`.

The UI authenticates with Google OAuth through `/auth/google`, then uses an HTTP-only signed session cookie. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SESSION_SECRET`, and `FRONTEND_URL` before running. For separate services, set `CORS_ORIGIN` to the frontend origin and use credentialed requests.

## Configuration

See `.env.example`. `WORKER_CONCURRENCY`, `PROCESSING_TIMEOUT_MS`, `WORKER_LOCK_DURATION_MS`, `MIN_SEND_DELAY_MS`, and `MAX_EMAILS_PER_HOUR` provide deployment defaults; each scheduling request can override delay and hourly limit, which are persisted with the job.

## Load and restart behavior

For 1000+ emails at one start time, BullMQ persists all delayed jobs in Redis and workers process them concurrently. Redis spacing and sender hourly counters spread actual sends; rate-limited jobs are moved to the next hour while retaining their database record and idempotency key. On API startup, scheduled PostgreSQL rows are reconciled into BullMQ when their Redis job is missing, covering a crash between the database commit and queue insertion. PostgreSQL and Redis volumes in `docker-compose.yml` survive application restarts, so pending delayed jobs are recovered by BullMQ. If a worker dies after claiming a row, BullMQ redelivery plus the stale-claim timeout makes the row eligible again; completed `sent` rows are never claimed again. As with SMTP generally, a crash after an SMTP server accepts a message but before the database update can only provide at-least-once delivery.

## Assessment requirement mapping

| Requirement | Implementation |
| --- | --- |
| Real Google login | Google OAuth authorization-code flow, signed HTTP-only session cookie, real profile data, logout, and protected email APIs |
| Persistent scheduling | PostgreSQL job rows plus BullMQ delayed jobs in Redis; both are external persistent services |
| No cron | Scheduling uses BullMQ delays only; no cron library or polling loop is used |
| Idempotency | Unique PostgreSQL `idempotency_key`, owner scoping, and transactional `scheduled` claim prevent duplicate sends |
| Worker concurrency | `WORKER_CONCURRENCY` configures BullMQ worker concurrency |
| Crash recovery | `PROCESSING_TIMEOUT_MS` reclaims abandoned processing rows; `WORKER_LOCK_DURATION_MS` controls BullMQ lock expiry |
| Send spacing | `MIN_SEND_DELAY_MS` and per-job delay values are persisted and used for rescheduling |
| Hourly rate limit | Atomic Redis Lua counter per sender/hour; jobs are rescheduled into the next hour instead of dropped |
| Multiple senders | Sender records are stored in PostgreSQL and rate limits are keyed per sender |
| Load behavior | 1000+ delayed jobs remain in Redis; concurrency processes them while spacing/rate limits smooth delivery |
| Frontend workflow | Auth-gated dashboard, scheduled/sent lists, search/filter, compose, CSV parsing, delay/hourly limit, Send Later, and detail views |

### Assumptions and trade-offs

- Google OAuth credentials and the callback URL must be created in Google Cloud Console; the application never stores OAuth passwords in source.
- The signed cookie expires after seven days; logout also writes a short-lived Redis revocation key, so replaying an old cookie is rejected.
- The frontend and API can be separate origins, but `CORS_ORIGIN` and credentialed requests must be configured consistently.
- State-changing API requests require an allowed `Origin`, providing browser CSRF protection alongside the signed session cookie.
- The current SMTP network restriction is environmental; Ethereal configuration remains unchanged.

## Verification

```powershell
npm run typecheck
npm run build
npm test
```

Full end-to-end tests require Docker PostgreSQL/Redis and valid Ethereal credentials. No secrets belong in source control.

## Railway deployment

Create one Railway project with PostgreSQL and Redis plugins, then create two services from this repository:

1. **API service** — uses the `railway.toml` build/deploy configuration (`npm run build`, `npm run start`). Set `RUN_WORKER=false` so this service does not also run a worker. Railway supplies `PORT`; the API binds to it automatically.
2. **Worker service** — use the same repository and build command, but set the start command to `npm run worker`. This service does not need an HTTP health check.

Railway's PostgreSQL and Redis plugins provide `DATABASE_URL` and `REDIS_URL`. Attach both plugins to both services. Configure these variables in Railway's Variables UI; never commit their values:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string supplied by Railway |
| `REDIS_URL` | Yes | Redis connection string supplied by Railway |
| `PORT` | API only | Supplied by Railway; defaults to `4000` locally |
| `RUN_WORKER` | API only | Set to `false` on the API service |
| `CORS_ORIGIN` | API only | Comma-separated allowed frontend origins; set this to the deployed frontend URL |
| `FRONTEND_URL` | API only | Redirect target after Google OAuth |
| `GOOGLE_CLIENT_ID` | API only | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | API only | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | API only | Registered Google OAuth callback URL |
| `SESSION_SECRET` | API only | Long random secret for signing session cookies |
| `VITE_API_URL` | Frontend build | Public API origin; required for production frontend builds |
| `SMTP_HOST` | Yes | Ethereal SMTP host, normally `smtp.ethereal.email` |
| `SMTP_PORT` | Yes | Ethereal SMTP port, normally `587` |
| `SMTP_USER` | Yes | Ethereal username |
| `SMTP_PASS` | Yes | Ethereal password |
| `DEFAULT_SENDER_EMAIL` | Yes | Sender address used when a request omits one |
| `WORKER_CONCURRENCY` | No | Worker concurrency; default `10` |
| `MIN_SEND_DELAY_MS` | No | Default spacing between sends; default `2000` |
| `MAX_EMAILS_PER_HOUR` | No | Default per-sender hourly limit; default `200` |

After deployment, verify the API service's `/health` endpoint returns HTTP 200. The health check validates PostgreSQL connectivity; Redis connectivity is exercised by the BullMQ queue/worker. Delayed jobs remain persistent in Railway Redis across API/worker restarts.

## Render one-click Blueprint deployment

The repository root contains `render.yaml`, which defines the complete Render stack:

- `reachinbox-api`: Node web service using `npm install && npm run build` and `npm start`, with `/health` configured as its health check.
- `reachinbox-worker`: separate BullMQ background worker using `npm install && npm run build` and `npm run worker`.
- `reachinbox-frontend`: Render static site publishing `dist/client`, the output configured by `vite.config.ts` and `npm run build`.
- `reachinbox-postgres`: managed PostgreSQL database.
- `reachinbox-redis`: managed Render Key Value service with snapshot persistence and `noeviction`.

Create a Render Blueprint from this repository and select `render.yaml`. Database URLs, Redis URL, the frontend/API URLs, CORS origin, and the Google callback base URL are wired through Render service references; no localhost URL is used by the production Blueprint. The application appends `/auth/google/callback` to the API's generated external URL when Render supplies the callback base.

During the initial Blueprint setup, provide these dashboard-only values:

- `DEFAULT_SENDER_EMAIL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SMTP_USER`
- `SMTP_PASS`

Render generates `SESSION_SECRET`. After the first sync, copy the generated API URL into Google Cloud's authorized redirect URI as `https://<api-host>/auth/google/callback`, and add the generated frontend URL to the Google OAuth authorized origins. Ethereal remains the SMTP provider; use `smtp.ethereal.email` and port `587` as defined in the Blueprint.
