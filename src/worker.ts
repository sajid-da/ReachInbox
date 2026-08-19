import { Worker } from './queue.js';
import crypto from 'node:crypto';
import { connection, emailQueue } from './queue.js';
import { config } from './config.js';
import { pool } from './db.js';
import { getPreviewUrl, sendEmail } from './mailer.js';

type JobData = { emailJobId: string };
const hourWindow = () => Math.floor(Date.now() / 3_600_000);

const rateScript = `
local current = redis.call('GET', KEYS[1])
if not current then current = 0 end
if tonumber(current) >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 3700); return 1
`;
const releaseSpacingScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end
`;

async function reschedule(id: string, delayMs: number, reason: string) {
  const next = new Date(Date.now() + delayMs);
  await pool.query('UPDATE email_jobs SET scheduled_at = $2, error = $3 WHERE id = $1', [id, next, reason]);
  await emailQueue.add('send', { emailJobId: id }, { jobId: `${id}:retry:${next.getTime()}`, delay: delayMs, removeOnComplete: true });
}

export const worker = new Worker<JobData>('email-sends', async (job) => {
  const result = await pool.query(`
    UPDATE email_jobs SET status = 'processing', processing_started_at = now(), attempts = attempts + 1
    WHERE id = $1 AND (
      status = 'scheduled' OR
      (status = 'processing' AND processing_started_at IS NOT NULL
        AND processing_started_at < now() - ($2 * interval '1 millisecond'))
    )
  RETURNING id, recipient, subject, body, sender_id, min_delay_ms, hourly_limit
  `, [job.data.emailJobId, config.processingTimeoutMs]);
  if (!result.rowCount) return;
  const row = result.rows[0] as { id: string; recipient: string; subject: string; body: string; sender_id: string; min_delay_ms: number; hourly_limit: number };
  const sender = await pool.query('SELECT email FROM senders WHERE id = $1', [row.sender_id]);
  const senderEmail = sender.rows[0]?.email;
  if (!senderEmail) throw new Error('Sender not found');

  const spacingKey = 'email-send-spacing';
  const spacingToken = crypto.randomUUID();
  const acquired = await connection.set(spacingKey, spacingToken, 'PX', config.minSendDelayMs, 'NX');
  if (!acquired) {
    await pool.query("UPDATE email_jobs SET status = 'scheduled', processing_started_at = NULL WHERE id = $1", [row.id]);
    await reschedule(row.id, row.min_delay_ms, 'Minimum send spacing');
    return;
  }

  const allowed = await connection.eval(rateScript, 1, `rate:${senderEmail}:${hourWindow()}`, String(row.hourly_limit));
  if (allowed !== 1) {
    await connection.eval(releaseSpacingScript, 1, spacingKey, spacingToken);
    await pool.query("UPDATE email_jobs SET status = 'scheduled', processing_started_at = NULL WHERE id = $1", [row.id]);
    const untilNextHour = 3_600_000 - (Date.now() % 3_600_000) + 1000;
    await reschedule(row.id, untilNextHour, 'Hourly rate limit reached');
    return;
  }

  try {
    const info = await sendEmail({ from: senderEmail, to: row.recipient, subject: row.subject, text: row.body });
    const previewUrl = getPreviewUrl(info);
    if (previewUrl) console.log('Ethereal preview URL:', previewUrl);
    await pool.query("UPDATE email_jobs SET status = 'sent', sent_at = now(), processing_started_at = NULL, error = NULL WHERE id = $1", [row.id]);
  } catch (error) {
    await pool.query("UPDATE email_jobs SET status = 'failed', processing_started_at = NULL, error = $2 WHERE id = $1", [row.id, error instanceof Error ? error.message : String(error)]);
    throw error;
  }
}, { connection, concurrency: config.workerConcurrency, lockDuration: config.workerLockDurationMs });

worker.on('failed', (job, error) => console.error('email job failed', job?.id, error.message));
