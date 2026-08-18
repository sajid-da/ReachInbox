# ReachInbox Email Scheduler

Full-stack implementation for the ReachInbox hiring assignment, including the verified scheduler backend and a React/Vite frontend based on the supplied reference screens.

## Architecture

- Express + TypeScript exposes scheduling, scheduled-email, sent-email, and health APIs.
- PostgreSQL stores senders and every email job. `idempotency_key` is unique, so repeated requests do not create duplicate sends.
- BullMQ stores delayed jobs in Redis. There are no cron jobs or polling schedulers.
- A configurable worker concurrency processes jobs in parallel. Job state is claimed transactionally (`scheduled` -> `processing`) so duplicate worker deliveries are ignored.
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

`GET /api/emails/scheduled` lists scheduled/processing jobs. `GET /api/emails/sent` lists sent and failed jobs. `GET /health` checks PostgreSQL connectivity.

## Frontend

The React/Vite client lives in `frontend/` and follows the supplied ReachInbox reference screens: sidebar mailbox navigation, scheduled/sent lists, compose flow, recipient chips, CSV upload, Send Later popover, and message detail view.

Run it locally alongside the API:

```powershell
npm run dev:client
```

Vite proxies `/api` to `http://localhost:4000` during local development. For a separately hosted frontend, set `VITE_API_URL` to the public API origin at build time, for example `https://your-api.example.com` (do not commit a real URL or secret). The frontend build is emitted to `dist/client` by `npm run build`.

The UI is wired to the existing scheduling/list APIs. For separate Railway services, set `CORS_ORIGIN` on the API service to the frontend's HTTPS origin. Google OAuth is not included because the existing backend has no authentication endpoint.

## Configuration

See `.env.example`. `WORKER_CONCURRENCY`, `MIN_SEND_DELAY_MS`, and `MAX_EMAILS_PER_HOUR` provide deployment defaults; each scheduling request can override delay and hourly limit, which are persisted with the job.

## Load and restart behavior

For 1000+ emails at one start time, BullMQ persists all delayed jobs in Redis and workers process them concurrently. Redis spacing and sender hourly counters spread actual sends; rate-limited jobs are moved to the next hour while retaining their database record and idempotency key. PostgreSQL and Redis volumes in `docker-compose.yml` survive application restarts, so pending delayed jobs are recovered by BullMQ.

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
