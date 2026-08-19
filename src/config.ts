import 'dotenv/config';

const number = (name: string, fallback: number) => {
  const value = process.env[name];
  return value ? Number(value) : fallback;
};
const nodeEnv = process.env.NODE_ENV ?? 'development';
const localOrEmpty = (value: string | undefined, local: string) => value ?? (nodeEnv === 'production' ? '' : local);
const renderExternalUrl = (process.env.RENDER_EXTERNAL_URL ?? '').trim().replace(/\/$/, '');
const configuredFrontendUrl = (process.env.FRONTEND_URL ?? '').trim().replace(/\/$/, '');
const frontendUrl = configuredFrontendUrl || renderExternalUrl || (nodeEnv === 'production' ? '' : 'http://localhost:5173');
const configuredGoogleRedirectUri = (process.env.GOOGLE_REDIRECT_URI ?? '').trim().replace(/\/$/, '');
const googleRedirectUri = configuredGoogleRedirectUri
  ? (configuredGoogleRedirectUri.endsWith('/auth/google/callback') ? configuredGoogleRedirectUri : `${configuredGoogleRedirectUri}/auth/google/callback`)
  : (renderExternalUrl ? `${renderExternalUrl}/auth/google/callback` : (nodeEnv === 'production' ? '' : `http://localhost:${number('PORT', 4000)}/auth/google/callback`));

export const config = {
  nodeEnv,
  port: number('PORT', 4000),
  databaseUrl: localOrEmpty(process.env.DATABASE_URL, 'postgres://reachinbox:reachinbox@localhost:5432/reachinbox'),
  redisUrl: localOrEmpty(process.env.REDIS_URL, 'redis://localhost:6379'),
  defaultSender: process.env.DEFAULT_SENDER_EMAIL ?? '',
  corsOrigin: localOrEmpty(process.env.CORS_ORIGIN, 'http://localhost:5173'),
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: number('SMTP_PORT', 0),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
  },
  workerConcurrency: number('WORKER_CONCURRENCY', 10),
  processingTimeoutMs: number('PROCESSING_TIMEOUT_MS', 120_000),
  workerLockDurationMs: number('WORKER_LOCK_DURATION_MS', 120_000),
  minSendDelayMs: number('MIN_SEND_DELAY_MS', 2000),
  maxEmailsPerHour: number('MAX_EMAILS_PER_HOUR', 200),
  frontendUrl,
  sessionSecret: process.env.SESSION_SECRET ?? '',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri: googleRedirectUri,
  },
};
