import express from 'express';
import crypto from 'node:crypto';
import { config } from './config.js';
import { migrate, pool, withTransaction } from './db.js';
import { emailQueue } from './queue.js';
import { clearCookie, createSession, exchangeGoogleCode, getCookie, googleAuthUrl, readSession, requireAuth, revokeSession, setCookie } from './auth.js';

const app = express();
const allowedOrigins = config.corsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);
const isAllowedOrigin = (origin: string | undefined) => Boolean(origin) && (
  allowedOrigins.includes('*') ||
  allowedOrigins.includes(origin as string) ||
  (config.nodeEnv !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin as string))
);
app.use((req, res, next) => {
  const origin = req.header('origin');
  if (origin && isAllowedOrigin(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.path.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !isAllowedOrigin(origin)) return res.status(403).json({ error: 'Origin not allowed' });
  next();
});
app.use(express.json({ limit: '2mb' }));

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.get('/auth/google', (req, res) => {
  if (!config.google.clientId || !config.google.clientSecret || !config.sessionSecret) return res.status(503).json({ error: 'Google OAuth is not configured' });
  const state = crypto.randomBytes(24).toString('hex');
  setCookie(res, 'reachinbox_oauth_state', state, 600);
  res.redirect(googleAuthUrl(state));
});

app.get('/auth/google/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!code || !state || state !== getCookie(req, 'reachinbox_oauth_state')) return res.status(400).send('Invalid Google OAuth callback');
  try {
    const user = await exchangeGoogleCode(code);
    setCookie(res, 'reachinbox_session', createSession(user), 7 * 24 * 60 * 60);
    clearCookie(res, 'reachinbox_oauth_state');
    res.redirect(config.frontendUrl);
  } catch (error) {
    console.error('Google OAuth failed:', error instanceof Error ? error.message : 'unknown error');
    res.status(502).send('Google sign-in failed');
  }
});

app.get('/api/auth/me', async (req, res) => {
  const user = await readSession(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  res.json({ user });
});

app.post('/api/auth/logout', async (req, res) => { await revokeSession(req); clearCookie(res, 'reachinbox_session'); res.status(204).send(); });

app.get('/api/senders', requireAuth, async (_req, res) => {
  const result = await pool.query('SELECT email, display_name AS "displayName" FROM senders ORDER BY email ASC');
  res.json(result.rows);
});

app.post('/api/emails/schedule', requireAuth, async (req, res) => {
  const { recipients, subject, body, startTime, delayMs = config.minSendDelayMs, hourlyLimit = config.maxEmailsPerHour, senderEmail = config.defaultSender, idempotencyKey } = req.body ?? {};
  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > 10_000 || typeof subject !== 'string' || typeof body !== 'string' || !subject.trim() || !body.trim() || !startTime) return res.status(400).json({ error: 'recipients, subject, body, and startTime are required' });
  const start = new Date(startTime);
  const numericDelay = Number(delayMs);
  const numericHourlyLimit = Number(hourlyLimit);
  const normalizedRecipients = [...new Set(recipients.filter((value): value is string => typeof value === 'string').map((value) => value.trim().toLowerCase()).filter((value) => /^\S+@\S+\.\S+$/.test(value)))];
  if (Number.isNaN(start.getTime()) || !normalizedRecipients.length || !Number.isFinite(numericDelay) || !Number.isFinite(numericHourlyLimit) || numericDelay < 0 || numericDelay > 86_400_000 || numericHourlyLimit < 1 || numericHourlyLimit > 1_000_000 || subject.length > 998 || body.length > 100_000 || /[\r\n]/.test(subject) || typeof senderEmail !== 'string' || !/^\S+@\S+\.\S+$/.test(senderEmail)) return res.status(400).json({ error: 'Invalid scheduling values' });
  const user = res.locals.user as { sub: string; email: string; name: string; picture: string };
  try {
    const requestKey = idempotencyKey ?? crypto.randomUUID();
    const inserted = await withTransaction(async (client) => {
      await client.query('INSERT INTO users(sub, email, display_name, picture) VALUES ($1,$2,$3,$4) ON CONFLICT (sub) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name, picture = EXCLUDED.picture, updated_at = now()', [user.sub, user.email, user.name, user.picture]);
      const sender = await client.query('SELECT id FROM senders WHERE email = $1', [senderEmail]);
      if (!sender.rowCount) throw new Error('Sender is not configured');
      const senderId = sender.rows[0].id;
      const rows: { id: string; scheduled_at: Date }[] = [];
      for (let index = 0; index < normalizedRecipients.length; index++) {
        const recipient = normalizedRecipients[index];
        const key = `${requestKey}:${recipient}:${index}`;
        const scheduledAt = new Date(start.getTime() + index * numericDelay);
        const result = await client.query(`INSERT INTO email_jobs(idempotency_key, owner_sub, sender_id, recipient, subject, body, scheduled_at, min_delay_ms, hourly_limit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, scheduled_at`, [key, user.sub, senderId, recipient, subject.trim(), body, scheduledAt, numericDelay, numericHourlyLimit]);
        if (result.rowCount) rows.push(result.rows[0]);
      }
      return rows;
    });
    await Promise.all(inserted.map((row) => emailQueue.add('send', { emailJobId: row.id }, { jobId: row.id, delay: Math.max(0, row.scheduled_at.getTime() - Date.now()), removeOnComplete: true, removeOnFail: false })));
    res.status(201).json({ scheduled: inserted.length });
  } catch (error) { if (error instanceof Error && error.message === 'Sender is not configured') return res.status(400).json({ error: error.message }); console.error(error); res.status(500).json({ error: 'Failed to schedule emails' }); }
});

app.get('/api/emails/scheduled', requireAuth, async (_req, res) => {
  const user = res.locals.user as { sub: string };
  const result = await pool.query("SELECT id, recipient AS email, subject, scheduled_at AS \"scheduledTime\", status FROM email_jobs WHERE owner_sub = $1 AND status IN ('scheduled','processing') ORDER BY scheduled_at ASC", [user.sub]);
  res.json(result.rows);
});

app.get('/api/emails/sent', requireAuth, async (_req, res) => {
  const user = res.locals.user as { sub: string };
  const result = await pool.query("SELECT id, recipient AS email, subject, sent_at AS \"sentTime\", status FROM email_jobs WHERE owner_sub = $1 AND status IN ('sent','failed') ORDER BY sent_at DESC NULLS LAST", [user.sub]);
  res.json(result.rows);
});

await migrate();

async function recoverScheduledJobs() {
  const result = await pool.query('SELECT id, scheduled_at FROM email_jobs WHERE status = $1 ORDER BY scheduled_at ASC', ['scheduled']);
  for (const row of result.rows as { id: string; scheduled_at: Date }[]) {
    const existing = await emailQueue.getJob(row.id);
    if (existing) continue;
    await emailQueue.add('send', { emailJobId: row.id }, {
      jobId: row.id,
      delay: Math.max(0, new Date(row.scheduled_at).getTime() - Date.now()),
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}

await recoverScheduledJobs();
if (process.env.RUN_WORKER !== 'false') await import('./worker.js');
app.listen(config.port, () => console.log(`ReachInbox API listening on :${config.port}`));
