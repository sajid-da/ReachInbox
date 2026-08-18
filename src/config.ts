import 'dotenv/config';

const number = (name: string, fallback: number) => {
  const value = process.env[name];
  return value ? Number(value) : fallback;
};

export const config = {
  port: number('PORT', 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://reachinbox:reachinbox@localhost:5432/reachinbox',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  defaultSender: process.env.DEFAULT_SENDER_EMAIL ?? 'sender@example.com',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  smtp: {
    host: process.env.SMTP_HOST ?? 'smtp.ethereal.email',
    port: number('SMTP_PORT', 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
  },
  workerConcurrency: number('WORKER_CONCURRENCY', 10),
  minSendDelayMs: number('MIN_SEND_DELAY_MS', 2000),
  maxEmailsPerHour: number('MAX_EMAILS_PER_HOUR', 200),
};
