import { Worker } from './queue.js';
import { connection, emailQueue } from './queue.js';
import { config } from './config.js';
import { pool } from './db.js';
import { sendEmail } from './mailer.js';

type JobData = { emailJobId: string };
const hourWindow = () => Math.floor(Date.now() / 3_600_000);

const rateScript = `
local current = redis.call('GET', KEYS[1])
if not current then current = 0 end
if tonumber(current) >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 3700); return 1
`;

async function reschedule(id: string, delayMs: number, reason: string) {
  const next = new Date(Date.now() + delayMs);
  await pool.query('UPDATE email_jobs SET scheduled_at = $2, error = $3 WHERE id = $1', [id, next, reason]);
  await emailQueue.add('send', { emailJobId: id }, { jobId: `${id}:retry:${next.getTime()}`, delay: delayMs, removeOnComplete: true });
}

export const worker = new Worker<JobData>('email-sends', async (job) => {
  const result = await pool.query(`
    UPDATE email_jobs SET status = 'processing', attempts = attempts + 1
    WHERE id = $1 AND status = 'scheduled'
  RETURNING id, recipient, subject, body, sender_id, min_delay_ms, hourly_limit
  `, [job.data.emailJobId]);
  if (!result.rowCount) return;
  const row = result.rows[0] as { id: string; recipient: string; subject: string; body: string; sender_id: string; min_delay_ms: number; hourly_limit: number };
  const sender = await pool.query('SELECT email FROM senders WHERE id = $1', [row.sender_id]);
  const senderEmail = sender.rows[0]?.email;
  if (!senderEmail) throw new Error('Sender not found');

  const allowed = await connection.eval(rateScript, 1, `rate:${senderEmail}:${hourWindow()}`, String(row.hourly_limit));
  if (allowed !== 1) {
    await pool.query("UPDATE email_jobs SET status = 'scheduled' WHERE id = $1", [row.id]);
    const untilNextHour = 3_600_000 - (Date.now() % 3_600_000) + 1000;
    await reschedule(row.id, untilNextHour, 'Hourly rate limit reached');
    return;
  }

  const spacingKey = 'email-send-spacing';
  const acquired = await connection.set(spacingKey, String(Date.now()), 'PX', config.minSendDelayMs, 'NX');
  if (!acquired) {
    await pool.query("UPDATE email_jobs SET status = 'scheduled' WHERE id = $1", [row.id]);
    await reschedule(row.id, row.min_delay_ms, 'Minimum send spacing');
    return;
  }

  try {
    await sendEmail({ from: senderEmail, to: row.recipient, subject: row.subject, text: row.body });
    await pool.query("UPDATE email_jobs SET status = 'sent', sent_at = now(), error = NULL WHERE id = $1", [row.id]);
  } catch (error) {
    await pool.query("UPDATE email_jobs SET status = 'failed', error = $2 WHERE id = $1", [row.id, error instanceof Error ? error.message : String(error)]);
    throw error;
  }
}, { connection, concurrency: config.workerConcurrency, lockDuration: 120_000 });

worker.on('failed', (job, error) => console.error('email job failed', job?.id, error.message));
