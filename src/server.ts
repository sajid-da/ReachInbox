import express from 'express';
import crypto from 'node:crypto';
import { config } from './config.js';
import { migrate, pool, withTransaction } from './db.js';
import { emailQueue } from './queue.js';

if (process.env.RUN_WORKER !== 'false') {
  await import('./worker.js');
}

const app = express();
const allowedOrigins = config.corsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.header('origin');
  if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '2mb' }));

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.post('/api/emails/schedule', async (req, res) => {
  const { recipients, subject, body, startTime, delayMs = config.minSendDelayMs, hourlyLimit = config.maxEmailsPerHour, senderEmail = config.defaultSender, idempotencyKey } = req.body ?? {};
  if (!Array.isArray(recipients) || recipients.length === 0 || !subject || !body || !startTime) return res.status(400).json({ error: 'recipients, subject, body, and startTime are required' });
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime()) || delayMs < 0 || hourlyLimit < 1) return res.status(400).json({ error: 'Invalid scheduling values' });
  try {
    const requestKey = idempotencyKey ?? crypto.randomUUID();
    const inserted = await withTransaction(async (client) => {
      const sender = await client.query('SELECT id FROM senders WHERE email = $1', [senderEmail]);
      const senderId = sender.rows[0]?.id ?? (await client.query('INSERT INTO senders(email) VALUES ($1) RETURNING id', [senderEmail])).rows[0].id;
      const rows: { id: string; scheduled_at: Date }[] = [];
      for (let index = 0; index < recipients.length; index++) {
        const recipient = String(recipients[index]).trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(recipient)) continue;
        const key = `${requestKey}:${recipient}:${index}`;
        const scheduledAt = new Date(start.getTime() + index * Number(delayMs));
        const result = await client.query(`INSERT INTO email_jobs(idempotency_key, sender_id, recipient, subject, body, scheduled_at, min_delay_ms, hourly_limit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, scheduled_at`, [key, senderId, recipient, subject, body, scheduledAt, Number(delayMs), Number(hourlyLimit)]);
        if (result.rowCount) rows.push(result.rows[0]);
      }
      return rows;
    });
    await Promise.all(inserted.map((row) => emailQueue.add('send', { emailJobId: row.id }, { jobId: row.id, delay: Math.max(0, row.scheduled_at.getTime() - Date.now()), removeOnComplete: true, removeOnFail: false })));
    res.status(201).json({ scheduled: inserted.length });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Failed to schedule emails' }); }
});

app.get('/api/emails/scheduled', async (_req, res) => {
  const result = await pool.query("SELECT id, recipient AS email, subject, scheduled_at AS \"scheduledTime\", status FROM email_jobs WHERE status IN ('scheduled','processing') ORDER BY scheduled_at ASC");
  res.json(result.rows);
});

app.get('/api/emails/sent', async (_req, res) => {
  const result = await pool.query("SELECT id, recipient AS email, subject, sent_at AS \"sentTime\", status FROM email_jobs WHERE status IN ('sent','failed') ORDER BY sent_at DESC NULLS LAST");
  res.json(result.rows);
});

await migrate();
app.listen(config.port, () => console.log(`ReachInbox API listening on :${config.port}`));
