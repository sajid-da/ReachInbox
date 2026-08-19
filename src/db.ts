import { Pool, PoolClient } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.databaseUrl });

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate() {
  await withTransaction(async (client) => {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        sub TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        display_name TEXT NOT NULL,
        picture TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS senders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        display_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        idempotency_key TEXT NOT NULL UNIQUE,
        owner_sub TEXT,
        sender_id UUID NOT NULL REFERENCES senders(id),
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        scheduled_at TIMESTAMPTZ NOT NULL,
        min_delay_ms INTEGER NOT NULL DEFAULT 2000,
        hourly_limit INTEGER NOT NULL DEFAULT 200,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','processing','sent','failed')),
        sent_at TIMESTAMPTZ,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        processing_started_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS email_jobs_status_scheduled_idx ON email_jobs(status, scheduled_at)');
    await client.query('ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS min_delay_ms INTEGER NOT NULL DEFAULT 2000');
    await client.query('ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS hourly_limit INTEGER NOT NULL DEFAULT 200');
    await client.query('ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ');
    await client.query('ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS owner_sub TEXT');
    await client.query('CREATE INDEX IF NOT EXISTS email_jobs_owner_status_idx ON email_jobs(owner_sub, status, scheduled_at)');
    await client.query('INSERT INTO senders(email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [config.defaultSender]);
  });
}
