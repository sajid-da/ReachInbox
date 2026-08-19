# ReachInbox Email Scheduler Assignment

## Working rules

- [ ] Before each implementation step, reread and follow the user-provided rules.
- [ ] Do not install new dependencies; reuse existing libraries, components, and functions whenever possible.
- [ ] Never hardcode secrets.
- [ ] Diagnose command failures before attempting another fix.
- [ ] Do not claim completion until the implementation is tested and working.
- [ ] Ask for user approval before implementing frontend UI/UX.

## Task checklist

### Repository

- [x] Create living task note
- [x] Inspect repository
- [x] Confirm repository state
- [x] Verify local Node/npm/Git/Docker/Redis tooling (Node v24.19.0 and npm v11.17.0 now resolve on PATH; Docker is not resolving; WSL reports access denied; no native Redis)
- [x] Review implementation plan

### Backend

- [x] TypeScript backend
- [x] Express.js API
- [x] PostgreSQL persistence
- [x] Database schema/migrations
- [x] Email scheduling API
- [x] Scheduled email API
- [x] Sent email API
- [x] Multiple sender support
- [x] Environment-based configuration

### Scheduler

- [x] BullMQ
- [x] Redis integration
- [x] Delayed jobs
- [x] NO cron
- [x] Configurable worker concurrency
- [x] Minimum delay between sends
- [x] Configurable hourly rate limit
- [x] Redis/DB-backed rate-limit state
- [x] Safe across multiple workers
- [x] Reschedule when hourly limit is reached
- [x] Never drop rate-limited jobs
- [x] Preserve ordering as much as reasonably possible
- [x] Handle 1000+ simultaneous scheduled emails (design/documentation)
- [x] Restart-safe delayed jobs (design via persistent Redis/Postgres)
- [x] Idempotent email processing
- [x] Duplicate-send prevention

### SMTP

- [x] Ethereal SMTP
- [x] Environment-based SMTP credentials
- [x] No committed secrets
- [x] .env.example
- [x] SMTP failure handling
- [x] Send status persistence

### Frontend — WAIT FOR USER UI APPROVAL

- [ ] Inspect provided Figma
- [ ] Confirm UI/UX direction with user
- [x] Real Google OAuth
- [x] Session-aware logout with backend revocation, cookie clearing, and protected-route reset
- [ ] Dashboard and email views
- [ ] Compose flow and CSV parsing
- [ ] Loading, empty, and error states
- [ ] Reusable responsive TypeScript components
- [ ] Match Figma closely

### Testing

- [x] API, PostgreSQL/Redis delayed-job restart test, and production verification
- [x] Reproduced abandoned `processing` claim after worker crash; added stale-claim recovery
- [x] Added API-startup reconciliation for scheduled PostgreSQL rows missing from Redis
- [ ] Full SMTP crash/delivery test (blocked by outbound Ethereal network restriction)
- [x] Production build
- [x] Type checking
- [x] Linting (no lint configuration exists yet)

### Documentation

- [x] README setup and environment instructions
- [x] Architecture, scheduling, persistence, idempotency, rate-limit, concurrency, and 1000+ email behavior
- [x] Requirements mapping, assumptions, and trade-offs

### Submission

- [ ] Private GitHub repository and collaborator access
- [ ] Verify no secrets
- [ ] Prepare <=5 minute demo
- [ ] Demonstrate scheduling, restart persistence, and optional rate limiting
- [ ] Final Git diff/status review

### Deployment preparation

- [x] Production build/start scripts
- [x] Separate BullMQ worker entrypoint
- [x] Railway Config-as-Code for API healthcheck/startup
- [x] Production environment-variable documentation
- [x] Deployment-focused `.gitignore` rules
- [x] Re-run typecheck, tests, and build

## Current status

The repository contains the backend and approved frontend implementation. The latest persistence audit verified delayed-job survival and reproduced/fixed stale processing recovery.

## Proposed implementation plan (before coding)

1. Confirm the UI/UX direction with the user, since the assignment requires matching a Figma design but no Figma URL was included.
2. Scaffold the minimum TypeScript backend and React frontend using only explicitly approved/available dependencies; first verify the local toolchain.
3. Add environment-driven configuration and database schema for users, email jobs, senders, and idempotency keys.
4. Build Express scheduling/list APIs and transactional persistence.
5. Wire BullMQ delayed jobs and workers with configurable concurrency, minimum send spacing, Redis-backed hourly limits, safe rescheduling, and restart/idempotency behavior.
6. Add Ethereal SMTP integration using environment-provided credentials only.
7. After UI/UX approval, build Google OAuth and the dashboard/compose/scheduled/sent views.
8. Add README/run instructions and verify with focused tests plus restart/load/rate-limit checks.

Plan status: backend source, configuration, migration, build, unit verification, Redis/PostgreSQL connectivity, and production startup are verified. Frontend implementation is now approved and in progress; backend logic remains frozen. `npm.cmd run dev` still fails in this environment before application startup because `tsx` triggers Node `uv_os_get_passwd ENOMEM`; `npm.cmd start` runs successfully.

### Frontend implementation plan

- [x] Add minimal React/Vite/TypeScript frontend tooling.
- [x] Recreate the Figma-inspired sidebar, message list, compose view, send-later popover, and email detail view.
- [x] Connect scheduled/sent lists and scheduling form to `VITE_API_URL`.
- [x] Add CSV lead parsing, loading, empty, error, and success states.
- [x] Verify frontend typecheck and production build.

Frontend remaining: interactive Google OAuth requires running the backend from a host process with outbound HTTPS access to Google.

Assessment audit update: Google OAuth flow, signed session cookies, logout, protected email APIs, credentialed frontend requests, functional search/filter, and requirement mapping are implemented. Runtime Google sign-in still requires real Google Cloud OAuth environment variables; local guard tests return 503 when those variables are intentionally absent.

Deployment preparation update: production API CORS is environment-configured, production frontend API configuration fails clearly when `VITE_API_URL` is missing, and the GitHub remote is configured. No deployment or push is performed automatically.

Credential audit update: SMTP username/password occur only in the ignored local `.env` used for testing; no staged/source/Git-history matches were found. SMTP delivery verification is blocked by outbound TCP access to Ethereal (port 587 fails; the test job remains processing), so no preview URL was produced.

### Development-loader investigation

- `tsx` version: 4.23.12.
- Direct system Node v24.19.0 `os.userInfo()` fails with the same `uv_os_get_passwd ENOMEM` error.
- Bundled Node v24.19.0 fails identically.
- `os.tmpdir()` and the compiled production server work.
- The process identity is inconsistent in this sandbox (`whoami` reports `codexsandboxoffline`, while `USERNAME` is `Admin`), indicating an execution-environment Windows user lookup failure rather than a tsx/Node compatibility problem.
